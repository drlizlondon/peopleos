import { addDaysToLocalDate, localDateForInstant } from "../domain/followUpPolicy";
import { personMatchesActiveMode, type ActiveRelationshipMode } from "../domain/relationshipMode";
import type { PeopleOsData } from "../domain/schema";
import {
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  resolveRelationshipScheduleState,
  type RelationshipClock
} from "../relationship-engine";
import { groupRelationshipData, relationshipBundleFromGroups } from "../application/relationshipEngineQueries";

// Keep enough headroom under iOS's 64-request limit to replace the whole
// PeopleOS plan before removing the previous one. That makes reconciliation
// recoverable if the native scheduler accepts only part of a replacement.
export const TODAY_NOTIFICATION_LIMIT = 30;
const TODAY_NOTIFICATION_ID_BASE = 1_500_000_000;

export type TodayNotificationPlanEntry = {
  id: number;
  localDate: string;
  at: Date;
  title: "PeopleOS";
  body: string;
  extra: {
    kind: "today-summary";
    destination: "today";
  };
};

export type TodayNotificationPlanOptions = {
  now: Date;
  timeZone: string;
  time: string;
  activeMode: ActiveRelationshipMode;
  limit?: number;
};

export type TodayNotificationPlanningResult = {
  entries: TodayNotificationPlanEntry[];
  /**
   * App-internal identifiers for people whose regular-contact frequency cannot
   * yet produce a date. These identifiers are never passed to iOS or included
   * in notification content.
   */
  incompleteRegularSchedulePersonIds: string[];
};

function parseTime(time: string): { hour: number; minute: number } {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(time);
  if (!match) throw new RangeError("A valid reminder time is required.");
  const [hour, minute] = time.split(":").map(Number);
  return { hour, minute };
}

function localDateAtTime(localDate: string, time: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const { hour, minute } = parseTime(time);
  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (!Number.isFinite(at.getTime())) throw new RangeError("The reminder date is invalid.");
  return at;
}

function nextSchedulableLocalDate(now: Date, timeZone: string, time: string): string {
  const today = localDateForInstant(now.toISOString(), timeZone);
  return localDateAtTime(today, time).getTime() > now.getTime()
    ? today
    : addDaysToLocalDate(today, 1);
}

export function todayNotificationId(localDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new RangeError("A valid local date is required.");
  const id = TODAY_NOTIFICATION_ID_BASE + Number(localDate.replaceAll("-", ""));
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) throw new RangeError("The local date is outside the supported notification range.");
  return id;
}

export function isTodayNotificationId(id: number): boolean {
  if (!Number.isInteger(id) || id <= TODAY_NOTIFICATION_ID_BASE || id > 2_147_483_647) return false;
  const encoded = String(id - TODAY_NOTIFICATION_ID_BASE).padStart(8, "0");
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(encoded);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function countBody(count: number): string {
  return count === 1
    ? "1 person is on your list today."
    : `${count} people are on your list today.`;
}

/**
 * Forecast a bounded set of device-local reminders from the same deterministic
 * eligibility rules as Today. The forecast contains no relationship data.
 * It is rebuilt whenever the local dataset, selected mode, time or permission
 * intent changes, and whenever the native app returns to the foreground.
 */
export function buildTodayNotificationPlanningResult(
  data: PeopleOsData,
  options: TodayNotificationPlanOptions
): TodayNotificationPlanningResult {
  const limit = options.limit ?? TODAY_NOTIFICATION_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > TODAY_NOTIFICATION_LIMIT) {
    throw new RangeError(`Notification limit must be between 1 and ${TODAY_NOTIFICATION_LIMIT}.`);
  }
  parseTime(options.time);
  const clock: RelationshipClock = {
    now: options.now.toISOString(),
    timeZone: options.timeZone,
    policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
  };
  const grouped = groupRelationshipData(data);
  const incompleteRegularSchedulePersonIds: string[] = [];
  const eligible = data.people.flatMap((person) => {
    if (!personMatchesActiveMode(person, options.activeMode)) return [];
    try {
      const scheduleState = resolveRelationshipScheduleState(
        relationshipBundleFromGroups(grouped, person),
        clock
      );
      if (scheduleState.kind === "incomplete_regular_schedule") {
        incompleteRegularSchedulePersonIds.push(person.id);
        return [];
      }
      return scheduleState.kind === "scheduled"
        ? [{
            personId: person.id,
            localDate: scheduleState.localDate,
            ...(scheduleState.temporary && scheduleState.resumesOn
              ? { resumesOn: scheduleState.resumesOn }
              : {})
          }]
        : [];
    } catch {
      return [];
    }
  });
  if (eligible.length === 0) {
    return { entries: [], incompleteRegularSchedulePersonIds };
  }

  const skipped = new Set(data.todaySkips.map((skip) => `${skip.personId}:${skip.localDate}`));
  const skippedDates = new Set(data.todaySkips.map((skip) => skip.localDate));
  const firstEligibleDate = eligible.reduce(
    (earliest, candidate) => candidate.localDate < earliest ? candidate.localDate : earliest,
    eligible[0].localDate
  );
  const firstSchedulableDate = nextSchedulableLocalDate(options.now, options.timeZone, options.time);
  let localDate = firstEligibleDate < firstSchedulableDate ? firstSchedulableDate : firstEligibleDate;
  const currentLocalDate = localDateForInstant(options.now.toISOString(), options.timeZone);
  const plan: TodayNotificationPlanEntry[] = [];
  const maxAttempts = limit + skippedDates.size + eligible.length + 1;

  for (let attempts = 0; plan.length < limit && attempts < maxAttempts; attempts += 1) {
    const count = eligible.filter((candidate) => candidate.localDate <= localDate
      && (!candidate.resumesOn || localDate === candidate.localDate || candidate.resumesOn <= localDate)
      && !skipped.has(`${candidate.personId}:${localDate}`)).length;
    if (count > 0) {
      plan.push({
        id: todayNotificationId(localDate),
        localDate,
        at: localDateAtTime(localDate, options.time),
        title: "PeopleOS",
        body: localDate === currentLocalDate
          ? countBody(count)
          : "People are waiting on your list today.",
        extra: { kind: "today-summary", destination: "today" }
      });
    }
    if (count === 0) {
      const skippedCandidateCanReturnTomorrow = eligible.some((candidate) =>
        candidate.localDate <= localDate
        && (!candidate.resumesOn || localDate === candidate.localDate || candidate.resumesOn <= localDate)
        && skipped.has(`${candidate.personId}:${localDate}`)
      );
      const nextEligibility = eligible
        .flatMap((candidate) => [
          ...(candidate.localDate > localDate ? [candidate.localDate] : []),
          ...(candidate.resumesOn && candidate.resumesOn > localDate ? [candidate.resumesOn] : [])
        ])
        .sort()[0];
      const tomorrow = addDaysToLocalDate(localDate, 1);
      localDate = skippedCandidateCanReturnTomorrow && (!nextEligibility || tomorrow < nextEligibility)
        ? tomorrow
        : nextEligibility ?? tomorrow;
    } else {
      localDate = addDaysToLocalDate(localDate, 1);
    }
  }
  return { entries: plan, incompleteRegularSchedulePersonIds };
}

export function buildTodayNotificationPlan(
  data: PeopleOsData,
  options: TodayNotificationPlanOptions
): TodayNotificationPlanEntry[] {
  return buildTodayNotificationPlanningResult(data, options).entries;
}
