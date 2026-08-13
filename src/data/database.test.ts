import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_SCHEMA_VERSION,
  DATABASE_VERSION,
  DEFAULT_CONVERSATION_STARTERS,
  type AppSettings
} from "../domain/schema";
import { createDefaultSettings, deletePeopleOsDatabase, openPeopleOsDatabase, readAllData } from "./database";
import { createAppendOnlyRecord, createRepositories, RecordConflictError, StaleRevisionError } from "./repositories";
import { completeData, fixedNow } from "../test/fixtures";
import { previewBackup, restoreBackup } from "./backup";
import { regularContactSetupState } from "../domain/regularContactSchedule";
import { legacyInitialScheduleIds } from "./legacyCompatibility";

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

async function createOriginMainV3Database(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      const people = database.createObjectStore("people", { keyPath: "id" });
      people.createIndex("by-updated", "updatedAt");
      const contacts = database.createObjectStore("contactMethods", { keyPath: "id" });
      contacts.createIndex("by-person", "personId");
      contacts.createIndex("by-canonical", "canonicalValue");
      const affiliations = database.createObjectStore("affiliations", { keyPath: "id" });
      affiliations.createIndex("by-person", "personId");
      affiliations.createIndex("by-organisation", "organisationName");
      const interactions = database.createObjectStore("interactions", { keyPath: "id" });
      interactions.createIndex("by-person", "personId");
      interactions.createIndex("by-event", "eventId");
      interactions.createIndex("by-occurred", "occurredAt");
      database.createObjectStore("events", { keyPath: "id" }).createIndex("by-name", "name");
      const facts = database.createObjectStore("memoryFacts", { keyPath: "id" });
      facts.createIndex("by-person", "personId");
      facts.createIndex("by-kind", "kind");
      const followUps = database.createObjectStore("followUps", { keyPath: "id" });
      followUps.createIndex("by-person", "personId");
      followUps.createIndex("by-due", "dueDate");
      followUps.createIndex("by-status", "status");
      followUps.createIndex("by-reach-out", "reachOutEntryId");
      const followUpEvents = database.createObjectStore("followUpEvents", { keyPath: "id" });
      followUpEvents.createIndex("by-follow-up", "followUpId");
      followUpEvents.createIndex("by-person", "personId");
      followUpEvents.createIndex("by-occurred", "occurredAt");
      const skips = database.createObjectStore("todaySkips", { keyPath: "id" });
      skips.createIndex("by-person", "personId");
      skips.createIndex("by-local-date", "localDate");
      const reachOut = database.createObjectStore("reachOutEntries", { keyPath: "id" });
      reachOut.createIndex("by-person", "personId");
      reachOut.createIndex("by-status", "intentStatus");
      reachOut.createIndex("by-updated", "updatedAt");
      const reachOutEvents = database.createObjectStore("reachOutEvents", { keyPath: "id" });
      reachOutEvents.createIndex("by-entry", "reachOutEntryId");
      reachOutEvents.createIndex("by-occurred", "occurredAt");
      const contexts = database.createObjectStore("reachOutContexts", { keyPath: "id" });
      contexts.createIndex("by-kind", "kind");
      contexts.createIndex("by-label", "label");
      database.createObjectStore("appSettings", { keyPath: "id" });
      database.createObjectStore("metadata", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction([
        "people",
        "contactMethods",
        "events",
        "appSettings",
        "metadata"
      ], "readwrite");
      const base = {
        revision: 3,
        identityStatus: "confirmed",
        relationshipMode: "personal",
        importance: "normal",
        tags: [],
        createdAt: "2026-07-01T09:00:00.000Z",
        updatedAt: "2026-07-02T09:00:00.000Z"
      };
      transaction.objectStore("people").add({
        ...base,
        id: "main-active",
        displayName: "Main Active",
        contactCadenceDays: 14,
        contactCadenceFirstDueDate: "2026-08-20",
        contactCadenceDeferredUntilDate: "2026-08-25",
        todayNote: "Ask about the new role."
      });
      transaction.objectStore("people").add({
        ...base,
        id: "main-paused",
        displayName: "Main Paused",
        contactCadenceDays: 7,
        contactCadenceFirstDueDate: "2026-08-18",
        contactCadencePausedAt: "2026-08-10T09:00:00.000Z",
        todayNote: "Wait until they are ready.",
        todayNoteCompletedAt: "2026-08-11T09:00:00.000Z"
      });
      transaction.objectStore("contactMethods").add({
        id: "main-phone",
        revision: 2,
        personId: "main-active",
        kind: "phone",
        rawValue: "07900 000000",
        canonicalValue: "+447900000000",
        region: "GB",
        isPreferred: true,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      transaction.objectStore("events").add({
        id: "main-event",
        revision: 1,
        name: "Main history event",
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      transaction.objectStore("appSettings").add({
        id: "app",
        revision: 7,
        defaultPhoneRegion: "FR",
        captureMode: "networking",
        alreadyContactedDefaultReminderDays: 21,
        reachOutDefaultReminderDays: 30,
        relationshipContexts: ["professional"],
        createdAt: "2026-07-01T08:00:00.000Z",
        updatedAt: "2026-07-02T08:00:00.000Z"
      });
      transaction.objectStore("metadata").add({
        id: "app",
        datasetRevision: 9,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

async function createRcLineV3Database(name: string) {
  const person = {
    id: "rc-person",
    revision: 4,
    displayName: "RC Person",
    identityStatus: "confirmed",
    relationshipMode: "professional",
    importance: "high",
    tags: ["mentor"],
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-02T08:00:00.000Z"
  };
  const identity = {
    id: "rc-identity",
    revision: 2,
    personId: person.id,
    provider: "linkedin",
    externalId: "linkedin-rc-person",
    profileUrl: "https://www.linkedin.com/in/rc-person",
    linkedAt: "2026-08-01T09:00:00.000Z",
    lastSyncedAt: "2026-08-02T09:00:00.000Z",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z"
  };
  const settings = {
    id: "app",
    defaultPhoneRegion: "IE",
    captureMode: "networking",
    alreadyContactedDefaultReminderDays: 21,
    reachOutDefaultReminderDays: 14,
    todaySummaryNotificationsEnabled: true,
    todaySummaryNotificationTime: "09:30",
    conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter })),
    revision: 8,
    createdAt: "2026-08-01T07:00:00.000Z",
    updatedAt: "2026-08-02T07:00:00.000Z"
  };
  const metadata = {
    id: "app",
    datasetRevision: 42,
    createdAt: "2026-08-01T07:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z"
  };
  const syncRecord = {
    key: `people:${person.id}`,
    store: "people",
    entityId: person.id,
    status: "synced",
    localRevision: person.revision,
    localUpdatedAt: person.updatedAt,
    localFingerprint: "rc-person-fingerprint",
    acknowledgedRemoteRevision: person.revision,
    acknowledgedRemoteUpdatedAt: person.updatedAt,
    cloudRecordName: "cGVvcGxlOnJjLXBlcnNvbg",
    changeTag: "rc-change-tag",
    systemFields: "rc-system-fields",
    retryCount: 0,
    acknowledgedAt: "2026-08-02T10:01:00.000Z"
  };
  const syncOutbox = {
    id: "externalIdentities:rc-identity:2",
    key: `externalIdentities:${identity.id}`,
    kind: "save",
    store: "externalIdentities",
    entityId: identity.id,
    cloudRecordName: "ZXh0ZXJuYWxJZGVudGl0aWVzOnJjLWlkZW50aXR5",
    schemaVersion: 1,
    revision: identity.revision,
    updatedAt: identity.updatedAt,
    originDeviceId: "rc-installation",
    payload: { ...identity },
    attemptCount: 1,
    nextAttemptAt: "2026-08-03T08:00:00.000Z",
    createdAt: "2026-08-02T10:02:00.000Z",
    updatedOperationAt: "2026-08-02T10:03:00.000Z"
  };
  const syncTombstone = {
    key: "contactMethods:rc-removed-contact",
    store: "contactMethods",
    entityId: "rc-removed-contact",
    cloudRecordName: "Y29udGFjdE1ldGhvZHM6cmMtcmVtb3ZlZC1jb250YWN0",
    deletedAt: "2026-08-02T11:00:00.000Z",
    originDeviceId: "rc-installation",
    acknowledgedAt: "2026-08-02T11:01:00.000Z",
    retainUntil: "2027-02-01T11:00:00.000Z"
  };
  const syncState = {
    id: "app",
    enabled: true,
    installationId: "rc-installation",
    changeToken: "rc-change-token",
    initialMigrationPhase: "complete",
    lastScannedDatasetRevision: metadata.datasetRevision,
    lastAttemptedSyncAt: "2026-08-02T12:00:00.000Z",
    lastSuccessfulSyncAt: "2026-08-02T12:01:00.000Z",
    retryCount: 0,
    accountStatus: "available"
  };

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      const people = database.createObjectStore("people", { keyPath: "id" });
      people.createIndex("by-updated", "updatedAt");
      const contacts = database.createObjectStore("contactMethods", { keyPath: "id" });
      contacts.createIndex("by-person", "personId");
      contacts.createIndex("by-canonical", "canonicalValue");
      const identities = database.createObjectStore("externalIdentities", { keyPath: "id" });
      identities.createIndex("by-person", "personId");
      identities.createIndex("by-provider", "provider");
      const affiliations = database.createObjectStore("affiliations", { keyPath: "id" });
      affiliations.createIndex("by-person", "personId");
      affiliations.createIndex("by-organisation", "organisationName");
      const interactions = database.createObjectStore("interactions", { keyPath: "id" });
      interactions.createIndex("by-person", "personId");
      interactions.createIndex("by-event", "eventId");
      interactions.createIndex("by-occurred", "occurredAt");
      database.createObjectStore("events", { keyPath: "id" }).createIndex("by-name", "name");
      const facts = database.createObjectStore("memoryFacts", { keyPath: "id" });
      facts.createIndex("by-person", "personId");
      facts.createIndex("by-kind", "kind");
      const followUps = database.createObjectStore("followUps", { keyPath: "id" });
      followUps.createIndex("by-person", "personId");
      followUps.createIndex("by-due", "dueDate");
      followUps.createIndex("by-status", "status");
      followUps.createIndex("by-reach-out", "reachOutEntryId");
      const followUpEvents = database.createObjectStore("followUpEvents", { keyPath: "id" });
      followUpEvents.createIndex("by-follow-up", "followUpId");
      followUpEvents.createIndex("by-person", "personId");
      followUpEvents.createIndex("by-occurred", "occurredAt");
      const skips = database.createObjectStore("todaySkips", { keyPath: "id" });
      skips.createIndex("by-person", "personId");
      skips.createIndex("by-local-date", "localDate");
      const reachOut = database.createObjectStore("reachOutEntries", { keyPath: "id" });
      reachOut.createIndex("by-person", "personId");
      reachOut.createIndex("by-status", "intentStatus");
      reachOut.createIndex("by-updated", "updatedAt");
      const reachOutEvents = database.createObjectStore("reachOutEvents", { keyPath: "id" });
      reachOutEvents.createIndex("by-entry", "reachOutEntryId");
      reachOutEvents.createIndex("by-occurred", "occurredAt");
      const contexts = database.createObjectStore("reachOutContexts", { keyPath: "id" });
      contexts.createIndex("by-kind", "kind");
      contexts.createIndex("by-label", "label");
      database.createObjectStore("appSettings", { keyPath: "id" });
      database.createObjectStore("metadata", { keyPath: "id" });
      database.createObjectStore("syncRecords", { keyPath: "key" }).createIndex("by-status", "status");
      database.createObjectStore("syncOutbox", { keyPath: "id" }).createIndex("by-next-attempt", "nextAttemptAt");
      database.createObjectStore("syncTombstones", { keyPath: "key" }).createIndex("by-retain-until", "retainUntil");
      database.createObjectStore("syncState", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction([
        "people",
        "externalIdentities",
        "appSettings",
        "metadata",
        "syncRecords",
        "syncOutbox",
        "syncTombstones",
        "syncState"
      ], "readwrite");
      transaction.objectStore("people").add(person);
      transaction.objectStore("externalIdentities").add(identity);
      transaction.objectStore("appSettings").add(settings);
      transaction.objectStore("metadata").add(metadata);
      transaction.objectStore("syncRecords").add(syncRecord);
      transaction.objectStore("syncOutbox").add(syncOutbox);
      transaction.objectStore("syncTombstones").add(syncTombstone);
      transaction.objectStore("syncState").add(syncState);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });

  return { person, identity, settings, metadata, syncRecord, syncOutbox, syncTombstone, syncState };
}

describe("PeopleOS IndexedDB foundation", () => {
  it("upgrades an exact origin/main v3 database without losing data or reactivating an indefinite pause", async () => {
    const name = databaseName("origin-main-v3");
    await createOriginMainV3Database(name);

    const migrated = await openPeopleOsDatabase(name, "2026-08-13T09:00:00.000Z");
    expect(migrated.version).toBe(DATABASE_VERSION);
    expect(Array.from(migrated.objectStoreNames)).toEqual([
      "affiliations", "appSettings", "contactMethods", "events", "externalIdentities", "followUpEvents",
      "followUps", "interactions", "memoryFacts", "metadata", "people", "reachOutContexts",
      "reachOutEntries", "reachOutEvents", "syncOutbox", "syncRecords", "syncState",
      "syncTombstones", "todaySkips"
    ]);
    const schemaTx = migrated.transaction([
      "externalIdentities",
      "syncRecords",
      "syncOutbox",
      "syncTombstones"
    ], "readonly");
    expect(Array.from(schemaTx.objectStore("externalIdentities").indexNames)).toEqual([
      "by-person",
      "by-provider"
    ]);
    expect(Array.from(schemaTx.objectStore("syncRecords").indexNames)).toEqual(["by-status"]);
    expect(Array.from(schemaTx.objectStore("syncOutbox").indexNames)).toEqual(["by-next-attempt"]);
    expect(Array.from(schemaTx.objectStore("syncTombstones").indexNames)).toEqual(["by-retain-until"]);
    await schemaTx.done;

    expect(await migrated.get("contactMethods", "main-phone")).toMatchObject({
      personId: "main-active",
      canonicalValue: "+447900000000"
    });
    expect(await migrated.get("events", "main-event")).toMatchObject({ name: "Main history event" });
    expect(await migrated.get("metadata", "app")).toMatchObject({ datasetRevision: 9 });
    expect(await migrated.get("appSettings", "app")).toMatchObject({
      revision: 7,
      defaultPhoneRegion: "FR",
      captureMode: "networking",
      alreadyContactedDefaultReminderDays: 21,
      reachOutDefaultReminderDays: 30,
      relationshipContexts: ["professional"],
      todaySummaryNotificationsEnabled: false,
      todaySummaryNotificationTime: "12:00",
      conversationStarters: DEFAULT_CONVERSATION_STARTERS
    });
    expect(await migrated.get("syncState", "app")).toMatchObject({
      enabled: false,
      initialMigrationPhase: "notStarted"
    });

    const active = await migrated.get("people", "main-active");
    expect(active).toMatchObject({
      revision: 3,
      contactCadence: { value: 14, unit: "days" },
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-08-20",
      contactCadenceDeferredUntilDate: "2026-08-25",
      todayPausedUntilDate: "2026-08-25",
      todayNote: "Ask about the new role."
    });
    const activeIds = legacyInitialScheduleIds("main-active");
    expect(await migrated.get("followUps", activeIds.followUpId)).toMatchObject({
      personId: "main-active",
      dueDate: "2026-08-20",
      suggestedByRule: "initial_schedule",
      status: "pending"
    });
    expect(await migrated.get("followUpEvents", activeIds.followUpEventId)).toMatchObject({
      followUpId: activeIds.followUpId,
      kind: "created",
      toDate: "2026-08-20"
    });
    expect(await migrated.count("interactions")).toBe(0);

    const paused = await migrated.get("people", "main-paused");
    expect(paused).toMatchObject({
      contactCadence: { value: 7, unit: "days" },
      contactCadenceFirstDueDate: "2026-08-18",
      contactCadencePausedAt: "2026-08-10T09:00:00.000Z",
      todayNote: "Wait until they are ready.",
      todayNoteCompletedAt: "2026-08-11T09:00:00.000Z"
    });
    expect(await migrated.get("followUps", legacyInitialScheduleIds("main-paused").followUpId)).toBeUndefined();
    expect(regularContactSetupState(paused!, [], [])).toBe("incomplete");
    migrated.close();

    const reopened = await openPeopleOsDatabase(name, "2026-08-14T09:00:00.000Z");
    expect(await reopened.count("followUps")).toBe(1);
    expect(await reopened.count("followUpEvents")).toBe(1);
    expect(await reopened.get("people", "main-active")).toEqual(active);
    reopened.close();
  });

  it("upgrades the exact RC-line v3 schema without replacing its Contacts or sync state", async () => {
    const name = databaseName("rc-line-v3");
    const seeded = await createRcLineV3Database(name);

    const migrated = await openPeopleOsDatabase(name, "2026-08-13T09:00:00.000Z");
    expect(migrated.version).toBe(DATABASE_VERSION);
    expect(Array.from(migrated.objectStoreNames)).toEqual([
      "affiliations", "appSettings", "contactMethods", "events", "externalIdentities", "followUpEvents",
      "followUps", "interactions", "memoryFacts", "metadata", "people", "reachOutContexts",
      "reachOutEntries", "reachOutEvents", "syncOutbox", "syncRecords", "syncState",
      "syncTombstones", "todaySkips"
    ]);

    const expectedIndexes = {
      affiliations: ["by-organisation", "by-person"],
      contactMethods: ["by-canonical", "by-person"],
      events: ["by-name"],
      externalIdentities: ["by-person", "by-provider"],
      followUpEvents: ["by-follow-up", "by-occurred", "by-person"],
      followUps: ["by-due", "by-person", "by-reach-out", "by-status"],
      interactions: ["by-event", "by-occurred", "by-person"],
      memoryFacts: ["by-kind", "by-person"],
      people: ["by-updated"],
      reachOutContexts: ["by-kind", "by-label"],
      reachOutEntries: ["by-person", "by-status", "by-updated"],
      reachOutEvents: ["by-entry", "by-occurred"],
      syncOutbox: ["by-next-attempt"],
      syncRecords: ["by-status"],
      syncTombstones: ["by-retain-until"],
      todaySkips: ["by-local-date", "by-person"]
    } as const;
    const schemaTx = migrated.transaction(Object.keys(expectedIndexes) as Array<keyof typeof expectedIndexes>, "readonly");
    for (const [storeName, indexNames] of Object.entries(expectedIndexes)) {
      expect(Array.from(schemaTx.objectStore(storeName as keyof typeof expectedIndexes).indexNames)).toEqual(indexNames);
    }
    await schemaTx.done;

    expect(await migrated.get("people", seeded.person.id)).toEqual(seeded.person);
    expect(await migrated.get("externalIdentities", seeded.identity.id)).toEqual(seeded.identity);
    expect(await migrated.get("metadata", "app")).toEqual(seeded.metadata);
    expect(await migrated.get("syncRecords", seeded.syncRecord.key)).toEqual(seeded.syncRecord);
    expect(await migrated.get("syncOutbox", seeded.syncOutbox.id)).toEqual(seeded.syncOutbox);
    expect(await migrated.get("syncTombstones", seeded.syncTombstone.key)).toEqual(seeded.syncTombstone);
    expect(await migrated.get("syncState", "app")).toEqual(seeded.syncState);
    expect(await migrated.get("appSettings", "app")).toEqual({
      ...seeded.settings,
      relationshipContexts: ["personal", "professional"]
    });
    expect(await migrated.getAllFromIndex("externalIdentities", "by-provider", "linkedin")).toEqual([seeded.identity]);
    expect(await migrated.getAllFromIndex("syncRecords", "by-status", "synced")).toEqual([seeded.syncRecord]);
    expect(await migrated.getAllFromIndex(
      "syncOutbox",
      "by-next-attempt",
      IDBKeyRange.upperBound(seeded.syncOutbox.nextAttemptAt)
    )).toEqual([seeded.syncOutbox]);
    expect(await migrated.getAllFromIndex(
      "syncTombstones",
      "by-retain-until",
      IDBKeyRange.only(seeded.syncTombstone.retainUntil)
    )).toEqual([seeded.syncTombstone]);

    const migratedSnapshot = {
      identity: await migrated.get("externalIdentities", seeded.identity.id),
      settings: await migrated.get("appSettings", "app"),
      syncRecord: await migrated.get("syncRecords", seeded.syncRecord.key),
      syncOutbox: await migrated.get("syncOutbox", seeded.syncOutbox.id),
      syncTombstone: await migrated.get("syncTombstones", seeded.syncTombstone.key),
      syncState: await migrated.get("syncState", "app")
    };
    migrated.close();

    const reopened = await openPeopleOsDatabase(name, "2026-08-14T09:00:00.000Z");
    expect({
      identity: await reopened.get("externalIdentities", seeded.identity.id),
      settings: await reopened.get("appSettings", "app"),
      syncRecord: await reopened.get("syncRecords", seeded.syncRecord.key),
      syncOutbox: await reopened.get("syncOutbox", seeded.syncOutbox.id),
      syncTombstone: await reopened.get("syncTombstones", seeded.syncTombstone.key),
      syncState: await reopened.get("syncState", "app")
    }).toEqual(migratedSnapshot);
    expect(await reopened.count("people")).toBe(1);
    expect(await reopened.count("externalIdentities")).toBe(1);
    expect(await reopened.count("syncRecords")).toBe(1);
    expect(await reopened.count("syncOutbox")).toBe(1);
    expect(await reopened.count("syncTombstones")).toBe(1);
    reopened.close();
  });

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
      conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter })),
      relationshipContexts: ["personal", "professional"]
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
