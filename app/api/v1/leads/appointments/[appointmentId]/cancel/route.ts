/**
 * POST /api/v1/leads/appointments/[appointmentId]/cancel
 *
 * Lógica em `lib/leads/appointments.ts` — compartilhada com a tool MCP
 * `crm_cancel_appointment`. Idempotente: cancelar de novo devolve 200 sem
 * reemitir atividade.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { cancelAppointment } from "@/lib/leads/appointments";

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

  try {
    const updated = await cancelAppointment(
      supabase,
      { organization_id: org.orgId, actor: { type: "user", id: user.id }, requestId },
      appointmentId,
    );
    return ok(updated, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
