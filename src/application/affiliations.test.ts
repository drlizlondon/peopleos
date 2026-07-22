import { afterEach, describe, expect, it } from "vitest";
import { deletePeopleOsDatabase, openPeopleOsDatabase, type PeopleOsDatabase } from "../data/database";
import { createRepositories, RecordConflictError, StaleRevisionError } from "../data/repositories";
import type { OrganisationAffiliation, Person } from "../domain/schema";
import { ValidationError } from "../domain/validation";
import {
  archiveAffiliation,
  createAffiliation,
  createAffiliationDraft,
  listPersonAffiliations,
  projectSearchableAffiliations,
  restoreAffiliation,
  selectDisplayAffiliation,
  sortCurrentAffiliations,
  sortPastAffiliations,
  updateAffiliation,
  type AffiliationDraft
} from "./affiliations";

const fixedNow = "2026-08-01T09:00:00.000Z";
const nextDay = "2026-08-02T09:00:00.000Z";
const later = "2026-08-03T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-one",
    revision: 1,
    displayName: "Sarah Ahmed",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides
  };
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-affiliations-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  await createRepositories(db).people.create(person());
  return db;
}

function affiliationDraft(overrides: Partial<AffiliationDraft> = {}): AffiliationDraft {
  return {
    id: "affiliation-one",
    personId: "person-one",
    organisationName: "NHS England",
    role: "Clinical fellow",
    isCurrent: true,
    createdAt: fixedNow,
    ...overrides
  };
}

