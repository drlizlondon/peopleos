import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "../data/repositories";
import { deletePeopleOsDatabase, openPeopleOsDatabase } from "../data/database";
import type { Person } from "../domain/schema";
import { cloudRecordName, decideRecord } from "./reconciliation";
import { runCloudSync, scanLocalChanges, setCloudSyncEnabled } from "./coordinator";
import { FakeCloudKitAdapter } from "./fakeAdapter";
import type { CloudRecordEnvelope, SyncTombstone } from "./types";

const databases: string[] = [];
const openedDatabases: Awaited<ReturnType<typeof openPeopleOsDatabase>>[] = [];
const T1 = "2026-08-01T09:00:00.000Z";
const T2 = "2026-08-02T09:00:00.000Z";

function person(id: string, name: string, updatedAt = T1): Person {
  return { id, displayName: name, identityStatus: "confirmed", importance: "normal", tags: [], revision: 1, createdAt: T1, updatedAt };
}

function remotePerson(value: Person, origin = "remote"): CloudRecordEnvelope {
  return { store: "people", entityId: value.id, recordName: cloudRecordName("people", value.id), schemaVersion: 1,
    revision: value.revision, updatedAt: value.updatedAt, deleted: false, originDeviceId: origin,
    payload: value as unknown as Record<string, unknown> };
}

async function database() {
  const name = `peopleos-sync-${crypto.randomUUID()}`; databases.push(name);
  const db = await openPeopleOsDatabase(name, T1); openedDatabases.push(db); return db;
}

async function enabledDatabase() {
  const db = await database(); await setCloudSyncEnabled(db, true); return db;
}

afterEach(async () => { vi.restoreAllMocks(); openedDatabases.splice(0).forEach((db) => db.close()); for (const name of databases.splice(0)) await deletePeopleOsDatabase(name); });

