"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Lead } from "@/lib/types/leads";
import { LeadFieldsForm } from "./LeadFieldsForm";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
}

/**
 * Casca do modal — os campos em si vêm de `LeadFieldsForm`, os MESMOS que o
 * dossiê usa. Este componente já teve sua própria cópia do formulário; a
 * cópia divergiu (Wave "tese": o dossiê relabelou o campo e o modal ficou
 * para trás com o nome antigo) — a lição documentada no cabeçalho de
 * `LeadFieldsForm` sobre por que ela existe.
 */
export function EditLeadDialog({ open, onOpenChange, lead, pipelineId }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar lead</DialogTitle>
          <DialogDescription>
            Atualize os campos. Mover de etapa ou marcar ganho/perdido tem opções
            próprias.
          </DialogDescription>
        </DialogHeader>
        <LeadFieldsForm
          lead={lead}
          pipelineId={pipelineId}
          onSaved={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
