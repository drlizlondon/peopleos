import type { PeopleOsDatabase } from "../data/database";
import { contactCadenceInDays, contactCadenceOf } from "../domain/cadence";
import { interactionCountsAsContact } from "../domain/interactionPolicy";
import {
  addDaysToLocalDate,
  compareFollowUpsByEffectiveDate,
  effectiveFollowUpDate,
  localDateForInstant
} from "../domain/followUpPolicy";
import type {
  ContactCadence,
  FollowUp,
  FollowUpActionType,
  FollowUpEvent,
  LocalDate,
  Person,
  TodaySkip
} from "../domain/schema";
import { personMatchesActiveMode, type ActiveRelationshipMode } from "../domain/relationshipMode";

export type PersonFollowUpLists = {
  pending: FollowUp[];
  history: FollowUp[];
};

export type FollowUpDetail = {
  followUp: FollowUp;
  person: Person;
  events: FollowUpEvent[];
  lineage: {
    previous?: FollowUp;
    next?: FollowUp;
  };
};

export type UpcomingFilters = {
  localDate: LocalDate;
  activeMode?: ActiveRelationshipMode;
  window?: "next_7_days" | "next_30_days" | "later";
  personId?: string;
  actionType?: FollowUpActionType;
};

export type UpcomingFollowUp = {
  followUp: FollowUp;
  person: Person;
  effectiveDate: LocalDate;
};

export type UpcomingGroup = {
  key: string;
  items: UpcomingFollowUp[];
};

export type UpcomingResult = {
  items: UpcomingFollowUp[];
  groups: UpcomingGroup[];
  dueCount: number;
};

export type UpcomingCadence = { person: Person; effectiveDate: LocalDate; cadenceDays: number };

export async function listUpcomingCadences(
  db: PeopleOsDatabase,
  filters: Pick<UpcomingFilters, "localDate" | "activeMode">
): Promise<UpcomingCadence[]> {
  const [people, interactions] = await Promise.all([db.getAll("people"), db.getAll("interactions")]);
  const latestContact = new Map<string, string>();
  for (const interaction of interactions) {
    if (!interactionCountsAsContact(interaction.kind)) continue;
    const current = latestContact.get(interaction.personId);
    if (!current || interaction.occurredAt > current) latestContact.set(interaction.personId, interaction.occurredAt);
  }
  return people.flatMap((person): UpcomingCadence[] => {
    if (!activePerson(person) || !personMatchesActiveMode(person, filters.activeMode ?? "personal")
      || !person.contactCadenceDays || person.contactCadencePausedAt) return [];
    const last = latestContact.get(person.id);
    const regularDate = last
      ? addDaysToLocalDate(localDateForInstant(last), person.contactCadenceDays)
      : person.contactCadenceFirstDueDate;
    const effectiveDate = person.contactCadenceDeferredUntilDate && (!regularDate || person.contactCadenceDeferredUntilDate > regularDate)
      ? person.contactCadenceDeferredUntilDate
      : regularDate;
    return effectiveDate && effectiveDate > filters.localDate
      ? [{ person, effectiveDate, cadenceDays: person.contactCadenceDays }]
      : [];
  }).sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate)
    || left.person.displayName.localeCompare(right.person.displayName));
}

export type NextPlanProjection =
  | { kind: "explicit_follow_up"; date: LocalDate; followUp: FollowUp }
  | { kind: "cadence"; date?: LocalDate; cadence: ContactCadence; cadenceDays: number }
  | { kind: "none" };

function activePerson(person: Person | undefined): person is Person {
  return Boolean(person && !person.archivedAt && person.identityStatus !== "merged");
}

function compareHistory(left: FollowUp, right: FollowUp): number {
  return right.updatedAt.localeCompare(left.updatedAt)
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id);
}

function compareUpcoming(left: UpcomingFollowUp, right: UpcomingFollowUp): number {
  return left.effectiveDate.localeCompare(right.effectiveDate)
    || (left.person.importance === right.person.importance
      ? 0
      : left.person.importance === "high" ? -1 : 1)
    || left.person.displayName.localeCompare(right.person.displayName, "en-US", { sensitivity: "base" })
    || left.person.id.localeCompare(right.person.id)
    || left.followUp.createdAt.localeCompare(right.followUp.createdAt)
    || left.followUp.id.localeCompare(right.followUp.id);
}

export async function listPersonFollowUps(
  db: PeopleOsDatabase,
  personId: string
): Promise<PersonFollowUpLists> {
  const records = await db.getAllFromIndex("followUps", "by-person", personId);
  return {
    pending: records.filter((record) => record.status === "pending").sort(compareFollowUpsByEffectiveDate),
    history: records.filter((record) => record.status !== "pending").sort(compareHistory)
  };
}

