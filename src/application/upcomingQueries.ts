import { readAllData, type PeopleOsDatabase } from "../data/database";
import { localDateForInstant } from "../domain/followUpPolicy";
import { personMatchesActiveMode, type ActiveRelationshipMode } from "../domain/relationshipMode";
import type { LocalDate, Person } from "../domain/schema";
import {
  nextTodayEligibleLocalDate,
  resolveRelationshipScheduleState,
  type RelationshipClock
} from "../relationship-engine";
import {
  groupRelationshipData,
  relationshipBundleFromGroups
} from "./relationshipEngineQueries";

export type UpcomingPerson = {
  person: Person;
  date: LocalDate;
};

export type UpcomingPeopleProjection = {
  localDate: LocalDate;
  people: UpcomingPerson[];
  incompleteRegularContactPeople: Person[];
  evaluationIssues: Array<{ personId: string; displayName: string }>;
};

function activePerson(person: Person): boolean {
  return !person.archivedAt && person.identityStatus !== "merged";
}

function compareUpcomingPeople(left: UpcomingPerson, right: UpcomingPerson): number {
  return left.date.localeCompare(right.date)
    || left.person.displayName.localeCompare(right.person.displayName, "en-US", { sensitivity: "base" })
    || left.person.id.localeCompare(right.person.id);
}

/**
 * Forecast the first future date on which each Person will enter Today.
 * This deliberately uses the same relationship-engine primitive as local
 * notification planning, so Upcoming cannot drift into a second scheduler.
 */
export async function getUpcomingPeopleProjection(
  db: PeopleOsDatabase,
  clock: RelationshipClock,
  activeMode: ActiveRelationshipMode = "personal"
): Promise<UpcomingPeopleProjection> {
  const data = await readAllData(db);
  const grouped = groupRelationshipData(data);
  const localDate = localDateForInstant(clock.now, clock.timeZone);
  const people: UpcomingPerson[] = [];
  const incompleteRegularContactPeople: Person[] = [];
  const evaluationIssues: UpcomingPeopleProjection["evaluationIssues"] = [];

  for (const person of data.people) {
    if (!activePerson(person) || !personMatchesActiveMode(person, activeMode)) continue;
    try {
      const bundle = relationshipBundleFromGroups(grouped, person);
      if (resolveRelationshipScheduleState(bundle, clock).kind === "incomplete_regular_schedule") {
        incompleteRegularContactPeople.push(person);
        continue;
      }
      const date = nextTodayEligibleLocalDate(bundle, clock);
      if (date && date > localDate) people.push({ person, date });
    } catch {
      evaluationIssues.push({ personId: person.id, displayName: person.displayName });
    }
  }

  return {
    localDate,
    people: people.sort(compareUpcomingPeople),
    incompleteRegularContactPeople: incompleteRegularContactPeople.sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "en-US", { sensitivity: "base" })
        || left.id.localeCompare(right.id)
    ),
    evaluationIssues
  };
}
