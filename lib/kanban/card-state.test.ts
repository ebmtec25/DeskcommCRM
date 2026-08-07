/**
 * O card do Kanban ficou reduzido a identidade (nome, telefone, dono) —
 * ver o porquê no cabeçalho de `CardInput`. `resolveLeadOwner` já é testado
 * em isolamento por `owner.test.ts`; aqui só a montagem do CardInput.
 */
import { describe, it, expect } from "vitest";

import { buildCardInput } from "./card-state";
import type { Lead } from "@/lib/types/leads";

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    organization_id: "org",
    pipeline_id: "p1",
    stage_id: "s1",
    contact_id: "c1",
    title: "Carlos — Clínica Vida Odonto",
    description: null,
    value_cents: null,
    currency: "BRL",
    status: "open",
    lost_reason: null,
    position_in_stage: 1,
    owner_kind: null,
    owner_user_id: null,
    owner_agent_id: null,
    assigned_at: null,
    last_activity_at: null,
    expected_close_date: null,
    closed_at: null,
    source: "manual",
    source_metadata: {},
    external_id: null,
    custom_fields: {},
    tags: [],
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:00:00Z",
    created_by_user_id: null,
    ...over,
  } as Lead;
}

const opts = { ownerNames: new Map<string, string | null>() };

describe("buildCardInput — o card só sabe identidade", () => {
  it("telefone vem do contato anexado pela rota do board", () => {
    const card = buildCardInput(
      lead({ contact: { name: "Carlos", phone_number: "5511999999999" } }),
      opts,
    );
    expect(card.phone).toBe("5511999999999");
  });

  it("sem contato anexado, telefone é null — não vira string vazia", () => {
    expect(buildCardInput(lead({ contact: null }), opts).phone).toBeNull();
    expect(buildCardInput(lead({ contact: undefined }), opts).phone).toBeNull();
  });

  it("contato sem telefone cadastrado também é null", () => {
    const card = buildCardInput(lead({ contact: { name: "Carlos", phone_number: null } }), opts);
    expect(card.phone).toBeNull();
  });

  it("título passa direto — é o nome do cliente, não recalculado aqui", () => {
    const card = buildCardInput(lead({ title: "Ana — Studio Fit" }), opts);
    expect(card.title).toBe("Ana — Studio Fit");
  });
});
