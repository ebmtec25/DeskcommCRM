import type { Queryable } from "../../queue/queue";

export interface AssumeConversationInput {
  organizationId: string;
  conversationId: string;
  agentId: string | null;
  jobId: string;
}

/**
 * Marca que a IA realmente assumiu uma conversa e grava a auditoria na mesma
 * instrução SQL. A transição é restrita a conversas abertas, sem atendente
 * humano, e é idempotente — reprocessar o mesmo turno não cria nova auditoria.
 */
export async function assumeConversationForAi(
  db: Queryable,
  input: AssumeConversationInput,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `with assumed as (
       update conversations
          set assignee_kind = 'ai',
              status = 'ai_handling',
              status_changed_at = now()
        where organization_id = $1
          and id = $2
          and assigned_to_user_id is null
          and status in ('open', 'pending')
          and (status <> 'ai_handling' or assignee_kind is distinct from 'ai')
       returning id
     )
     insert into api_audit_log
       (organization_id, action, resource_type, resource_id, request_id, bypassed_rls, metadata)
     select $1, 'conversation.ai_assumed', 'conversation', id, $4, true, $3::jsonb
       from assumed
     returning resource_id as id`,
    [
      input.organizationId,
      input.conversationId,
      JSON.stringify({ actor_kind: "ai_agent", agent_id: input.agentId }),
      input.jobId,
    ],
  );

  return rows.length > 0;
}
