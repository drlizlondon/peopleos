import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import {
  RecordConflictError,
  StaleRevisionError,
  createRepositories
} from "../data/repositories";
import type { InteractionDraft } from "./interactions";
import {
  DuplicateEventError,
  LifecycleOwnedInteractionError,
  createInteraction,
  createInteractionDraft,
  createRelationshipEventDraft,
  deleteInteraction,
  updateInteraction
} from "./interactions";
import { ValidationError } from "../domain/validation";
import type { Person } from "../domain/schema";

const fixedNow = "2026-08-01T12:00:00.000Z";
const later = "2026-08-02T12:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(id = "person-one", overrides: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName: id === "person-one" ? "Sarah Jones" : "Aaron Patel",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides
  };
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-interactions-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  await createRepositories(db).people.create(person());
  return db;
}

function draft(
  overrides: Partial<InteractionDraft> = {}
): InteractionDraft {
  return {
    id: "interaction-one",
    personId: "person-one",
    kind: "email",
    occurredAt: fixedNow,
    summary: "Shared the pilot update",
    createdAt: fixedNow,
    origin: "manual",
    ...overrides
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("Interaction commands", () => {
  it("creates stable drafts and commits an exact retry only once", async () => {
    const db = await openDatabase("create-retry");
    const stableDraft = createInteractionDraft("person-one", {
      now: fixedNow,
      idFactory: () => "stable",
      kind: "phone_call"
    });
    stableDraft.summary = "Discussed pilot sites";
    const revisionBefore = (await db.get("metadata", "app"))!.datasetRevision;

    const first = await createInteraction(db, stableDraft, fixedNow);
    const second = await createInteraction(db, stableDraft, fixedNow);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      id: "interaction-stable",
      personId: "person-one",
      kind: "phone_call",
      summary: "Discussed pilot sites",
      revision: 1
    });
    expect(await db.count("interactions")).toBe(1);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionBefore + 1);
  });

  it("enforces origin-owned kinds, occurrence time, summary, and introduction rules", async () => {
    const db = await openDatabase("validation");
    const invalid: InteractionDraft[] = [
      draft({ id: "contacted-manually", kind: "contacted" }),
      draft({ id: "follow-up-manually", kind: "follow_up_completed" }),
      draft({ id: "note-manually", kind: "note_added", summary: "A note" }),
      draft({ id: "future", occurredAt: later }),
      draft({ id: "empty-note", kind: "note_added", origin: "note", summary: "   " }),
      draft({ id: "empty-introduction", kind: "introduction_received", summary: undefined }),
      draft({ id: "self-introduction", kind: "introduction_made", relatedPersonId: "person-one" }),
      draft({ id: "manual-follow-up-link", followUpId: "follow-up-one" }),
      draft({ id: "long-summary", summary: "x".repeat(5_001) })
    ];

    for (const candidate of invalid) {
      await expect(createInteraction(db, candidate, fixedNow)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await db.count("interactions")).toBe(0);

    await expect(createInteraction(db, draft({
      id: "contacted-explicitly",
      kind: "contacted",
      origin: "already_contacted",
      summary: undefined
    }), fixedNow)).resolves.toMatchObject({ kind: "contacted" });
    await expect(createInteraction(db, draft({
      id: "introduction-with-name",
      kind: "introduction_made",
      summary: "Introduced them to Ed"
    }), fixedNow)).resolves.toMatchObject({ kind: "introduction_made" });
    await expect(createInteraction(db, draft({
      id: "summary-boundary",
      summary: "x".repeat(5_000)
    }), fixedNow)).resolves.toMatchObject({ id: "summary-boundary" });
  });

  it("validates owning and linked records in the same transaction", async () => {
    const db = await openDatabase("references");
    await expect(createInteraction(db, draft({ id: "missing-person", personId: "missing" }), fixedNow))
      .rejects.toBeInstanceOf(RecordConflictError);
    await expect(createInteraction(db, draft({ id: "missing-event", eventId: "missing" }), fixedNow))
      .rejects.toBeInstanceOf(RecordConflictError);
    await expect(createInteraction(db, draft({ id: "missing-related", kind: "introduction_received", relatedPersonId: "missing" }), fixedNow))
      .rejects.toBeInstanceOf(RecordConflictError);

    const repositories = createRepositories(db);
    const owner = await repositories.people.get("person-one");
    await repositories.people.archive("person-one", owner!.revision, fixedNow);
    await expect(createInteraction(db, draft({ id: "archived-owner" }), fixedNow))
      .rejects.toBeInstanceOf(RecordConflictError);
    expect(await db.count("interactions")).toBe(0);
  });

  it("creates a new Event and Interaction atomically and rejects an exact normalized Event duplicate", async () => {
    const db = await openDatabase("event");
    const eventDraft = createRelationshipEventDraft({ now: fixedNow, idFactory: () => "fellowship" });
    eventDraft.name = "  AI   Fellowship  ";
    eventDraft.occurredOn = "2026-08-01";
    eventDraft.location = " London ";

    const created = await createInteraction(db, draft({ id: "with-event", newEvent: eventDraft }), fixedNow);
    expect(created.eventId).toBe("event-fellowship");
    expect(await db.get("events", "event-fellowship")).toMatchObject({
      name: "AI Fellowship",
      occurredOn: "2026-08-01",
      location: "London"
    });

    const duplicateEvent = createRelationshipEventDraft({ now: fixedNow, idFactory: () => "duplicate" });
    duplicateEvent.name = "ai fellowship";
    duplicateEvent.occurredOn = "2026-08-01";
    await expect(createInteraction(db, draft({ id: "duplicate-event-interaction", newEvent: duplicateEvent }), fixedNow))
      .rejects.toBeInstanceOf(DuplicateEventError);
    expect(await db.get("events", "event-duplicate")).toBeUndefined();
    expect(await db.get("interactions", "duplicate-event-interaction")).toBeUndefined();
  });

  it("accepts only an exact compound retry of both the Interaction and its new Event", async () => {
    const db = await openDatabase("compound-retry");
    const eventDraft = createRelationshipEventDraft({ now: fixedNow, idFactory: () => "compound" });
    eventDraft.name = "AI Fellowship";
    eventDraft.occurredOn = "2026-08-01";
    const compound = draft({ id: "compound-interaction", newEvent: eventDraft });

    const first = await createInteraction(db, compound, fixedNow);
    const revisionAfterFirst = (await db.get("metadata", "app"))!.datasetRevision;
    await expect(createInteraction(db, compound, fixedNow)).resolves.toEqual(first);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionAfterFirst);

    await expect(createInteraction(db, {
      ...compound,
      newEvent: { ...eventDraft, location: "A different location" }
    }, fixedNow)).rejects.toBeInstanceOf(RecordConflictError);
    expect(await db.get("events", eventDraft.id)).toMatchObject({ name: "AI Fellowship" });
    expect(await db.count("events")).toBe(1);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionAfterFirst);
  });

  it("rolls back both a new Event and Interaction when the compound write fails", async () => {
    const db = await openDatabase("event-rollback");
    const eventDraft = createRelationshipEventDraft({ now: fixedNow, idFactory: () => "rollback" });
    eventDraft.name = "NHS Hackathon";

    await expect(createInteraction(
      db,
      draft({ id: "interaction-rollback", newEvent: eventDraft }),
      fixedNow,
      { beforeCommit: () => { throw new Error("injected failure"); } }
    )).rejects.toThrow("injected failure");

    expect(await db.get("events", "event-rollback")).toBeUndefined();
    expect(await db.get("interactions", "interaction-rollback")).toBeUndefined();
  });

  it("updates with optimistic revisions without changing identity or ownership", async () => {
    const db = await openDatabase("update");
    const original = await createInteraction(db, draft(), fixedNow);
    const changed = await updateInteraction(db, {
      ...draft(),
      kind: "meeting",
      occurredAt: "2026-07-31T10:00:00.000Z",
      summary: "Met in person"
    }, original.revision, later);

    expect(changed).toMatchObject({
      id: original.id,
      personId: original.personId,
      revision: 2,
      createdAt: original.createdAt,
      updatedAt: later,
      kind: "meeting",
      summary: "Met in person"
    });
    await expect(updateInteraction(db, draft({ summary: "Stale edit" }), original.revision, later))
      .rejects.toBeInstanceOf(StaleRevisionError);
    await expect(updateInteraction(db, draft({ personId: "someone-else" }), changed.revision, later))
      .rejects.toBeInstanceOf(RecordConflictError);
  });

  it("deletes an editable Interaction, retains Facts, and clears their optional source reference", async () => {
    const db = await openDatabase("delete-source-cleanup");
    const repositories = createRepositories(db);
    const stored = await createInteraction(db, draft(), fixedNow);
    await repositories.memoryFacts.create({
      id: "fact-one",
      revision: 1,
      personId: "person-one",
      kind: "interest",
      value: "NHS AI pilots",
      showAsMemoryCue: true,
      sourceInteractionId: stored.id,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const revisionBefore = (await db.get("metadata", "app"))!.datasetRevision;

    await deleteInteraction(db, stored.id, stored.revision, later);
    await deleteInteraction(db, stored.id, stored.revision, later);

    expect(await db.get("interactions", stored.id)).toBeUndefined();
    expect(await db.get("memoryFacts", "fact-one")).toEqual({
      id: "fact-one",
      revision: 2,
      personId: "person-one",
      kind: "interest",
      value: "NHS AI pilots",
      showAsMemoryCue: true,
      createdAt: fixedNow,
      updatedAt: later
    });
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionBefore + 1);
  });

  it("clears every Fact source reference even when restored data links across People", async () => {
    const db = await openDatabase("cross-person-fact-cleanup");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-two"));
    const stored = await createInteraction(db, draft(), fixedNow);
    await repositories.memoryFacts.create({
      id: "fact-other-person",
      revision: 1,
      personId: "person-two",
      kind: "interest",
      value: "Clinical simulation",
      showAsMemoryCue: false,
      sourceInteractionId: stored.id,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });

    await deleteInteraction(db, stored.id, stored.revision, later);

    expect(await db.get("memoryFacts", "fact-other-person")).toMatchObject({
      personId: "person-two",
      revision: 2
    });
    expect(await db.get("memoryFacts", "fact-other-person")).not.toHaveProperty("sourceInteractionId");
  });

  it("rolls back Interaction deletion and Fact cleanup on failure", async () => {
    const db = await openDatabase("delete-rollback");
    const repositories = createRepositories(db);
    const stored = await createInteraction(db, draft(), fixedNow);
    await repositories.memoryFacts.create({
      id: "fact-rollback",
      revision: 1,
      personId: "person-one",
      kind: "interest",
      value: "Simulation",
      showAsMemoryCue: false,
      sourceInteractionId: stored.id,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });

    await expect(deleteInteraction(db, stored.id, stored.revision, later, {
      beforeCommit: () => { throw new Error("injected delete failure"); }
    })).rejects.toThrow("injected delete failure");

    expect(await db.get("interactions", stored.id)).toEqual(stored);
    expect(await db.get("memoryFacts", "fact-rollback")).toMatchObject({
      revision: 1,
      sourceInteractionId: stored.id
    });
  });

  it("protects lifecycle-owned Interactions from direct edit or deletion", async () => {
    const db = await openDatabase("lifecycle-owned");
    const repositories = createRepositories(db);
    await repositories.followUps.create({
      id: "follow-up-one",
      revision: 1,
      personId: "person-one",
      dueDate: "2026-08-02",
      reason: "Send update",
      actionType: "send_update",
      status: "pending",
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const stored = await createInteraction(db, draft({
      kind: "contacted",
      origin: "already_contacted",
      followUpId: "follow-up-one",
      summary: undefined
    }), fixedNow);

    await expect(updateInteraction(db, { ...draft(), followUpId: "follow-up-one" }, stored.revision, later))
      .rejects.toBeInstanceOf(LifecycleOwnedInteractionError);
    await expect(deleteInteraction(db, stored.id, stored.revision, later))
      .rejects.toBeInstanceOf(LifecycleOwnedInteractionError);
    expect(await db.get("interactions", stored.id)).toEqual(stored);
  });
});
