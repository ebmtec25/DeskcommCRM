import { describe, expect, it } from "vitest";

import { getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

const INPUT = { tenantId: "org-1", leadId: "contact-1", conversationId: "conv-1" };
const KNOBS = { historyLimit: 20, maxTokens: 1_000 };

function demand(id: string, at = "2026-08-22T10:00:00.000Z") {
  return {
    id,
    organization_id: "org-1",
    pipeline_id: "pipe-1",
    status: "open",
    last_activity_at: at,
    created_at: "2026-08-01T10:00:00.000Z",
    title: "Consultoria empresarial",
    description: "Precisa reduzir o tempo de resposta e integrar o WhatsApp.",
    stage_name: "Qualificado",
    tags: ["prioridade"],
  };
}

function dbWith(demands: ReturnType<typeof demand>[]) {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("from contacts")) {
        return {
          rows: [
            {
              name: "Cliente",
              display_name: "Cliente",
              email: null,
              phone_number: null,
              tags: [],
              is_blocked: false,
              source: "whatsapp",
              consent: null,
              is_anonymized: false,
            },
          ],
        };
      }
      if (sql.includes("from crm_leads l")) {
        expect(params).toEqual(["org-1", "contact-1"]);
        expect(sql).toContain("l.organization_id = $1");
        expect(sql).toContain("l.contact_id = $2");
        return { rows: demands };
      }
      if (sql.includes("from crm_pipelines")) return { rows: [] };
      return { rows: [] };
    },
  };
}

describe("getLeadContext — resumo estratégico do negócio", () => {
  it("entrega à IA o resumo do negócio ativo e seu estágio", async () => {
    const result = await getLeadContext(
      dbWith([demand("lead-1")]) as never,
      {} as never,
      INPUT,
      KNOBS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.open_demand).toEqual({
      status: "active",
      id: "lead-1",
      title: "Consultoria empresarial",
      summary: "Precisa reduzir o tempo de resposta e integrar o WhatsApp.",
      stage: "Qualificado",
      tags: ["prioridade"],
      created_at: "2026-08-01T10:00:00.000Z",
    });
  });

  it("declara ausência quando o contato não tem negócio aberto", async () => {
    const result = await getLeadContext(dbWith([]) as never, {} as never, INPUT, KNOBS);

    expect(result.ok && result.context.open_demand).toEqual({ status: "none" });
  });

  it("não escolhe um negócio quando os candidatos permanecem empatados", async () => {
    const result = await getLeadContext(
      dbWith([demand("lead-1"), demand("lead-2")]) as never,
      {} as never,
      INPUT,
      KNOBS,
    );

    expect(result.ok && result.context.open_demand).toEqual({
      status: "ambiguous",
      candidate_count: 2,
    });
  });
});
