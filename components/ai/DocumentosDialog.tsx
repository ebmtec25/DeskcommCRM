"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Biblioteca de documentos de uma fonte `policy` — upload ACRESCENTA (não
 * substitui), cada arquivo é listado com seu status e pode ser removido
 * individualmente.
 *
 * `sourceId` pode ser `null`: card ainda vazio, a fonte nem existe. O
 * primeiro upload cria a fonte (o endpoint resolve/cria) e devolve o id, que
 * fica guardado localmente pro resto da sessão do diálogo — sem isso, um
 * segundo upload na mesma sessão não saberia a quem anexar o arquivo antes de
 * o pai recarregar a lista de fontes.
 */

interface ArquivoDaBiblioteca {
  id: string;
  filename: string;
  size_bytes: number;
  ext: string;
  status: "ready" | "failed" | string;
  error: string | null;
  chunk_count: number;
  created_at: string;
}

interface Props {
  agentId: string;
  sourceId: string | null;
  rotulo: string;
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function DocumentosDialog({ agentId, sourceId, rotulo, aberto, onFechar, onSalvo }: Props) {
  const [sourceIdAtual, setSourceIdAtual] = useState(sourceId);
  const [arquivos, setArquivos] = useState<ArquivoDaBiblioteca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  // Reabrir o diálogo (ou trocar de fonte) reparte do que o pai sabe — evita
  // arrastar o `sourceId` recém-criado de uma sessão anterior do diálogo para
  // outra fonte. Reposição DURANTE o render (não em efeito), mesmo padrão de
  // `CampoDeLogo.tsx`: o servidor manda quando a prop muda.
  const [ultimoAberto, setUltimoAberto] = useState(aberto);
  if (aberto !== ultimoAberto) {
    setUltimoAberto(aberto);
    if (aberto) setSourceIdAtual(sourceId);
  }

  async function carregarArquivos(id: string) {
    setCarregando(true);
    try {
      const res = await fetch(`/api/v1/ai/knowledge/sources/${id}`);
      const json = (await res.json()) as {
        data?: { files?: ArquivoDaBiblioteca[] };
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(json.error?.message ?? "Não consegui carregar os arquivos.");
        return;
      }
      setArquivos(json.data?.files ?? []);
    } catch {
      toast.error("Não consegui falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (!aberto) return;
    if (sourceIdAtual) {
      void carregarArquivos(sourceIdAtual);
    } else {
      setArquivos([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, sourceIdAtual]);

  async function enviar(arquivo: File) {
    setEnviando(true);
    try {
      const corpo = new FormData();
      corpo.set("agent_id", agentId);
      corpo.set("name", `Documentos de ${rotulo}`);
      corpo.set("file", arquivo);
      const res = await fetch("/api/v1/ai/knowledge/sources/upload", {
        method: "POST",
        body: corpo,
      });
      const json = (await res.json()) as {
        data?: { id?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(json.error?.message ?? "Não consegui subir o arquivo.");
        return;
      }
      toast.success("Arquivo enviado. A indexação começa em instantes.");
      const novoSourceId = json.data?.id;
      if (novoSourceId) {
        setSourceIdAtual(novoSourceId);
        await carregarArquivos(novoSourceId);
      }
      onSalvo();
    } catch {
      toast.error("Não consegui falar com o servidor.");
    } finally {
      setEnviando(false);
      // Sem isto, escolher o MESMO arquivo de novo não dispara `change`.
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function remover(fileId: string) {
    if (!sourceIdAtual) return;
    setRemovendoId(fileId);
    try {
      const res = await fetch(
        `/api/v1/ai/knowledge/sources/${sourceIdAtual}/files/${fileId}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        toast.error(json.error?.message ?? "Não consegui remover o arquivo.");
        return;
      }
      toast.success("Arquivo removido.");
      setArquivos((atual) => atual.filter((a) => a.id !== fileId));
      onSalvo();
    } catch {
      toast.error("Não consegui falar com o servidor.");
    } finally {
      setRemovendoId(null);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rotulo}</DialogTitle>
          <DialogDescription>
            Suba arquivos PDF ou Markdown — cada um vira conteúdo pesquisável pelo agente. Subir
            um novo arquivo acrescenta à lista, não substitui os anteriores.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <input
              ref={entrada}
              type="file"
              accept=".pdf,.md,application/pdf,text/markdown"
              disabled={enviando}
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                if (arquivo) void enviar(arquivo);
              }}
              className="max-w-full text-sm file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-border file:bg-surface-elevated file:px-3 file:py-1.5 file:text-sm"
            />
            <p className="text-xs text-text-muted">PDF ou Markdown, até 20MB por arquivo.</p>
          </div>

          <div className="space-y-2">
            {carregando ? (
              <p className="text-sm text-text-muted">Carregando…</p>
            ) : arquivos.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum arquivo enviado ainda.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {arquivos.map((arquivo) => (
                  <li key={arquivo.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium">{arquivo.filename}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <span>{formatarTamanho(arquivo.size_bytes)}</span>
                        <span>{arquivo.chunk_count} chunks</span>
                        <Badge variant={arquivo.status === "ready" ? "success" : "error"}>
                          {arquivo.status === "ready" ? "Pronto" : "Falhou"}
                        </Badge>
                      </div>
                      {arquivo.status === "failed" && arquivo.error ? (
                        <p className="text-xs text-error-fg">{arquivo.error}</p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={removendoId === arquivo.id}
                      onClick={() => void remover(arquivo.id)}
                      aria-label={`Remover ${arquivo.filename}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
