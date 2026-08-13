import { describe, expect, it } from "vitest";
import type { FollowUp, Interaction } from "./schema";
import {
  CADENCE_PRESET_OPTIONS,
  FOLLOW_UP_ACTION_OPTIONS,
  addDaysToLocalDate,
  addMonthsToLocalDate,
  effectiveFollowUpDate,
  hasFollowUpCreatedAfterSoleContact,
  localDateForInstant,
  pendingFollowUpTemporalState
} from "./followUpPolicy";

const now = "2026-08-01T09:00:00.000Z";

function followUp(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "follow-up-one",
    revision: 1,
    personId: "person-one",
    dueDate: "2026-08-08",
    reason: "Send the update",
    actionType: "send_update",
    status: "pending",
    createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
    ...overrides
  };
}

function interaction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: "interaction-one",
    revision: 1,
    personId: "person-one",
    kind: "met",
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("follow-up policy", () => {
  it("exposes all eight shared action types without lossy mapping", () => {
    expect(FOLLOW_UP_ACTION_OPTIONS.map((option) => option.value)).toEqual([
      "message", "email", "call", "arrange_meeting", "make_introduction",
      "send_update", "research_contact_route", "other"
    ]);
    expect(CADENCE_PRESET_OPTIONS.map((option) => option.value)).toEqual([
      undefined, 1, 3, 7, 14, 30, 90
    ]);
  });

  it("uses the snooze date as the effective date and adds calendar days safely", () => {
    expect(effectiveFollowUpDate(followUp())).toBe("2026-08-08");
    expect(effectiveFollowUpDate(followUp({ snoozedUntilDate: "2026-08-10" }))).toBe("2026-08-10");
    expect(addDaysToLocalDate("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDaysToLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(() => addDaysToLocalDate("2026-02-30", 1)).toThrow(RangeError);
  });

  it("adds calendar months and clamps dates at the end of shorter months", () => {
    expect(addMonthsToLocalDate("2026-08-12", 1)).toBe("2026-09-12");
    expect(addMonthsToLocalDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToLocalDate("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsToLocalDate("2026-12-31", 1)).toBe("2027-01-31");
    expect(() => addMonthsToLocalDate("2026-02-30", 1)).toThrow(RangeError);
  });

  it("treats an elapsed snooze as due or overdue before using the Snoozed label", () => {
    const record = followUp({ dueDate: "2026-07-01", snoozedUntilDate: "2026-07-10" });
    expect(pendingFollowUpTemporalState(record, "2026-07-09")).toBe("snoozed");
    expect(pendingFollowUpTemporalState(record, "2026-07-10")).toBe("due_today");
    expect(pendingFollowUpTemporalState(record, "2026-07-11")).toBe("overdue");
    expect(pendingFollowUpTemporalState({ ...record, status: "completed" }, "2026-07-11")).toBeUndefined();
  });

  it("converts instants using an injected timezone at the UK DST boundary", () => {
    expect(localDateForInstant("2026-03-29T23:30:00.000Z", "UTC")).toBe("2026-03-29");
    expect(localDateForInstant("2026-03-29T23:30:00.000Z", "Europe/London")).toBe("2026-03-30");
  });

  it("suppresses New only when any-status follow-up was created after the sole contact", () => {
    const soleContact = interaction();
    expect(hasFollowUpCreatedAfterSoleContact([soleContact], [followUp({ status: "cancelled" })])).toBe(true);
    expect(hasFollowUpCreatedAfterSoleContact([soleContact], [followUp({
      createdAt: "2026-07-31T09:00:00.000Z",
      updatedAt: "2026-07-31T09:00:00.000Z"
    })])).toBe(false);
    expect(hasFollowUpCreatedAfterSoleContact([
      soleContact,
      interaction({ id: "interaction-two", kind: "email", occurredAt: "2026-08-03T09:00:00.000Z" })
    ], [followUp()])).toBe(false);
    expect(hasFollowUpCreatedAfterSoleContact([
      soleContact,
      interaction({ id: "note", kind: "note_added", occurredAt: "2026-08-03T09:00:00.000Z" })
    ], [followUp()])).toBe(true);
  });
});
