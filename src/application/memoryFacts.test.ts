import { afterEach, describe, expect, it } from "vitest";
import { deletePeopleOsDatabase, openPeopleOsDatabase, type PeopleOsDatabase } from "../data/database";
import { createRepositories, RecordConflictError, StaleRevisionError } from "../data/repositories";
import type { MemoryFact, MemoryFactKind, Person } from "../domain/schema";
import { ValidationError } from "../domain/validation";
import { createInteraction } from "./interactions";
import {
  archiveMemoryFact,
  createMemoryFact,
  createMemoryFactDraft,
  defaultMemoryCueEligibility,
  DuplicateMemoryFactError,
  listPersonMemoryFacts,
  normalizeMemorySearchText,
  projectSearchableMemoryFacts,
  restoreMemoryFact,
  selectCompactProfileFacts,
  selectMemoryCueFactCandidates,
  updateMemoryFact,
  type MemoryFactDraft
} from "./memoryFacts";

const fixedNow = "2026-08-01T09:00:00.000Z";
const nextDay = "2026-08-02T09:00:00.000Z";
const later = "2026-08-03T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(id = "person-one", overrides: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName: id === "person-one" ? "Sarah Ahmed" : "James Cole",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides
  };
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-memory-facts-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  await createRepositories(db).people.create(person());
  return db;
}

function factDraft(overrides: Partial<MemoryFactDraft> = {}): MemoryFactDraft {
  return {
    id: "fact-one",
    personId: "person-one",
    kind: "interest",
    value: "Clinical simulation",
    showAsMemoryCue: true,
    createdAt: fixedNow,
    ...overrides
  };
}

