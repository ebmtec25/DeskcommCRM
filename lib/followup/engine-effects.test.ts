import { describe, expect, it, vi } from "vitest";

import { runFollowupTick, type AdminClient } from "./engine";
import type { EnrollmentRow } from "./node-handlers";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function enrollment(): EnrollmentRow {
  return {
    id: "enrollment-1",
    organization_id: "org-1",
    pointer_id: "pointer-1",
    version_id: "version-1",
    contact_id: "contact-1",
    conversation_id: null,
    current_node_id: "tag-2",
    status: "active",
    next_eval_at: NOW.toISOString(),
    claimed_until: null,
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    steps_taken: 4,
    outcome: null,
    cancel_reason: null,
    started_at: NOW.toISOString(),
    completed_at: null,
    updated_at: NOW.toISOString(),
  };
}

describe("follow-up engine — ações nativas de CRM", () => {
  it("aplica a troca de etiqueta, registra o passo e avança sem enfileirar mensagem", async () => {
    const applyLeadEffect = vi.fn().mockResolvedValue(undefined);
    const updateEnrollment = vi.fn().mockResolvedValue(undefined);
    const insertEnrollmentEvent = vi.fn().mockResolvedValue({ inserted: true });
    const db: AdminClient = {
      claimDueEnrollments: vi.fn().mockResolvedValue([enrollment()]),
      loadFlowGraph: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "tag-2",
            type: "action",
            label: "Follow-up 2",
            position: { x: 0, y: 0 },
            config: {
              mode: "tag_update",
              add_tags: ["FOLLOW-UP 2"],
              remove_tags: ["FOLLOW-UP 1"],
              remove_added_on_reply: true,
            },
          },
          {
            id: "send-2",
            type: "end",
            label: "Fim",
            position: { x: 0, y: 100 },
            config: { outcome: "exhausted" },
          },
        ],
        edges: [
          {
            id: "tag-2-send-2",
            source: "tag-2",
            target: "send-2",
            condition: { type: "always" },
            priority: 0,
          },
        ],
      }),
      loadLeadFacts: vi.fn().mockResolvedValue({ lead_stage: "recepcao", tags: ["FOLLOW-UP 1"] }),
      loadEnrollmentEvents: vi.fn().mockResolvedValue([]),
      insertEnrollmentEvent,
      updateEnrollment,
      loadFlowPointerName: vi.fn().mockResolvedValue("Fluxo"),
      insertDeadInboxItem: vi.fn().mockResolvedValue(undefined),
      applyLeadEffect,
    };
    const enqueueJob = vi.fn().mockResolvedValue(undefined);

    const summary = await runFollowupTick({ db, clock: () => NOW, enqueueJob });

    expect(applyLeadEffect).toHaveBeenCalledWith(
      "org-1",
      "contact-1",
      {
        mode: "tag_update",
        add_tags: ["FOLLOW-UP 2"],
        remove_tags: ["FOLLOW-UP 1"],
        remove_added_on_reply: true,
      },
      "followup:enrollment-1:tag-2:4",
    );
    expect(insertEnrollmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "lead_effect_applied",
        idempotency_key: "tag-2:4",
      }),
    );
    expect(updateEnrollment).toHaveBeenCalledWith(
      "enrollment-1",
      "org-1",
      expect.objectContaining({
        current_node_id: "send-2",
        status: "active",
        steps_taken: 5,
      }),
    );
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ claimed: 1, advanced: 1, failed: 0 });
  });
});
