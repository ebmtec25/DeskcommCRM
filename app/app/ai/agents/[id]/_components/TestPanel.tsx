"use client";
/**
 * TestPanel — conversa de teste de uma version, com memória (S-13.12 + 0177).
 *
 * Cada mensagem via POST `:test` (admin-only) acrescenta um turno na MESMA
 * conversa de teste deste admin (`ai_agent_test_conversations`, uma por
 * versão) — é o que dá "janela de conversa" ao painel, em vez de cada clique
 * ser um teste isolado sem memória do anterior. GET `:test-conversation`
 * hidrata a tela ao abrir a aba; DELETE reseta (apaga a conversa de teste;
 * a próxima mensagem começa outra do zero). Digitar exatamente "resetar" no
 * campo de mensagem é atalho pro mesmo reset, sem precisar do botão.
 *
 * Não toca WAHA, não cria contacts/conversations/messages reais. Quando
 * `INTERNAL_AGENT_RUN_STUB=true` o backend devolve trace stub com
 * `stub: true`; o componente mostra um aviso amigável.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { agentRunsKey } from "@/hooks/ai/useAgentRuns";
import type { AgentRow } from "@/hooks/ai/useAgent";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";

import { isComandoResetar } from "@/lib/ai/agents/comando-resetar";

import { RunTrace } from "./RunTrace";

interface Guardrails {
  passou: boolean;
  categorias: string[];
  termos: string[];
  naoAvaliados: Array<{ gate: string; porque: string }>;
}

interface ThreadMessage {
  id: string | null;
  role: "user" | "assistant";
  content: string;
  tool_calls?: unknown;
  guardrails?: Guardrails | null;
  created_at?: string;
}

interface Props {
  agent: AgentRow;
  draft: AgentVersionRow | null;
  published: AgentVersionRow | null;
  readOnly?: boolean;
}

interface TestResponse {
  data: {
    run_id: string;
    status: string;
    final_text?: string | null;
    tool_calls?: unknown;
    tokens_in?: number;
    tokens_out?: number;
    cost_cents?: number;
    latency_ms?: number;
    would_send_to?: { session?: string | null; chat_id?: string | null };
    stub?: boolean;
    /** Ver lib/ai/agents/avaliar-resposta-de-teste.ts. */
    guardrails?: Guardrails;
    test_conversation_id?: string;
    messages?: ThreadMessage[];
  };
}

interface TestConversationResponse {
  data: {
    test_conversation_id: string | null;
    sample_contact: { name: string | null; phone: string | null } | null;
    messages: ThreadMessage[];
  };
}

/**
 * O que as verificações disseram sobre a resposta — e o que elas NÃO puderam
 * dizer.
 *
 * Antes disto, o teste mostrava a resposta e mais nada: nenhum gate a examinava
 * (o runtime desta tela não importa a cadeia), então o usuário publicava achando
 * que tinha visto o comportamento real. Mostrar "não verificado" em voz alta é o
 * conserto — silêncio que parece aprovação foi o defeito.
 */
