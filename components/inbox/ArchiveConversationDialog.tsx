"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useArchiveConversation } from "@/hooks/inbox/useArchiveConversation";
import { CANONICAL_LOST_REASONS, LOST_REASON_LABELS } from "@/lib/schemas/leads";

interface ArchiveConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
}

const MAX_LEN = 500;

/**
 * Arquivar aqui é a MESMA decisão do "Arquivar" do card no Kanban — o
 * atendimento é onde a pessoa percebe que o negócio não vai fechar, então o
 * motivo é pedido aqui em vez de mandar o atendente até o board pra dizer a
 * mesma coisa. A rota (`/archive`) resolve sozinha se há um negócio aberto
 * inequívoco desse contato; se não houver, só a conversa arquiva.
 */
export function ArchiveConversationDialog({
  open,
  onOpenChange,
  conversationId,
}: ArchiveConversationDialogProps) {
  const [reasonCode, setReasonCode] = useState<string>("");
  const [otherText, setOtherText] = useState("");
  const mutation = useArchiveConversation();

  const finalReason = reasonCode === "other" ? otherText.trim() || "other" : reasonCode;

  const handleSubmit = async (comNegocio: boolean) => {
    try {
      await mutation.mutateAsync({
        conversation_id: conversationId,
        lost_reason: comNegocio ? finalReason : undefined,
      });
      setReasonCode("");
      setOtherText("");
      onOpenChange(false);
    } catch {
      // error already toasted
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arquivar conversa</DialogTitle>
          <DialogDescription>
            Sai da sua visão de atendimento. Se houver um negócio aberto deste contato, informe o
            motivo para marcá-lo como perdido também — fica disponível em Perdidos para
            remarketing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Label>Motivo (opcional — só arquiva a conversa se deixar em branco)</Label>
          <div className="grid grid-cols-1 gap-1.5">
            {CANONICAL_LOST_REASONS.map((code) => (
              <label
                key={code}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name="archive-reason"
                  value={code}
                  checked={reasonCode === code}
                  onChange={(e) => setReasonCode(e.target.value)}
                />
                <span>{LOST_REASON_LABELS[code]}</span>
              </label>
            ))}
          </div>
          {reasonCode === "other" && (
            <div className="grid gap-1.5">
              <Label htmlFor="archive-reason-other">Detalhe (opcional)</Label>
              <Textarea
                id="archive-reason-other"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Ex: Cliente desistiu por X motivo"
                maxLength={MAX_LEN}
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <div className="flex gap-2">
            {!reasonCode && (
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => handleSubmit(false)}
              >
                Só arquivar
              </Button>
            )}
            {reasonCode && (
              <Button disabled={mutation.isPending} onClick={() => handleSubmit(true)}>
                {mutation.isPending ? "Arquivando…" : "Arquivar e marcar perdido"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
