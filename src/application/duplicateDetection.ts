import type { PreparedManualPersonCapture } from "./manualPersonCapture";
import type { PeopleOsDatabase } from "../data/database";
import {
  conservativeFullNameDuplicateKey,
  detectDuplicatePeople,
  normaliseDuplicateText,
  type DuplicateMatch
} from "../domain/duplicates";
import type {
  ContactMethod,
  Interaction,
  OrganisationAffiliation,
  Person,
  RelationshipEvent
} from "../domain/schema";

export type DuplicateDetectionSnapshot = {
  peopleById: Map<string, Person>;
  persistedPersonIds: Set<string>;
  contactMethodsByPerson: Map<string, ContactMethod[]>;
  affiliationsByPerson: Map<string, OrganisationAffiliation[]>;
  interactionsByPerson: Map<string, Interaction[]>;
  eventsById: Map<string, RelationshipEvent>;
  personIdsByCanonicalContact: Map<string, Set<string>>;
  personIdsByName: Map<string, Set<string>>;
  personIdsByOrganisation: Map<string, Set<string>>;
  personIdsByEvent: Map<string, Set<string>>;
};

function addRecord<T>(records: Map<string, T[]>, personId: string, record: T): void {
  const current = records.get(personId);
  if (current) current.push(record);
  else records.set(personId, [record]);
}

function addPersonId(index: Map<string, Set<string>>, key: string, personId: string): void {
  if (!key) return;
  const current = index.get(key);
  if (current) current.add(personId);
  else index.set(key, new Set([personId]));
}

function contactKey(contact: Pick<ContactMethod, "kind" | "canonicalValue">): string {
  return `${contact.kind}\0${contact.canonicalValue}`;
}

function emptySnapshot(): DuplicateDetectionSnapshot {
  return {
    peopleById: new Map(),
    persistedPersonIds: new Set(),
    contactMethodsByPerson: new Map(),
    affiliationsByPerson: new Map(),
    interactionsByPerson: new Map(),
    eventsById: new Map(),
    personIdsByCanonicalContact: new Map(),
    personIdsByName: new Map(),
    personIdsByOrganisation: new Map(),
    personIdsByEvent: new Map()
  };
}

function indexPerson(snapshot: DuplicateDetectionSnapshot, person: Person): void {
  if (person.archivedAt || person.identityStatus === "merged") return;
  snapshot.peopleById.set(person.id, person);
  addPersonId(snapshot.personIdsByName, normaliseDuplicateText(person.displayName), person.id);
}

function indexContactMethod(snapshot: DuplicateDetectionSnapshot, contact: ContactMethod): void {
  if (contact.archivedAt || !snapshot.peopleById.has(contact.personId)) return;
  addRecord(snapshot.contactMethodsByPerson, contact.personId, contact);
  addPersonId(snapshot.personIdsByCanonicalContact, contactKey(contact), contact.personId);
}

function indexAffiliation(
  snapshot: DuplicateDetectionSnapshot,
  affiliation: OrganisationAffiliation
): void {
  if (affiliation.archivedAt || !affiliation.isCurrent || !snapshot.peopleById.has(affiliation.personId)) return;
  addRecord(snapshot.affiliationsByPerson, affiliation.personId, affiliation);
  addPersonId(
    snapshot.personIdsByOrganisation,
    normaliseDuplicateText(affiliation.organisationName),
    affiliation.personId
  );
}

function indexInteraction(snapshot: DuplicateDetectionSnapshot, interaction: Interaction): void {
  if (!interaction.eventId || !snapshot.peopleById.has(interaction.personId)) return;
  addRecord(snapshot.interactionsByPerson, interaction.personId, interaction);
  addPersonId(snapshot.personIdsByEvent, interaction.eventId, interaction.personId);
}

export async function loadDuplicateDetectionSnapshot(
  db: PeopleOsDatabase
): Promise<DuplicateDetectionSnapshot> {
  const tx = db.transaction(
    ["people", "contactMethods", "affiliations", "interactions", "events"],
    "readonly"
  );
  const [people, contactMethods, affiliations, interactions, events] = await Promise.all([
    tx.objectStore("people").getAll(),
    tx.objectStore("contactMethods").getAll(),
    tx.objectStore("affiliations").getAll(),
    tx.objectStore("interactions").getAll(),
    tx.objectStore("events").getAll()
  ]);
  await tx.done;

  const snapshot = emptySnapshot();
  people.forEach((person) => {
    indexPerson(snapshot, person);
    if (snapshot.peopleById.has(person.id)) snapshot.persistedPersonIds.add(person.id);
  });
  contactMethods.forEach((contact) => indexContactMethod(snapshot, contact));
  affiliations.forEach((affiliation) => indexAffiliation(snapshot, affiliation));
  interactions.forEach((interaction) => indexInteraction(snapshot, interaction));
  events.forEach((event) => snapshot.eventsById.set(event.id, event));
  return snapshot;
}

