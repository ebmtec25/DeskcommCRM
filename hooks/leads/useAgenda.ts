"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

/** O tipo vem da ROTA — mesmo padrão de useAtRiskLeads/usePerdidos. */
export type { AgendaItem } from "@/app/api/v1/leads/appointments/route";
import type { AgendaItem } from "@/app/api/v1/leads/appointments/route";

export function useAgenda(status: "scheduled" | "cancelled" = "scheduled") {
  return useQuery({
    queryKey: ["agenda", status],
    queryFn: () =>
      apiClient
        .get<{ data: { items: AgendaItem[] } }>(`/api/v1/leads/appointments?status=${status}`)
        .then((r) => r.data.items),
  });
}

export function useCancelAgendaItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appointmentId: string) =>
      apiClient.post(`/api/v1/leads/appointments/${appointmentId}/cancel`, {}),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda"] });
      qc.invalidateQueries({ queryKey: ["lead-appointments"] });
    },
  });
}
