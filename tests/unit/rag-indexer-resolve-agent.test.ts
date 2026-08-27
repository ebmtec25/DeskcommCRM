import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bug real medido em produção (26/08): um agente "cópia" foi ARQUIVADO mas
 * ainda carregava `is_active=true` (resíduo de antes do archive). O agente
 * default de verdade — dono da base de conhecimento, com versão publicada e
 * `channel_session_id` real — tinha `is_active=false`. `resolveAgent` filtrava
 * por `is_active`, então a reindexação de FAQ/catálogo sempre resolvia o
 * agente ERRADO (arquivado, sem fonte nenhuma) e pulava com "no_sources" sem
 * nunca reportar erro — a base de conhecimento ficava cadastrada mas inerte.
 *
 * Fonte da doutrina: `agent-config.ts` — "is_active é semântica do rag_bot
 * legado; para mcp_agent 'ativo' = published_version_id preenchido + não
 * arquivado". O fix troca o filtro de `is_active` para `archived_at is null`.
 */

interface AgenteFake {
  id: string;
  organization_id: string;
  active_kb_version_id: string | null;
  archived_at: string | null;
  is_default: boolean;
  created_at: string;
}

let agentes: AgenteFake[] = [];

function clienteFalso() {
  const abrir = (table: string) => {
    if (table !== "ai_agents") throw new Error(`tabela inesperada no teste: ${table}`);
    const filtros: { organizationId?: string; archivedAtIsNull?: boolean } = {};
    const b = {
      select: () => b,
      eq: (coluna: string, valor: unknown) => {
        if (coluna === "organization_id") filtros.organizationId = valor as string;
        return b;
      },
      is: (coluna: string, valor: unknown) => {
        if (coluna === "archived_at" && valor === null) filtros.archivedAtIsNull = true;
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: () => {
        let rows = agentes.filter((a) => a.organization_id === filtros.organizationId);
        if (filtros.archivedAtIsNull) rows = rows.filter((a) => a.archived_at === null);
        rows = [...rows].sort((a, b2) => {
          if (a.is_default !== b2.is_default) return a.is_default ? -1 : 1;
          return a.created_at.localeCompare(b2.created_at);
        });
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
    };
    return b;
  };
  return { from: abrir } as never;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => clienteFalso() }));

const { resolveAgent } = await import("@/workers/rag-indexer");

const ORG = "org-1";

beforeEach(() => {
  agentes = [];
});

describe("resolveAgent — arquivado não pode vencer o default vivo", () => {
  it("agente arquivado com is_active=true NÃO é escolhido — o default não-arquivado vence", async () => {
    agentes = [
      {
        id: "agente-default-vivo",
        organization_id: ORG,
        active_kb_version_id: "kb-1",
        archived_at: null,
        is_default: true,
        created_at: "2026-08-07T00:00:00Z",
      },
      {
        id: "agente-copia-arquivada",
        organization_id: ORG,
        active_kb_version_id: null,
        archived_at: "2026-08-22T19:11:54Z",
        is_default: false,
        created_at: "2026-08-21T00:00:00Z",
      },
    ];

    const resolved = await resolveAgent(ORG);
    expect(resolved?.id).toBe("agente-default-vivo");
  });

  it("sem default: escolhe o não-arquivado mais antigo, nunca o arquivado", async () => {
    agentes = [
      {
        id: "arquivado",
        organization_id: ORG,
        active_kb_version_id: null,
        archived_at: "2026-08-22T00:00:00Z",
        is_default: false,
        created_at: "2026-08-01T00:00:00Z",
      },
      {
        id: "vivo-mais-novo",
        organization_id: ORG,
        active_kb_version_id: "kb-2",
        archived_at: null,
        is_default: false,
        created_at: "2026-08-10T00:00:00Z",
      },
    ];

    const resolved = await resolveAgent(ORG);
    expect(resolved?.id).toBe("vivo-mais-novo");
  });

  it("nenhum agente na org: null", async () => {
    agentes = [];
    expect(await resolveAgent(ORG)).toBeNull();
  });
});