function addIntersection(
  target: Set<string>,
  left: ReadonlySet<string> | undefined,
  right: ReadonlySet<string> | undefined
): void {
  if (!left || !right) return;
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  smaller.forEach((personId) => {
    if (larger.has(personId)) target.add(personId);
  });
}

function possibleDuplicatePersonIds(
  snapshot: DuplicateDetectionSnapshot,
  capture: PreparedManualPersonCapture
): string[] {
  const result = new Set<string>();
  capture.contactMethods
    .filter((contact) => !contact.archivedAt)
    .forEach((contact) => {
      snapshot.personIdsByCanonicalContact.get(contactKey(contact))
        ?.forEach((personId) => result.add(personId));
    });

  const matchingNames = snapshot.personIdsByName.get(
    normaliseDuplicateText(capture.person.displayName)
  );
  if (matchingNames) {
    if (conservativeFullNameDuplicateKey(capture.person.displayName)) {
      matchingNames.forEach((personId) => result.add(personId));
    }
    if (capture.affiliation?.isCurrent && !capture.affiliation.archivedAt) {
      addIntersection(
        result,
        matchingNames,
        snapshot.personIdsByOrganisation.get(
          normaliseDuplicateText(capture.affiliation.organisationName)
        )
      );
    }
    if (capture.metInteraction?.eventId) {
      addIntersection(
        result,
        matchingNames,
        snapshot.personIdsByEvent.get(capture.metInteraction.eventId)
      );
    }
  }

  result.delete(capture.person.id);
  return [...result].sort();
}

export function findDuplicateMatchesInSnapshot(
  snapshot: DuplicateDetectionSnapshot,
  capture: PreparedManualPersonCapture
): DuplicateMatch[] {
  const personIds = possibleDuplicatePersonIds(snapshot, capture);
  if (!personIds.length) return [];

  const people = personIds.flatMap((personId) => {
    const person = snapshot.peopleById.get(personId);
    return person ? [person] : [];
  });
  const contactMethods = personIds.flatMap(
    (personId) => snapshot.contactMethodsByPerson.get(personId) ?? []
  );
  const affiliations = personIds.flatMap(
    (personId) => snapshot.affiliationsByPerson.get(personId) ?? []
  );
  const interactions = personIds.flatMap(
    (personId) => snapshot.interactionsByPerson.get(personId) ?? []
  );
  const eventIds = new Set<string>();
  if (capture.metInteraction?.eventId) eventIds.add(capture.metInteraction.eventId);
  interactions.forEach((interaction) => interaction.eventId && eventIds.add(interaction.eventId));
  const events = [...eventIds]
    .sort()
    .flatMap((eventId) => {
      const event = snapshot.eventsById.get(eventId);
      return event ? [event] : [];
    });

  return detectDuplicatePeople({
    candidate: {
      person: capture.person,
      contactMethods: capture.contactMethods,
      affiliations: capture.affiliation ? [capture.affiliation] : [],
      interactions: capture.metInteraction ? [capture.metInteraction] : []
    },
    people,
    contactMethods,
    affiliations,
    interactions,
    events
  }).map((match) => ({
    ...match,
    source: snapshot.persistedPersonIds.has(match.person.id) ? "stored" : "import"
  }));
}

/**
 * Adds a valid preview candidate to the in-memory snapshot only. This lets a
 * later row in the same file review against an earlier row without persisting
 * either row or changing the dataset revision.
 */
export function addPreparedCaptureToDuplicateSnapshot(
  snapshot: DuplicateDetectionSnapshot,
  capture: PreparedManualPersonCapture
): void {
  if (snapshot.peopleById.has(capture.person.id)) return;
  indexPerson(snapshot, capture.person);
  capture.contactMethods.forEach((contact) => indexContactMethod(snapshot, contact));
  if (capture.affiliation) indexAffiliation(snapshot, capture.affiliation);
  if (capture.metInteraction) indexInteraction(snapshot, capture.metInteraction);
}

export async function findDuplicateMatches(
  db: PeopleOsDatabase,
  capture: PreparedManualPersonCapture
): Promise<DuplicateMatch[]> {
  const snapshot = await loadDuplicateDetectionSnapshot(db);
  return findDuplicateMatchesInSnapshot(snapshot, capture);
}
