/**
 * POST /api/v1/leads/appointments/[appointmentId]/cancel
 *
 * Idempotente: cancelar um agendamento já cancelado devolve 200 sem
 * reemitir atividade (mesma política de `encerraDemanda`).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ appointmentId: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { appointmentId } = await ctx.params;
  const supabase = await createClient();

  const authz = await requireRole("agent", { requestId, resource: "crm_lead_appointments" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const { data: existing, error: selErr } = await supabase
    .from("crm_lead_appointments")
    .select("id, lead_id, contact_id, scheduled_at, status")
    .eq("id", appointmentId)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (selErr) return fail("internal_error", selErr.message, 500, { requestId });
  if (!existing) return fail("not_found", "Agendamento não encontrado.", 404, { requestId });

  if (existing.status === "cancelled") {
    return ok(existing, { requestId });
  }

  const { data: updated, error: updErr } = await supabase
    .from("crm_lead_appointments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", appointmentId)
    .select("id, scheduled_at, note, status, created_at")
    .single();
  if (updErr) {
    console.error("[leads.appointments.cancel] update failed", updErr.message);
    return fail("internal_error", "Falha ao cancelar o agendamento.", 500, { requestId });
  }

  const atividade = await emitLeadActivity(supabase, {
    organizationId: org.orgId,
    leadId: existing.lead_id,
    contactId: existing.contact_id,
    type: "appointment_cancelled",
    sourceModule: "crm",
    sourceId: appointmentId,
    actor: { type: "user", id: user.id },
    reason: `Agendamento de ${new Date(existing.scheduled_at).toLocaleString("pt-BR")} cancelado`,
    payload: { appointment_id: appointmentId },
  });
  if (!atividade.ok) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: org.orgId,
      leadId: existing.lead_id,
      tipo: "appointment_cancelled",
      origem: "leads/appointments/[appointmentId]/cancel",
      erro: atividade.error,
      requestId,
    });
  }

  return ok(updated, { requestId });
}
