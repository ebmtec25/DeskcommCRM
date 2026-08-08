/**
 * GET  /api/v1/leads/[id]/appointments — a agenda DESTE negócio.
 * POST /api/v1/leads/[id]/appointments — marca um compromisso novo.
 *
 * Lógica em `lib/leads/appointments.ts` — compartilhada com as tools MCP
 * (a IA usa a MESMA função pra marcar/ver agendamento).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAppointmentSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { createAppointment, listAppointmentsForLead } from "@/lib/leads/appointments";

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

  try {
    const items = await listAppointmentsForLead(
      supabase,
      { organization_id: authz.org.orgId, actor: { type: "user", id: authz.user.id }, requestId },
      leadId,
    );
    return ok({ items }, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita no funil é agent+.
  const authz = await requireRole("agent", { requestId, resource: "crm_lead_appointments" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  try {
    const input = await validateRequest(createAppointmentSchema, req);
    const appointment = await createAppointment(
      supabase,
      { organization_id: org.orgId, actor: { type: "user", id: user.id }, requestId },
      leadId,
      input,
    );
    return ok(appointment, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
}
