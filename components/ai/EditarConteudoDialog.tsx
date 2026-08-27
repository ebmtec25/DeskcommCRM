"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Edição do conteúdo de uma fonte já cadastrada.
 *
 * Era um stub: o botão "Editar conteúdo" só mostrava um toast "em breve" — não
 * existia como ver ou mudar o que já tinha sido colado. A API sempre teve
 * PATCH; faltava a tela E o jeito de LER o conteúdo atual (o GET de uma fonte
 * devolve `markdown_blob` reconstruído dos itens, no mesmo formato que a
 * criação usa, pra edição e criação parecerem a mesma coisa).
 */
interface Props {
  sourceId: string;
  rotulo: string;
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}

export function EditarConteudoDialog({ sourceId, rotulo, aberto, onFechar, onSalvo }: Props) {
  const [conteudo, setConteudo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setCarregando(true);
    fetch(`/api/v1/ai/knowledge/sources/${sourceId}`)
      .then((res) => res.json() as Promise<{ data?: { markdown_blob?: string }; error?: { message?: string } }>)
      .then((json) => {
        if (json.error) {
          toast.error(json.error.message ?? "Não consegui carregar o conteúdo.");
          return;
        }
        setConteudo(json.data?.markdown_blob ?? "");
      })
      .catch(() => toast.error("Não consegui falar com o servidor."))
      .finally(() => setCarregando(false));
  }, [aberto, sourceId]);

  async function salvar() {
    if (conteudo.trim().length === 0) {
      toast.error("O conteúdo não pode ficar vazio — arquive a fonte se quiser removê-la.");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch(`/api/v1/ai/knowledge/sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown_blob: conteudo }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        toast.error(json.error?.message ?? "Não consegui salvar o conteúdo.");
        return;
      }
      toast.success("Conteúdo salvo. A reindexação começa em instantes.");
      onSalvo();
      onFechar();
    } catch {
      toast.error("Não consegui falar com o servidor.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar {rotulo.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Mude as perguntas e respostas. Salvar substitui o conteúdo inteiro e reindexa.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            rows={14}
            value={conteudo}
            onChange={(e) => setConteudo(e.target.value)}
            disabled={carregando}
            placeholder={carregando ? "Carregando…" : undefined}
          />
          <p className="text-xs text-text-muted">
            Uma linha <code>## Pergunta:</code> e uma <code>## Resposta:</code> por item, separados
            por uma linha em branco.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={carregando || salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
