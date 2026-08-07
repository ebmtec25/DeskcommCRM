"use client";
import { Draggable } from "@hello-pangea/dnd";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import type { CardInput } from "@/lib/kanban/card-state";
import { KanbanCardActions } from "./KanbanCardActions";
import { OwnerBadge } from "./OwnerBadge";

interface KanbanCardProps {
  /** O que o card mostra — explicitamente NÃO é a linha do banco. */
  card: CardInput;
  /** A linha do lead, só para o menu de ações (que muta o lead). */
  lead: Lead;
  index: number;
  pipelineId: string;
  isSelected?: boolean;
  /**
   * Contador de pulsos deste card (evento REMOTO). Muda a cada evento novo — é
   * a MUDANÇA que remonta o overlay e reinicia a animação; um booleano deixaria
   * o segundo evento dentro da janela passar despercebido.
   */
  pulseCount?: number;
  onSelect?: (leadId: string, additive: boolean) => void;
  /** Abrir o dossiê. Separado de `onSelect`: são gestos e intenções diferentes. */
  onOpen?: (leadId: string) => void;
}

/**
 * O card do Kanban — só identidade: nome, telefone e o atendente, pequeno.
 *
 * Valor, score da IA e próxima ação saíram de propósito (ver o cabeçalho de
 * `CardInput` em `lib/kanban/card-state.ts`): decisão de venda pede contexto
 * que este card não tem espaço para dar. Vivem no dossiê e, a próxima ação,
 * também em `/app/ai/proposals`.
 *
 * Cor só aparece em foco/seleção — não há mais estado de negócio para
 * anunciar na borda.
 */
export function KanbanCard({
  card,
  lead,
  index,
  pipelineId,
  isSelected,
  pulseCount = 0,
  onSelect,
  onOpen,
}: KanbanCardProps) {
  // Clique ABRE o dossiê; ctrl/cmd+clique SELECIONA. "Clicar abre" é a
  // convenção mais forte, e seleção múltipla é recurso de poder, que tolera
  // modificador. O arrasto continua funcionando porque o dnd distingue clique
  // de arrasto por movimento, não por handler.
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey) {
      onSelect?.(card.id, true);
      return;
    }
    onOpen?.(card.id);
  };

  return (
    <Draggable draggableId={card.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          // O dnd marca o handle como role="button"; com o menu de ações dentro,
          // isso vira nested-interactive no axe. "group" mantém o foco e o
          // teclado do dnd (tabIndex e handlers continuam vindo do spread) sem
          // aninhar dois controles — nada de aria-hidden nem de suprimir regra.
          role="group"
          aria-label={`Lead: ${card.title}`}
          onClick={handleClick}
          className={cn(
            "group relative overflow-hidden rounded-md border border-border bg-surface",
            "py-2.5 pl-3 pr-3 shadow-xs transition-colors",
            "hover:border-border-strong",
            snapshot.isDragging && "rotate-1 shadow-md ring-1 ring-accent/40",
            isSelected && "ring-2 ring-accent",
          )}
        >
          {/* key = contador: cada evento remoto monta um overlay NOVO, e é isso
              que reinicia a animação. Fica no elemento interno — pôr no wrapper
              remontaria o draggable e quebraria o arrasto. */}
          {pulseCount > 0 && (
            <span
              key={pulseCount}
              aria-hidden
              // Observável de propósito: é assim que o teste prova que o
              // overlay REMONTOU (contador novo) em vez de ter sobrado do
              // evento anterior — e "sobrou" era exatamente o defeito.
              data-pulse={pulseCount}
              className="card-pulse pointer-events-none absolute inset-0"
            />
          )}

          {/* ① nome — o TÍTULO é o elemento ativável, não o card inteiro.
              `role="group"` no card foi decisão da wave 2 (o dnd marca o
              handle como button, e com o menu de ações dentro isso vira
              nested-interactive no axe). Voltar o card para `button`
              reintroduziria aquele defeito com cara de melhoria de
              acessibilidade; deixar só onKeyDown daria uma ação que existe
              e NÃO É DESCOBERTA por leitor de tela. O título como button
              atende mouse, teclado e leitor sem desfazer a decisão antiga. */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5 text-text">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.(card.id);
                }}
                className="text-left hover:underline"
              >
                {card.title}
              </button>
            </h3>
            <KanbanCardActions lead={lead} pipelineId={pipelineId} />
          </div>

          {/* ② telefone. */}
          <p className="mt-1 truncate text-xs text-text-muted">{card.phone ?? "—"}</p>

          {/* ③ atendente — pequeno, no rodapé. */}
          <div className="mt-1.5">
            <OwnerBadge
              ownerKind={card.owner.kind}
              ownerName={card.owner.name}
              agentVersion={card.owner.agentVersion}
            />
          </div>
        </div>
      )}
    </Draggable>
  );
}
