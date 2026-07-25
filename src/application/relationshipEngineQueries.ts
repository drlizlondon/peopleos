import { readAllData, type PeopleOsDatabase } from "../data/database";
import type { PeopleOsData, Person } from "../domain/schema";
import {
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  assessRelationship,
  buildToday,
  type RelationshipAssessment,
  type RelationshipClock,
  type RelationshipPersonBundle,
  type TodayResult
} from "../relationship-engine";

export type RelationshipClockOptions = {
  now?: string;
  timeZone?: string;
};

export function createRelationshipClock(options: RelationshipClockOptions = {}): RelationshipClock {
  return {
    now: options.now ?? new Date().toISOString(),
    timeZone: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
  };
}

/**
 * Bundle one Person's records out of a whole dataset.
 *
 * Correct but O(records) per Person, so it is only appropriate when assessing a
 * single Person. Assessing many — Today, search, filter options — must go
 * through `groupRelationshipData` instead, or the join becomes O(People x
 * records): measured at 3,000 People and 45,000 Interactions, the per-Person
 * filter cost 1,916 ms against 744 ms for the grouped equivalent, and it grew
 * with interaction volume where the grouped form does not.
 */
export function relationshipBundleFromData(
  data: PeopleOsData,
  person: Person,
  options: { triggeringInteractionId?: string } = {}
): RelationshipPersonBundle {
  return {
    person,
    contactMethods: data.contactMethods.filter((record) => record.personId === person.id),
    interactions: data.interactions.filter((record) => record.personId === person.id),
    followUps: data.followUps.filter((record) => record.personId === person.id),
    reachOutEntries: data.reachOutEntries.filter((record) => record.personId === person.id),
    facts: data.memoryFacts.filter((record) => record.personId === person.id),
    affiliations: data.affiliations.filter((record) => record.personId === person.id),
    events: data.events,
    ...(options.triggeringInteractionId ? { triggeringInteractionId: options.triggeringInteractionId } : {})
  };
}

const NO_RECORDS: readonly never[] = [];

function groupByPerson<T extends { personId: string }>(records: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const bucket = grouped.get(record.personId);
    if (bucket) bucket.push(record);
    else grouped.set(record.personId, [record]);
  }
  return grouped;
}

/**
 * One pass over each child collection, indexed by Person. Preserves the source
 * order of every collection, so bundles are identical to the filtered form and
 * the engine's own sorting and tie-breaks are unaffected.
 */
export type GroupedRelationshipData = {
  data: PeopleOsData;
  contactMethods: Map<string, PeopleOsData["contactMethods"]>;
  interactions: Map<string, PeopleOsData["interactions"]>;
  followUps: Map<string, PeopleOsData["followUps"]>;
  reachOutEntries: Map<string, PeopleOsData["reachOutEntries"]>;
  facts: Map<string, PeopleOsData["memoryFacts"]>;
  affiliations: Map<string, PeopleOsData["affiliations"]>;
};

export function groupRelationshipData(data: PeopleOsData): GroupedRelationshipData {
  return {
    data,
    contactMethods: groupByPerson(data.contactMethods),
    interactions: groupByPerson(data.interactions),
    followUps: groupByPerson(data.followUps),
    reachOutEntries: groupByPerson(data.reachOutEntries),
    facts: groupByPerson(data.memoryFacts),
    affiliations: groupByPerson(data.affiliations)
  };
}

export function relationshipBundleFromGroups(
  grouped: GroupedRelationshipData,
  person: Person,
  options: { triggeringInteractionId?: string } = {}
): RelationshipPersonBundle {
  return {
    person,
    contactMethods: grouped.contactMethods.get(person.id) ?? NO_RECORDS,
    interactions: grouped.interactions.get(person.id) ?? NO_RECORDS,
    followUps: grouped.followUps.get(person.id) ?? NO_RECORDS,
    reachOutEntries: grouped.reachOutEntries.get(person.id) ?? NO_RECORDS,
    facts: grouped.facts.get(person.id) ?? NO_RECORDS,
    affiliations: grouped.affiliations.get(person.id) ?? NO_RECORDS,
    events: grouped.data.events,
    ...(options.triggeringInteractionId ? { triggeringInteractionId: options.triggeringInteractionId } : {})
  };
}

export function comparePersonId(left: Person, right: Person): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function assessRelationshipsFromData(
  data: PeopleOsData,
  clock: RelationshipClock
): RelationshipAssessment[] {
  const grouped = groupRelationshipData(data);
  return [...data.people]
    .sort(comparePersonId)
    .map((person) => assessRelationship(relationshipBundleFromGroups(grouped, person), clock));
}

export function buildTodayFromData(
  data: PeopleOsData,
  clock: RelationshipClock
): TodayResult {
  return buildToday({
    assessments: assessRelationshipsFromData(data, clock),
    todaySkips: data.todaySkips,
    clock
  });
}

export async function getRelationshipAssessment(
  db: PeopleOsDatabase,
  personId: string,
  clock: RelationshipClock,
  options: { triggeringInteractionId?: string } = {}
): Promise<RelationshipAssessment | undefined> {
  const data = await readAllData(db);
  const person = data.people.find((candidate) => candidate.id === personId);
  return person
    ? assessRelationship(relationshipBundleFromData(data, person, options), clock)
    : undefined;
}

export async function getTodayResult(
  db: PeopleOsDatabase,
  clock: RelationshipClock
): Promise<TodayResult> {
  return buildTodayFromData(await readAllData(db), clock);
}
