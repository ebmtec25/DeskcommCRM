"use client";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePerdidos, type PerdidosFilter } from "@/hooks/leads/usePerdidos";
import { CANONICAL_LOST_REASONS, LOST_REASON_LABELS } from "@/lib/schemas/leads";

function formatBRL(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency ?? "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

function reasonLabel(reason: string | null): string {
  if (!reason) return "—";
  return (LOST_REASON_LABELS as Record<string, string>)[reason] ?? reason;
}

export function PerdidosList() {
  const [filter, setFilter] = useState<PerdidosFilter>({});
  const { data, isLoading } = usePerdidos(filter);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="filtro-motivo" className="text-xs text-muted-foreground">
            Motivo
          </Label>
          <Select
            value={filter.lost_reason ?? "all"}
            onValueChange={(v) =>
              setFilter((f) => ({ ...f, lost_reason: v === "all" ? undefined : v }))
            }
          >
            <SelectTrigger id="filtro-motivo" className="h-8 w-56 text-sm">
              <SelectValue placeholder="Todos os motivos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os motivos</SelectItem>
              {CANONICAL_LOST_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {LOST_REASON_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="filtro-de" className="text-xs text-muted-foreground">
            De
          </Label>
          <Input
            id="filtro-de"
            type="date"
            className="h-8 w-36 text-sm"
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                from: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="filtro-ate" className="text-xs text-muted-foreground">
            Até
          </Label>
          <Input
            id="filtro-ate"
            type="date"
            className="h-8 w-36 text-sm"
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                to: e.target.value
                  ? new Date(`${e.target.value}T23:59:59.999Z`).toISOString()
                  : undefined,
              }))
            }
          />
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {!isLoading && (data?.items.length ?? 0) === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
          Nenhum negócio perdido com esse filtro.
        </div>
      )}

      {!isLoading && (data?.items.length ?? 0) > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted/40 text-xs text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Nome</th>
                <th className="px-3 py-2 text-left font-medium">Telefone</th>
                <th className="px-3 py-2 text-left font-medium">Valor</th>
                <th className="px-3 py-2 text-left font-medium">Motivo</th>
                <th className="px-3 py-2 text-left font-medium">Perdido em</th>
                <th className="px-3 py-2 text-left font-medium">Funil</th>
              </tr>
            </thead>
            <tbody>
              {data!.items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{item.title}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {item.contact?.phone_number ?? "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatBRL(item.value_cents, item.currency)}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{reasonLabel(item.lost_reason)}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">
                    {item.closed_at ? new Date(item.closed_at).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{item.pipeline_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
