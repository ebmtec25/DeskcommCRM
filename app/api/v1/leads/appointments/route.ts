/**
 * GET /api/v1/leads/appointments — a agenda da ORGANIZAÇÃO inteira, pra
 * `/app/agenda`. Por padrão só os vivos (status='scheduled'), mais próximo
 * primeiro — é a pergunta que a tela existe pra responder: "o que vem por aí".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  status: z.enum(["scheduled", "cancelled"]).default("scheduled"),
});

export interface AgendaItem {
  id: string;
  scheduled_at: string;
  note: string | null;
  status: string;
  lead_id: string;
  lead_title: string;
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
  const { limit, status } = parsed.data;

  const { data: rows, error } = await supabase
    .from("crm_lead_appointments")
    .select("id, scheduled_at, note, status, lead_id, contact_id")
    .eq("status", status)
    .order("scheduled_at", { ascending: status === "scheduled" })
    .limit(limit);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const appointments = (rows ?? []) as Array<{
    id: string;
    scheduled_at: string;
    note: string | null;
    status: string;
    lead_id: string;
    contact_id: string | null;
  }>;

  const leadIds = [...new Set(appointments.map((a) => a.lead_id))];
  const contactIds = [
    ...new Set(appointments.map((a) => a.contact_id).filter((id): id is string => !!id)),
  ];

  const [{ data: leads, error: leadsErr }, { data: contacts, error: contactsErr }] =
    await Promise.all([
      leadIds.length > 0
        ? supabase.from("crm_leads").select("id, title").in("id", leadIds)
        : Promise.resolve({ data: [], error: null }),
      contactIds.length > 0
        ? supabase.from("contacts").select("id, name, display_name, phone_number").in("id", contactIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (leadsErr) return fail("internal_error", leadsErr.message, 500, { requestId });
  if (contactsErr) return fail("internal_error", contactsErr.message, 500, { requestId });

  const leadTitleById = new Map(
    ((leads ?? []) as Array<{ id: string; title: string }>).map((l) => [l.id, l.title]),
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

  const items: AgendaItem[] = appointments.map((a) => {
    const contact = a.contact_id ? contactById.get(a.contact_id) : undefined;
    return {
      id: a.id,
      scheduled_at: a.scheduled_at,
      note: a.note,
      status: a.status,
      lead_id: a.lead_id,
      lead_title: leadTitleById.get(a.lead_id) ?? "—",
      contact: contact
        ? { name: contact.display_name ?? contact.name, phone_number: contact.phone_number }
        : null,
    };
  });

  return ok({ items, total: items.length }, { requestId });
}