function factRecord(
  id: string,
  kind: MemoryFactKind,
  updatedAt: string,
  overrides: Partial<MemoryFact> = {}
): MemoryFact {
  return {
    id,
    revision: 1,
    personId: "person-one",
    kind,
    value: id,
    showAsMemoryCue: true,
    createdAt: fixedNow,
    updatedAt,
    ...overrides
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("memory fact commands", () => {
  it("creates stable drafts with the specified cue defaults", () => {
    const defaults: Record<MemoryFactKind, boolean> = {
      introduced_by: true,
      interest: true,
      seeking: true,
      family: false,
      communication_preference: true,
      location: true,
      other: false
    };

    for (const [kind, expected] of Object.entries(defaults) as Array<[MemoryFactKind, boolean]>) {
      const draft = createMemoryFactDraft("person-one", {
        kind,
        now: fixedNow,
        idFactory: () => kind
      });
      expect(draft).toMatchObject({
        id: `fact-${kind}`,
        personId: "person-one",
        kind,
        showAsMemoryCue: expected,
        createdAt: fixedNow
      });
      expect(defaultMemoryCueEligibility(kind)).toBe(expected);
    }
  });

  it("trims a Fact, preserves its stable ID, and treats an exact retry as one write", async () => {
    const db = await openDatabase("stable-retry");
    const draft = factDraft({ value: "  Clinical simulation  " });
    const revisionBefore = (await db.get("metadata", "app"))!.datasetRevision;

    const first = await createMemoryFact(db, draft);
    const retry = await createMemoryFact(db, draft);

    expect(retry).toEqual(first);
    expect(first).toMatchObject({ id: draft.id, value: "Clinical simulation", revision: 1 });
    expect(await db.count("memoryFacts")).toBe(1);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionBefore + 1);
  });

  it("enforces required, bounded, controlled, and related-person fields", async () => {
    const db = await openDatabase("validation");
    const invalidDrafts: MemoryFactDraft[] = [
      factDraft({ id: "empty", value: "   " }),
      factDraft({ id: "long", value: "x".repeat(241) }),
      factDraft({ id: "preference", kind: "communication_preference", value: "Teams" }),
      factDraft({ id: "wrong-kind-link", relatedPersonId: "person-two" }),
      factDraft({ id: "self-link", kind: "introduced_by", relatedPersonId: "person-one" })
    ];

    for (const draft of invalidDrafts) {
      await expect(createMemoryFact(db, draft)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await db.count("memoryFacts")).toBe(0);

    await expect(createMemoryFact(db, factDraft({
      id: "valid-preference",
      kind: "communication_preference",
      value: "email"
    }))).resolves.toMatchObject({ value: "email" });
  });

  it("validates owner, introduced-by Person, and same-Person source Interaction inside the write transaction", async () => {
    const db = await openDatabase("references");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-two"));
    await createInteraction(db, {
      id: "note-one",
      personId: "person-one",
      kind: "note_added",
      occurredAt: fixedNow,
      summary: "James introduced us",
      createdAt: fixedNow,
      origin: "note"
    }, fixedNow);
    await createInteraction(db, {
      id: "note-other",
      personId: "person-two",
      kind: "note_added",
      occurredAt: fixedNow,
      summary: "Belongs elsewhere",
      createdAt: fixedNow,
      origin: "note"
    }, fixedNow);
    await createInteraction(db, {
      id: "meeting-one",
      personId: "person-one",
      kind: "meeting",
      occurredAt: fixedNow,
      createdAt: fixedNow,
      origin: "manual"
    }, fixedNow);

    await expect(createMemoryFact(db, factDraft({
      id: "introduced",
      kind: "introduced_by",
      value: "Introduced by James",
      relatedPersonId: "person-two",
      sourceInteractionId: "note-one"
    }))).resolves.toMatchObject({ relatedPersonId: "person-two", sourceInteractionId: "note-one" });

    const invalidReferences = [
      factDraft({ id: "missing-owner", personId: "missing" }),
      factDraft({ id: "missing-related", kind: "introduced_by", relatedPersonId: "missing" }),
      factDraft({ id: "wrong-owner-note", sourceInteractionId: "note-other" })
    ];
    for (const draft of invalidReferences) {
      await expect(createMemoryFact(db, draft)).rejects.toBeInstanceOf(RecordConflictError);
    }
    await expect(createMemoryFact(db, factDraft({ id: "meeting-source", sourceInteractionId: "meeting-one" })))
      .resolves.toMatchObject({ sourceInteractionId: "meeting-one" });
  });

  it("warns on an exact active duplicate and saves only with explicit override", async () => {
    const db = await openDatabase("duplicates");
    const original = await createMemoryFact(db, factDraft({ value: "  Looking for pilot sites " }));
    const duplicate = factDraft({ id: "fact-duplicate", value: "Looking for pilot sites" });

    await expect(createMemoryFact(db, duplicate)).rejects.toMatchObject({
      name: "DuplicateMemoryFactError",
      existingFact: expect.objectContaining({ id: original.id })
    });
    expect(await db.get("memoryFacts", duplicate.id)).toBeUndefined();
    await expect(createMemoryFact(db, duplicate, { allowDuplicate: true }))
      .resolves.toMatchObject({ id: duplicate.id });
    expect(await db.count("memoryFacts")).toBe(2);

    const different = await createMemoryFact(db, factDraft({ id: "fact-different", value: "Another interest" }));
    await expect(updateMemoryFact(db, {
      ...factDraft(),
      id: different.id,
      value: original.value,
      createdAt: different.createdAt
    }, different.revision)).rejects.toBeInstanceOf(DuplicateMemoryFactError);
    await expect(updateMemoryFact(db, {
      ...factDraft(),
      id: different.id,
      value: original.value,
      createdAt: different.createdAt
    }, different.revision, { allowDuplicate: true, now: nextDay }))
      .resolves.toMatchObject({ id: different.id, value: original.value, revision: 2 });
  });

  it("updates through optimistic revisions without changing identity, ownership, or source Note", async () => {
    const db = await openDatabase("update");
    await createInteraction(db, {
      id: "note-one",
      personId: "person-one",
      kind: "note_added",
      occurredAt: fixedNow,
      summary: "A narrative note",
      createdAt: fixedNow,
      origin: "note"
    }, fixedNow);
    const original = await createMemoryFact(db, factDraft({ sourceInteractionId: "note-one" }));
    const updated = await updateMemoryFact(db, {
      ...factDraft(),
      value: "Simulation education",
      sourceInteractionId: "note-one"
    }, original.revision, { now: nextDay });

    expect(updated).toMatchObject({
      id: original.id,
      personId: original.personId,
      revision: 2,
      createdAt: original.createdAt,
      updatedAt: nextDay,
      value: "Simulation education"
    });
    await expect(updateMemoryFact(db, factDraft({ value: "Stale" }), original.revision))
      .rejects.toBeInstanceOf(StaleRevisionError);
    await expect(updateMemoryFact(db, {
      ...factDraft(), personId: "person-two", sourceInteractionId: "note-one"
    }, updated.revision)).rejects.toBeInstanceOf(RecordConflictError);
    await expect(updateMemoryFact(db, {
      ...factDraft(), sourceInteractionId: undefined
    }, updated.revision)).rejects.toBeInstanceOf(RecordConflictError);
  });

  it("archives and restores reversibly while active projections exclude archived Facts", async () => {
    const db = await openDatabase("archive");
    const original = await createMemoryFact(db, factDraft());
    const archived = await archiveMemoryFact(db, original.id, original.revision, nextDay);

    expect(archived).toMatchObject({ revision: 2, archivedAt: nextDay, updatedAt: nextDay });
    await expect(restoreMemoryFact(db, archived.id, original.revision, later))
      .rejects.toBeInstanceOf(StaleRevisionError);
    const afterArchive = await listPersonMemoryFacts(db, "person-one");
    expect(afterArchive.active).toEqual([]);
    expect(afterArchive.archived.map((fact) => fact.id)).toEqual([original.id]);
    expect(selectMemoryCueFactCandidates(afterArchive.archived)).toEqual([]);
    expect(projectSearchableMemoryFacts(afterArchive.archived)).toEqual([]);

    const restored = await restoreMemoryFact(db, archived.id, archived.revision, later);
    expect(restored).toMatchObject({ id: original.id, revision: 3, updatedAt: later });
    expect(restored.archivedAt).toBeUndefined();
    expect((await listPersonMemoryFacts(db, "person-one")).active.map((fact) => fact.id))
      .toEqual([original.id]);
    await expect(restoreMemoryFact(db, restored.id, restored.revision, { now: later }))
      .rejects.toBeInstanceOf(RecordConflictError);
  });

  it("warns before restoring an exact active duplicate and requires explicit override", async () => {
    const db = await openDatabase("restore-duplicate");
    const original = await createMemoryFact(db, factDraft());
    const archived = await archiveMemoryFact(db, original.id, original.revision, nextDay);
    await createMemoryFact(db, factDraft({ id: "fact-active-copy" }));

    await expect(restoreMemoryFact(db, archived.id, archived.revision, { now: later }))
      .rejects.toBeInstanceOf(DuplicateMemoryFactError);
    expect((await db.get("memoryFacts", archived.id))?.archivedAt).toBe(nextDay);
    const restored = await restoreMemoryFact(db, archived.id, archived.revision, { now: later, allowDuplicate: true });
    expect(restored.id).toBe(archived.id);
    expect(restored.archivedAt).toBeUndefined();
  });

  it("rolls back failed creation and archival, including metadata changes", async () => {
    const db = await openDatabase("rollback");
    const revisionBefore = (await db.get("metadata", "app"))!.datasetRevision;
    await expect(createMemoryFact(db, factDraft(), {
      beforeCommit: () => { throw new Error("injected create failure"); }
    })).rejects.toThrow("injected create failure");
    expect(await db.get("memoryFacts", "fact-one")).toBeUndefined();
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionBefore);

    const stored = await createMemoryFact(db, factDraft());
    const revisionAfterCreate = (await db.get("metadata", "app"))!.datasetRevision;
    await expect(archiveMemoryFact(db, stored.id, stored.revision, nextDay, () => {
      throw new Error("injected archive failure");
    })).rejects.toThrow("injected archive failure");
    expect(await db.get("memoryFacts", stored.id)).toEqual(stored);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionAfterCreate);
  });
});

