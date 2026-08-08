"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Conversation } from "@/lib/types/messaging";

interface ArchiveArgs {
  conversation_id: string;
  lost_reason?: string;
}

interface ArchiveResult {
  conversation: Conversation;
  lead_archived: boolean;
}

export function useArchiveConversation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversation_id, lost_reason }: ArchiveArgs) =>
      apiClient.post<{ data: ArchiveResult }>(
        `/api/v1/conversations/${conversation_id}/archive`,
        lost_reason ? { lost_reason } : {},
      ),
    onError: (err, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      showApiError(err);
    },
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["leads-perdidos"] });
    },
  });
}
