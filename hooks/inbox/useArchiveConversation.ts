"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Conversation } from "@/lib/types/messaging";

interface ArchiveArgs {
  conversation_id: string;
}

/** Arquiva sem apagar o contato, as mensagens ou o histórico de atendimento. */
export function useArchiveConversation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: ArchiveArgs) =>
      apiClient.patch<{ data: Conversation }>(`/api/v1/conversations/${args.conversation_id}`, {
        status: "archived",
      }),
    onError: (err, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversation-counts"] });
      showApiError(err);
    },
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversation-counts"] });
    },
  });
}
