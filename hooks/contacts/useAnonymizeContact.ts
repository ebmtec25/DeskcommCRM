"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { LgpdAnonymizeInput } from "@/lib/schemas/contacts";

interface AnonymizeResponse {
  data: {
    contact_id: string;
    anonymized_at: string | null;
    action: "anonymized" | "already_anonymized";
  };
}

export function useAnonymizeContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LgpdAnonymizeInput) =>
      apiClient.post<AnonymizeResponse>("/api/v1/lgpd/anonymize", input),
    onError: showApiError,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["contact", vars.contact_id] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-counts"] });
    },
  });
}
