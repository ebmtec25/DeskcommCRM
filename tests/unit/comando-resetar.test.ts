import { describe, expect, it } from "vitest";

import { isComandoResetar } from "@/lib/ai/agents/comando-resetar";

describe("isComandoResetar", () => {
  it("reconhece a palavra sozinha", () => {
    expect(isComandoResetar("resetar")).toBe(true);
  });

  it("ignora caixa e espaços em volta", () => {
    expect(isComandoResetar("  ResEtar  ")).toBe(true);
  });

  it("não reconhece a palavra dentro de uma frase (é mensagem de teste normal)", () => {
    expect(isComandoResetar("como faço para resetar minha senha?")).toBe(false);
  });

  it("não reconhece string vazia", () => {
    expect(isComandoResetar("")).toBe(false);
  });
});