describe("iCloud Sync reconciliation", () => {
  it("reconciles two simulated devices through one private-cloud adapter", async () => {
    const first = await enabledDatabase(); const second = await enabledDatabase(); const cloud = new FakeCloudKitAdapter();
    await createRepositories(first).people.create(person("from-first", "From first"));
    await createRepositories(second).people.create(person("from-second", "From second"));
    await runCloudSync(first, cloud, T1); await runCloudSync(second, cloud, T2); await runCloudSync(first, cloud, T2);
    expect(await first.get("people", "from-second")).toBeTruthy();
    expect(await second.get("people", "from-first")).toBeTruthy();
    expect([...cloud.records.values()].filter((record) => record.store === "people")).toHaveLength(2);
  });

  it("uploads a local-only record", async () => {
    const db = await enabledDatabase(); const cloud = new FakeCloudKitAdapter();
    await createRepositories(db).people.create(person("local", "Local")); await runCloudSync(db, cloud, T2);
    expect([...cloud.records.values()].some((record) => record.entityId === "local")).toBe(true);
  });

  it("imports a remote-only record", async () => {
    const db = await enabledDatabase(); const cloud = new FakeCloudKitAdapter(); const value = person("remote", "Remote");
    cloud.records.set(cloudRecordName("people", value.id), remotePerson(value)); await runCloudSync(db, cloud, T2);
    expect(await db.get("people", "remote")).toEqual(value);
  });

  it("syncs a structured contact cadence without flattening its unit", async () => {
    const db = await enabledDatabase();
    const cloud = new FakeCloudKitAdapter();
    const value = { ...person("cadence", "Cadence"), contactCadence: { value: 4, unit: "weeks" as const } };
    cloud.records.set(cloudRecordName("people", value.id), remotePerson(value));
    await runCloudSync(db, cloud, T2);
    expect((await db.get("people", value.id))?.contactCadence).toEqual({ value: 4, unit: "weeks" });
  });

  it("resolves concurrent scalar edits deterministically", () => {
    const local = person("same", "Local", T2) as unknown as Record<string, unknown>;
    expect(decideRecord(local, remotePerson(person("same", "Remote", T1)), "device-a")).toBe("keep-local");
    expect(decideRecord(local, remotePerson(person("same", "Remote", "2026-08-03T09:00:00.000Z")), "device-a")).toBe("apply-remote");
  });

  it("preserves independently identified interactions from two devices", async () => {
    const db = await enabledDatabase(); const cloud = new FakeCloudKitAdapter();
    await createRepositories(db).people.create(person("p", "Person"));
    await createRepositories(db).interactions.create({ id: "i-local", personId: "p", kind: "contacted", occurredAt: T1, revision: 1, createdAt: T1, updatedAt: T1 });
    cloud.records.set(cloudRecordName("people", "p"), remotePerson(person("p", "Person")));
    cloud.records.set(cloudRecordName("interactions", "i-remote"), { store: "interactions", entityId: "i-remote", recordName: cloudRecordName("interactions", "i-remote"), schemaVersion: 1, revision: 1, updatedAt: T2, deleted: false, originDeviceId: "remote", payload: { id: "i-remote", personId: "p", kind: "email", occurredAt: T2, revision: 1, createdAt: T2, updatedAt: T2 } });
    await runCloudSync(db, cloud, T2); expect(await db.getAll("interactions")).toHaveLength(2);
  });

  it("keeps a newer local deletion over an older remote update", () => {
    const value = person("deleted", "Old", T1); const tombstone: SyncTombstone = { key: "people:deleted", store: "people", entityId: "deleted", cloudRecordName: cloudRecordName("people", "deleted"), deletedAt: T2, originDeviceId: "local", retainUntil: "2027-01-30T09:00:00.000Z" };
    expect(decideRecord(undefined, remotePerson(value), "local", tombstone)).toBe("apply-deletion");
  });

  it("applies a remote deletion locally and retains a tombstone", async () => {
    const db = await enabledDatabase(); const cloud = new FakeCloudKitAdapter(); await createRepositories(db).people.create(person("gone", "Gone"));
    const deleted = { ...remotePerson(person("gone", "Gone")), deleted: true, deletedAt: T2, updatedAt: T2, payload: undefined };
    cloud.records.set(deleted.recordName, deleted); await runCloudSync(db, cloud, T2);
    expect(await db.get("people", "gone")).toBeUndefined(); expect(await db.get("syncTombstones", "people:gone")).toBeTruthy();
  });

  it("retains an offline mutation in the outbox until reconnection", async () => {
    const db = await enabledDatabase(); await createRepositories(db).people.create(person("offline", "Offline"));
    await scanLocalChanges(db, T2); expect(await db.count("syncOutbox")).toBeGreaterThan(0);
    const cloud = new FakeCloudKitAdapter(); await runCloudSync(db, cloud, T2); expect([...cloud.records.values()].some((r) => r.entityId === "offline")).toBe(true);
  });

  it("resumes an interrupted initial sync phase idempotently", async () => {
    const db = await enabledDatabase(); const state = await db.get("syncState", "app");
    await db.put("syncState", { ...state!, initialMigrationPhase: "reconciling" }); const cloud = new FakeCloudKitAdapter();
    await runCloudSync(db, cloud, T2); expect((await db.get("syncState", "app"))?.initialMigrationPhase).toBe("complete");
  });

  it("does not duplicate exact retry operations", async () => {
    const db = await enabledDatabase(); await createRepositories(db).people.create(person("retry", "Retry"));
    await scanLocalChanges(db, T2); const first = await db.count("syncOutbox"); await scanLocalChanges(db, T2);
    expect(await db.count("syncOutbox")).toBe(first);
  });

  it("retains only failed operations after a partial batch failure", async () => {
    const db = await enabledDatabase(); await createRepositories(db).people.create(person("a", "A")); await createRepositories(db).people.create(person("b", "B")); await scanLocalChanges(db, T2);
    const cloud = new FakeCloudKitAdapter(); const failed = (await db.getAll("syncOutbox")).find((op) => op.entityId === "a")!; cloud.failOperations.set(failed.id, "rate_limited");
    await runCloudSync(db, cloud, T2); expect((await db.getAll("syncOutbox")).some((op) => op.entityId === "a")).toBe(true); expect([...cloud.records.values()].some((r) => r.entityId === "b")).toBe(true);
  });

  it("recovers an expired change token with full reconciliation", async () => {
    const db = await enabledDatabase(); const cloud = new FakeCloudKitAdapter(); await runCloudSync(db, cloud, T1);
    const value = person("full", "Full", T2); cloud.records.set(cloudRecordName("people", "full"), remotePerson(value)); cloud.expireNextToken = true;
    await runCloudSync(db, cloud, T2); expect(await db.get("people", "full")).toEqual(value);
  });

  it("pauses safely when the iCloud account becomes unavailable", async () => {
    const db = await enabledDatabase(); const cloud = new FakeCloudKitAdapter(); cloud.accountStatus = "no_account";
    await expect(runCloudSync(db, cloud, T2)).rejects.toThrow(); expect((await db.get("syncState", "app"))?.lastErrorCategory).toBe("no_account");
  });

  it("never clears populated local data for an empty remote database", async () => {
    const db = await enabledDatabase(); await createRepositories(db).people.create(person("safe", "Safe")); await runCloudSync(db, new FakeCloudKitAdapter(), T2);
    expect(await db.get("people", "safe")).toBeTruthy();
  });

  it("fills an empty local database from populated remote data", async () => {
    const db = await enabledDatabase(); const cloud = new FakeCloudKitAdapter(); const value = person("cloud", "Cloud"); cloud.records.set(cloudRecordName("people", "cloud"), remotePerson(value));
    await runCloudSync(db, cloud, T2); expect(await db.get("people", "cloud")).toBeTruthy();
  });

  it("preserves pending operations through the IndexedDB schema migration boundary", async () => {
    const db = await enabledDatabase(); await createRepositories(db).people.create(person("pending", "Pending")); await scanLocalChanges(db, T2); db.close();
    const reopened = await openPeopleOsDatabase(databases.at(-1)!); expect((await reopened.getAll("syncOutbox")).some((op) => op.entityId === "pending")).toBe(true); reopened.close();
  });

  it("does not write contact details or payloads to diagnostics", async () => {
    const log = vi.spyOn(console, "log"); const error = vi.spyOn(console, "error"); const db = await enabledDatabase(); const cloud = new FakeCloudKitAdapter();
    await createRepositories(db).contactMethods.create({ id: "secret", personId: "missing", kind: "email", rawValue: "private@example.com", canonicalValue: "private@example.com", isPreferred: true, revision: 1, createdAt: T1, updatedAt: T1 }).catch(() => undefined);
    await runCloudSync(db, cloud, T2); expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });

  it("keeps unsupported web environments local without invoking a native adapter", async () => {
    const module = await import("./capacitorAdapter"); expect(module.isCloudSyncSupported()).toBe(false); expect(module.getCloudSyncAdapter()).toBeUndefined();
  });

  it("keeps existing JSON backup data valid with an empty external identity collection", async () => {
    const { generateBackup, previewBackup } = await import("../data/backup"); const db = await database(); const generated = await generateBackup(db, T2);
    expect(previewBackup(generated.json).envelope.data.externalIdentities).toEqual([]);
  });
});
