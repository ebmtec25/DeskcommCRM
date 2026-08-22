import { describe, expect, it, vi } from "vitest";

import type { EventRow } from "@/lib/event-log/dispatcher";
import { applyReactivityEvent, type ReactivityAdminClient } from "./reactivity";

const NOW = new Date("2026-08-22T12:00:00.000Z");

describe("follow-up reactivity — limpeza de etiquetas", () => {
  it("remove as etiquetas configuradas antes de cancelar por resposta", async () => {
    const removeReplyCleanupTags = vi.fn().mockResolvedValue(undefined);
    const updateEnrollment = vi.fn().mockResolvedValue(undefined);
    const db: ReactivityAdminClient = {
      loadConversationContactId: vi.fn().mockResolvedValue(null),
      loadContactBlocked: vi.fn().mockResolvedValue(false),
      loadLiveEnrollmentsForContact: vi.fn().mockResolvedValue([
        {
          id: "enrollment-1",
          status: "waiting_reply",
          current_node_id: "classify-1",
          version_id: "version-1",
          steps_taken: 7,
          pointer_id: "pointer-1",
          handoff_policy: "pause",
          trigger_config: { kind: "manual", cancel_on_reply: true },
        },
      ]),
      insertEnrollmentEvent: vi.fn().mockResolvedValue({ inserted: true }),
      updateEnrollment,
      removeReplyCleanupTags,
      agoraNoBanco: vi.fn().mockResolvedValue(NOW.toISOString()),
    };
    const row: EventRow = {
      id: "event-1",
      organization_id: "org-1",
      event_type: "message.received",
      entity_kind: "message",
      entity_id: "message-1",
      payload: { contact_id: "contact-1" },
      metadata: {},
      consumed_by: [],
      attempts: 0,
    };

    const summary = await applyReactivityEvent(db, () => NOW, row);

    expect(removeReplyCleanupTags).toHaveBeenCalledWith(
      "org-1",
      "contact-1",
      "version-1",
      "followup-reply:event-1:enrollment-1",
    );
    expect(updateEnrollment).toHaveBeenCalledWith(
      "enrollment-1",
      "org-1",
      expect.objectContaining({
        status: "cancelled",
        outcome: "replied",
        cancel_reason: "cancel_on_reply",
      }),
    );
    expect(summary).toEqual({ matched: true, reacted: 1 });
  });
});