export async function getFollowUpDetail(
  db: PeopleOsDatabase,
  id: string
): Promise<FollowUpDetail | undefined> {
  const followUp = await db.get("followUps", id);
  if (!followUp) return undefined;
  const [person, events, previous, next] = await Promise.all([
    db.get("people", followUp.personId),
    db.getAllFromIndex("followUpEvents", "by-follow-up", followUp.id),
    followUp.supersedesFollowUpId
      ? db.get("followUps", followUp.supersedesFollowUpId)
      : Promise.resolve(undefined),
    followUp.supersededByFollowUpId
      ? db.get("followUps", followUp.supersededByFollowUpId)
      : Promise.resolve(undefined)
  ]);
  if (!person) return undefined;
  return {
    followUp,
    person,
    events: events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)
      || left.id.localeCompare(right.id)),
    lineage: {
      ...(previous ? { previous } : {}),
      ...(next ? { next } : {})
    }
  };
}

function withinWindow(date: LocalDate, filters: UpcomingFilters): boolean {
  if (!filters.window) return true;
  const sevenDays = addDaysToLocalDate(filters.localDate, 7);
  const thirtyDays = addDaysToLocalDate(filters.localDate, 30);
  if (filters.window === "next_7_days") return date <= sevenDays;
  if (filters.window === "next_30_days") return date <= thirtyDays;
  return date > thirtyDays;
}

export async function listUpcomingFollowUps(
  db: PeopleOsDatabase,
  filters: UpcomingFilters
): Promise<UpcomingResult> {
  const [pending, people] = await Promise.all([
    db.getAllFromIndex("followUps", "by-status", "pending"),
    db.getAll("people")
  ]);
  const peopleById = new Map(people.filter((person) => activePerson(person) && personMatchesActiveMode(person, filters.activeMode ?? "personal")).map((person) => [person.id, person]));
  const allActive = pending.flatMap((followUp): UpcomingFollowUp[] => {
    const person = peopleById.get(followUp.personId);
    return person ? [{ followUp, person, effectiveDate: effectiveFollowUpDate(followUp) }] : [];
  });
  const dueCount = allActive.filter((item) => item.effectiveDate <= filters.localDate).length;
  const items = allActive.filter((item) => item.effectiveDate > filters.localDate
      && (!filters.personId || item.person.id === filters.personId)
      && (!filters.actionType || item.followUp.actionType === filters.actionType)
      && withinWindow(item.effectiveDate, filters))
    .sort(compareUpcoming);
  const groups: UpcomingGroup[] = [];
  for (const item of items) {
    const key = item.effectiveDate.slice(0, 7);
    const current = groups[groups.length - 1];
    if (current?.key === key) current.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return { items, groups, dueCount };
}

export async function hasExistingFutureFollowUp(
  db: PeopleOsDatabase,
  personId: string,
  localDate: LocalDate
): Promise<boolean> {
  const person = await db.get("people", personId);
  if (!activePerson(person)) return false;
  const records = await db.getAllFromIndex("followUps", "by-person", personId);
  return records.some((record) => record.status === "pending"
    && effectiveFollowUpDate(record) > localDate);
}

export async function getNextPlanForPerson(
  db: PeopleOsDatabase,
  personId: string,
  _localDate: LocalDate,
  options: { timeZone?: string } = {}
): Promise<NextPlanProjection> {
  const [person, followUps, interactions] = await Promise.all([
    db.get("people", personId),
    db.getAllFromIndex("followUps", "by-person", personId),
    db.getAllFromIndex("interactions", "by-person", personId)
  ]);
  if (!activePerson(person)) return { kind: "none" };
  const followUp = followUps.filter((record) => record.status === "pending")
    .sort(compareFollowUpsByEffectiveDate)[0];
  if (followUp) {
    return { kind: "explicit_follow_up", date: effectiveFollowUpDate(followUp), followUp };
  }
  const contactCadence = contactCadenceOf(person);
  if (!contactCadence) return { kind: "none" };
  const cadenceDays = contactCadenceInDays(contactCadence);
  const lastContact = interactions.filter((interaction) => interactionCountsAsContact(interaction.kind))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)
      || left.id.localeCompare(right.id))[0];
  return {
    kind: "cadence",
    cadence: contactCadence,
    cadenceDays,
    ...(lastContact
      ? { date: addDaysToLocalDate(localDateForInstant(lastContact.occurredAt, options.timeZone), cadenceDays) }
      : {})
  };
}

export async function listTodaySkips(
  db: PeopleOsDatabase,
  localDate: LocalDate
): Promise<TodaySkip[]> {
  return (await db.getAllFromIndex("todaySkips", "by-local-date", localDate))
    .sort((left, right) => left.personId.localeCompare(right.personId) || left.id.localeCompare(right.id));
}

export async function getTodaySkip(
  db: PeopleOsDatabase,
  personId: string,
  localDate: LocalDate
): Promise<TodaySkip | undefined> {
  return db.get("todaySkips", `${personId}:${localDate}`);
}
