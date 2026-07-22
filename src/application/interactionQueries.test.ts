import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import { createAppendOnlyRecord, createRepositories } from "../data/repositories";
import type {
  OrganisationAffiliation,
  Person,
  RelationshipEvent
} from "../domain/schema";
import { createInteraction } from "./interactions";
import {
  getPersonHistory,
  listActivePersonOptions,
  listEvents
} from "./interactionQueries";

const fixedNow = "2026-08-01T12:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(id: string, displayName: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    ...overrides
  };
}

function event(
  id: string,
  name: string,
  occurredOn?: string,
  createdAt = "2026-01-01T09:00:00.000Z"
): RelationshipEvent {
  return {
    id,
    revision: 1,
    name,
    ...(occurredOn ? { occurredOn } : {}),
    createdAt,
    updatedAt: createdAt
  };
}

function affiliation(
  id: string,
  personId: string,
  organisationName: string,
  overrides: Partial<OrganisationAffiliation> = {}
): OrganisationAffiliation {
  return {
    id,
    revision: 1,
    personId,
    organisationName,
    isCurrent: true,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    ...overrides
  };
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-interaction-queries-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("Interaction history queries", () => {
  it("returns undefined for a missing Person", async () => {
    const db = await openDatabase("missing-person");

    await expect(getPersonHistory(db, "missing")).resolves.toBeUndefined();
  });

  it("returns derived history with Event and related-Person display context", async () => {
    const db = await openDatabase("decorated-history");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-one", "Sarah Jones"));
    await repositories.people.create(person("person-two", "Ed Blake"));
    await repositories.events.create(event(
      "event-fellowship",
      "AI Fellowship",
      "2026-07-01"
    ));
    await repositories.followUps.create({
      id: "follow-up-one",
      revision: 1,
      personId: "person-one",
      dueDate: "2026-07-20",
      reason: "Send the promised introduction",
      actionType: "make_introduction",
      status: "completed",
      completedAt: "2026-07-20T10:00:00.000Z",
      createdAt: "2026-07-10T10:00:00.000Z",
      updatedAt: "2026-07-20T10:00:00.000Z"
    });
    await createInteraction(db, {
      id: "interaction-email",
      personId: "person-one",
      kind: "email",
      occurredAt: "2026-07-15T10:00:00.000Z",
      summary: "Sent the fellowship notes",
      eventId: "event-fellowship",
      createdAt: "2026-07-15T10:00:00.000Z",
      origin: "manual"
    }, fixedNow);
    await createInteraction(db, {
      id: "interaction-introduction",
      personId: "person-one",
      kind: "introduction_made",
      occurredAt: "2026-07-20T10:00:00.000Z",
      summary: "Introduced Sarah to Ed",
      relatedPersonId: "person-two",
      followUpId: "follow-up-one",
      createdAt: "2026-07-20T10:00:00.000Z",
      origin: "follow_up_completion"
    }, fixedNow);
    await createInteraction(db, {
      id: "interaction-note",
      personId: "person-one",
      kind: "note_added",
      occurredAt: "2026-07-25T10:00:00.000Z",
      summary: "Interested in simulation",
      createdAt: "2026-07-25T10:00:00.000Z",
      origin: "note"
    }, fixedNow);
    await createAppendOnlyRecord(db, "followUpEvents", {
      id: "follow-up-event-complete",
      followUpId: "follow-up-one",
      personId: "person-one",
      kind: "completed_with_contact",
      occurredAt: "2026-07-20T10:00:00.000Z",
      interactionId: "interaction-introduction"
    });

    const history = await getPersonHistory(db, "person-one");

    expect(history?.person.displayName).toBe("Sarah Jones");
    expect(history?.interactions).toHaveLength(3);
    expect(history?.lastContact?.id).toBe("interaction-email");
    expect(history?.timeline.map((item) => item.id)).toEqual([
      "interaction-note",
      "follow-up-event-complete",
      "interaction-email",
      "person-created:person-one"
    ]);
    expect(history?.timeline.find((item) => item.id === "interaction-email")).toMatchObject({
      event: { id: "event-fellowship", name: "AI Fellowship" }
    });
    expect(history?.timeline.find((item) => item.id === "follow-up-event-complete")).toMatchObject({
      interactionId: "interaction-introduction",
      relatedPerson: { id: "person-two", displayName: "Ed Blake" },
      editable: false
    });
  });
});

describe("Interaction supporting queries", () => {
  it("filters Events by normalized substring and orders results deterministically", async () => {
    const db = await openDatabase("event-list");
    const repositories = createRepositories(db);
    await repositories.events.create(event(
      "event-z",
      "NHS AI Fellowship",
      "2026-07-01",
      "2026-01-01T09:00:00.000Z"
    ));
    await repositories.events.create(event(
      "event-a",
      "AI   Fellowship Alumni",
      "2026-07-01",
      "2026-01-02T09:00:00.000Z"
    ));
    await repositories.events.create(event(
      "event-undated",
      "Fellowship coffee",
      undefined,
      "2026-07-03T09:00:00.000Z"
    ));
    await repositories.events.create(event(
      "event-other",
      "HealthTech Conference",
      "2026-08-01",
      "2026-01-03T09:00:00.000Z"
    ));

    await expect(listEvents(db, "  fellowship ")).resolves.toMatchObject([
      { id: "event-a" },
      { id: "event-z" },
      { id: "event-undated" }
    ]);
    await expect(listEvents(db)).resolves.toMatchObject([
      { id: "event-other" },
      { id: "event-a" },
      { id: "event-z" },
      { id: "event-undated" }
    ]);
  });

  it("lists only active People with their selected current affiliation and stable name order", async () => {
    const db = await openDatabase("person-options");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-excluded", "Aaron Patel"));
    await repositories.people.create(person("person-a", "sarah jones"));
    await repositories.people.create(person("person-b", "Sarah Jones"));
    await repositories.people.create(person("person-archived", "Archived Person", {
      archivedAt: "2026-07-01T09:00:00.000Z"
    }));
    await repositories.people.create(person("person-merged", "Merged Person", {
      identityStatus: "merged",
      mergedIntoPersonId: "person-a"
    }));
    await repositories.affiliations.create(affiliation(
      "affiliation-old",
      "person-a",
      "Old Health",
      { role: "Advisor", startedOn: "2024-01-01" }
    ));
    await repositories.affiliations.create(affiliation(
      "affiliation-current",
      "person-a",
      "Watford Health",
      { role: "Digital lead", startedOn: "2026-01-01" }
    ));
    await repositories.affiliations.create(affiliation(
      "affiliation-archived",
      "person-a",
      "Hidden Health",
      {
        role: "Director",
        startedOn: "2027-01-01",
        archivedAt: "2026-07-01T09:00:00.000Z"
      }
    ));

    const options = await listActivePersonOptions(db, "person-excluded");

    expect(options.map(({ person: option }) => option.id)).toEqual(["person-a", "person-b"]);
    expect(options[0].affiliation).toBe("Digital lead · Watford Health");
    expect(options[1].affiliation).toBeUndefined();
  });
});
