import { describe, expect, it, vi } from "vitest";

import { patchConversationHandler } from "@/app/api/v1/conversations/_handler";
import { audit } from "@/lib/audit";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "44444444-4444-4444-8444-444444444444";

function supabaseStub() {
  let payload: Record<string, unknown> | null = null;
  const filtros: Array<[string, unknown]> = [];
  const chain = {
    update: (next: Record<string, unknown>) => {
      payload = next;
      return chain;
    },
    eq: (field: string, value: unknown) => {
      filtros.push([field, value]);
      return chain;
    },
    select: () => chain,
    maybeSingle: async () => ({
      data: {
        id: CONVERSA,
        organization_id: ORG,
        status: "archived",
        unread_count_for_assignee: 0,
      },
      error: null,
    }),
  };

  return {
    client: { from: () => chain } as never,
    payload: () => payload,
    filtros,
  };
}

describe("arquivar conversa", () => {
  it("mantém o histórico, muda apenas o estado e limpa a pendência", async () => {
    const db = supabaseStub();
    const result = await patchConversationHandler(
      db.client,
      {
        organization_id: ORG,
        requestId: "req-1",
        actor: { type: "user", id: "user-1" },
      },
      CONVERSA,
      { status: "archived" },
    );

    expect(db.payload()).toMatchObject({ status: "archived", unread_count_for_assignee: 0 });
    expect(db.payload()).not.toHaveProperty("contact_id");
    expect(db.payload()).not.toHaveProperty("messages");
    expect(db.filtros).toEqual(
      expect.arrayContaining([
        ["id", CONVERSA],
        ["organization_id", ORG],
      ]),
    );
    expect(result.status).toBe("archived");
  });

  it("registra a ação certa na auditoria", async () => {
    vi.mocked(audit).mockClear();
    const db = supabaseStub();

    await patchConversationHandler(
      db.client,
      {
        organization_id: ORG,
        requestId: "req-2",
        actor: { type: "user", id: "user-1" },
      },
      CONVERSA,
      { status: "archived" },
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "conversation.archived",
        organizationId: ORG,
        resourceId: CONVERSA,
      }),
    );
  });
});
