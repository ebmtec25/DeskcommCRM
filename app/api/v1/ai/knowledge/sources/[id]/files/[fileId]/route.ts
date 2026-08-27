/**
 * DELETE /api/v1/ai/knowledge/sources/[id]/files/[fileId]
 *
 * Remove um arquivo individual da biblioteca de documentos de uma fonte
 * (`ai_document_files`). Upload acrescenta; isto é o par que tira — apaga o
 * blob do Storage (best-effort) e a linha, e reemite `knowledge_source.updated`
 * pra reindexar sem aquele arquivo.
 *
 * Não apaga `ai_chunks` diretamente: a reindexação total reconstrói a base
 * numa versão nova, só ativada se sobrar algo pra indexar (nunca troca uma
 * base funcionando por uma vazia — mesma doutrina de qualquer edição de fonte).
 *
 * Auth: cookie session, role >= manager. organization_id sempre resolvido da
 * sessão — nunca do path.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId, fileId } = await params;

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  // Verifica posse com client de usuário (RLS) — a fonte tem que existir e
  // pertencer à org, e o arquivo tem que pertencer À FONTE (não só à org:
  // evita apagar um arquivo de outra fonte passando o id certo por acidente).
  const supabase = await createClient();
  const { data: source, error: sourceErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id, agent_id, source_type")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (sourceErr) {
    console.error("[ai-document-files] DELETE source lookup failed:", sourceErr.message);
    return fail("internal_error", "Erro ao verificar fonte.", 500, { requestId });
  }
  if (!source) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }

  const { data: file, error: fileErr } = await supabase
    .from("ai_document_files")
    .select("id, blob_path")
    .eq("id", fileId)
    .eq("knowledge_source_id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (fileErr) {
    console.error("[ai-document-files] DELETE file lookup failed:", fileErr.message);
    return fail("internal_error", "Erro ao verificar arquivo.", 500, { requestId });
  }
  if (!file) {
    return fail("not_found", "Arquivo não encontrado nesta fonte.", 404, { requestId });
  }

  const { blob_path: blobPath } = file as { id: string; blob_path: string };
  const admin = createAdminClient();

  // Best-effort: mesmo se o blob já não existir no Storage, a linha some da
  // lista de qualquer jeito — não deixar um objeto órfão bloquear a remoção.
  const { error: rmErr } = await admin.storage.from("ai-policy").remove([blobPath]);
  if (rmErr) {
    console.warn("[ai-document-files] blob removal failed (non-blocking):", rmErr.message);
  }

  const { error: delErr } = await admin
    .from("ai_document_files")
    .delete()
    .eq("id", fileId)
    .eq("organization_id", activeOrg.orgId);

  if (delErr) {
    console.error("[ai-document-files] DELETE row failed:", delErr.message);
    return fail("internal_error", "Erro ao remover o arquivo.", 500, { requestId });
  }

  const { agent_id: agentId, source_type: sourceType } = source as {
    agent_id: string;
    source_type: string;
  };

  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: sourceId,
    p_payload: {
      knowledge_source_id: sourceId,
      agent_id: agentId,
      source_type: sourceType,
    },
    p_organization_id: activeOrg.orgId,
  } as never);

  if (emitErr) {
    console.warn("[ai-document-files] emit_event failed (non-blocking):", emitErr.message);
  }

  return ok({ id: fileId, deleted: true }, { requestId });
}
