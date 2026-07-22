import { afterEach, describe, expect, it } from "vitest";
import { deletePeopleOsDatabase, openPeopleOsDatabase, type PeopleOsDatabase } from "../data/database";
import { createRepositories, StaleRevisionError } from "../data/repositories";
import { completeData, fixedNow } from "../test/fixtures";
import { validatePeopleOsData } from "../domain/validation";
import { readAllData } from "../data/database";
import {
  addContactMethod,
  archiveContactMethod,
  editContactMethod,
  listContactMethodsForPerson,
  restoreContactMethod,
  setPreferredContactMethod
} from "./contactMethods";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function databaseName(label: string): string {
  const name = `peopleos-contacts-${label}-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

async function databaseWithPerson(label: string) {
  const db = await openPeopleOsDatabase(databaseName(label), fixedNow);
  connections.add(db);
  await createRepositories(db).people.create({
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Ahmed",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: fixedNow,
    updatedAt: fixedNow
  });
  return db;
}

describe("contact method actions", () => {
  it("rejects imported data with more than one active preferred contact per kind", () => {
    const data = completeData();
    data.contactMethods.push({
      ...data.contactMethods[0],
      id: "contact-sarah-phone-two",
      rawValue: "07700 900123",
      canonicalValue: "+447700900123"
    });
    expect(() => validatePeopleOsData(data)).toThrow(/more than one active preferred phone/);
  });

  it("adds multiple values of the same type and assigns only the first as preferred", async () => {
    const db = await databaseWithPerson("add");
    const first = await addContactMethod(db, {
      id: "phone-one", personId: "person-sarah", kind: "phone", value: "07900 123456", label: "Personal", createdAt: fixedNow
    }, "GB");
    const second = await addContactMethod(db, {
      id: "phone-two", personId: "person-sarah", kind: "phone", value: "+44 7912 123456", label: "Work", createdAt: fixedNow
    }, "GB");
    const email = await addContactMethod(db, {
      id: "email-one", personId: "person-sarah", kind: "email", value: "sarah@example.com", label: "Personal", createdAt: fixedNow
    }, "GB");
    expect(first.isPreferred).toBe(true);
    expect(second.isPreferred).toBe(false);
    expect(email.isPreferred).toBe(true);
    expect((await listContactMethodsForPerson(db, "person-sarah")).map((record) => record.id)).toEqual(["phone-one", "email-one", "phone-two"]);
    expect(validatePeopleOsData(await readAllData(db)).contactMethods).toHaveLength(3);
    db.close();
  });

  it("edits through revision checks and preserves stable identity", async () => {
    const db = await databaseWithPerson("edit");
    const original = await addContactMethod(db, {
      id: "email-one", personId: "person-sarah", kind: "email", value: "old@example.com", createdAt: fixedNow
    }, "GB");
    const edited = await editContactMethod(db, {
      id: original.id, expectedRevision: 1, kind: "email", value: " New@Example.COM ", label: "NHS email"
    }, "GB", "2026-08-02T09:00:00.000Z");
    expect(edited).toMatchObject({
      id: original.id,
      personId: original.personId,
      revision: 2,
      rawValue: "New@Example.COM",
      canonicalValue: "new@example.com",
      createdAt: original.createdAt
    });
    await expect(editContactMethod(db, {
      id: original.id, expectedRevision: 1, kind: "email", value: "stale@example.com"
    }, "GB")).rejects.toBeInstanceOf(StaleRevisionError);
    db.close();
  });

  it("requires explicit review before a contact value is shared by active People", async () => {
    const db = await databaseWithPerson("duplicate-review");
    const repositories = createRepositories(db);
    await repositories.people.create({
      id: "person-aaron",
      revision: 1,
      displayName: "Aaron Patel",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await addContactMethod(db, {
      id: "email-aaron", personId: "person-aaron", kind: "email", value: "shared@example.com", createdAt: fixedNow
    }, "GB");
    const candidate = {
      id: "email-sarah", personId: "person-sarah", kind: "email" as const, value: " Shared@Example.com ", createdAt: fixedNow
    };

    await expect(addContactMethod(db, candidate, "GB", {
      enforceDuplicateReview: true
    })).rejects.toMatchObject({
      name: "DuplicateReviewRequiredError",
      matches: [expect.objectContaining({ person: expect.objectContaining({ id: "person-aaron" }) })]
    });
    expect(await db.get("contactMethods", candidate.id)).toBeUndefined();

    const saved = await addContactMethod(db, candidate, "GB", {
      enforceDuplicateReview: true,
      acknowledgedDuplicatePersonIds: ["person-aaron"]
    });
    expect(saved).toMatchObject({ personId: "person-sarah", canonicalValue: "shared@example.com" });
  });

  it("applies the same duplicate guard when an existing contact method is edited", async () => {
    const db = await databaseWithPerson("duplicate-edit-review");
    const repositories = createRepositories(db);
    await repositories.people.create({
      id: "person-aaron",
      revision: 1,
      displayName: "Aaron Patel",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await addContactMethod(db, {
      id: "email-aaron", personId: "person-aaron", kind: "email", value: "shared@example.com", createdAt: fixedNow
    }, "GB");
    const sarah = await addContactMethod(db, {
      id: "email-sarah", personId: "person-sarah", kind: "email", value: "unique@example.com", createdAt: fixedNow
    }, "GB");

    await expect(editContactMethod(db, {
      id: sarah.id,
      expectedRevision: sarah.revision,
      kind: "email",
      value: "shared@example.com"
    }, "GB", fixedNow, { enforceDuplicateReview: true })).rejects.toMatchObject({
      name: "DuplicateReviewRequiredError"
    });
    expect((await db.get("contactMethods", sarah.id))?.canonicalValue).toBe("unique@example.com");

    const saved = await editContactMethod(db, {
      id: sarah.id,
      expectedRevision: sarah.revision,
      kind: "email",
      value: "shared@example.com"
    }, "GB", fixedNow, {
      enforceDuplicateReview: true,
      acknowledgedDuplicatePersonIds: ["person-aaron"]
    });
    expect(saved).toMatchObject({ revision: 2, canonicalValue: "shared@example.com" });
  });

  it("changes preference atomically and archives without selecting a replacement", async () => {
    const db = await databaseWithPerson("preference");
    await addContactMethod(db, {
      id: "email-one", personId: "person-sarah", kind: "email", value: "one@example.com", createdAt: fixedNow
    }, "GB");
    const second = await addContactMethod(db, {
      id: "email-two", personId: "person-sarah", kind: "email", value: "two@example.com", createdAt: fixedNow
    }, "GB");
    await setPreferredContactMethod(db, second.id, second.revision, "2026-08-02T09:00:00.000Z");
    const afterPreference = await listContactMethodsForPerson(db, "person-sarah");
    expect(afterPreference.map((record) => [record.id, record.isPreferred])).toEqual([
      ["email-two", true], ["email-one", false]
    ]);
    const preferred = afterPreference[0];
    const archived = await archiveContactMethod(db, preferred.id, preferred.revision, "2026-08-03T09:00:00.000Z");
    const all = await listContactMethodsForPerson(db, "person-sarah", true);
    expect(all.find((record) => record.id === "email-two")).toMatchObject({ isPreferred: false, archivedAt: "2026-08-03T09:00:00.000Z" });
    expect(all.find((record) => record.id === "email-one")?.isPreferred).toBe(false);
    const restored = await restoreContactMethod(db, archived.id, archived.revision, true, "2026-08-04T09:00:00.000Z");
    expect(restored).toMatchObject({ id: "email-two", isPreferred: true, revision: 4 });
    expect(restored.archivedAt).toBeUndefined();
    db.close();
  });

  it("rolls back an add failure and leaves no contact method behind", async () => {
    const db = await databaseWithPerson("rollback");
    await expect(addContactMethod(db, {
      id: "email-rollback", personId: "person-sarah", kind: "email", value: "sarah@example.com", createdAt: fixedNow
    }, "GB", { beforeCommit: () => { throw new Error("simulated failure"); } })).rejects.toThrow("simulated failure");
    expect(await db.count("contactMethods")).toBe(0);
    db.close();
  });
});