function affiliationRecord(
  id: string,
  overrides: Partial<OrganisationAffiliation> = {}
): OrganisationAffiliation {
  return {
    id,
    revision: 1,
    personId: "person-one",
    organisationName: id,
    isCurrent: true,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("affiliation commands", () => {
  it("creates a stable draft and treats an exact retry as one write", async () => {
    const draft = createAffiliationDraft("person-one", { now: fixedNow, idFactory: () => "stable" });
    expect(draft).toEqual({
      id: "affiliation-stable",
      personId: "person-one",
      organisationName: "",
      isCurrent: true,
      createdAt: fixedNow
    });
    draft.organisationName = "  NHS England  ";
    draft.role = "  Clinical fellow  ";
    const db = await openDatabase("stable-retry");
    const revisionBefore = (await db.get("metadata", "app"))!.datasetRevision;

    const first = await createAffiliation(db, draft);
    const retry = await createAffiliation(db, draft);

    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      id: "affiliation-stable",
      organisationName: "NHS England",
      role: "Clinical fellow",
      revision: 1
    });
    expect(await db.count("affiliations")).toBe(1);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionBefore + 1);
  });

  it("requires an organisation and valid chronological dates", async () => {
    const db = await openDatabase("validation");
    const invalidDrafts = [
      affiliationDraft({ id: "empty", organisationName: "   " }),
      affiliationDraft({ id: "invalid-start", startedOn: "2026-02-31" }),
      affiliationDraft({ id: "invalid-end", isCurrent: false, endedOn: "not-a-date" }),
      affiliationDraft({ id: "reversed", isCurrent: false, startedOn: "2026-09-01", endedOn: "2026-08-01" })
    ];
    for (const draft of invalidDrafts) {
      await expect(createAffiliation(db, draft)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await db.count("affiliations")).toBe(0);
  });

  it("clears an end date for a current affiliation and stores an ended affiliation as past", async () => {
    const db = await openDatabase("current-past");
    const current = await createAffiliation(db, affiliationDraft({
      endedOn: "2026-07-31",
      isCurrent: true
    }));
    expect(current.isCurrent).toBe(true);
    expect(current.endedOn).toBeUndefined();

    const past = await updateAffiliation(db, {
      ...affiliationDraft(),
      endedOn: "2026-07-31",
      isCurrent: false
    }, current.revision, { now: nextDay });
    expect(past).toMatchObject({ isCurrent: false, endedOn: "2026-07-31", revision: 2 });
  });

  it("allows several current affiliations and derives the display affiliation deterministically", async () => {
    const db = await openDatabase("multiple-current");
    await createAffiliation(db, affiliationDraft({
      id: "affiliation-old",
      organisationName: "Old current",
      startedOn: "2025-01-01"
    }));
    await createAffiliation(db, affiliationDraft({
      id: "affiliation-new-b",
      organisationName: "New current B",
      startedOn: "2026-01-01",
      createdAt: nextDay
    }));
    await createAffiliation(db, affiliationDraft({
      id: "affiliation-new-a",
      organisationName: "New current A",
      startedOn: "2026-01-01",
      createdAt: nextDay
    }));

    const list = await listPersonAffiliations(db, "person-one");
    expect(list.current.map((record) => record.id)).toEqual([
      "affiliation-new-a", "affiliation-new-b", "affiliation-old"
    ]);
    expect(selectDisplayAffiliation([...list.current].reverse())?.id).toBe("affiliation-new-a");
  });

  it("updates through optimistic revisions without changing identity or ownership", async () => {
    const db = await openDatabase("update");
    const original = await createAffiliation(db, affiliationDraft());
    const updated = await updateAffiliation(db, {
      ...affiliationDraft(),
      organisationName: "NHS Bristol",
      role: "Advisor"
    }, original.revision, { now: nextDay });
    expect(updated).toMatchObject({
      id: original.id,
      personId: original.personId,
      revision: 2,
      createdAt: original.createdAt,
      updatedAt: nextDay,
      organisationName: "NHS Bristol",
      role: "Advisor"
    });
    await expect(updateAffiliation(db, affiliationDraft({ organisationName: "Stale" }), original.revision))
      .rejects.toBeInstanceOf(StaleRevisionError);
    await expect(updateAffiliation(db, affiliationDraft({ personId: "person-two" }), updated.revision))
      .rejects.toBeInstanceOf(RecordConflictError);
  });

  it("rejects writes for missing, archived, or merged owning People", async () => {
    const db = await openDatabase("owner");
    await expect(createAffiliation(db, affiliationDraft({ id: "missing", personId: "missing" })))
      .rejects.toBeInstanceOf(RecordConflictError);
    const repositories = createRepositories(db);
    const owner = await repositories.people.get("person-one");
    await repositories.people.archive("person-one", owner!.revision, nextDay);
    await expect(createAffiliation(db, affiliationDraft({ id: "archived-owner" })))
      .rejects.toBeInstanceOf(RecordConflictError);
  });

  it("archives and restores an affiliation without losing its stable identity", async () => {
    const db = await openDatabase("archive");
    const original = await createAffiliation(db, affiliationDraft());
    const archived = await archiveAffiliation(db, original.id, original.revision, nextDay);
    expect(archived).toMatchObject({ id: original.id, revision: 2, archivedAt: nextDay });
    await expect(restoreAffiliation(db, archived.id, original.revision, later))
      .rejects.toBeInstanceOf(StaleRevisionError);
    const afterArchive = await listPersonAffiliations(db, "person-one");
    expect(afterArchive.current).toEqual([]);
    expect(afterArchive.archived.map((record) => record.id)).toEqual([original.id]);

    const restored = await restoreAffiliation(db, archived.id, archived.revision, later);
    expect(restored).toMatchObject({ id: original.id, revision: 3, updatedAt: later });
    expect(restored.archivedAt).toBeUndefined();
    expect((await listPersonAffiliations(db, "person-one")).current.map((record) => record.id))
      .toEqual([original.id]);
    await expect(restoreAffiliation(db, restored.id, restored.revision, later))
      .rejects.toBeInstanceOf(RecordConflictError);
  });

  it("rolls back failed creation and archival, including metadata changes", async () => {
    const db = await openDatabase("rollback");
    const revisionBefore = (await db.get("metadata", "app"))!.datasetRevision;
    await expect(createAffiliation(db, affiliationDraft(), {
      beforeCommit: () => { throw new Error("injected create failure"); }
    })).rejects.toThrow("injected create failure");
    expect(await db.get("affiliations", "affiliation-one")).toBeUndefined();
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionBefore);

    const stored = await createAffiliation(db, affiliationDraft());
    const revisionAfterCreate = (await db.get("metadata", "app"))!.datasetRevision;
    await expect(archiveAffiliation(db, stored.id, stored.revision, nextDay, () => {
      throw new Error("injected archive failure");
    })).rejects.toThrow("injected archive failure");
    expect(await db.get("affiliations", stored.id)).toEqual(stored);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionAfterCreate);
  });
});

describe("affiliation projections", () => {
  it("orders current and past history exactly and excludes archived records from search", () => {
    const records = [
      affiliationRecord("current-old", { startedOn: "2025-01-01" }),
      affiliationRecord("current-new", { startedOn: "2026-01-01" }),
      affiliationRecord("past-undated", { isCurrent: false }),
      affiliationRecord("past-old", { isCurrent: false, startedOn: "2020-01-01", endedOn: "2022-01-01" }),
      affiliationRecord("past-new", { isCurrent: false, startedOn: "2021-01-01", endedOn: "2025-01-01" }),
      affiliationRecord("archived", { archivedAt: later, organisationName: "Hidden organisation" })
    ];

    expect(sortCurrentAffiliations(records).map((record) => record.id)).toEqual(["current-new", "current-old"]);
    expect(sortPastAffiliations(records).map((record) => record.id)).toEqual(["past-new", "past-old", "past-undated"]);
    expect(projectSearchableAffiliations(records).map((record) => record.id)).toEqual([
      "current-new", "current-old", "past-new", "past-old", "past-undated"
    ]);
    expect(projectSearchableAffiliations([
      affiliationRecord("accented", { organisationName: "Brístol NHS", role: "Clinical—Advisor" })
    ])[0]).toMatchObject({ normalizedText: "bristol nhs clinical advisor" });
  });
});
