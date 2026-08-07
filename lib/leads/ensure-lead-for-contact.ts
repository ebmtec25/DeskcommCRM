/**
 * Garante que o contato tem um negócio aberto no Kanban quando a IA assume o
 * atendimento — sem isto, o funil do agente (`lead_state`) roda inteiro sem
 * nenhum card no board (achado documentado em `HANDOFF-crm-vivo.md`: "dois
 * funis paralelos", "Negócios no CRM: 0").
 *
 * NÃO decide qual negócio mover — isso é `agent-stage-sync.ts`. Este arquivo só
 * garante que existe UM para mover, e reusa `resolveActiveLeadForContact` pela
 * MESMA razão que `agent-stage-sync.ts` reusa: um segundo resolvedor de "qual
 * negócio deste contato" divergiria do primeiro no primeiro ajuste.
 *
 * Reusa `createLeadHandler` (mesmo caminho do REST/MCP e da automação
 * `create_or_move_lead`) em vez de duplicar INSERT + posição + audit + evento.
 *
 * Pipeline/estágio de destino: o pipeline default da org; dentro dele, o
 * estágio com `agent_stage_hint='new'` se a org mapeou (mesma ponte do
 * agent-stage-sync), senão o primeiro estágio não-arquivado por posição. Sem
 * pipeline default ou sem nenhum estágio elegível é configuração ausente, não
 * erro — não cria nada (mesmo espírito de `MIRROR_WARN_ONLY`).
 *
 * ⚠️ Race conhecida e aceita: duas primeiras mensagens do MESMO contato
 * processadas em paralelo (dois workers, mesmo instante) podem passar as duas
 * pelo "sem negócio aberto" antes de qualquer insert commitar, criando dois
 * leads. Não é silencioso nem perigoso: `resolveActiveLeadForContact` já trata
 * dois negócios abertos do mesmo contato como "ambíguo" e para de mover
 * qualquer um até um humano arquivar um dos dois — o mesmo comportamento que o
 * produto já tem para qualquer contato com dois negócios legítimos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";

export type ResultadoGarantiaDeLead =
  | { ok: true; created: true; leadId: string }
  | { ok: true; created: false; motivo: "ja_tem_negocio" | "ambiguo" }
  | { ok: false; motivo: "sem_pipeline_default" | "sem_estagio_elegivel" | "erro"; detalhe?: string };

interface EstagioElegivel {
  id: string;
  position: number;
  agent_stage_hint: string | null;
}

export async function garanteLeadParaContato(
  supabase: SupabaseClient,
  input: { organizationId: string; contactId: string; agentId: string | null },
): Promise<ResultadoGarantiaDeLead> {
  const { data: leadRows, error: erroLeads } = await supabase
    .from("crm_leads")
    .select("id, organization_id, pipeline_id, status, created_at, last_activity_at")
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId);
  if (erroLeads) return { ok: false, motivo: "erro", detalhe: erroLeads.message };

  const candidatos = (leadRows ?? []) as unknown as LeadCandidate[];
  const rota = resolveActiveLeadForContact(candidatos);
  if (rota.routed) return { ok: true, created: false, motivo: "ja_tem_negocio" };
  if (rota.reason === "ambiguous_open_leads") {
    return { ok: true, created: false, motivo: "ambiguo" };
  }

  const { data: pipeline, error: erroPipeline } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("is_default", true)
    .maybeSingle();
  if (erroPipeline) return { ok: false, motivo: "erro", detalhe: erroPipeline.message };
  if (!pipeline) return { ok: false, motivo: "sem_pipeline_default" };
  const pipelineId = (pipeline as { id: string }).id;

  const { data: stageRows, error: erroStages } = await supabase
    .from("crm_stages")
    .select("id, position, agent_stage_hint")
    .eq("pipeline_id", pipelineId)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  if (erroStages) return { ok: false, motivo: "erro", detalhe: erroStages.message };

  const estagios = (stageRows ?? []) as EstagioElegivel[];
  const estagioInicial = estagios.find((e) => e.agent_stage_hint === "new") ?? estagios[0];
  if (!estagioInicial) return { ok: false, motivo: "sem_estagio_elegivel" };

  const { data: contactRow } = await supabase
    .from("contacts")
    .select("name, display_name, phone_number")
    .eq("id", input.contactId)
    .maybeSingle();
  const contact = contactRow as { name: string | null; display_name: string | null; phone_number: string | null } | null;
  const title = contact?.display_name ?? contact?.name ?? contact?.phone_number ?? "Novo contato via WhatsApp";

  const handlerCtx: HandlerCtx = {
    organization_id: input.organizationId,
    actor: input.agentId
      ? { type: "ai_agent", id: "agent-engine", role: "ai_operator", agent_id: input.agentId }
      : { type: "webhook_source", id: "agent-engine" },
    requestId: `agent-engine:${input.contactId}`,
  };

  try {
    const lead = await createLeadHandler(supabase, handlerCtx, {
      pipeline_id: pipelineId,
      stage_id: estagioInicial.id,
      title,
      contact_id: input.contactId,
      owner_agent_id: input.agentId,
      source: "ai_agent",
    } as Parameters<typeof createLeadHandler>[2]);
    return { ok: true, created: true, leadId: String((lead as { id: string }).id) };
  } catch (err) {
    return { ok: false, motivo: "erro", detalhe: err instanceof Error ? err.message : String(err) };
  }
}
