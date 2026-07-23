import { effectiveFollowUpDate } from "./followUpPolicy";
import type { FollowUp, LocalDate, ReachOutEntry } from "./schema";

export type ReachOutDisplayState =
  | "active"
  | "waiting"
  | "snoozed"
  | "overdue"
  | "completed"
  | "dormant";

export type ReachOutStatusFilter =
  | "active"
  | "due"
  | "overdue"
  | "upcoming"
  | "waiting"
  | "snoozed"
  | "dormant"
  | "completed";

export type ReachOutQueueComparable = {
  entry: ReachOutEntry;
  followUp?: FollowUp;
  displayName: string;
};

function currentPendingFollowUp(entry: ReachOutEntry, followUp?: FollowUp): FollowUp | undefined {
  return followUp
    && entry.currentFollowUpId === followUp.id
    && followUp.reachOutEntryId === entry.id
    && followUp.personId === entry.personId
    && followUp.status === "pending"
    ? followUp
    : undefined;
}

export function deriveReachOutDisplayState(
  entry: ReachOutEntry,
  followUp: FollowUp | undefined,
  localDate: LocalDate
): ReachOutDisplayState {
  if (entry.intentStatus === "completed") return "completed";
  if (entry.intentStatus === "dormant") return "dormant";
  const current = currentPendingFollowUp(entry, followUp);
  if (!current) return "active";
  const effectiveDate = effectiveFollowUpDate(current);
  if (effectiveDate < localDate) return "overdue";
  if (current.snoozedUntilDate && effectiveDate > localDate) return "snoozed";
  if (effectiveDate > localDate) return "waiting";
  return "active";
}

export function reachOutMatchesStatusFilters(
  entry: ReachOutEntry,
  followUp: FollowUp | undefined,
  localDate: LocalDate,
  filters: readonly ReachOutStatusFilter[]
): boolean {
  if (entry.removedAt) return false;
  const state = deriveReachOutDisplayState(entry, followUp, localDate);
  if (filters.length === 0) return state !== "completed" && state !== "dormant";
  const current = currentPendingFollowUp(entry, followUp);
  const effectiveDate = current ? effectiveFollowUpDate(current) : undefined;
  return filters.some((filter) => {
    if (filter === "due") return state === "active" && effectiveDate === localDate;
    if (filter === "upcoming") return Boolean(effectiveDate && effectiveDate > localDate);
    return state === filter;
  });
}

function activeQueueBand(item: ReachOutQueueComparable, localDate: LocalDate): number {
  const state = deriveReachOutDisplayState(item.entry, item.followUp, localDate);
  if (state === "overdue") return 0;
  const current = currentPendingFollowUp(item.entry, item.followUp);
  if (state === "active" && current && effectiveFollowUpDate(current) === localDate) return 1;
  if (state === "active") return 2;
  if (state === "waiting" || state === "snoozed") return 3;
  if (state === "dormant") return 4;
  return 5;
}

export function compareReachOutQueueItems(
  left: ReachOutQueueComparable,
  right: ReachOutQueueComparable,
  localDate: LocalDate
): number {
  const leftBand = activeQueueBand(left, localDate);
  const rightBand = activeQueueBand(right, localDate);
  if (leftBand !== rightBand) return leftBand - rightBand;

  if (leftBand === 0 || leftBand === 1 || leftBand === 3) {
    const leftDate = left.followUp ? effectiveFollowUpDate(left.followUp) : "";
    const rightDate = right.followUp ? effectiveFollowUpDate(right.followUp) : "";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  } else if (leftBand === 2) {
    const added = right.entry.addedAt.localeCompare(left.entry.addedAt);
    if (added !== 0) return added;
  } else {
    const updated = right.entry.updatedAt.localeCompare(left.entry.updatedAt);
    if (updated !== 0) return updated;
  }

  const label = left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
  return label || left.entry.id.localeCompare(right.entry.id);
}
