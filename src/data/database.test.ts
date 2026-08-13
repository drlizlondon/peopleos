import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_SCHEMA_VERSION,
  DEFAULT_CONVERSATION_STARTERS,
  type AppSettings
} from "../domain/schema";
import { createDefaultSettings, deletePeopleOsDatabase, openPeopleOsDatabase, readAllData } from "./database";
import { createAppendOnlyRecord, createRepositories, RecordConflictError, StaleRevisionError } from "./repositories";
import { completeData, fixedNow } from "../test/fixtures";
import { previewBackup, restoreBackup } from "./backup";

const names = new Set<string>();

function databaseName(label: string): string {
  const name = `peopleos-test-${label}-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

afterEach(async () => {
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("PeopleOS IndexedDB foundation", () => {
  it("migrates missing relationship modes once and preserves an existing classification", async () => {
    const name = databaseName("relationship-mode-migration");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("people", { keyPath: "id" });
        database.createObjectStore("appSettings", { keyPath: "id" });
        database.createObjectStore("metadata", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("people", "readwrite");
        const store = transaction.objectStore("people");
        const base = { revision: 1, identityStatus: "confirmed", importance: "normal", tags: [], createdAt: fixedNow, updatedAt: fixedNow };
        store.add({ ...base, id: "legacy", displayName: "Legacy" });
        store.add({ ...base, id: "assigned", displayName: "Assigned", relationshipMode: "professional" });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    const migrated = await openPeopleOsDatabase(name, fixedNow);
    expect((await migrated.get("people", "legacy"))?.relationshipMode).toBe("personal");
    expect((await migrated.get("people", "assigned"))?.relationshipMode).toBe("professional");
    migrated.close();

    const reopened = await openPeopleOsDatabase(name, fixedNow);
    expect((await reopened.get("people", "assigned"))?.relationshipMode).toBe("professional");
    reopened.close();
  });

  it("creates every V1 store and deterministic singleton defaults", async () => {
    const db = await openPeopleOsDatabase(databaseName("schema"), fixedNow);
    expect(Array.from(db.objectStoreNames)).toEqual([
      "affiliations", "appSettings", "contactMethods", "events", "externalIdentities", "followUpEvents",
      "followUps", "interactions", "memoryFacts", "metadata", "people",
      "reachOutContexts", "reachOutEntries", "reachOutEvents", "syncOutbox", "syncRecords",
      "syncState", "syncTombstones", "todaySkips"
    ]);
    const settings = await db.get("appSettings", "app");
    expect(settings).toMatchObject({
      id: "app",
      captureMode: "standard",
      alreadyContactedDefaultReminderDays: 14,
      todaySummaryNotificationsEnabled: false,
      todaySummaryNotificationTime: "12:00",
      conversationStarters: DEFAULT_CONVERSATION_STARTERS,
      revision: 1
    });
    expect(settings?.reachOutDefaultReminderDays).toBeUndefined();
    db.close();
  });

  it("preserves stable IDs across idempotent retry and rejects conflicting reuse", async () => {
    const db = await openPeopleOsDatabase(databaseName("idempotency"), fixedNow);
    const people = createRepositories(db).people;
    const person = {
      id: "person-stable", revision: 1, displayName: "Stable Person", identityStatus: "confirmed" as const,
      importance: "normal" as const, tags: [], createdAt: fixedNow, updatedAt: fixedNow
    };
    await people.create(person);
    await people.create(person);
    expect(await people.list()).toEqual([{ ...person, relationshipMode: "personal" }]);
    await expect(people.create({ ...person, displayName: "Different" })).rejects.toBeInstanceOf(RecordConflictError);
    db.close();
  });

  it("rejects stale updates and supports safe archive and restore", async () => {
    const db = await openPeopleOsDatabase(databaseName("revision"), fixedNow);
    const people = createRepositories(db).people;
    const person = {
      id: "person-revision", revision: 1, displayName: "Revision Person", identityStatus: "confirmed" as const,
      importance: "normal" as const, tags: [], createdAt: fixedNow, updatedAt: fixedNow
    };
    await people.create(person);
    const archived = await people.archive(person.id, 1, "2026-08-02T09:00:00.000Z");
    expect(archived).toMatchObject({ revision: 2, archivedAt: "2026-08-02T09:00:00.000Z" });
    await expect(people.update({ ...archived, displayName: "Stale" }, 1)).rejects.toBeInstanceOf(StaleRevisionError);
    const restored = await people.restore(person.id, 2, "2026-08-03T09:00:00.000Z");
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.revision).toBe(3);
    db.close();
  });

  it("requires a Person before writing a child record", async () => {
    const db = await openPeopleOsDatabase(databaseName("child"), fixedNow);
    const contacts = createRepositories(db).contactMethods;
    await expect(contacts.create({
      id: "contact-orphan", revision: 1, personId: "missing", kind: "email", rawValue: "x@example.com",
      canonicalValue: "x@example.com", isPreferred: true, createdAt: fixedNow, updatedAt: fixedNow
    })).rejects.toThrow(/missing person/);
    db.close();
  });

  it("rehydrates persisted records after closing and reopening", async () => {
    const name = databaseName("rehydrate");
    const first = await openPeopleOsDatabase(name, fixedNow);
    await createRepositories(first).people.create({
      id: "person-reload", revision: 1, displayName: "Reload Person", identityStatus: "confirmed",
      importance: "normal", tags: [], createdAt: fixedNow, updatedAt: fixedNow
    });
    first.close();
    const reopened = await openPeopleOsDatabase(name, fixedNow);
    expect((await readAllData(reopened)).people.map((person) => person.id)).toEqual(["person-reload"]);
    reopened.close();
  });

  it("uses the same deterministic Settings shape when called directly", () => {
    const first = createDefaultSettings(fixedNow);
    const second = createDefaultSettings(fixedNow);
    expect(first).toMatchObject({
      id: "app",
      captureMode: "standard",
      alreadyContactedDefaultReminderDays: 14,
      todaySummaryNotificationsEnabled: false,
      todaySummaryNotificationTime: "12:00",
      conversationStarters: DEFAULT_CONVERSATION_STARTERS,
      revision: 1
    });
    expect(first.conversationStarters).not.toBe(second.conversationStarters);
    expect(first.conversationStarters[0]).not.toBe(second.conversationStarters[0]);
  });

  it("migrates an existing Settings singleton once without changing its other fields or metadata", async () => {
    const name = databaseName("settings-migration");
    const first = await openPeopleOsDatabase(name, fixedNow);
    const metadata = await first.get("metadata", "app");
    const legacy = {
      id: "app" as const,
      defaultPhoneRegion: "FR",
      captureMode: "networking" as const,
      reachOutDefaultReminderDays: 30 as const,
      revision: 7,
      createdAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-02T08:00:00.000Z"
    };
    await first.put("appSettings", legacy as AppSettings);
    first.close();

    const migratedDb = await openPeopleOsDatabase(name, "2026-08-02T09:00:00.000Z");
    const migrated = await migratedDb.get("appSettings", "app");
    expect(migrated).toEqual({
      ...legacy,
      alreadyContactedDefaultReminderDays: 14,
      todaySummaryNotificationsEnabled: false,
      todaySummaryNotificationTime: "12:00",
      conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter }))
    });
    expect(await migratedDb.get("metadata", "app")).toEqual(metadata);
    migratedDb.close();

    const reopened = await openPeopleOsDatabase(name, "2026-08-03T09:00:00.000Z");
    expect(await reopened.get("appSettings", "app")).toEqual(migrated);
    expect(await reopened.get("metadata", "app")).toEqual(metadata);
    reopened.close();
  });

  it("prevents concurrent Settings edits from overwriting one another", async () => {
    const db = await openPeopleOsDatabase(databaseName("settings-revision"), fixedNow);
    const settings = createRepositories(db).appSettings;
    const current = await settings.get("app");
    expect(current).toBeDefined();
    const results = await Promise.allSettled([
      settings.update({ ...current!, captureMode: "networking" }, 1, "2026-08-02T09:00:00.000Z"),
      settings.update({ ...current!, reachOutDefaultReminderDays: 14 }, 1, "2026-08-02T09:00:01.000Z")
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")?.reason).toBeInstanceOf(StaleRevisionError);
    expect((await settings.get("app"))?.revision).toBe(2);
    db.close();
  });

  it("stores lifecycle and skip records append-only with idempotent retry", async () => {
    const db = await openPeopleOsDatabase(databaseName("append-only"), fixedNow);
    const data = completeData();
    await restoreBackup(db, previewBackup({ product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: fixedNow, data }), fixedNow);
    await createAppendOnlyRecord(db, "todaySkips", data.todaySkips[0]);
    await createAppendOnlyRecord(db, "followUpEvents", data.followUpEvents[0]);
    expect(await db.count("todaySkips")).toBe(1);
    expect(await db.count("followUpEvents")).toBe(1);
    await expect(createAppendOnlyRecord(db, "followUpEvents", {
      ...data.followUpEvents[0],
      toDate: "2026-08-09"
    })).rejects.toBeInstanceOf(RecordConflictError);
    db.close();
  });
});
