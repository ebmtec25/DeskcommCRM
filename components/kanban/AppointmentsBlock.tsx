"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  useLeadAppointments,
  useCreateAppointment,
  useCancelAppointment,
} from "@/hooks/leads/useLeadAppointments";

interface Props {
  leadId: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A agenda DESTE negócio, dentro do dossiê. Lista vem de `crm_lead_appointments`
 * (migration 0116) — a mesma tabela que alimenta `/app/agenda` (org inteira).
 * Cancelar não apaga a linha: vira histórico (mesma lógica de "perdido" não ser
 * delete).
 */
export function AppointmentsBlock({ leadId }: Props) {
  const { data: appointments, isLoading } = useLeadAppointments(leadId);
  const create = useCreateAppointment(leadId);
  const cancel = useCancelAppointment(leadId);
  const [formOpen, setFormOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");

  const proximos = (appointments ?? [])
    .filter((a) => a.status === "scheduled")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const historico = (appointments ?? [])
    .filter((a) => a.status === "cancelled")
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  async function handleCreate() {
    if (!date || !time) return;
    const iso = new Date(`${date}T${time}:00`).toISOString();
    try {
      await create.mutateAsync({ scheduled_at: iso, note: note.trim() || undefined });
      setDate("");
      setTime("");
      setNote("");
      setFormOpen(false);
    } catch {
      // toast já mostrado
    }
  }

  return (
    <section className="border-b border-border py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Agendamentos
        </h3>
        {!formOpen && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="text-xs text-accent hover:underline"
          >
            + Agendar
          </button>
        )}
      </div>

      {formOpen && (
        <div className="mb-3 space-y-2 rounded-md border border-border bg-surface-muted/40 p-3">
          <div className="flex gap-2">
            <div className="space-y-1">
              <Label htmlFor="agenda-data" className="text-xs">
                Data
              </Label>
              <Input
                id="agenda-data"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-8 w-36 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="agenda-hora" className="text-xs">
                Hora
              </Label>
              <Input
                id="agenda-hora"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-8 w-28 text-sm"
              />
            </div>
          </div>
          <Textarea
            placeholder="Nota (opcional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!date || !time || create.isPending}
              onClick={handleCreate}
            >
              {create.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-xs text-text-muted">Carregando…</p>}

      {!isLoading && proximos.length === 0 && !formOpen && (
        <p className="text-xs text-text-muted">Sem agendamentos futuros.</p>
      )}

      {proximos.length > 0 && (
        <ul className="space-y-1.5">
          {proximos.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium tabular-nums">{formatDateTime(a.scheduled_at)}</p>
                {a.note && <p className="truncate text-xs text-text-muted">{a.note}</p>}
              </div>
              <button
                type="button"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(a.id)}
                className="shrink-0 text-xs text-text-muted hover:text-error-fg"
              >
                Cancelar
              </button>
            </li>
          ))}
        </ul>
      )}

      {historico.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-text-muted">
            {historico.length} cancelado(s)
          </summary>
          <ul className="mt-1.5 space-y-1">
            {historico.map((a) => (
              <li key={a.id} className="text-xs text-text-muted line-through">
                {formatDateTime(a.scheduled_at)}
                {a.note ? ` — ${a.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
