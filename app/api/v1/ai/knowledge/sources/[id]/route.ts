/**
 * GET    /api/v1/ai/knowledge/sources/[id]  — read one source + its content
 * PATCH  /api/v1/ai/knowledge/sources/[id]  — update knowledge source
 * DELETE /api/v1/ai/knowledge/sources/[id]  — soft-delete (status='archived')
 *
 * Auth: cookie session. GET só exige sessão (mesmo padrão do GET de listagem);
 * PATCH/DELETE exigem role >= manager.
 * organization_id is ALWAYS resolved from the authenticated session — never from body/path.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseFaqMarkdown, toFaqMarkdown } from "@/lib/ai/rag/ingest/faq";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Zod schema for PATCH
// ---------------------------------------------------------------------------

const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
  locale: z.string().optional().default("pt-BR"),
});

const patchSourceSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  items: z.array(faqItemSchema).optional(),
  // Mesmo atalho que o POST de criação já oferece: cola o markdown, o servidor
  // parseia. Sem isto a tela de edição teria que reimplementar o parser no
  // cliente pra mandar `items` estruturado — a mesma regra em dois lugares.
  markdown_blob: z.string().optional(),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// GET — read one source, with content pra pré-preencher a edição
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId } = await params;

  const authUser = await loadAuthUser();
  if (!authUser) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) {
    return fail("forbidden", "Nenhuma organização ativa.", 403, { requestId });
  }

  const supabase = await createClient();
  const { data: source, error: srcErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id, agent_id, source_type, name")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (srcErr) {
    console.error("[ai-knowledge-sources] GET one failed:", srcErr.message);
    return fail("internal_error", "Erro ao carregar fonte.", 500, { requestId });
  }
  if (!source) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }

  const src = source as { id: string; agent_id: string; source_type: string; name: string };

  // Só faq/policy têm conteúdo colado pra devolver — catalog/conversations são
  // preenchidos por pipeline (ver NovaFonteDialog) e não têm markdown nenhum.
  let markdownBlob = "";
  if (src.source_type === "faq" || src.source_type === "policy") {
    const { data: items, error: itemsErr } = await supabase
      .from("ai_faq_items")
      .select("question, answer")
      .eq("knowledge_source_id", sourceId)
      .order("position", { ascending: true });

    if (itemsErr) {
      console.error("[ai-knowledge-sources] GET one items failed:", itemsErr.message);
      return fail("internal_error", "Erro ao carregar conteúdo da fonte.", 500, { requestId });
    }
    markdownBlob = toFaqMarkdown((items ?? []) as Array<{ question: string; answer: string }>);
  }

  // Biblioteca de documentos: só 'policy' tem arquivos — a lista que o
  // DocumentosDialog usa pra mostrar o que já foi enviado.
  let files: Array<{
    id: string;
    filename: string;
    size_bytes: number;
    ext: string;
    status: string;
    error: string | null;
    chunk_count: number;
    created_at: string;
  }> = [];
  if (src.source_type === "policy") {
    const { data: fileRows, error: filesErr } = await supabase
      .from("ai_document_files")
      .select("id, filename, size_bytes, ext, status, error, chunk_count, created_at")
      .eq("knowledge_source_id", sourceId)
      .order("created_at", { ascending: false });

    if (filesErr) {
      console.error("[ai-knowledge-sources] GET one files failed:", filesErr.message);
      return fail("internal_error", "Erro ao carregar arquivos da fonte.", 500, { requestId });
    }
    files = fileRows ?? [];
  }

  return ok(
    {
      id: src.id,
      agent_id: src.agent_id,
      source_type: src.source_type,
      name: src.name,
      markdown_blob: markdownBlob,
      files,
    },
    { requestId },
  );
}

// ---------------------------------------------------------------------------
// Shared: resolve auth + role gate
// ---------------------------------------------------------------------------

async function resolveContext(requestId: string) {
  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return { error: authz.response };
  return { authUser: authz.user, activeOrg: authz.org };
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId } = await params;

  const ctx = await resolveContext(requestId);
  if (ctx.error) return ctx.error;
  const { activeOrg } = ctx as Exclude<typeof ctx, { error: Response }>;

  // Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }

  const parsed = patchSourceSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const input = parsed.data;

  // Verify the source exists and belongs to the org (user-scoped client for RLS check).
  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id, source_type, agent_id")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[ai-knowledge-sources] PATCH fetch failed:", fetchErr.message);
    return fail("internal_error", "Erro ao verificar fonte.", 500, { requestId });
  }
  if (!existing) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }

  const ksRow = existing as { id: string; source_type: string; agent_id: string };

  // Build update payload (only provided fields).
  const updatePayload: Record<string, unknown> = {};
  if (input.name !== undefined) updatePayload.name = input.name;
  if (input.source_metadata !== undefined) updatePayload.source_metadata = input.source_metadata;

  const admin = createAdminClient();

  if (Object.keys(updatePayload).length > 0) {
    const { error: updateErr } = await admin
      .from("ai_knowledge_sources")
      .update(updatePayload)
      .eq("id", sourceId)
      .eq("organization_id", activeOrg.orgId);

    if (updateErr) {
      console.error("[ai-knowledge-sources] PATCH update failed:", updateErr.message);
      return fail("internal_error", "Erro ao atualizar fonte.", 500, { requestId });
    }
  }

  // Replace FAQ items if provided — vale para 'faq' E 'policy' (mesmo ajuste do
  // POST de criação: os dois tipos guardam pergunta/resposta na mesma tabela;
  // filtrar só por 'faq' aqui aceitava edição de política e descartava em
  // silêncio). `markdown_blob` é o atalho que a tela de edição usa — mesmo
  // parser do cadastro, pra não duplicar a regra em dois lugares.
  const tipoTemConteudoColado = ksRow.source_type === "faq" || ksRow.source_type === "policy";
  let itemsParaGravar: Array<{ question: string; answer: string; tags: string[]; locale: string }> | undefined;
  if (input.items !== undefined) {
    itemsParaGravar = input.items;
  } else if (input.markdown_blob !== undefined && tipoTemConteudoColado) {
    itemsParaGravar = parseFaqMarkdown(input.markdown_blob);
    if (itemsParaGravar.length === 0) {
      return fail(
        "invalid_request",
        "markdown_blob não contém itens válidos. Use seções ## Pergunta: / ## Resposta:.",
        400,
        { requestId },
      );
    }
  }

  let itemsCount: number | undefined;
  if (itemsParaGravar !== undefined && tipoTemConteudoColado) {
    // Delete existing items.
    const { error: delErr } = await admin
      .from("ai_faq_items")
      .delete()
      .eq("knowledge_source_id", sourceId)
      .eq("organization_id", activeOrg.orgId);

    if (delErr) {
      console.error("[ai-knowledge-sources] PATCH delete items failed:", delErr.message);
      return fail("internal_error", "Erro ao remover itens antigos.", 500, { requestId });
    }

    if (itemsParaGravar.length > 0) {
      const rows = itemsParaGravar.map((item, idx) => ({
        organization_id: activeOrg.orgId,
        knowledge_source_id: sourceId,
        question: item.question,
        answer: item.answer,
        tags: item.tags,
        locale: item.locale,
        position: idx,
      }));

      const { error: insertErr } = await admin.from("ai_faq_items").insert(rows);

      if (insertErr) {
        console.error("[ai-knowledge-sources] PATCH insert items failed:", insertErr.message);
        return fail("internal_error", "Erro ao inserir novos itens FAQ.", 500, { requestId });
      }
      itemsCount = rows.length;
    } else {
      itemsCount = 0;
    }
  }

  // Emit knowledge_source.updated (fire-and-forget).
  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: sourceId,
    p_payload: {
      knowledge_source_id: sourceId,
      agent_id: ksRow.agent_id,
      source_type: ksRow.source_type,
    },
    p_organization_id: activeOrg.orgId,
  } as never);

  if (emitErr) {
    console.warn("[ai-knowledge-sources] emit_event failed (non-blocking):", emitErr.message);
  }

  return ok(
    { id: sourceId, ...(itemsCount !== undefined ? { items_count: itemsCount } : {}) },
    { requestId },
  );
}

// ---------------------------------------------------------------------------
// DELETE — soft-delete (status='archived')
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId } = await params;

  const ctx = await resolveContext(requestId);
  if (ctx.error) return ctx.error;
  const { activeOrg } = ctx as Exclude<typeof ctx, { error: Response }>;

  // Verify ownership with user-scoped client.
  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[ai-knowledge-sources] DELETE fetch failed:", fetchErr.message);
    return fail("internal_error", "Erro ao verificar fonte.", 500, { requestId });
  }
  if (!existing) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }

  const admin = createAdminClient();
  const { error: archiveErr } = await admin
    .from("ai_knowledge_sources")
    .update({ status: "archived" })
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId);

  if (archiveErr) {
    console.error("[ai-knowledge-sources] DELETE archive failed:", archiveErr.message);
    return fail("internal_error", "Erro ao arquivar fonte.", 500, { requestId });
  }

  return ok({ id: sourceId, status: "archived" }, { requestId });
}
