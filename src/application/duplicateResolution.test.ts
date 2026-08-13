import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { createRepositories, RecordConflictError, StaleRevisionError } from "../data/repositories";
import type { ContactMethod, Person } from "../domain/schema";
import { ValidationError } from "../domain/validation";
import { fixedNow } from "../test/fixtures";
import {
  createManualPersonCaptureDraft,
  prepareManualPersonCapture,
  type ManualPersonCaptureDraft
} from "./manualPersonCapture";
import { addReviewedDetailsToExistingPerson } from "./duplicateResolution";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();
const commandNow = "2026-08-02T10:00:00.000Z";

function databaseName(label: string): string {
  const name = `peopleos-duplicate-resolution-${label}-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const db = await openPeopleOsDatabase(databaseName(label), fixedNow);
  connections.add(db);
  return db;
}

function targetPerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-target",
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

function candidate(overrides: Partial<ManualPersonCaptureDraft> = {}) {
  return prepareManualPersonCapture({
    ...createManualPersonCaptureDraft({
      now: fixedNow,
      idFactory: (() => {
        let index = 0;
        return () => `candidate-${++index}`;
      })()
    }),
    displayName: "Possible Sarah",
    contactMethods: [],
    ...overrides
  }, "GB");
}

function contact(overrides: Partial<ContactMethod> = {}): ContactMethod {
  return {
    id: "contact-existing-phone",
    revision: 1,
    personId: "person-target",
    kind: "phone",
    rawValue: "07900 123456",
    canonicalValue: "+447900123456",
    region: "GB",
    isPreferred: true,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides
  } as ContactMethod;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("reviewed duplicate resolution", () => {
  it("reassigns stable selected IDs, skips canonical duplicates and preserves preferred semantics", async () => {
    const db = await openDatabase("details");
    const repositories = createRepositories(db);
    await repositories.people.create(targetPerson());
    await repositories.contactMethods.create(contact());
    const prepared = candidate({
      organisationName: "NHS England",
      role: "Clinical Fellow",
      whereMet: "AI Fellowship",
      contactMethods: [
        { id: "contact-duplicate-phone", kind: "phone", value: "+44 7900 123456" },
        { id: "contact-new-phone", kind: "phone", value: "+44 7911 123456", label: "Work mobile" },
        { id: "contact-first-email", kind: "email", value: "Sarah@NHS.example", label: "NHS email" },
        { id: "contact-second-email", kind: "email", value: "sarah@example.com" }
      ]
    });

    const result = await addReviewedDetailsToExistingPerson(db, {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: prepared.contactMethods.map((record) => record.id),
      includeAffiliation: true,
      now: commandNow
    });

    expect(result.person).toMatchObject({ id: "person-target", revision: 2, updatedAt: commandNow });
    expect(result.skippedContactMethodIds).toEqual(["contact-duplicate-phone"]);
    expect(result.addedContactMethods.map((record) => record.id)).toEqual([
      "contact-new-phone", "contact-first-email", "contact-second-email"
    ]);
    expect(result.addedContactMethods.map((record) => [record.id, record.personId, record.isPreferred])).toEqual([
      ["contact-new-phone", "person-target", false],
      ["contact-first-email", "person-target", true],
      ["contact-second-email", "person-target", false]
    ]);
    expect(result.addedAffiliation).toMatchObject({
      id: prepared.affiliation?.id,
      personId: "person-target",
      organisationName: "NHS England"
    });

    const data = await readAllData(db);
    expect(data.people.map((record) => record.id)).toEqual(["person-target"]);
    expect(data.contactMethods.filter((record) => record.canonicalValue === "+447900123456")).toHaveLength(1);
    expect(data.interactions).toEqual([]);
    expect(data.affiliations).toHaveLength(1);
  });

  it("does not revise the Person or dataset when every selected canonical value already exists", async () => {
    const db = await openDatabase("no-op");
    const repositories = createRepositories(db);
    await repositories.people.create(targetPerson());
    await repositories.contactMethods.create(contact({
      id: "contact-existing-email",
      kind: "email",
      rawValue: "Sarah@Example.com",
      canonicalValue: "sarah@example.com"
    }));
    await repositories.affiliations.create({
      id: "affiliation-existing",
      revision: 1,
      personId: "person-target",
      organisationName: "NHS England",
      role: "Clinical Fellow",
      isCurrent: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const prepared = candidate({
      organisationName: "NHS—England",
      role: "clinical fellow",
      contactMethods: [{ id: "contact-candidate-email", kind: "email", value: " sarah@example.com " }]
    });
    const metadataBefore = await db.get("metadata", "app");

    const result = await addReviewedDetailsToExistingPerson(db, {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: ["contact-candidate-email"],
      includeAffiliation: true,
      now: commandNow
    });

    expect(result.addedContactMethods).toEqual([]);
    expect(result.skippedContactMethodIds).toEqual(["contact-candidate-email"]);
    expect(result.addedAffiliation).toBeUndefined();
    expect(result.skippedAffiliationId).toBe(prepared.affiliation?.id);
    expect(await db.get("people", "person-target")).toEqual({ ...targetPerson(), relationshipMode: "personal" });
    expect(await db.get("metadata", "app")).toEqual(metadataBefore);
  });

  it("atomically replaces an identifier fallback with an explicitly reviewed human name", async () => {
    const db = await openDatabase("reviewed-name");
    const repositories = createRepositories(db);
    await repositories.people.create(targetPerson({ displayName: "07900 123456" }));
    await repositories.contactMethods.create(contact());
    const prepared = candidate({
      displayName: "Bibi Jones",
      contactMethods: [{ id: "contact-candidate-phone", kind: "phone", value: "+44 7900 123456" }]
    });
    const metadataBefore = await db.get("metadata", "app");
    const input = {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: [],
      includeAffiliation: false,
      includeDisplayName: true,
      now: commandNow
    };

    const result = await addReviewedDetailsToExistingPerson(db, input);

    expect(result).toMatchObject({
      person: { id: "person-target", displayName: "Bibi Jones", revision: 2 },
      displayNameUpdated: true,
      addedContactMethods: [],
      skippedContactMethodIds: []
    });
    expect(await db.count("people")).toBe(1);
    expect(await db.count("contactMethods")).toBe(1);
    expect((await db.get("metadata", "app"))?.datasetRevision)
      .toBe((metadataBefore?.datasetRevision ?? 0) + 1);

    const retry = await addReviewedDetailsToExistingPerson(db, input);
    expect(retry.person).toEqual(result.person);
    expect(retry.displayNameUpdated).toBe(true);
    expect(await db.count("people")).toBe(1);
    expect(await db.count("contactMethods")).toBe(1);
  });

  it("never overwrites an existing real name during reviewed contact enrichment", async () => {
    const db = await openDatabase("keep-real-name");
    const repositories = createRepositories(db);
    await repositories.people.create(targetPerson({ displayName: "Sarah Smith" }));
    await repositories.contactMethods.create(contact());
    const prepared = candidate({
      displayName: "Bibi Jones",
      contactMethods: [{ id: "contact-candidate-phone", kind: "phone", value: "+44 7900 123456" }]
    });
    const metadataBefore = await db.get("metadata", "app");

    await expect(addReviewedDetailsToExistingPerson(db, {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: [],
      includeAffiliation: false,
      includeDisplayName: true,
      now: commandNow
    })).rejects.toBeInstanceOf(RecordConflictError);

    expect((await db.get("people", "person-target"))?.displayName).toBe("Sarah Smith");
    expect(await db.get("metadata", "app")).toEqual(metadataBefore);
  });

  it("rejects phone and email display fallbacks as reviewed names", async () => {
    const db = await openDatabase("invalid-reviewed-name");
    const repositories = createRepositories(db);
    await repositories.people.create(targetPerson({ displayName: "07900 123456" }));
    await repositories.contactMethods.create(contact());
    const prepared = candidate({
      displayName: "",
      contactMethods: [{ id: "contact-candidate-phone", kind: "phone", value: "+44 7900 123456" }]
    });

    await expect(addReviewedDetailsToExistingPerson(db, {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: [],
      includeAffiliation: false,
      includeDisplayName: true,
      now: commandNow
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns the same records on exact retry without incrementing revisions or counts", async () => {
    const db = await openDatabase("retry");
    await createRepositories(db).people.create(targetPerson());
    const prepared = candidate({
      organisationName: "NHS England",
      contactMethods: [{ id: "contact-stable-email", kind: "email", value: "sarah@example.com" }]
    });
    const input = {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: ["contact-stable-email"],
      includeAffiliation: true,
      now: commandNow
    };

    const metadataBefore = await db.get("metadata", "app");
    const first = await addReviewedDetailsToExistingPerson(db, input);
    const metadataAfterFirst = await db.get("metadata", "app");
    const second = await addReviewedDetailsToExistingPerson(db, input);

    expect(second).toEqual(first);
    expect(await db.count("people")).toBe(1);
    expect(await db.count("contactMethods")).toBe(1);
    expect(await db.count("affiliations")).toBe(1);
    expect((await db.get("people", "person-target"))?.revision).toBe(2);
    expect(metadataAfterFirst?.datasetRevision).toBe((metadataBefore?.datasetRevision ?? 0) + 1);
    expect(await db.get("metadata", "app")).toEqual(metadataAfterFirst);
  });

  it("recognises an exact stable-child replay after later unrelated Person revisions", async () => {
    const db = await openDatabase("retry-after-person-update");
    const repositories = createRepositories(db);
    await repositories.people.create(targetPerson());
    const prepared = candidate({
      organisationName: "NHS England",
      role: "Clinical Fellow",
      contactMethods: [{ id: "contact-stable-email", kind: "email", value: "sarah@example.com" }]
    });
    const input = {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: ["contact-stable-email"],
      includeAffiliation: true,
      now: commandNow
    };

    const first = await addReviewedDetailsToExistingPerson(db, input);
    const laterNow = "2026-08-03T11:00:00.000Z";
    const laterPerson = await repositories.people.update({
      ...first.person,
      displayName: "Sarah Ahmed (updated)"
    }, first.person.revision, laterNow);
    const metadataBeforeReplay = await db.get("metadata", "app");

    const replay = await addReviewedDetailsToExistingPerson(db, input);

    expect(replay.person).toEqual(laterPerson);
    expect(replay.addedContactMethods).toEqual(first.addedContactMethods);
    expect(replay.addedAffiliation).toEqual(first.addedAffiliation);
    expect(replay.skippedContactMethodIds).toEqual([]);
    expect(await db.count("people")).toBe(1);
    expect(await db.count("contactMethods")).toBe(1);
    expect(await db.count("affiliations")).toBe(1);
    expect(await db.get("metadata", "app")).toEqual(metadataBeforeReplay);
  });

  it("does not mistake a changed stable child for an exact replay", async () => {
    const db = await openDatabase("changed-child-is-not-replay");
    const repositories = createRepositories(db);
    await repositories.people.create(targetPerson());
    const prepared = candidate({
      contactMethods: [{ id: "contact-stable-email", kind: "email", value: "sarah@example.com" }]
    });
    const input = {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: ["contact-stable-email"],
      includeAffiliation: false,
      now: commandNow
    };

    const first = await addReviewedDetailsToExistingPerson(db, input);
    await repositories.contactMethods.update({
      ...first.addedContactMethods[0],
      label: "NHS email"
    }, first.addedContactMethods[0].revision, "2026-08-03T11:00:00.000Z");

    await expect(addReviewedDetailsToExistingPerson(db, input)).rejects.toBeInstanceOf(RecordConflictError);
    expect((await db.get("contactMethods", "contact-stable-email"))?.label).toBe("NHS email");
  });

  it("rejects stale target revisions and newly conflicting canonical details", async () => {
    const staleDb = await openDatabase("stale");
    const staleRepositories = createRepositories(staleDb);
    await staleRepositories.people.create(targetPerson());
    await staleRepositories.people.update({ ...targetPerson(), displayName: "Updated target" }, 1, commandNow);
    const prepared = candidate({
      contactMethods: [{ id: "contact-new-email", kind: "email", value: "new@example.com" }]
    });
    await expect(addReviewedDetailsToExistingPerson(staleDb, {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: ["contact-new-email"],
      includeAffiliation: false,
      now: commandNow
    })).rejects.toBeInstanceOf(StaleRevisionError);

    const conflictDb = await openDatabase("canonical-conflict");
    const conflictRepositories = createRepositories(conflictDb);
    await conflictRepositories.people.create(targetPerson());
    await conflictRepositories.people.create(targetPerson({ id: "person-other", displayName: "Other Person" }));
    await conflictRepositories.contactMethods.create(contact({
      id: "contact-other-email",
      personId: "person-other",
      kind: "email",
      rawValue: "new@example.com",
      canonicalValue: "new@example.com"
    }));
    await expect(addReviewedDetailsToExistingPerson(conflictDb, {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: ["contact-new-email"],
      includeAffiliation: false,
      now: commandNow
    })).rejects.toThrow(/review duplicates again/);
    expect(await conflictDb.get("contactMethods", "contact-new-email")).toBeUndefined();
  });

  it("rejects a stable child ID collision with different content", async () => {
    const db = await openDatabase("id-collision");
    const repositories = createRepositories(db);
    await repositories.people.create(targetPerson());
    await repositories.contactMethods.create(contact({
      id: "contact-stable-email",
      kind: "email",
      rawValue: "existing@example.com",
      canonicalValue: "existing@example.com"
    }));
    const prepared = candidate({
      contactMethods: [{ id: "contact-stable-email", kind: "email", value: "different@example.com" }]
    });

    await expect(addReviewedDetailsToExistingPerson(db, {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: ["contact-stable-email"],
      includeAffiliation: false,
      now: commandNow
    })).rejects.toBeInstanceOf(RecordConflictError);
    expect((await db.get("contactMethods", "contact-stable-email"))?.canonicalValue).toBe("existing@example.com");
  });

  it("rolls back Person, contacts, affiliation and metadata when the transaction fails", async () => {
    const db = await openDatabase("rollback");
    await createRepositories(db).people.create(targetPerson());
    const prepared = candidate({
      organisationName: "NHS England",
      whereMet: "AI Fellowship",
      contactMethods: [
        { id: "contact-rollback-phone", kind: "phone", value: "+44 7911 123456" },
        { id: "contact-rollback-email", kind: "email", value: "rollback@example.com" }
      ]
    });
    const before = await readAllData(db);
    const metadataBefore = await db.get("metadata", "app");

    await expect(addReviewedDetailsToExistingPerson(db, {
      targetPersonId: "person-target",
      expectedPersonRevision: 1,
      candidate: prepared,
      selectedContactMethodIds: prepared.contactMethods.map((record) => record.id),
      includeAffiliation: true,
      now: commandNow
    }, {
      beforeCommit: () => { throw new Error("injected resolution failure"); }
    })).rejects.toThrow("injected resolution failure");

    expect(await readAllData(db)).toEqual(before);
    expect(await db.get("metadata", "app")).toEqual(metadataBefore);
    expect(await db.count("interactions")).toBe(0);
  });
});
