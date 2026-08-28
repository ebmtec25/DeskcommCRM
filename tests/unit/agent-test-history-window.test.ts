import { describe, expect, it } from "vitest";

import { trimHistoryToBudget, estimateTokens, type HistoryMessage } from "@/lib/ai/runtime/history";

/**
 * Migration 0177 — o histórico da conversa de teste (ai_agent_test_messages)
 * precisa passar pela MESMA janela deslizante que `loadHistoryWithBudget` já
 * aplicava sobre `messages` real. Extraída como função pura para os dois
 * caminhos compartilharem o comportamento em vez de duas cópias divergirem.
 */
function msg(role: HistoryMessage["role"], content: string): HistoryMessage {
  return { role, content };
}

describe("trimHistoryToBudget", () => {
  it("mantém tudo quando cabe na janela de mensagens e de tokens", () => {
    const history = [msg("user", "oi"), msg("assistant", "olá, tudo bem?")];
    const out = trimHistoryToBudget(history, { messageWindow: 20, tokenWindow: 8000 });
    expect(out).toEqual(history);
  });

  it("corta pelo número de mensagens, mantendo as MAIS RECENTES", () => {
    const history = [msg("user", "1"), msg("assistant", "2"), msg("user", "3"), msg("assistant", "4")];
    const out = trimHistoryToBudget(history, { messageWindow: 2, tokenWindow: 8000 });
    expect(out).toEqual([msg("user", "3"), msg("assistant", "4")]);
  });

  it("corta pelo orçamento de tokens quando a janela de mensagens é folgada", () => {
    const big = "x".repeat(4000); // ~1000 tokens
    const history = [msg("user", big), msg("assistant", "resposta curta")];
    const out = trimHistoryToBudget(history, { messageWindow: 20, tokenWindow: estimateTokens("resposta curta") });
    expect(out).toEqual([msg("assistant", "resposta curta")]);
  });

  it("lista vazia devolve lista vazia (primeira mensagem da conversa de teste)", () => {
    expect(trimHistoryToBudget([], { messageWindow: 20, tokenWindow: 8000 })).toEqual([]);
  });

  it("preserva a ordem cronológica (oldest-first) do que sobrou", () => {
    const history = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")];
    const out = trimHistoryToBudget(history, { messageWindow: 3, tokenWindow: 8000 });
    expect(out.map((m) => m.content)).toEqual(["a", "b", "c"]);
  });
});
