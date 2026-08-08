/**
 * A agenda do negócio (crm_lead_appointments, migration 0116) — núcleo
 * compartilhado entre a rota REST (dossiê do lead, `/app/agenda`) e as tools
 * MCP (a IA pode marcar/ver/cancelar durante a conversa). Mesma razão de
 * `encerraDemanda`: duas implementações fariam humano e IA agendarem por
 * critérios diferentes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";

export interface LeadAppointmentRow {
  id: string;
  scheduled_at: string;
  note: string | null;
  status: "scheduled" | "cancelled";
  created_at: string;
}

const SELECT_COLS = "id, scheduled_at, note, status, created_at";

export async function listAppointmentsForLead(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  leadId: string,
): Promise<LeadAppointmentRow[]> {
  const { data, error } = await supabase
    .from("crm_lead_appointments")
    .select(SELECT_COLS)
    .eq("lead_id", leadId)
    .eq("organization_id", ctx.organization_id)
    .order("scheduled_at", { ascending: true });
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  return (data ?? []) as unknown as LeadAppointmentRow[];
}

export interface CreateAppointmentInput {
  scheduled_at: string;
  note?: string | null;
}

export async function createAppointment(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  leadId: string,
  input: CreateAppointmentInput,
): Promise<LeadAppointmentRow> {
  const { data: lead, error: leadErr } = await supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (leadErr) throw new ApiError(500, "internal_error", undefined, ctx.requestId, leadErr.message);
  if (!lead) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Lead não encontrado.");

  const contactId = (lead as { contact_id: string | null }).contact_id;
  const actorUserId = ctx.actor.type === "user" ? ctx.actor.id : null;

  const { data: appointment, error: insErr } = await supabase
    .from("crm_lead_appointments")
    .insert({
      organization_id: ctx.organization_id,
      lead_id: leadId,
      contact_id: contactId,
      scheduled_at: input.scheduled_at,
      note: input.note ?? null,
      created_by_user_id: actorUserId,
    })
    .select(SELECT_COLS)
    .single();
  if (insErr) {
    console.error("[leads.appointments] insert failed", insErr.message);
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      "Falha ao marcar o agendamento.",
    );
  }

  const row = appointment as unknown as LeadAppointmentRow;
  const atividade = await emitLeadActivity(supabase, {
    organizationId: ctx.organization_id,
    leadId,
    contactId,
    type: "appointment_scheduled",
    sourceModule: "crm",
    sourceId: row.id,
    actor: ctx.actor,
    reason: `Agendado para ${new Date(input.scheduled_at).toLocaleString("pt-BR")}`,
    payload: { appointment_id: row.id, scheduled_at: input.scheduled_at },
  });
  if (!atividade.ok) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: ctx.organization_id,
      leadId,
      tipo: "appointment_scheduled",
      origem: "leads/appointments",
      erro: atividade.error,
      requestId: ctx.requestId,
    });
  }

  return row;
}

export async function cancelAppointment(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  appointmentId: string,
): Promise<LeadAppointmentRow> {
  const { data: existing, error: selErr } = await supabase
    .from("crm_lead_appointments")
    .select("id, lead_id, contact_id, scheduled_at, status")
    .eq("id", appointmentId)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (selErr) throw new ApiError(500, "internal_error", undefined, ctx.requestId, selErr.message);
  if (!existing) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Agendamento não encontrado.");
  }

  if (existing.status === "cancelled") {
    const { data } = await supabase
      .from("crm_lead_appointments")
      .select(SELECT_COLS)
      .eq("id", appointmentId)
      .single();
    return data as unknown as LeadAppointmentRow;
  }

  const { data: updated, error: updErr } = await supabase
    .from("crm_lead_appointments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", appointmentId)
    .select(SELECT_COLS)
    .single();
  if (updErr) {
    console.error("[leads.appointments.cancel] update failed", updErr.message);
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      "Falha ao cancelar o agendamento.",
    );
  }

  const atividade = await emitLeadActivity(supabase, {
    organizationId: ctx.organization_id,
    leadId: existing.lead_id,
    contactId: existing.contact_id,
    type: "appointment_cancelled",
    sourceModule: "crm",
    sourceId: appointmentId,
    actor: ctx.actor,
    reason: `Agendamento de ${new Date(existing.scheduled_at).toLocaleString("pt-BR")} cancelado`,
    payload: { appointment_id: appointmentId },
  });
  if (!atividade.ok) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: ctx.organization_id,
      leadId: existing.lead_id,
      tipo: "appointment_cancelled",
      origem: "leads/appointments/cancel",
      erro: atividade.error,
      requestId: ctx.requestId,
    });
  }

  return updated as unknown as LeadAppointmentRow;
}
