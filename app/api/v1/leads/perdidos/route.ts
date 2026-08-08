/**
 * GET /api/v1/leads/perdidos
 *
 * Lista org-wide de negócios `status='lost'`, filtrável por motivo e período —
 * o lugar para onde o card sai quando arquivado (Kanban e Inbox). Existe
 * porque uma coluna "Perdidos" no fim de um board largo não serve remarketing:
 * ninguém rola até lá, e não dá pra segmentar por motivo/valor/data. RLS
 * escopa por organização (mesmo client autenticado do board).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  lost_reason: z.string().min(1).max(500).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  pipeline_id: z.string().uuid().optional(),
});

export interface LeadPerdido {
  id: string;
  title: string;
  value_cents: number | null;
  currency: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  pipeline_id: string;
  pipeline_name: string;
  contact: { name: string | null; phone_number: string | null } | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { limit, lost_reason, from, to, pipeline_id } = parsed.data;

  let query = supabase
    .from("crm_leads")
    .select("id, title, value_cents, currency, lost_reason, closed_at, pipeline_id, contact_id")
    .eq("status", "lost")
    .order("closed_at", { ascending: false })
    .limit(limit);

  if (lost_reason) query = query.eq("lost_reason", lost_reason);
  if (from) query = query.gte("closed_at", from);
  if (to) query = query.lte("closed_at", to);
  if (pipeline_id) query = query.eq("pipeline_id", pipeline_id);

  const { data: leads, error: leadsErr } = await query;
  if (leadsErr) return fail("internal_error", leadsErr.message, 500, { requestId });

  const rows = (leads ?? []) as Array<{
    id: string;
    title: string;
    value_cents: number | null;
    currency: string | null;
    lost_reason: string | null;
    closed_at: string | null;
    pipeline_id: string;
    contact_id: string | null;
  }>;

  const pipelineIds = [...new Set(rows.map((r) => r.pipeline_id))];
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((id): id is string => !!id))];

  const [{ data: pipelines, error: pipelinesErr }, { data: contacts, error: contactsErr }] =
    await Promise.all([
      pipelineIds.length > 0
        ? supabase.from("crm_pipelines").select("id, name").in("id", pipelineIds)
        : Promise.resolve({ data: [], error: null }),
      contactIds.length > 0
        ? supabase.from("contacts").select("id, name, display_name, phone_number").in("id", contactIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (pipelinesErr) return fail("internal_error", pipelinesErr.message, 500, { requestId });
  if (contactsErr) return fail("internal_error", contactsErr.message, 500, { requestId });

  const pipelineNameById = new Map(
    ((pipelines ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  const contactById = new Map(
    (
      (contacts ?? []) as Array<{
        id: string;
        name: string | null;
        display_name: string | null;
        phone_number: string | null;
      }>
    ).map((c) => [c.id, c]),
  );

  const items: LeadPerdido[] = rows.map((r) => {
    const contact = r.contact_id ? contactById.get(r.contact_id) : undefined;
    return {
      id: r.id,
      title: r.title,
      value_cents: r.value_cents,
      currency: r.currency,
      lost_reason: r.lost_reason,
      closed_at: r.closed_at,
      pipeline_id: r.pipeline_id,
      pipeline_name: pipelineNameById.get(r.pipeline_id) ?? "—",
      contact: contact
        ? { name: contact.display_name ?? contact.name, phone_number: contact.phone_number }
        : null,
    };
  });

  return ok({ items, total: items.length }, { requestId });
}