describe("memory fact projections", () => {
  it("orders cue and compact candidates deterministically and protects Family/Other by default", () => {
    const records = [
      factRecord("other-hidden", "other", later, { showAsMemoryCue: false }),
      factRecord("family-hidden", "family", later, { showAsMemoryCue: false }),
      factRecord("family-enabled", "family", fixedNow),
      factRecord("location", "location", later),
      factRecord("introduction", "introduced_by", later),
      factRecord("interest-old", "interest", fixedNow),
      factRecord("interest-new", "interest", later),
      factRecord("seeking", "seeking", fixedNow),
      factRecord("preference", "communication_preference", fixedNow),
      factRecord("archived", "communication_preference", later, { archivedAt: later })
    ];

    expect(selectMemoryCueFactCandidates(records).map((fact) => fact.id)).toEqual([
      "preference", "seeking", "interest-new", "interest-old", "introduction", "location", "family-enabled"
    ]);
    expect(selectCompactProfileFacts(records, { excludeFactId: "preference", limit: 8 }).map((fact) => fact.id)).toEqual([
      "seeking", "interest-new", "interest-old", "introduction", "location", "family-enabled"
    ]);
  });

  it("projects only active Facts into normalized, explainable search data", () => {
    const active = factRecord("location", "location", fixedNow, { value: "Based in Brístol" });
    const preference = factRecord("preference", "communication_preference", nextDay, { value: "whatsapp" });
    const archived = factRecord("archived", "seeking", later, { value: "Pilot sites", archivedAt: later });

    expect(normalizeMemorySearchText("  Brístol—NHS  ")).toBe("bristol nhs");
    expect(projectSearchableMemoryFacts([archived, preference, active])).toEqual([
      expect.objectContaining({
        id: preference.id,
        label: "Communication preference",
        value: "WhatsApp",
        normalizedText: "communication preference whatsapp"
      }),
      expect.objectContaining({
        id: active.id,
        label: "Location",
        value: "Based in Brístol",
        normalizedText: "location based in bristol"
      })
    ]);
  });

  it("groups persisted Facts into deterministically sorted active and archived lists", async () => {
    const db = await openDatabase("list-projection");
    const interest = await createMemoryFact(db, factDraft({ id: "interest", value: "Simulation" }));
    await createMemoryFact(db, factDraft({ id: "introduction", kind: "introduced_by", value: "Introduced by Ed" }));
    await createMemoryFact(db, factDraft({ id: "seeking", kind: "seeking", value: "Pilot sites" }));
    await archiveMemoryFact(db, interest.id, interest.revision, nextDay);

    const lists = await listPersonMemoryFacts(db, "person-one");
    expect(lists.active.map((fact) => fact.id)).toEqual(["introduction", "seeking"]);
    expect(lists.archived.map((fact) => fact.id)).toEqual(["interest"]);
  });
});
