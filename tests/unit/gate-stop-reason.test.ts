import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";
import { BEFORE_SEND_GATES, type GateContext } from "@/lib/agent-engine/guardrails/before-send";
import { retentionCopy } from "@/lib/inbox/retention-copy";

const stopGate = BEFORE_SEND_GATES[0]!;

function baseCtx(over: Partial<GateContext> = {}): GateContext {
  return {
    now: new Date("2026-08-26T12:00:00Z"),
    body: "oi",
    optedOut: false,
    provider: "waha",
    pacing: {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
      rng: () => 0,
    },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    lgpd: null,
    promise: { table: null },
    semanticPromise: null,
    ...over,
  } as GateContext;
}

const CTX = { window_start_hour: 7, window_end_hour: 22, allow_sunday: true, timezone: "America/Sao_Paulo" };

describe("gate stop — opt-out real x comando com o humano são motivos diferentes", () => {
  // Bug real medido em produção: `readStopFlags` só devolvia `is_blocked OR
  // force_human`, então TODO handoff humano virava o código `contato_bloqueado` —
  // a Central acusava "o contato pediu para não receber mensagens" quando na
  // verdade um atendente só tinha assumido a conversa. `stopReason` distingue as
  // duas raízes do mesmo veto irrevogável.
  it("opt-out real: code contato_bloqueado", () => {
    const v = stopGate.evaluate(baseCtx({ optedOut: true, stopReason: "opt_out" }));
    expect(v.pass).toBe(false);
    if (v.pass) throw new Error("inalcançável");
    expect(v.code).toBe("contato_bloqueado");
  });

  it("comando com o humano: code atendimento_humano, NÃO contato_bloqueado", () => {
    const v = stopGate.evaluate(baseCtx({ optedOut: true, stopReason: "human_takeover" }));
    expect(v.pass).toBe(false);
    if (v.pass) throw new Error("inalcançável");
    expect(v.code).toBe("atendimento_humano");
  });

  it("stopReason ausente (chamador antigo) cai no default seguro: contato_bloqueado", () => {
    const v = stopGate.evaluate(baseCtx({ optedOut: true }));
    expect(v.pass).toBe(false);
    if (v.pass) throw new Error("inalcançável");
    expect(v.code).toBe("contato_bloqueado");
  });

  it("sem veto nenhum passa", () => {
    expect(stopGate.evaluate(baseCtx({ optedOut: false })).pass).toBe(true);
  });
});

describe("retentionCopy — a tela não pode acusar o cliente de opt-out por um handoff humano", () => {
  it("atendimento_humano vira aviso de handoff, não de conformidade", () => {
    const copy = retentionCopy("atendimento_humano", CTX);
    expect(copy.kind).toBe("handoff");
    expect(copy.description).not.toMatch(/pediu para não receber/);
    expect(copy.description).not.toMatch(/opt-out/);
  });

  it("contato_bloqueado continua o aviso de conformidade de sempre", () => {
    const copy = retentionCopy("contato_bloqueado", CTX);
    expect(copy.kind).toBe("compliance");
  });
});
