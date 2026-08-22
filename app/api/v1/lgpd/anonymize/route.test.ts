import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { cascadeRedactContact } from "@/lib/lgpd/redact-cascade";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/lgpd/redact-cascade", () => ({ cascadeRedactContact: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function request() {
  return new NextRequest("http://localhost/api/v1/lgpd/anonymize", {
    method: "POST",
    body: JSON.stringify({
      contact_id: CONTACT,
      justification: "Solicitação formal do titular",
    }),
    headers: { "content-type": "application/json" },
  });
}

function authOk() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER },
    org: { orgId: ORG, name: "Org", role: "admin" },
  } as never);
}

function supabaseWith(existing: { is_anonymized: boolean; anonymized_at: string | null }) {
  let contactRead = 0;
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER } }, error: null }) },
    from: vi.fn((table: string) => {
      expect(table).toBe("contacts");
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => {
        contactRead += 1;
        return contactRead === 1
          ? { data: { id: CONTACT, organization_id: ORG, ...existing }, error: null }
          : { data: { anonymized_at: "2026-08-22T12:00:00.000Z" }, error: null };
      });
      return chain;
    }),
    rpc,
  };
  vi.mocked(createClient).mockResolvedValue(client as never);
  return { client, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  authOk();
  vi.mocked(cascadeRedactContact).mockResolvedValue({
    alreadyAnonymized: false,
    counts: {},
    mediaPaths: [],
  });
});

describe("POST /api/v1/lgpd/anonymize", () => {
  it("usa a cascata completa e preserva o evento para os consumidores", async () => {
    const { rpc } = supabaseWith({ is_anonymized: false, anonymized_at: null });
    const { POST } = await import("./route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(cascadeRedactContact).toHaveBeenCalledWith({
      organizationId: ORG,
      contactId: CONTACT,
      requestId: expect.any(String),
    });
    expect(rpc).toHaveBeenCalledWith(
      "emit_event",
      expect.objectContaining({
        p_event_type: "contact.anonymized",
        p_organization_id: ORG,
      }),
    );
    expect((await response.json()).data).toMatchObject({
      contact_id: CONTACT,
      anonymized_at: "2026-08-22T12:00:00.000Z",
      action: "anonymized",
    });
  });

  it("é idempotente e não executa a cascata novamente", async () => {
    supabaseWith({ is_anonymized: true, anonymized_at: "2026-08-20T10:00:00.000Z" });
    const { POST } = await import("./route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(cascadeRedactContact).not.toHaveBeenCalled();
    expect((await response.json()).data.action).toBe("already_anonymized");
  });
});
