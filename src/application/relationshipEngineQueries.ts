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

export function assessRelationshipsFromData(
  data: PeopleOsData,
  clock: RelationshipClock
): RelationshipAssessment[] {
  return [...data.people]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((person) => assessRelationship(relationshipBundleFromData(data, person), clock));
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
