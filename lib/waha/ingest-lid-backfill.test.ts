import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const getPhoneChatIdForLid = vi.fn();
vi.mock("@/lib/waha/client", () => ({
  getWahaClient: () => ({ getPhoneChatIdForLid }),
}));

import { dispatchWahaEvent, type WahaEnvelope, type WahaPayload } from "@/lib/waha/ingest";

/**
 * CONTATO SÓ-LID PODE JÁ TER TELEFONE CONHECIDO PELO WAHA.
 *
 * O WhatsApp manda `@lid` em vez do número real em cada vez mais chats — o
 * payload do webhook nunca traz o telefone nesses casos. Mas o cache
 * `noweb.store` do WAHA (quando ligado) sabe mapear lid -> telefone real; o
 * ingest tenta resolver isso best-effort ao criar/atualizar o contato, sem
 * deixar a falha (store desligado, lid desconhecido, WAHA fora) derrubar a
 * ingestão da mensagem em si.
 */

interface Duplo {
  admin: unknown;
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  contactUpdates: Array<{ id: string; org: string; phone_number: string }>;
}

function bancoDeMentira(): Duplo {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const contactUpdates: Array<{ id: string; org: string; phone_number: string }> = [];
  const consulta = () => {
    const q = {
      eq: () => q,
      in: () => q,
      limit: () => q,
      is: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return q;
  };
  const admin = {
    from: (table: string) => {
      if (table === "contacts") {
        return {
          select: () => consulta(),
          update: (patch: { phone_number: string }) => {
            const chain = {
              id: "",
              org: "",
              eq(coluna: string, valor: string) {
                if (coluna === "id") chain.id = valor;
                if (coluna === "organization_id") chain.org = valor;
                return chain;
              },
              is: async () => {
                contactUpdates.push({ id: chain.id, org: chain.org, phone_number: patch.phone_number });
                return { error: null };
              },
            };
            return chain;
          },
        };
      }
      return {
        select: () => consulta(),
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: { id: "msg-1" }, error: null }),
          }),
        }),
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };
  return { admin, rpcs, contactUpdates };
}

const SESSION = { id: "sessao-1", organization_id: "org-1", waha_session_name: "org_1_abc" };

function inboundDeLid(lid: string): WahaEnvelope {
  const from = `${lid}@lid`;
  const payload: WahaPayload = { id: `false_${from}_3EB0ABC`, from, fromMe: false, body: "oi" };
  return { event: "message.any", session: "org_1_abc", payload };
}

describe("backfill de telefone via lid", () => {
  beforeEach(() => {
    getPhoneChatIdForLid.mockReset();
  });

  it("resolve e grava o telefone quando o WAHA conhece o lid", async () => {
    getPhoneChatIdForLid.mockResolvedValueOnce("5511999999999@c.us");
    const { admin, contactUpdates } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, inboundDeLid("182527536959716"), "req-1");

    expect(getPhoneChatIdForLid).toHaveBeenCalledWith("org_1_abc", "182527536959716");
    expect(contactUpdates).toEqual([{ id: "contato-1", org: "org-1", phone_number: "+5511999999999" }]);
  });

  it("lid desconhecido do WAHA (pn null) não grava nada e não quebra a ingestão", async () => {
    getPhoneChatIdForLid.mockResolvedValueOnce(null);
    const { admin, contactUpdates, rpcs } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, inboundDeLid("999"), "req-1");

    expect(contactUpdates).toEqual([]);
    // a mensagem ainda foi ingerida — a falha de resolução não derruba o resto
    expect(rpcs.find((c) => c.fn === "fn_upsert_wa_conversation")).toBeDefined();
  });

  it("contato de telefone normal (não-lid) nunca chama a resolução de lid", async () => {
    const { admin, contactUpdates } = bancoDeMentira();
    const payload: WahaPayload = {
      id: "false_5511999999999@c.us_3EB0ABC",
      from: "5511999999999@c.us",
      fromMe: false,
      body: "oi",
    };
    const envelope: WahaEnvelope = { event: "message.any", session: "org_1_abc", payload };

    await dispatchWahaEvent(admin as never, SESSION as never, envelope, "req-1");

    expect(getPhoneChatIdForLid).not.toHaveBeenCalled();
    expect(contactUpdates).toEqual([]);
  });
});
