"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface LeadAppointment {
  id: string;
  scheduled_at: string;
  note: string | null;
  status: "scheduled" | "cancelled";
  created_at: string;
}

/** A agenda DESTE lead — usada pelo bloco de Agendamentos no dossiê. */
export function useLeadAppointments(leadId: string | null) {
  return useQuery({
    queryKey: ["lead-appointments", leadId],
    enabled: !!leadId,
    queryFn: () =>
      apiClient
        .get<{ data: { items: LeadAppointment[] } }>(`/api/v1/leads/${leadId}/appointments`)
        .then((r) => r.data.items),
  });
}

export function useCreateAppointment(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { scheduled_at: string; note?: string }) =>
      apiClient.post<{ data: LeadAppointment }>(`/api/v1/leads/${leadId}/appointments`, input),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-appointments", leadId] });
      qc.invalidateQueries({ queryKey: ["agenda"] });
    },
  });
}

export function useCancelAppointment(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appointmentId: string) =>
      apiClient.post<{ data: LeadAppointment }>(
        `/api/v1/leads/appointments/${appointmentId}/cancel`,
        {},
      ),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-appointments", leadId] });
      qc.invalidateQueries({ queryKey: ["agenda"] });
    },
  });
}
