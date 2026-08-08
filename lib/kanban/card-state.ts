import { resolveLeadOwner, type OwnerDisplay } from "@/lib/kanban/owner";
import type { Lead } from "@/lib/types/leads";

/**
 * O que o card do Kanban precisa saber — e SÓ isso.
 *
 * O card responde só "quem é" (nome, telefone) e "quem toca" (dono). Valor,
 * score da IA, próxima ação, retomada de negócio parado e tempo no estágio
 * saíram daqui de propósito: são decisão de venda, e decisão pede contexto que
 * um card de 300px não tem espaço para dar sem virar ruído. Vivem no dossiê
 * (`LeadDossier`) e — a próxima ação — também em `/app/ai/proposals`, que já
 * cobre "não deixa a proposta apodrecer em silêncio" fora do card.
 *
 * Dívida aceita conscientemente: a proposta de retomada de negócio parado NÃO
 * tem tela alternativa hoje. Tirá-la do card a deixa sem superfície nenhuma
 * até existir uma central equivalente à de propostas.
 */
export interface CardInput {
  id: string;
  title: string;
  phone: string | null;
  /** Sem telefone porque o WhatsApp só entregou um lid (protegido), não porque falta dado. */
  phoneHidden: boolean;
  owner: OwnerDisplay;
}

/**
 * Monta o CardInput a partir do que o board tem em mãos. Pura e testável: é
 * aqui que se decide o que o card VÊ, e é o único lugar onde a linha do banco
 * encosta no card.
 */
export function buildCardInput(
  lead: Pick<
    Lead,
    "id" | "title" | "contact" | "owner_kind" | "owner_user_id" | "owner_agent_id" | "owner_agent"
  >,
  opts: {
    ownerNames: Map<string, string | null> | undefined;
  },
): CardInput {
  return {
    id: lead.id,
    title: lead.title,
    phone: lead.contact?.phone_number ?? null,
    phoneHidden: lead.contact?.phone_hidden ?? false,
    owner: resolveLeadOwner(lead, opts.ownerNames),
  };
}
