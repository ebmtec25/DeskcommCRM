/**
 * POST /api/v1/conversations/[id]/archive — arquiva a conversa e, se houver
 * um negócio aberto inequívoco do mesmo contato, marca-o como perdido.
 *
 * Duas ações, um clique: o botão "Arquivar" do atendimento existe porque a
 * pessoa que fecha o caso ali é a mesma que decide que o negócio não vai
 * fechar — pedir os dois cliques em duas telas diferentes é fricção sem
 * função. Reaproveita `encerraDemanda` (a MESMA regra do Kanban e da IA) em
 * vez de reimplementar o encerramento — duas implementações fariam humano e
 * IA fecharem negócio por critérios diferentes.
 *
 * NÃO adivinha: se o contato tem zero ou mais de um negócio aberto, a
 * conversa arquiva do mesmo jeito e o negócio fica intocado — mover o card
 * errado do cliente errado é o único bug aqui que o cliente final veria.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { encerraDemanda } from "@/lib/leads/encerramento";
import { loseLeadSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import type { Conversation } from "@/lib/types/messaging";

export const dynamic = "force-dynamic";

const SELECT_COLS = `
  id, organization_id, contact_id, channel_session_id, channel, status,
  status_changed_at, assigned_to_user_id, assigned_at, last_inbound_at,
  last_outbound_at, last_message_at, last_message_preview,
  unread_count_for_assignee, is_group, group_chat_id, metadata,
  created_at, updated_at
`;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const input = await validateRequest(loseLeadSchema, req).catch(() => null);

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("conversations")
    .update({ status: "archived", status_changed_at: now })
    .eq("id", id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const conv = data as unknown as Conversation;

  await audit({
    action: "conversation.archived",
    actorUserId: user.id,
    organizationId: conv.organization_id,
    resourceType: "conversation",
    resourceId: conv.id,
    requestId,
  });

  let leadArchived = false;
  if (input?.lost_reason && conv.contact_id) {
    const { data: candidatos, error: leadsErr } = await supabase
      .from("crm_leads")
      .select("id, organization_id, pipeline_id, status, last_activity_at, created_at")
      .eq("organization_id", org.orgId)
      .eq("contact_id", conv.contact_id);

    if (!leadsErr && candidatos) {
      const resolucao = resolveActiveLeadForContact(candidatos as LeadCandidate[]);
      if (resolucao.routed) {
        try {
          await encerraDemanda(
            supabase,
            { organization_id: org.orgId, actor: { type: "user", id: user.id }, requestId },
            { leadId: resolucao.leadId, desfecho: "lost", motivo: input.lost_reason },
          );
          leadArchived = true;
        } catch (err) {
          // Conversa já arquivou — falhar o encerramento do negócio não pode
          // derrubar isso. O erro sobe pro Sentry pelo caminho normal.
          if (!(err instanceof ApiError)) throw err;
        }
      }
    }
  }

  return ok({ conversation: conv, lead_archived: leadArchived }, { requestId });
}
