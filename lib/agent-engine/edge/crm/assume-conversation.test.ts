import { describe, expect, it, vi } from "vitest";

import { assumeConversationForAi } from "./assume-conversation";

describe("assumeConversationForAi", () => {
  it("limita a transição ao tenant, protege atendimento humano e audita atomicamente", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "conv-1" }] });

    await expect(
      assumeConversationForAi({ query } as never, {
        organizationId: "org-1",
        conversationId: "conv-1",
        agentId: "agent-1",
        jobId: "job-1",
      }),
    ).resolves.toBe(true);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("organization_id = $1");
    expect(sql).toContain("assigned_to_user_id is null");
    expect(sql).toContain("status in ('open', 'pending')");
    expect(sql).toContain("conversation.ai_assumed");
    expect(sql).toContain("from assumed");
    expect(params).toEqual([
      "org-1",
      "conv-1",
      JSON.stringify({ actor_kind: "ai_agent", agent_id: "agent-1" }),
      "job-1",
    ]);
  });

  it("não afirma nova assunção quando a conversa já estava no estado correto", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await expect(
      assumeConversationForAi({ query } as never, {
        organizationId: "org-1",
        conversationId: "conv-1",
        agentId: null,
        jobId: "job-2",
      }),
    ).resolves.toBe(false);
  });
});