function Verificacoes({ g }: { g: NonNullable<TestResponse["data"]["guardrails"]> }) {
  return (
    <div className="space-y-2" data-testid="teste-verificacoes">
      {g.passou ? (
        <p
          data-testid="teste-vazamento-limpo"
          className="rounded-md border border-border/60 bg-muted/40 p-2 text-xs"
        >
          A resposta não usa palavras internas do sistema.
        </p>
      ) : (
        <div
          data-testid="teste-vazamento-achado"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs"
        >
          <p className="font-medium text-destructive">
            Esta resposta usa palavras que o cliente não deveria ver.
          </p>
          <p className="mt-1 text-muted-foreground">
            Em produção ela seria barrada e o assistente teria que reescrever. Encontrado:{" "}
            <span className="font-mono">{g.termos.join(", ")}</span>
          </p>
        </div>
      )}

      {/*
        A lista do que NÃO foi checado. Ela é o que separa este conserto de uma
        mentira mais bonita: as verificações que dependem do turno real não podem
        ser avaliadas aqui, e inventá-las daria um veredito com aparência de
        prova. O usuário precisa saber a diferença entre "passou em tudo" e
        "passou no que dava para checar sem uma conversa de verdade".

        (O texto dizia "os seis gates" enquanto a lista renderizava nove — número
        que já foi verdade para um subconjunto e envelheceu. A contagem agora sai
        da própria lista, logo abaixo, e não de prosa.)

        Esta lista responde "o que este teste NÃO checou"; a aba "Confere antes de
        enviar" responde "o que é checado, e o que cada uma protege". São
        perguntas diferentes, e por isso há um ponteiro em vez de uma cópia — as
        duas saem da mesma cadeia, cada uma com o seu teste de casamento.
      */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer" data-testid="teste-nao-verificado">
          O teste não consegue verificar tudo ({g.naoAvaliados.length} verificações ficam de fora)
        </summary>
        <ul className="mt-2 space-y-1 pl-4">
          {g.naoAvaliados.map((n) => (
            <li key={n.gate}>— {n.porque}</li>
          ))}
        </ul>
        <p className="mt-2">
          Estas só acontecem numa conversa real, com um cliente de verdade do outro lado. Para ver
          a lista inteira do que é conferido — e o que cada verificação protege — abra a aba{" "}
          <span className="font-medium text-foreground">Confere antes de enviar</span>.
        </p>
      </details>
    </div>
  );
}

export function TestPanel({ agent, draft, published, readOnly }: Props) {
  const target = draft ?? published;
  const qc = useQueryClient();

  const [message, setMessage] = React.useState("");
  const [contactName, setContactName] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [loadingThread, setLoadingThread] = React.useState(true);
  const [messages, setMessages] = React.useState<ThreadMessage[]>([]);
  const [lastResult, setLastResult] = React.useState<TestResponse["data"] | null>(null);

  const targetId = target?.id ?? null;

  const loadThread = React.useCallback(async () => {
    if (!targetId) return;
    setLoadingThread(true);
    try {
      const res = await apiClient.get<TestConversationResponse>(
        `/api/v1/ai/agents/${agent.id}/versions/${targetId}/test-conversation`,
      );
      setMessages(res.data.messages ?? []);
      setContactName(res.data.sample_contact?.name ?? "");
      setContactPhone(res.data.sample_contact?.phone ?? "");
    } catch {
      // Aba de teste não é crítica o bastante pra travar a tela por isto —
      // simplesmente começa como se fosse a primeira mensagem.
    } finally {
      setLoadingThread(false);
    }
  }, [agent.id, targetId]);

  React.useEffect(() => {
    setMessages([]);
    setLastResult(null);
    void loadThread();
  }, [loadThread]);

  if (!target) {
    return (
      <p className="text-sm text-muted-foreground">
        Configure e salve uma versão antes de testar.
      </p>
    );
  }

  const versionLabel =
    target.status === "published"
      ? `v${target.version_number} (publicada)`
      : `v${target.version_number} (rascunho)`;

  async function handleReset() {
    if (!target) return;
    setResetting(true);
    try {
      await apiClient.delete(`/api/v1/ai/agents/${agent.id}/versions/${target.id}/test-conversation`);
      setMessages([]);
      setLastResult(null);
      setContactName("");
      setContactPhone("");
      setMessage("");
      toast.success("Conversa de teste resetada.");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message ?? `Erro: ${err.code}`);
      } else {
        toast.error("Erro inesperado ao resetar.");
      }
    } finally {
      setResetting(false);
    }
  }

  async function handleRun() {
    const texto = message.trim();
    if (!texto) {
      toast.error("Informe uma mensagem de teste (ou digite \"resetar\" para recomeçar).");
      return;
    }
    if (isComandoResetar(texto)) {
      setMessage("");
      await handleReset();
      return;
    }
    if (!target) return;
    setPending(true);
    try {
      const body: Record<string, unknown> = { sample_message: texto };
      if (contactName.trim() || contactPhone.trim()) {
        body.sample_contact = {
          ...(contactName.trim() ? { name: contactName.trim() } : {}),
          ...(contactPhone.trim() ? { phone: contactPhone.trim() } : {}),
        };
      }
      const res = await apiClient.post<TestResponse>(
        `/api/v1/ai/agents/${agent.id}/versions/${target.id}/test`,
        body,
      );
      setLastResult(res.data);
      if (res.data.messages) setMessages(res.data.messages);
      setMessage("");
      qc.invalidateQueries({ queryKey: agentRunsKey(agent.id) });
      toast.success("Teste executado.");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message ?? `Erro: ${err.code}`);
      } else {
        toast.error("Erro inesperado.");
      }
    } finally {
      setPending(false);
    }
  }

  const hasThread = messages.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Versão alvo
            </p>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{versionLabel}</Badge>
              <span className="font-mono text-xs">
                {target.provider} / {target.model}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={resetting || (!hasThread && !loadingThread) || readOnly}
          >
            {resetting ? "Resetando…" : "Resetar conversa"}
          </Button>
        </div>

        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <p className="font-medium text-amber-700 dark:text-amber-400">
            ⚠ Modo teste consome créditos do provider.
          </p>
          <p className="mt-1 text-muted-foreground">
            Nenhuma mensagem é enviada via WhatsApp. Esta conversa fica só entre você e o agente —
            cada mensagem lembra das anteriores até você resetar (ou digitar "resetar").
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="test-message">Mensagem do cliente (sample)</Label>
          <Textarea
            id="test-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder='Oi, quanto custa X? (ou digite "resetar" para recomeçar)'
            rows={4}
            disabled={pending || resetting || readOnly}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="test-name">Nome (opcional)</Label>
            <Input
              id="test-name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Maria"
              disabled={pending || resetting || readOnly || hasThread}
              title={hasThread ? "Definido no início desta conversa de teste — resete para trocar." : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="test-phone">Telefone (opcional)</Label>
            <Input
              id="test-phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+55..."
              disabled={pending || resetting || readOnly || hasThread}
              title={hasThread ? "Definido no início desta conversa de teste — resete para trocar." : undefined}
            />
          </div>
        </div>

        <Button onClick={handleRun} disabled={pending || resetting || readOnly} className="self-start">
          {pending ? "Executando…" : "Enviar"}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Conversa de teste
        </p>

        {loadingThread ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : null}

        {!loadingThread && !hasThread && !pending ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma mensagem ainda — mande a primeira acima.
          </p>
        ) : null}

        {hasThread ? (
          <div className="flex flex-col gap-2" data-testid="teste-thread">
            {messages.map((m, idx) => (
              <div
                key={m.id ?? idx}
                className={
                  m.role === "user"
                    ? "self-end max-w-[85%] rounded-md bg-primary/10 px-3 py-2 text-sm"
                    : "self-start max-w-[85%] rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm"
                }
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
          </div>
        ) : null}

        {pending ? (
          <p className="text-sm text-muted-foreground">Executando dry-run…</p>
        ) : null}

        {lastResult ? (
          <div className="mt-2 flex flex-col gap-3 border-t border-border/60 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Detalhe do último turno
            </p>

            {lastResult.stub ? (
              <p className="rounded-md border border-border/60 bg-muted/40 p-2 text-xs text-muted-foreground">
                Stub: o runtime real é entregue na S-13.08. O trace abaixo é simulado.
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Cell label="Status">{lastResult.status}</Cell>
              <Cell label="Latência">
                {typeof lastResult.latency_ms === "number" ? `${lastResult.latency_ms}ms` : "—"}
              </Cell>
              <Cell label="Tokens in/out">
                {(lastResult.tokens_in ?? 0).toLocaleString()} /{" "}
                {(lastResult.tokens_out ?? 0).toLocaleString()}
              </Cell>
              <Cell label="Custo (cents)">{lastResult.cost_cents ?? 0}</Cell>
            </div>

            <RunTrace
              toolCalls={lastResult.tool_calls}
              finalText={null}
              emptyMessage="Sem tool calls (resposta direta do LLM)."
            />

            {lastResult.guardrails ? <Verificacoes g={lastResult.guardrails} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border/60 px-2 py-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono">{children}</p>
    </div>
  );
}
