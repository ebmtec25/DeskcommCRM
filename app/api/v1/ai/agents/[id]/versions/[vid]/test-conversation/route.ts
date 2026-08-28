/**
 * GET/DELETE /api/v1/ai/agents/:id/versions/:vid/test-conversation (admin)
 *
 * Companheiro de `../test/route.ts` (migration 0177). GET hidrata a tela com
 * a conversa de teste já existente deste admin para esta versão (ou
 * `test_conversation_id: null` se ainda não mandou nenhuma mensagem). DELETE
 * é o "resetar": apaga a linha de `ai_agent_test_conversations`, que em
 * cascade leva as mensagens — próxima chamada em `../test` começa uma
 * conversa nova. Nunca toca contacts/conversations/messages reais.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string; vid: string }> };

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id, vid } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(vid)) {
    return fail("invalid_request", "ids inválidos.", 400, { requestId });
  }

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const admin = createAdminClient();

  const { data: testConv } = await admin
    .from("ai_agent_test_conversations")
    .select("id, sample_contact_name, sample_contact_phone")
    .eq("organization_id", activeOrg.orgId)
    .eq("agent_id", id)
    .eq("agent_version_id", vid)
    .eq("created_by", authUser.id)
    .maybeSingle();

  if (!testConv) {
    return ok({ test_conversation_id: null, sample_contact: null, messages: [] }, { requestId });
  }

  const { data: messages } = await admin
    .from("ai_agent_test_messages")
    .select("id, role, content, tool_calls, guardrails, created_at")
    .eq("test_conversation_id", testConv.id)
    .order("created_at", { ascending: true });

  return ok(
    {
      test_conversation_id: testConv.id,
      sample_contact: {
        name: testConv.sample_contact_name,
        phone: testConv.sample_contact_phone,
      },
      messages: messages ?? [],
    },
    { requestId },
  );
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id, vid } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(vid)) {
    return fail("invalid_request", "ids inválidos.", 400, { requestId });
  }

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const admin = createAdminClient();

  const { error } = await admin
    .from("ai_agent_test_conversations")
    .delete()
    .eq("organization_id", activeOrg.orgId)
    .eq("agent_id", id)
    .eq("agent_version_id", vid)
    .eq("created_by", authUser.id);

  if (error) {
    return fail("internal_error", "Não consegui resetar a conversa de teste.", 500, { requestId });
  }

  void audit({
    action: "ai_agent.test_conversation_reset",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "ai_agent_version",
    resourceId: vid,
    requestId,
    metadata: {},
  });

  return ok({ reset: true }, { requestId });
}
