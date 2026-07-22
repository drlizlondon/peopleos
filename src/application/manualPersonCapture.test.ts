import { afterEach, describe, expect, it } from "vitest";
import { generateBackup, previewBackup, restoreBackup } from "../data/backup";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { RecordConflictError } from "../data/repositories";
import { fixedNow } from "../test/fixtures";
import {
  captureManualPerson,
  createManualPersonCaptureDraft,
  prepareManualPersonCapture,
  savePreparedManualPersonCapture,
  type ManualPersonCaptureDraft
} from "./manualPersonCapture";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function databaseName(label: string): string {
  const name = `peopleos-capture-${label}-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

async function openDatabase(name: string): Promise<PeopleOsDatabase> {
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  return db;
}

function draft(overrides: Partial<ManualPersonCaptureDraft> = {}): ManualPersonCaptureDraft {
  return {
    ...createManualPersonCaptureDraft({
      now: fixedNow,
      idFactory: (() => {
        let index = 0;
        return () => `stable-${++index}`;
      })()
    }),
    displayName: "Sarah Ahmed",
    ...overrides
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("manual Person capture", () => {
  it("rejects a labelled contact row without a value instead of silently dropping it", () => {
    expect(() => prepareManualPersonCapture(draft({
      contactMethods: [{ id: "contact-labelled-empty", kind: "phone", value: "", label: "Assistant's number" }]
    }), "GB")).toThrow(/phone number or remove its labelled row/);
  });

  it("uses a contact row's selected region for ambiguous national input", () => {
    const prepared = prepareManualPersonCapture(draft({
      contactMethods: [{ id: "contact-us", kind: "phone", value: "202 555 0123", region: "US" }]
    }), "GB");
    expect(prepared.contactMethods[0]).toMatchObject({
      canonicalValue: "+12025550123",
      region: "US"
    });
  });

  it("creates a name-only confirmed Person and a descriptive provisional Person", async () => {
    const db = await openDatabase(databaseName("minimal"));
    const named = await captureManualPerson(db, draft(), "GB");
    const provisionalDraft = draft({
      personId: "person-provisional",
      affiliationId: "affiliation-provisional",
      metInteractionId: "interaction-provisional",
      displayName: "Chief Information Officer at Watford",
      identityStatus: "provisional"
    });
    const provisional = await captureManualPerson(db, provisionalDraft, "GB");

    expect(named.person).toMatchObject({ displayName: "Sarah Ahmed", identityStatus: "confirmed" });
    expect(provisional.person).toMatchObject({ id: "person-provisional", identityStatus: "provisional" });
    expect(await db.count("people")).toBe(2);
    expect(await db.count("contactMethods")).toBe(0);
    db.close();
  });

  it("atomically creates multiple same-kind contacts, first affiliation and met history", async () => {
    const db = await openDatabase(databaseName("full"));
    const result = await captureManualPerson(db, draft({
      organisationName: "NHS England",
      role: "Clinical Fellow",
      whereMet: "AI Fellowship",
      contactMethods: [
        { id: "phone-personal", kind: "phone", value: "07900 123456", label: "Personal mobile" },
        { id: "phone-work", kind: "phone", value: "+44 7912 123456", label: "Work mobile" },
        { id: "email-nhs", kind: "email", value: " Sarah@NHS.NET ", label: "NHS email" }
      ]
    }), "GB");

    expect(result.contactMethods).toHaveLength(3);
    expect(result.contactMethods.filter((record) => record.kind === "phone").map((record) => record.isPreferred)).toEqual([true, false]);
    expect(result.contactMethods[2]).toMatchObject({ rawValue: "Sarah@NHS.NET", canonicalValue: "sarah@nhs.net", isPreferred: true });
    expect(result.affiliation).toMatchObject({ organisationName: "NHS England", role: "Clinical Fellow", isCurrent: true });
    expect(result.metInteraction).toMatchObject({ kind: "met", summary: "AI Fellowship", occurredAt: fixedNow });
    const persisted = await readAllData(db);
    expect(persisted.people.map((record) => record.id)).toEqual([result.person.id]);
    expect(persisted.contactMethods.map((record) => record.id).sort()).toEqual(["email-nhs", "phone-personal", "phone-work"]);
    expect(persisted.affiliations.map((record) => record.id)).toEqual([result.affiliation?.id]);
    expect(persisted.interactions.map((record) => record.id)).toEqual([result.metInteraction?.id]);
    db.close();
  });

  it("uses stable draft IDs and makes an identical retry a no-op", async () => {
    const db = await openDatabase(databaseName("retry"));
    const prepared = prepareManualPersonCapture(draft({
      contactMethods: [{ id: "contact-stable", kind: "email", value: "sarah@example.com" }]
    }), "GB");
    const metadataBefore = await db.get("metadata", "app");
    await savePreparedManualPersonCapture(db, prepared);
    const metadataAfterFirst = await db.get("metadata", "app");
    await savePreparedManualPersonCapture(db, prepared);
    const metadataAfterRetry = await db.get("metadata", "app");

    expect(await db.count("people")).toBe(1);
    expect(await db.count("contactMethods")).toBe(1);
    expect(metadataAfterFirst?.datasetRevision).toBe((metadataBefore?.datasetRevision ?? 0) + 1);
    expect(metadataAfterRetry).toEqual(metadataAfterFirst);
    await expect(savePreparedManualPersonCapture(db, {
      ...prepared,
      person: { ...prepared.person, displayName: "Different" }
    })).rejects.toBeInstanceOf(RecordConflictError);
    db.close();
  });

  it("checks duplicate evidence inside the creation transaction and requires each match to be acknowledged", async () => {
    const db = await openDatabase(databaseName("duplicate-guard"));
    const existing = prepareManualPersonCapture(draft({
      personId: "person-existing",
      affiliationId: "affiliation-existing",
      metInteractionId: "interaction-existing",
      contactMethods: [{ id: "contact-existing", kind: "email", value: "shared@example.com" }]
    }), "GB");
    await savePreparedManualPersonCapture(db, existing);
    const candidate = prepareManualPersonCapture(draft({
      personId: "person-candidate",
      affiliationId: "affiliation-candidate",
      metInteractionId: "interaction-candidate",
      displayName: "Another Sarah",
      contactMethods: [{ id: "contact-candidate", kind: "email", value: "Shared@Example.com" }]
    }), "GB");

    await expect(savePreparedManualPersonCapture(db, candidate, {
      enforceDuplicateReview: true
    })).rejects.toMatchObject({
      name: "DuplicateReviewRequiredError",
      matches: [expect.objectContaining({ person: expect.objectContaining({ id: "person-existing" }) })]
    });
    expect(await db.get("people", candidate.person.id)).toBeUndefined();

    await savePreparedManualPersonCapture(db, candidate, {
      enforceDuplicateReview: true,
      acknowledgedDuplicatePersonIds: ["person-existing"]
    });
    expect(await db.get("people", candidate.person.id)).toEqual(candidate.person);
  });

  it("rolls back every child when an atomic write fails before commit", async () => {
    const db = await openDatabase(databaseName("rollback"));
    const prepared = prepareManualPersonCapture(draft({
      organisationName: "NHS England",
      whereMet: "AI Fellowship",
      contactMethods: [{ id: "contact-rollback", kind: "phone", value: "07900 123456" }]
    }), "GB");
    await expect(savePreparedManualPersonCapture(db, prepared, {
      beforeCommit: () => { throw new Error("simulated failed write"); }
    })).rejects.toThrow("simulated failed write");
    expect(await db.count("people")).toBe(0);
    expect(await db.count("contactMethods")).toBe(0);
    expect(await db.count("affiliations")).toBe(0);
    expect(await db.count("interactions")).toBe(0);
    db.close();
  });

  it("rejects malformed prepared children before a transaction can create an orphan", async () => {
    const db = await openDatabase(databaseName("prepared-owner"));
    const prepared = prepareManualPersonCapture(draft({
      contactMethods: [{ id: "contact-wrong-owner", kind: "email", value: "sarah@example.com" }]
    }), "GB");
    prepared.contactMethods[0] = { ...prepared.contactMethods[0], personId: "person-someone-else" };
    await expect(savePreparedManualPersonCapture(db, prepared)).rejects.toThrow(/must belong to the captured Person/);
    expect(await db.count("people")).toBe(0);
    expect(await db.count("contactMethods")).toBe(0);
  });

  it("survives rehydration and the existing backup/restore path", async () => {
    const originalName = databaseName("backup-source");
    const restoredName = databaseName("backup-target");
    const original = await openDatabase(originalName);
    const saved = await captureManualPerson(original, draft({
      contactMethods: [{ id: "contact-backup", kind: "email", value: "Sarah@Example.com" }]
    }), "GB");
    original.close();

    const reopened = await openDatabase(originalName);
    expect(await reopened.get("people", saved.person.id)).toEqual(saved.person);
    const backup = await generateBackup(reopened, fixedNow);
    const restored = await openDatabase(restoredName);
    await restoreBackup(restored, previewBackup(backup.json), fixedNow);
    expect(await restored.get("people", saved.person.id)).toEqual(saved.person);
    expect(await restored.get("contactMethods", "contact-backup")).toEqual(saved.contactMethods[0]);
    reopened.close();
    restored.close();
  });
});
