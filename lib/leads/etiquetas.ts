/**
 * Atualização idempotente de etiquetas do negócio mais recente de um contato.
 *
 * O follow-up trabalha por contato, enquanto as etiquetas usadas nas condições
 * do funil vivem em `crm_leads`. Esta função concentra a resolução contato →
 * negócio, o isolamento por organização e os mesmos rastros usados pela edição
 * normal do CRM. Remover uma etiqueta inexistente ou adicionar uma já presente
 * é no-op — propriedade necessária para retries seguros do worker.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";

export interface AtualizaEtiquetasInput {
  adicionar?: string[];
  remover?: string[];
}

export interface EtiquetasAtualizadas {
  leadId: string;
  tags: string[];
  alterou: boolean;
}

function unicas(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

export async function atualizaEtiquetasDoLeadMaisRecente(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  contactId: string,
  input: AtualizaEtiquetasInput,
): Promise<EtiquetasAtualizadas | null> {
  const { data: lead, error: selectError } = await supabase
    .from("crm_leads")
    .select("id, contact_id, tags")
    .eq("organization_id", ctx.organization_id)
    .eq("contact_id", contactId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) throw new Error(selectError.message);
  if (!lead) return null;

  const anteriores = unicas((lead.tags as string[] | null) ?? []);
  const remover = new Set(unicas(input.remover ?? []));
  const adicionar = unicas(input.adicionar ?? []);
  // A inclusão vence se, por erro de configuração, a mesma etiqueta aparecer
  // nas duas listas. Assim o resultado é determinístico e nunca apaga o estado
  // que o próprio passo acabou de declarar.
  const proximas = [...new Set([...anteriores.filter((tag) => !remover.has(tag)), ...adicionar])];
  const alterou =
    anteriores.length !== proximas.length || anteriores.some((tag, i) => tag !== proximas[i]);
  const leadId = String(lead.id);

  if (!alterou) return { leadId, tags: proximas, alterou: false };

  const { error: updateError } = await supabase
    .from("crm_leads")
    .update({ tags: proximas, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organization_id)
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);

  const adicionadas = proximas.filter((tag) => !anteriores.includes(tag));
  const removidas = anteriores.filter((tag) => !proximas.includes(tag));
  const metadataActor = { actor_type: ctx.actor.type, actor_id: ctx.actor.id };

  await supabase
    .rpc("emit_event", {
      p_event_type: "lead.updated",
      p_entity_kind: "crm_lead",
      p_entity_id: leadId,
      p_payload: { fields: ["tags"] },
      p_metadata: { request_id: ctx.requestId, ...metadataActor },
      p_organization_id: ctx.organization_id,
    })
    .then(({ error }) => {
      if (error) console.error("[followup.tags] emit_event failed", error.message);
    });

  if (adicionadas.length > 0) {
    await supabase
      .rpc("emit_event", {
        p_event_type: "lead.tag_added",
        p_entity_kind: "crm_lead",
        p_entity_id: leadId,
        p_payload: { added_tags: adicionadas, tags: proximas },
        p_metadata: { request_id: ctx.requestId, ...metadataActor },
        p_organization_id: ctx.organization_id,
      })
      .then(({ error }) => {
        if (error) console.error("[followup.tags] emit_event failed", error.message);
      });
  }

  const atividade = await emitLeadActivity(supabase, {
    organizationId: ctx.organization_id,
    leadId,
    contactId,
    type: "lead_edited",
    sourceModule: "followup",
    sourceId: null,
    actor: ctx.actor,
    reason: "Alterou etiquetas pelo follow-up",
    payload: {
      fields: ["tags"],
      added_count: adicionadas.length,
      removed_count: removidas.length,
    },
  });
  if (!atividade.ok) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: ctx.organization_id,
      leadId,
      tipo: "lead_edited",
      origem: "lib/leads/etiquetas.atualizaEtiquetasDoLeadMaisRecente",
      erro: atividade.error,
      requestId: ctx.requestId,
    });
  }

  await audit({
    action: "lead.updated",
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    organizationId: ctx.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId: ctx.requestId,
    metadata: {
      ...metadataActor,
      fields: ["tags"],
      added_count: adicionadas.length,
      removed_count: removidas.length,
      source: "followup",
    },
  });

  return { leadId, tags: proximas, alterou: true };
}
