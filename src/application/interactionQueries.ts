import type { PeopleOsDatabase } from "../data/database";
import { buildTimeline, deriveLastContact, type TimelineItem } from "../domain/timeline";
import type { Interaction, Person, RelationshipEvent } from "../domain/schema";
import { normalizeEventName } from "./interactions";
import { selectDisplayAffiliation } from "./peopleQueries";

export type TimelineDisplayItem = TimelineItem & {
  event?: RelationshipEvent;
  relatedPerson?: Person;
};

export type PersonHistory = {
  person: Person;
  interactions: Interaction[];
  timeline: TimelineDisplayItem[];
  lastContact?: Interaction;
};

export async function getPersonHistory(
  db: PeopleOsDatabase,
  personId: string
): Promise<PersonHistory | undefined> {
  const tx = db.transaction([
    "people", "interactions", "events", "followUpEvents", "reachOutEntries", "reachOutEvents"
  ], "readonly");
  const [person, interactions, followUpEvents, events, people, reachOutEntries, reachOutEvents] = await Promise.all([
    tx.objectStore("people").get(personId),
    tx.objectStore("interactions").index("by-person").getAll(personId),
    tx.objectStore("followUpEvents").index("by-person").getAll(personId),
    tx.objectStore("events").getAll(),
    tx.objectStore("people").getAll(),
    tx.objectStore("reachOutEntries").index("by-person").getAll(personId),
    tx.objectStore("reachOutEvents").getAll()
  ]);
  await tx.done;
  if (!person) return undefined;
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const peopleById = new Map(people.map((candidate) => [candidate.id, candidate]));
  const reachOutEntryIds = new Set(reachOutEntries.map((entry) => entry.id));
  const reachOutReasonById = new Map(reachOutEntries.map((entry) => [entry.id, entry.reason]));
  const timeline = buildTimeline(
    person,
    interactions,
    followUpEvents,
    reachOutEvents.filter((event) => reachOutEntryIds.has(event.reachOutEntryId))
  ).map((item) => ({
    ...item,
    ...(item.source === "reach_out" && item.reachOutEntryId && reachOutReasonById.get(item.reachOutEntryId)
      ? { summary: reachOutReasonById.get(item.reachOutEntryId) }
      : {}),
    ...(item.eventId && eventsById.get(item.eventId) ? { event: eventsById.get(item.eventId) } : {}),
    ...(item.relatedPersonId && peopleById.get(item.relatedPersonId)
      ? { relatedPerson: peopleById.get(item.relatedPersonId) }
      : {})
  }));
  return {
    person,
    interactions,
    timeline,
    ...(deriveLastContact(interactions) ? { lastContact: deriveLastContact(interactions) } : {})
  };
}

export async function listEvents(
  db: PeopleOsDatabase,
  query = ""
): Promise<RelationshipEvent[]> {
  const normalizedQuery = normalizeEventName(query);
  const events = await db.getAll("events");
  return events
    .filter((event) => !normalizedQuery || normalizeEventName(event.name).includes(normalizedQuery))
    .sort((left, right) => {
      if ((left.occurredOn ?? "") !== (right.occurredOn ?? "")) {
        return (left.occurredOn ?? "") > (right.occurredOn ?? "") ? -1 : 1;
      }
      if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
      const name = normalizeEventName(left.name).localeCompare(normalizeEventName(right.name), "en-US");
      return name || left.id.localeCompare(right.id, "en-US");
    });
}

export type PersonPickerOption = {
  person: Person;
  affiliation?: string;
};

export async function listActivePersonOptions(
  db: PeopleOsDatabase,
  excludePersonId?: string
): Promise<PersonPickerOption[]> {
  const tx = db.transaction(["people", "affiliations"], "readonly");
  const [people, affiliations] = await Promise.all([
    tx.objectStore("people").getAll(),
    tx.objectStore("affiliations").getAll()
  ]);
  await tx.done;
  return people
    .filter((person) => !person.archivedAt && person.identityStatus !== "merged" && person.id !== excludePersonId)
    .map((person) => {
      const current = selectDisplayAffiliation(
        affiliations.filter((affiliation) => affiliation.personId === person.id)
      );
      return {
        person,
        ...(current ? { affiliation: [current.role, current.organisationName].filter(Boolean).join(" · ") } : {})
      };
    })
    .sort((left, right) =>
      left.person.displayName.localeCompare(right.person.displayName, "en-US", { sensitivity: "base" })
      || left.person.id.localeCompare(right.person.id, "en-US")
    );
}
