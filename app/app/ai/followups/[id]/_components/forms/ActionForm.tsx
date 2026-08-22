"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { actionConfigSchema } from "@/lib/followup/graph-schema";
import { MODOS_DA_ACAO, opcoes, type ModoDaAcao } from "@/lib/followup/vocabulario";
import { useMessageTemplates } from "@/hooks/inbox/useMessageTemplates";

import type { ConfigOf } from "./shared";

/**
 * O seletor de modelo, no lugar dos dois `<Input>` que pediam um UUID colado à
 * mão. Trata os três estados em vez de fingir que a lista sempre chega:
 * carregando, vazia e erro — porque um seletor vazio sem explicação é o mesmo
 * beco sem saída que o campo de UUID era, só que mais bonito.
 */
function SeletorDeModelo({
  id,
  valor,
  onChange,
  permiteVazio,
}: {
  id: string;
  valor: string;
  onChange: (templateId: string) => void;
  permiteVazio: boolean;
}) {
  const { data: modelos, isLoading, isError } = useMessageTemplates();

  if (isLoading) return <p className="text-xs text-text-muted">Carregando seus modelos…</p>;
  if (isError) {
    return <p className="text-xs text-error-fg">Não consegui carregar seus modelos de mensagem. Recarregue a página.</p>;
  }
  if (!modelos?.length) {
    return (
      <p className="text-xs text-text-muted">
        Você ainda não tem modelos de mensagem. Crie um em Ajustes → Modelos e ele aparece aqui.
      </p>
    );
  }

  const SEM_MODELO = "__nenhum__";
  return (
    <Select
      value={valor === "" ? SEM_MODELO : valor}
      onValueChange={(v) => onChange(v === SEM_MODELO ? "" : v)}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder="Escolha um modelo" />
      </SelectTrigger>
      <SelectContent>
        {permiteVazio && <SelectItem value={SEM_MODELO}>Nenhum</SelectItem>}
        {modelos.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function etiquetasDoCampo(valor: string): string[] {
  return [...new Set(valor.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

export function ActionForm({
  config,
  onChange,
}: {
  config: ConfigOf<"action">;
  onChange: (c: ConfigOf<"action">) => void;
}) {
  const [mode, setMode] = useState(config.mode);
  const [promptHint, setPromptHint] = useState(config.mode === "ai_message" ? config.prompt_hint : "");
  const [fallbackTemplateId, setFallbackTemplateId] = useState(
    config.mode === "ai_message" ? (config.fallback_template_id ?? "") : "",
  );
  const [templateId, setTemplateId] = useState(config.mode === "template" ? config.template_id : "");
  const [addTagsText, setAddTagsText] = useState(
    config.mode === "tag_update" ? config.add_tags.join(", ") : "",
  );
  const [removeTagsText, setRemoveTagsText] = useState(
    config.mode === "tag_update" ? config.remove_tags.join(", ") : "",
  );
  const [removeAddedOnReply, setRemoveAddedOnReply] = useState(
    config.mode === "tag_update" ? config.remove_added_on_reply : true,
  );
  const [lostReason, setLostReason] = useState(config.mode === "close_lost" ? config.lost_reason : "");
  const [error, setError] = useState<string | null>(null);

  const commit = (overrides: Partial<{
    mode: ModoDaAcao;
    promptHint: string;
    fallbackTemplateId: string;
    templateId: string;
    addTagsText: string;
    removeTagsText: string;
    removeAddedOnReply: boolean;
    lostReason: string;
  }>) => {
    const next = {
      mode,
      promptHint,
      fallbackTemplateId,
      templateId,
      addTagsText,
      removeTagsText,
      removeAddedOnReply,
      lostReason,
      ...overrides,
    };
    const candidate =
      next.mode === "ai_message"
        ? {
            mode: "ai_message" as const,
            prompt_hint: next.promptHint,
            ...(next.fallbackTemplateId.trim() ? { fallback_template_id: next.fallbackTemplateId } : {}),
          }
        : next.mode === "template"
          ? { mode: "template" as const, template_id: next.templateId }
          : next.mode === "tag_update"
            ? {
                mode: "tag_update" as const,
                add_tags: etiquetasDoCampo(next.addTagsText),
                remove_tags: etiquetasDoCampo(next.removeTagsText),
                remove_added_on_reply: next.removeAddedOnReply,
              }
            : { mode: "close_lost" as const, lost_reason: next.lostReason };
    const parsed = actionConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Configuração inválida.");
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="action-mode">O que esta ação deve fazer</Label>
        <Select
          value={mode}
          onValueChange={(v) => {
            const next = v as ModoDaAcao;
            setMode(next);
            commit({ mode: next, promptHint, fallbackTemplateId, templateId });
          }}
        >
          <SelectTrigger id="action-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoes(MODOS_DA_ACAO).map(({ valor, rotulo }) => (
              <SelectItem key={valor} value={valor}>
                {rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "ai_message" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="action-prompt-hint">Instrução para a IA</Label>
            <Textarea
              id="action-prompt-hint"
              maxLength={1000}
              value={promptHint}
              onChange={(e) => {
                setPromptHint(e.target.value);
                commit({ mode, promptHint: e.target.value, fallbackTemplateId, templateId });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-fallback">Se a IA não conseguir escrever, mandar este modelo</Label>
            <SeletorDeModelo
              id="action-fallback"
              valor={fallbackTemplateId}
              permiteVazio
              onChange={(v) => {
                setFallbackTemplateId(v);
                commit({ mode, promptHint, fallbackTemplateId: v, templateId });
              }}
            />
          </div>
        </>
      ) : mode === "template" ? (
        <div className="space-y-2">
          <Label htmlFor="action-template-id">Modelo de mensagem</Label>
          <SeletorDeModelo
            id="action-template-id"
            valor={templateId}
            permiteVazio={false}
            onChange={(v) => {
              setTemplateId(v);
              commit({ templateId: v });
            }}
          />
        </div>
      ) : mode === "tag_update" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="action-add-tags">Adicionar etiquetas</Label>
            <Input
              id="action-add-tags"
              value={addTagsText}
              maxLength={700}
              placeholder="Ex.: FOLLOW-UP 2"
              onChange={(e) => {
                setAddTagsText(e.target.value);
                commit({ addTagsText: e.target.value });
              }}
            />
            <p className="text-xs text-text-muted">Separe várias etiquetas por vírgula.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-remove-tags">Remover etiquetas</Label>
            <Input
              id="action-remove-tags"
              value={removeTagsText}
              maxLength={700}
              placeholder="Ex.: FOLLOW-UP 1"
              onChange={(e) => {
                setRemoveTagsText(e.target.value);
                commit({ removeTagsText: e.target.value });
              }}
            />
          </div>
          <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
            <div className="space-y-1">
              <Label htmlFor="action-cleanup-reply">Remover ao receber resposta</Label>
              <p className="text-xs text-text-muted">
                Se o lead responder, o CRM retira automaticamente a etiqueta adicionada por este passo.
              </p>
            </div>
            <Switch
              id="action-cleanup-reply"
              checked={removeAddedOnReply}
              onCheckedChange={(checked) => {
                setRemoveAddedOnReply(checked);
                commit({ removeAddedOnReply: checked });
              }}
            />
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="action-lost-reason">Motivo da perda</Label>
          <Textarea
            id="action-lost-reason"
            value={lostReason}
            maxLength={200}
            placeholder="Ex.: Sem retorno após follow-up"
            onChange={(e) => {
              setLostReason(e.target.value);
              commit({ lostReason: e.target.value });
            }}
          />
          <p className="text-xs text-text-muted">
            A oportunidade será movida para Perdido e este motivo ficará registrado no histórico.
          </p>
        </div>
      )}
      {error && <p className="text-xs text-error-fg">{error}</p>}
    </div>
  );
}
