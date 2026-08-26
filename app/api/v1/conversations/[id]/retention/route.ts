/**
 * GET /api/v1/conversations/[id]/retention — vetos recentes da cadeia before_send
 * para o contato desta conversa (Operação Visível F2-i). Read-only, RLS-scoped
 * (client de sessão): responde POR QUE a resposta do assistente foi retida, com o
 * contexto dos knobs efetivos do número para a UI compor a copy leiga.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Só vetos recentes interessam à tela — mais velho que isso é histórico, não aviso. */
const RETENTION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const authUser = await loadAuthUser();
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) {
    return fail("no_active_org", "No active organization.", 403, { requestId });
  }

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, contact_id, channel_session_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (convErr) {
    return fail("internal_error", "Failed to load conversation.", 500, { requestId });
  }
  if (!conv) {
    return fail("not_found", "Conversation not found.", 404, { requestId });
  }

  // A tela só deve avisar se o veto ainda é o desfecho ATUAL da conversa — ou seja,
  // se nenhuma tentativa de envio (veto ou sucesso) aconteceu depois dele. Toda
  // tentativa do before_send grava um trace, vetada ou não (`runBeforeSend`), então
  // a tentativa MAIS RECENTE é o estado real. Filtrar só por `vetoed_gate not null`
  // (sem olhar o que veio depois) mostrava um aviso "resolvido" por até 24h — o
  // assistente já tinha reescrito e enviado com sucesso, e a tela seguia dizendo
  // que a resposta estava retida.
  const since = new Date(Date.now() - RETENTION_LOOKBACK_MS).toISOString();
  const { data: latestTrace, error: traceErr } = await supabase
    .from("before_send_traces")
    .select("id, created_at, vetoed_gate, vetoed_code")
    .eq("organization_id", activeOrg.orgId)
    .eq("contact_id", conv.contact_id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (traceErr) {
    return fail("internal_error", "Failed to load retention traces.", 500, { requestId });
  }
  const traces = latestTrace && latestTrace.vetoed_gate !== null ? [latestTrace] : [];

  // Knobs do número (coluna NULL = default conservador do engine) — a UI usa o
  // contexto pra dizer QUAL janela segurou o envio, não a genérica.
  const { data: knobs } = await supabase
    .from("channel_knobs")
    .select("window_start_hour, window_end_hour, allow_sunday, timezone")
    .eq("organization_id", activeOrg.orgId)
    .eq("channel_session_id", conv.channel_session_id)
    .maybeSingle();

  return ok(
    {
      retentions: traces ?? [],
      context: {
        window_start_hour: knobs?.window_start_hour ?? PACING_DEFAULTS.windowStartHour,
        window_end_hour: knobs?.window_end_hour ?? PACING_DEFAULTS.windowEndHour,
        allow_sunday: knobs?.allow_sunday ?? PACING_DEFAULTS.allowSunday,
        timezone: knobs?.timezone ?? PACING_DEFAULTS.timezone,
      },
    },
    { requestId },
  );
}
