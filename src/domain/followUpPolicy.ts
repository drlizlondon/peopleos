import { interactionCountsAsContact } from "./interactionPolicy";
import type { FollowUp, FollowUpActionType, Interaction, LocalDate } from "./schema";

export const FOLLOW_UP_ACTION_OPTIONS: ReadonlyArray<{
  value: FollowUpActionType;
  label: string;
}> = [
  { value: "message", label: "Message" },
  { value: "email", label: "Email" },
  { value: "call", label: "Call" },
  { value: "arrange_meeting", label: "Arrange meeting" },
  { value: "make_introduction", label: "Make introduction" },
  { value: "send_update", label: "Send update" },
  { value: "research_contact_route", label: "Research contact route" },
  { value: "other", label: "Other" }
];

export const CADENCE_PRESET_OPTIONS: ReadonlyArray<{
  value: undefined | 30 | 90 | 180 | 365;
  label: string;
}> = [
  { value: undefined, label: "No recurring cadence" },
  { value: 30, label: "Monthly" },
  { value: 90, label: "Every 3 months" },
  { value: 180, label: "Every 6 months" },
  { value: 365, label: "Yearly" }
];

export function effectiveFollowUpDate(
  followUp: Pick<FollowUp, "dueDate" | "snoozedUntilDate">
): LocalDate {
  return followUp.snoozedUntilDate ?? followUp.dueDate;
}

export type PendingFollowUpTemporalState =
  | "overdue"
  | "due_today"
  | "snoozed"
  | "future_pending";

export function pendingFollowUpTemporalState(
  followUp: Pick<FollowUp, "status" | "dueDate" | "snoozedUntilDate">,
  localDate: LocalDate
): PendingFollowUpTemporalState | undefined {
  if (followUp.status !== "pending") return undefined;
  const effectiveDate = effectiveFollowUpDate(followUp);
  if (effectiveDate < localDate) return "overdue";
  if (effectiveDate === localDate) return "due_today";
  if (followUp.snoozedUntilDate) return "snoozed";
  return "future_pending";
}

export function addDaysToLocalDate(date: LocalDate, days: number): LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days)) {
    throw new RangeError("A valid local date and whole number of days are required.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(start.getTime()) || start.getUTCFullYear() !== year
    || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) {
    throw new RangeError("The local date is invalid.");
  }
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

export function isPendingFollowUp(
  followUp: Pick<FollowUp, "status">
): boolean {
  return followUp.status === "pending";
}

export function compareFollowUpsByEffectiveDate(
  left: FollowUp,
  right: FollowUp
): number {
  return effectiveFollowUpDate(left).localeCompare(effectiveFollowUpDate(right))
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

/**
 * `Intl.DateTimeFormat` construction dominates this function: building a
 * formatter per call costs ~27us, while reusing one costs ~1.3us for identical
 * output. The Relationship Engine calls this roughly eight times per Person, so
 * on a 3,000-contact dataset the difference is most of a second per Today
 * build. Formatters are immutable and safe to share.
 *
 * Keyed by time zone, and effectively bounded by the number of zones a single
 * user's data can reference — one in practice, a handful in tests. An invalid
 * zone still throws from the constructor on first use and is never cached.
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = dateFormatters.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  dateFormatters.set(timeZone, formatter);
  return formatter;
}

export function localDateForInstant(
  instant: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): LocalDate {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new RangeError("The instant is invalid.");
  const parts = dateFormatterFor(timeZone).formatToParts(date);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new RangeError("The local date could not be calculated.");
  return `${year}-${month}-${day}`;
}

export function hasFollowUpCreatedAfterSoleContact(
  interactions: readonly Interaction[],
  followUps: readonly FollowUp[]
): boolean {
  const contacts = interactions.filter((interaction) => interactionCountsAsContact(interaction.kind));
  if (contacts.length !== 1) return false;
  return followUps.some((followUp) => followUp.personId === contacts[0].personId
    && followUp.createdAt > contacts[0].occurredAt);
}
