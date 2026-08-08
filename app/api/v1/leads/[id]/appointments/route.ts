/**
 * GET  /api/v1/leads/[id]/appointments — a agenda DESTE negócio.
 * POST /api/v1/leads/[id]/appointments — marca um compromisso novo.
 *
 * `crm_lead_appointments` (migration 0116). Emite `appointment_scheduled` na
 * timeline ao criar — mesma política das outras rotas de leads: falha ao
 * emitir não desfaz a criação (`registraFalhaDeAtividade`), a mutação já
 * aconteceu e o rastro perdido é contado, não escondido.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAppointmentSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;
  const supabase = await createClient();

  const authz = await requireRole("agent", { requestId, resource: "crm_lead_appointments" });
  if (!authz.ok) return authz.response;

  const { data, error } = await supabase
    .from("crm_lead_appointments")
    .select("id, scheduled_at, note, status, created_at")
    .eq("lead_id", leadId)
    .eq("organization_id", authz.org.orgId)
    .order("scheduled_at", { ascending: true });

  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok({ items: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita no funil é agent+.
  const authz = await requireRole("agent", { requestId, resource: "crm_lead_appointments" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let input;
  try {
    input = await validateRequest(createAppointmentSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const { data: lead, error: leadErr } = await supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (leadErr) return fail("internal_error", leadErr.message, 500, { requestId });
  if (!lead) return fail("not_found", "Lead não encontrado.", 404, { requestId });

  const { data: appointment, error: insErr } = await supabase
    .from("crm_lead_appointments")
    .insert({
      organization_id: org.orgId,
      lead_id: leadId,
      contact_id: (lead as { contact_id: string | null }).contact_id,
      scheduled_at: input.scheduled_at,
      note: input.note ?? null,
      created_by_user_id: user.id,
    })
    .select("id, scheduled_at, note, status, created_at")
    .single();

  if (insErr) {
    console.error("[leads.appointments] insert failed", insErr.message);
    return fail("internal_error", "Falha ao marcar o agendamento.", 500, { requestId });
  }

  const atividade = await emitLeadActivity(supabase, {
    organizationId: org.orgId,
    leadId,
    contactId: (lead as { contact_id: string | null }).contact_id,
    type: "appointment_scheduled",
    sourceModule: "crm",
    sourceId: appointment.id,
    actor: { type: "user", id: user.id },
    reason: `Agendado para ${new Date(input.scheduled_at).toLocaleString("pt-BR")}`,
    payload: { appointment_id: appointment.id, scheduled_at: input.scheduled_at },
  });
  if (!atividade.ok) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: org.orgId,
      leadId,
      tipo: "appointment_scheduled",
      origem: "leads/[id]/appointments",
      erro: atividade.error,
      requestId,
    });
  }

  return ok(appointment, { requestId });
}
