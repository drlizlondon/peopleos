import { describe, expect, it } from "vitest";
import type { FollowUp, ReachOutEntry } from "./schema";
import {
  compareReachOutQueueItems,
  deriveReachOutDisplayState,
  reachOutMatchesStatusFilters
} from "./reachOutPolicy";

const now = "2026-08-01T09:00:00.000Z";

function entry(overrides: Partial<ReachOutEntry> = {}): ReachOutEntry {
  return {
    id: "reach-1",
    revision: 1,
    personId: "person-1",
    intentStatus: "active",
    contextIds: [],
    addedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function followUp(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "follow-1",
    revision: 1,
    personId: "person-1",
    reachOutEntryId: "reach-1",
    dueDate: "2026-08-08",
    reason: "Reconnect",
    actionType: "other",
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("Reach Out display policy", () => {
  it.each([
    [entry({ intentStatus: "completed" }), undefined, "completed"],
    [entry({ intentStatus: "dormant" }), undefined, "dormant"],
    [entry(), undefined, "active"],
    [entry({ currentFollowUpId: "follow-1" }), followUp({ dueDate: "2026-07-31" }), "overdue"],
    [entry({ currentFollowUpId: "follow-1" }), followUp({ dueDate: "2026-08-01" }), "active"],
    [entry({ currentFollowUpId: "follow-1" }), followUp({ dueDate: "2026-08-08" }), "waiting"],
    [entry({ currentFollowUpId: "follow-1" }), followUp({ dueDate: "2026-08-01", snoozedUntilDate: "2026-08-08" }), "snoozed"]
  ] as const)("derives %s without storing projection state", (record, plan, expected) => {
    expect(deriveReachOutDisplayState(record, plan, "2026-08-01")).toBe(expected);
  });

  it("treats a broken or terminal link as active rather than inventing a date", () => {
    const record = entry({ currentFollowUpId: "follow-1" });
    expect(deriveReachOutDisplayState(record, followUp({ status: "cancelled" }), "2026-08-01")).toBe("active");
    expect(deriveReachOutDisplayState(record, followUp({ personId: "someone-else" }), "2026-08-01")).toBe("active");
  });

  it("supports the complete deterministic status-filter contract", () => {
    const dueEntry = entry({ currentFollowUpId: "follow-1" });
    const duePlan = followUp({ dueDate: "2026-08-01" });
    expect(reachOutMatchesStatusFilters(dueEntry, duePlan, "2026-08-01", ["due"])).toBe(true);
    expect(reachOutMatchesStatusFilters(dueEntry, duePlan, "2026-08-01", ["active"])).toBe(true);
    expect(reachOutMatchesStatusFilters(dueEntry, duePlan, "2026-08-01", ["upcoming"])).toBe(false);

    const snoozed = followUp({ dueDate: "2026-08-01", snoozedUntilDate: "2026-08-08" });
    expect(reachOutMatchesStatusFilters(dueEntry, snoozed, "2026-08-01", ["snoozed"])).toBe(true);
    expect(reachOutMatchesStatusFilters(dueEntry, snoozed, "2026-08-01", ["upcoming"])).toBe(true);

    expect(reachOutMatchesStatusFilters(entry({ intentStatus: "completed" }), undefined, "2026-08-01", [])).toBe(false);
    expect(reachOutMatchesStatusFilters(entry({ intentStatus: "completed" }), undefined, "2026-08-01", ["completed"])).toBe(true);
    expect(reachOutMatchesStatusFilters(entry({ removedAt: now }), undefined, "2026-08-01", ["active"])).toBe(false);
  });

  it("orders the active queue by documented bands and stable tie-breakers", () => {
    const items = [
      { entry: entry({ id: "waiting", currentFollowUpId: "waiting-plan", personId: "waiting-person" }), followUp: followUp({ id: "waiting-plan", personId: "waiting-person", reachOutEntryId: "waiting", dueDate: "2026-08-05" }), displayName: "Waiting" },
      { entry: entry({ id: "no-date-new", personId: "new-person", addedAt: "2026-08-01T10:00:00.000Z" }), displayName: "New" },
      { entry: entry({ id: "due", currentFollowUpId: "due-plan", personId: "due-person" }), followUp: followUp({ id: "due-plan", personId: "due-person", reachOutEntryId: "due", dueDate: "2026-08-01" }), displayName: "Due" },
      { entry: entry({ id: "overdue-late", currentFollowUpId: "overdue-late-plan", personId: "late-person" }), followUp: followUp({ id: "overdue-late-plan", personId: "late-person", reachOutEntryId: "overdue-late", dueDate: "2026-07-31" }), displayName: "Late" },
      { entry: entry({ id: "overdue-old", currentFollowUpId: "overdue-old-plan", personId: "old-person" }), followUp: followUp({ id: "overdue-old-plan", personId: "old-person", reachOutEntryId: "overdue-old", dueDate: "2026-07-25" }), displayName: "Old" }
    ];
    expect(items.sort((left, right) => compareReachOutQueueItems(left, right, "2026-08-01")).map((item) => item.entry.id))
      .toEqual(["overdue-old", "overdue-late", "due", "no-date-new", "waiting"]);
  });
});
