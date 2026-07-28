import type {
  AppSettings,
  ContactMethod,
  Interaction,
  OrganisationAffiliation,
  Person
} from "../domain/schema";
import { personMatchesActiveMode, type ActiveRelationshipMode } from "../domain/relationshipMode";
import type { PeopleOsDatabase } from "../data/database";
import { selectDisplayAffiliation } from "./affiliations";

export { selectDisplayAffiliation } from "./affiliations";

export type PersonSummary = {
  person: Person;
  activeContactMethods: ContactMethod[];
  currentAffiliation?: OrganisationAffiliation;
  latestMetInteraction?: Interaction;
};

export async function getAppSettings(db: PeopleOsDatabase): Promise<AppSettings> {
  const settings = await db.get("appSettings", "app");
  if (!settings) throw new Error("PeopleOS settings are missing");
  return settings;
}

function descending(left: string, right: string): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function ascending(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sortActiveContacts(records: ContactMethod[]): ContactMethod[] {
  return records
    .filter((record) => !record.archivedAt)
    .sort((left, right) => {
      if (left.isPreferred !== right.isPreferred) return left.isPreferred ? -1 : 1;
      if (left.kind !== right.kind) return left.kind === "phone" ? -1 : 1;
      return ascending(left.id, right.id);
    });
}

function selectLatestMetInteraction(interactions: Interaction[]): Interaction | undefined {
  return interactions
    .filter((record) => record.kind === "met")
    .sort((left, right) => descending(left.occurredAt, right.occurredAt) || ascending(left.id, right.id))[0];
}

function groupByPerson<T extends { personId: string }>(records: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const current = grouped.get(record.personId) ?? [];
    current.push(record);
    grouped.set(record.personId, current);
  }
  return grouped;
}

export async function getPersonSummary(
  db: PeopleOsDatabase,
  personId: string
): Promise<PersonSummary | undefined> {
  const tx = db.transaction(["people", "contactMethods", "affiliations", "interactions"], "readonly");
  const person = await tx.objectStore("people").get(personId);
  if (!person) {
    await tx.done;
    return undefined;
  }
  const [contactMethods, affiliations, interactions] = await Promise.all([
    tx.objectStore("contactMethods").index("by-person").getAll(personId),
    tx.objectStore("affiliations").index("by-person").getAll(personId),
    tx.objectStore("interactions").index("by-person").getAll(personId)
  ]);
  await tx.done;
  return {
    person,
    activeContactMethods: sortActiveContacts(contactMethods),
    currentAffiliation: selectDisplayAffiliation(affiliations),
    latestMetInteraction: selectLatestMetInteraction(interactions)
  };
}

export async function listPeopleSummaries(db: PeopleOsDatabase, activeMode: ActiveRelationshipMode = "personal"): Promise<PersonSummary[]> {
  const tx = db.transaction(["people", "contactMethods", "affiliations", "interactions"], "readonly");
  const [peopleRecords, contactMethods, affiliations, interactions] = await Promise.all([
    tx.objectStore("people").getAll(),
    tx.objectStore("contactMethods").getAll(),
    tx.objectStore("affiliations").getAll(),
    tx.objectStore("interactions").getAll()
  ]);
  await tx.done;
  const contactsByPerson = groupByPerson(contactMethods);
  const affiliationsByPerson = groupByPerson(affiliations);
  const interactionsByPerson = groupByPerson(interactions);
  const people = peopleRecords
    .filter((person) => !person.archivedAt && person.identityStatus !== "merged" && personMatchesActiveMode(person, activeMode))
    .sort((left, right) =>
      descending(left.createdAt, right.createdAt)
      || ascending(left.displayName.toLocaleLowerCase("en-US"), right.displayName.toLocaleLowerCase("en-US"))
      || ascending(left.id, right.id)
    );
  return people.map((person) => ({
    person,
    activeContactMethods: sortActiveContacts(contactsByPerson.get(person.id) ?? []),
    currentAffiliation: selectDisplayAffiliation(affiliationsByPerson.get(person.id) ?? []),
    latestMetInteraction: selectLatestMetInteraction(interactionsByPerson.get(person.id) ?? [])
  }));
}
