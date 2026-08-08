/**
 * MCP tools sobre a agenda do negócio (crm_lead_appointments, migration 0116).
 *
 * Reusa `lib/leads/appointments.ts` — a MESMA lógica que a tela do dossiê e
 * `/app/agenda` chamam. Duas implementações fariam a IA e o humano marcarem
 * compromisso por critérios diferentes (mesmo raciocínio de `encerraDemanda`).
 *
 * Distinto de `crm_schedule_followup` (lib/mcp/tools/retencao.ts): aquele é o
 * retorno INTERNO do agente (um por contato, dispara o próprio agente de
 * novo); isto é um HORÁRIO MARCADO com a pessoa — vários por lead, aparece na
 * tela de Agenda pro humano ver.
 */
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import {
  cancelAppointment,
  createAppointment,
  listAppointmentsForLead,
} from "@/lib/leads/appointments";
import type { McpContext, McpToolDefinition } from "../types";

const scheduleInputShape = {
  lead_id: z.string().uuid(),
  scheduled_at: z.string().datetime({ offset: true }),
  note: z.string().max(1000).optional(),
};

export const crmScheduleAppointment: McpToolDefinition<typeof scheduleInputShape> = {
  name: "crm_schedule_appointment",
  description:
    "Marca um compromisso (reunião, ligação ou visita) com o lead. scheduled_at é ISO 8601 " +
    "ABSOLUTO e no futuro — se você não sabe que dia é hoje, use crm_list_appointments primeiro " +
    "para ver o relógio implícito nos compromissos existentes, ou peça a data ao cliente. " +
    "Vários compromissos por lead são permitidos.",
  inputSchema: scheduleInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx: McpContext) => {
    if (new Date(input.scheduled_at).getTime() <= Date.now()) {
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "scheduled_at precisa estar no futuro.",
      );
    }
    const appointment = await createAppointment(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      input.lead_id,
      { scheduled_at: input.scheduled_at, note: input.note },
    );
    return { appointment };
  },
};

const cancelInputShape = {
  appointment_id: z.string().uuid(),
};

export const crmCancelAppointment: McpToolDefinition<typeof cancelInputShape> = {
  name: "crm_cancel_appointment",
  description:
    "Cancela um compromisso marcado que ainda não passou. Idempotente: cancelar de novo não é erro.",
  inputSchema: cancelInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx: McpContext) => {
    const appointment = await cancelAppointment(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      input.appointment_id,
    );
    return { appointment };
  },
};

const listInputShape = {
  lead_id: z.string().uuid(),
};

export const crmListAppointments: McpToolDefinition<typeof listInputShape> = {
  name: "crm_list_appointments",
  description:
    "Lista os compromissos de um lead, do mais próximo ao mais antigo, com status " +
    "scheduled/cancelled. Use antes de marcar um novo, para não propor dois horários com a mesma pessoa.",
  inputSchema: listInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx: McpContext) => {
    const items = await listAppointmentsForLead(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      input.lead_id,
    );
    return { items };
  },
};
