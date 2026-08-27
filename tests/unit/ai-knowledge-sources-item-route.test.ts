/**
 * GET/PATCH /api/v1/ai/knowledge/sources/[id] — a rota por trás da aba
 * "Conhecimento" do agente. O botão "Editar conteúdo" era um stub (só um
 * toast "em breve"); a tela nova depende de dois comportamentos que nunca
 * tinham teste:
 *
 *   1. GET reconstrói `markdown_blob` a partir de `ai_faq_items`, no mesmo
 *      formato que a criação aceita — é o que pré-preenche o editor.
 *   2. PATCH aceita `markdown_blob` (mesmo parser do POST) e, principalmente,
 *      vale para 'policy' também — o código antigo só substituía os itens
 *      quando `source_type === "faq"`, e uma edição de política era aceita
 *      com 200 e descartada em silêncio (o mesmo defeito que o POST já
 *      corrigiu, agora do lado da edição).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const KS_ID = "33333333-3333-4333-8333-333333333333";

function sessaoOk(): void {
  const user = { id: "user-1", email: "u@example.com" } as unknown as AuthUser;
  vi.mocked(loadAuthUser).mockResolvedValue(user);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG_ID, name: "Org", role: "manager" });
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG_ID, name: "Org", role: "manager" },
  });
}

interface FakeSource {
  id: string;
  agent_id: string;
  source_type: string;
  name: string;
}

/** Dubla o client user-scoped: lê a fonte e (se aplicável) os itens dela. */
function dublarLeitura(source: FakeSource | null, itens: Array<{ question: string; answer: string }>) {
  vi.mocked(createClient).mockResolvedValue({
    from: (tabela: string) => {
      if (tabela === "ai_knowledge_sources") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: source, error: null }) }),
            }),
          }),
        };
      }
      if (tabela === "ai_faq_items") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: itens, error: null }),
            }),
          }),
        };
      }
      throw new Error(`tabela inesperada no teste: ${tabela}`);
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function reqGet(): NextRequest {
  return new NextRequest(`http://localhost/api/v1/ai/knowledge/sources/${KS_ID}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/ai/knowledge/sources/[id] — reconstrói o markdown pra pré-preencher a edição", () => {
  it("faq com itens devolve markdown no formato ## Pergunta:/## Resposta:", async () => {
    sessaoOk();
    dublarLeitura({ id: KS_ID, agent_id: AGENT_ID, source_type: "faq", name: "FAQ" }, [
      { question: "Qual o prazo?", answer: "Dois dias." },
      { question: "Fazem troca?", answer: "Sim, em 30 dias." },
    ]);
    const { GET } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
    const res = await GET(reqGet(), { params: Promise.resolve({ id: KS_ID }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { markdown_blob: string } };
    expect(body.data.markdown_blob).toBe(
      "## Pergunta: Qual o prazo?\n## Resposta: Dois dias.\n\n## Pergunta: Fazem troca?\n## Resposta: Sim, em 30 dias.",
    );
  });

  it("catalog/conversations não têm conteúdo colado — markdown_blob vazio, sem consultar ai_faq_items", async () => {
    sessaoOk();
    dublarLeitura({ id: KS_ID, agent_id: AGENT_ID, source_type: "catalog", name: "Catálogo" }, []);
    const { GET } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
    const res = await GET(reqGet(), { params: Promise.resolve({ id: KS_ID }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { markdown_blob: string } };
    expect(body.data.markdown_blob).toBe("");
  });

  it("fonte inexistente (ou de outra org) → 404", async () => {
    sessaoOk();
    dublarLeitura(null, []);
    const { GET } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
    const res = await GET(reqGet(), { params: Promise.resolve({ id: KS_ID }) });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/ai/knowledge/sources/[id] — markdown_blob vale para policy também", () => {
  function reqPatch(body: Record<string, unknown>): NextRequest {
    return new NextRequest(`http://localhost/api/v1/ai/knowledge/sources/${KS_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function dublarAdmin() {
    const escritas: Array<{ tabela: string; op: string; payload?: unknown }> = [];
    const admin = {
      from: (tabela: string) => ({
        update: (payload: unknown) => {
          escritas.push({ tabela, op: "update", payload });
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        delete: () => {
          escritas.push({ tabela, op: "delete" });
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        insert: (payload: unknown) => {
          escritas.push({ tabela, op: "insert", payload });
          return Promise.resolve({ error: null });
        },
      }),
      rpc: async () => ({ error: null }),
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);
    return escritas;
  }

  it("edita uma fonte 'policy' via markdown_blob — o defeito era só aceitar 'faq'", async () => {
    sessaoOk();
    dublarLeitura({ id: KS_ID, agent_id: AGENT_ID, source_type: "policy", name: "Política" }, []);
    const escritas = dublarAdmin();
    const { PATCH } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
    const res = await PATCH(
      reqPatch({ markdown_blob: "## Pergunta: Trocam?\n## Resposta: Sim, em 30 dias." }),
      { params: Promise.resolve({ id: KS_ID }) },
    );

    expect(res.status).toBe(200);
    const insercao = escritas.find((e) => e.tabela === "ai_faq_items" && e.op === "insert");
    expect(insercao).toBeDefined();
    expect(insercao?.payload).toMatchObject([
      expect.objectContaining({ question: "Trocam?", answer: "Sim, em 30 dias." }),
    ]);
  });

  it("markdown_blob sem par pergunta/resposta válido → 400, nada é gravado", async () => {
    sessaoOk();
    dublarLeitura({ id: KS_ID, agent_id: AGENT_ID, source_type: "faq", name: "FAQ" }, []);
    const escritas = dublarAdmin();
    const { PATCH } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
    const res = await PATCH(reqPatch({ markdown_blob: "texto solto sem marcador nenhum" }), {
      params: Promise.resolve({ id: KS_ID }),
    });

    expect(res.status).toBe(400);
    expect(escritas.filter((e) => e.tabela === "ai_faq_items")).toHaveLength(0);
  });

  it("catalog/conversations ignoram markdown_blob — não têm conteúdo colado", async () => {
    sessaoOk();
    dublarLeitura({ id: KS_ID, agent_id: AGENT_ID, source_type: "catalog", name: "Catálogo" }, []);
    const escritas = dublarAdmin();
    const { PATCH } = await import("@/app/api/v1/ai/knowledge/sources/[id]/route");
    const res = await PATCH(reqPatch({ markdown_blob: "## Pergunta: X\n## Resposta: Y" }), {
      params: Promise.resolve({ id: KS_ID }),
    });

    expect(res.status).toBe(200);
    expect(escritas.filter((e) => e.tabela === "ai_faq_items")).toHaveLength(0);
  });
});
