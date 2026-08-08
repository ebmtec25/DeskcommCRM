"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAgenda, useCancelAgendaItem } from "@/hooks/leads/useAgenda";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Agenda org inteira. A mesma tabela (crm_lead_appointments) que o bloco do
 * dossiê usa — esta tela é a visão "o que vem por aí" sem abrir lead por
 * lead.
 */
export function AgendaList() {
  const { data: items, isLoading } = useAgenda("scheduled");
  const cancel = useCancelAgendaItem();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
        Nenhum agendamento marcado ainda.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium tabular-nums">{formatDateTime(item.scheduled_at)}</p>
            {/* Sem link direto pro lead de propósito: não existe deep-link pra
                abrir um dossiê específico ainda (o Kanban é por pipeline, o
                lead não declara o dele aqui) — um link pra /app/kanban
                genérico seria pior que nenhum link, porque prometeria abrir
                o lead certo e abriria a lista errada. */}
            <p className="text-sm text-text">{item.lead_title}</p>
            <p className="text-xs text-text-muted">
              {item.contact?.phone_number ?? "sem telefone"}
              {item.note ? ` · ${item.note}` : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(item.id)}
          >
            Cancelar
          </Button>
        </li>
      ))}
    </ul>
  );
}
