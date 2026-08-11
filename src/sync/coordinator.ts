import { DATA_STORE_NAMES, type DataStoreName, type PeopleOsData } from "../domain/schema";
import { validatePeopleOsData } from "../domain/validation";
import { readAllData, type PeopleOsDatabase } from "../data/database";
import { canonicalJson, cloudRecordName, decodeCloudRecordName, decideRecord, migrateLegacyCloudRecord, recordTimestamp, recordsByKey, syncKey } from "./reconciliation";
import { SYNC_SCHEMA_VERSION, type CloudRecordEnvelope, type PeopleOSCloudSyncAdapter, type SyncOutboxOperation, type SyncRecordMetadata, type SyncState, type SyncTombstone } from "./types";

const BATCH_SIZE = 100;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

function revisionOf(record: Record<string, unknown>): number {
  return typeof record.revision === "number" ? record.revision : 0;
}

function operationId(key: string, updatedAt: string, deleted: boolean): string {
  return `${key}:${deleted ? "d" : "s"}:${updatedAt}`;
}

function retainUntil(deletedAt: string): string {
  return new Date(new Date(deletedAt).getTime() + RETENTION_MS).toISOString();
}

export async function scanLocalChanges(db: PeopleOsDatabase, now = new Date().toISOString()): Promise<number> {
  const state = await db.get("syncState", "app");
  const metadata = await db.get("metadata", "app");
  if (!state || !metadata || !state.enabled) return 0;
  const data = await readAllData(db);
  const local = recordsByKey(data);
  const shadows = await db.getAll("syncRecords");
  const shadowByKey = new Map(shadows.map((shadow) => [shadow.key, shadow]));
  let queued = 0;
  const tx = db.transaction(["syncRecords", "syncOutbox", "syncTombstones", "syncState"], "readwrite");

  for (const store of DATA_STORE_NAMES) {
    for (const candidate of data[store]) {
      const record = candidate as unknown as Record<string, unknown>;
      const key = syncKey(store, candidate.id);
      const fingerprint = canonicalJson(record);
      const timestamp = recordTimestamp(store, record);
      const previous = shadowByKey.get(key);
      if (previous?.localFingerprint === fingerprint && previous.status !== "deleted") continue;
      const recordName = previous?.cloudRecordName ?? cloudRecordName(store, candidate.id);
      const operation: SyncOutboxOperation = {
        id: operationId(key, timestamp, false), key, kind: "save", store, entityId: candidate.id,
        cloudRecordName: recordName, schemaVersion: SYNC_SCHEMA_VERSION, revision: revisionOf(record),
        updatedAt: timestamp, originDeviceId: state.installationId, payload: record,
        changeTag: previous?.changeTag, attemptCount: 0, nextAttemptAt: now, createdAt: now, updatedOperationAt: now
      };
      await tx.objectStore("syncOutbox").put(operation);
      await tx.objectStore("syncTombstones").delete(key);
      await tx.objectStore("syncRecords").put({
        ...previous, key, store, entityId: candidate.id, status: "pending", localRevision: operation.revision,
        localUpdatedAt: timestamp, localFingerprint: fingerprint, cloudRecordName: recordName,
        retryCount: previous?.retryCount ?? 0
      });
      queued += 1;
    }
  }

  for (const shadow of shadows) {
    if (local.has(shadow.key) || shadow.status === "deleted") continue;
    const tombstone: SyncTombstone = {
      key: shadow.key, store: shadow.store, entityId: shadow.entityId, cloudRecordName: shadow.cloudRecordName,
      deletedAt: now, originDeviceId: state.installationId, retainUntil: retainUntil(now)
    };
    await tx.objectStore("syncTombstones").put(tombstone);
    await tx.objectStore("syncOutbox").put({
      id: operationId(shadow.key, now, true), key: shadow.key, kind: "delete", store: shadow.store,
      entityId: shadow.entityId, cloudRecordName: shadow.cloudRecordName, schemaVersion: SYNC_SCHEMA_VERSION,
      revision: shadow.localRevision, updatedAt: now, deletedAt: now, originDeviceId: state.installationId,
      changeTag: shadow.changeTag, attemptCount: 0, nextAttemptAt: now, createdAt: now, updatedOperationAt: now
    });
    await tx.objectStore("syncRecords").put({ ...shadow, status: "deleted", localUpdatedAt: now, localFingerprint: "deleted", retryCount: 0 });
    queued += 1;
  }
  await tx.objectStore("syncState").put({ ...state, lastScannedDatasetRevision: metadata.datasetRevision });
  await tx.done;
  return queued;
}

function withRecord(data: PeopleOsData, store: DataStoreName, record: Record<string, unknown> | undefined, entityId: string): PeopleOsData {
  const current = data[store] as unknown as Array<Record<string, unknown>>;
  const next = record
    ? [...current.filter((item) => item.id !== entityId), record]
    : current.filter((item) => item.id !== entityId);
  return { ...data, [store]: next } as PeopleOsData;
}

async function applyRemoteRecords(db: PeopleOsDatabase, records: CloudRecordEnvelope[], state: SyncState, now: string): Promise<void> {
  let data = await readAllData(db);
  const tombstones = new Map((await db.getAll("syncTombstones")).map((item) => [item.key, item]));
  const decisions: Array<{
    remote: CloudRecordEnvelope;
    decision: ReturnType<typeof decideRecord>;
    sourceFingerprint?: string;
  }> = [];
  for (const incomingRemote of records) {
    const remote = migrateLegacyCloudRecord(incomingRemote);
    if (!DATA_STORE_NAMES.includes(remote.store)) throw new Error("Remote store is not allowed");
    const key = syncKey(remote.store, remote.entityId);
    const local = (data[remote.store] as Array<{ id: string }>).find((item) => item.id === remote.entityId) as unknown as Record<string, unknown> | undefined;
    const decision = decideRecord(local, remote, state.installationId, tombstones.get(key));
    decisions.push({
      remote,
      decision,
      ...(incomingRemote.payload ? { sourceFingerprint: canonicalJson(incomingRemote.payload) } : {})
    });
    if (decision === "apply-remote") data = withRecord(data, remote.store, remote.payload, remote.entityId);
    if (decision === "apply-deletion") data = withRecord(data, remote.store, undefined, remote.entityId);
  }
  validatePeopleOsData(data);
  const tx = db.transaction([...DATA_STORE_NAMES, "metadata", "syncRecords", "syncTombstones", "syncOutbox"] as never, "readwrite");
  for (const { remote, decision, sourceFingerprint } of decisions) {
    const key = syncKey(remote.store, remote.entityId);
    const localRecord = (data[remote.store] as Array<{ id: string }>).find((item) => item.id === remote.entityId) as unknown as Record<string, unknown> | undefined;
    if (decision === "apply-remote" && remote.payload) {
      await tx.objectStore(remote.store as never).put(remote.payload as never);
      await tx.objectStore("syncTombstones" as never).delete(key as never);
    } else if (decision === "apply-deletion") {
      await tx.objectStore(remote.store as never).delete(remote.entityId as never);
      const deletedAt = remote.deletedAt ?? remote.updatedAt;
      await tx.objectStore("syncTombstones" as never).put({
        key, store: remote.store, entityId: remote.entityId, cloudRecordName: remote.recordName,
        deletedAt, originDeviceId: remote.originDeviceId, acknowledgedAt: now, retainUntil: retainUntil(deletedAt)
      } as never);
    }
    if (decision !== "keep-local") {
      await tx.objectStore("syncOutbox" as never).delete(operationId(key, remote.updatedAt, remote.deleted) as never);
      await tx.objectStore("syncRecords" as never).put({
        key, store: remote.store, entityId: remote.entityId, status: remote.deleted ? "deleted" : "synced",
        localRevision: localRecord ? revisionOf(localRecord) : remote.revision,
        localUpdatedAt: remote.deleted ? remote.deletedAt ?? remote.updatedAt : remote.updatedAt,
        // Keep the source fingerprint when a legacy payload was normalized. The
        // next local scan then writes the additive defaults back to CloudKit,
        // healing the private-cloud record without fabricating a user edit.
        localFingerprint: remote.deleted ? "deleted" : sourceFingerprint ?? canonicalJson(remote.payload),
        acknowledgedRemoteRevision: remote.revision, acknowledgedRemoteUpdatedAt: remote.updatedAt,
        cloudRecordName: remote.recordName, changeTag: remote.changeTag, systemFields: remote.systemFields,
        retryCount: 0, acknowledgedAt: now
      } satisfies SyncRecordMetadata as never);
    }
  }
  const metadataStore = tx.objectStore("metadata" as never);
  const metadata = await metadataStore.get("app" as never) as { datasetRevision: number; updatedAt: string };
  if (decisions.some(({ decision }) => decision === "apply-remote" || decision === "apply-deletion")) {
    await metadataStore.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now } as never);
  }
  await tx.done;
}

async function pushPending(db: PeopleOsDatabase, adapter: PeopleOSCloudSyncAdapter, now: string): Promise<void> {
  const pending = (await db.getAllFromIndex("syncOutbox", "by-next-attempt", IDBKeyRange.upperBound(now))).slice(0, BATCH_SIZE);
  if (!pending.length) return;
  const response = await adapter.pushOperations({ operations: pending });
  const tx = db.transaction(["syncOutbox", "syncRecords", "syncTombstones"], "readwrite");
  for (const result of response.results) {
    const operation = pending.find((candidate) => candidate.id === result.operationId);
    if (!operation) continue;
    const shadow = await tx.objectStore("syncRecords").get(operation.key);
    if (result.success) {
      await tx.objectStore("syncOutbox").delete(operation.id);
      if (shadow) await tx.objectStore("syncRecords").put({
        ...shadow, status: operation.kind === "delete" ? "deleted" : "synced", retryCount: 0,
        lastErrorCategory: undefined, acknowledgedRemoteRevision: result.record?.revision ?? operation.revision,
        acknowledgedRemoteUpdatedAt: result.record?.updatedAt ?? operation.updatedAt,
        changeTag: result.record?.changeTag, systemFields: result.record?.systemFields, acknowledgedAt: now
      });
      const tombstone = await tx.objectStore("syncTombstones").get(operation.key);
      if (tombstone) await tx.objectStore("syncTombstones").put({ ...tombstone, acknowledgedAt: now });
    } else {
      const attempts = operation.attemptCount + 1;
      const delay = Math.min(21_600, result.retryAfterSeconds ?? 5 * 2 ** Math.min(attempts, 12));
      const nextAttemptAt = new Date(new Date(now).getTime() + Math.random() * delay * 1000).toISOString();
      await tx.objectStore("syncOutbox").put({ ...operation, attemptCount: attempts, nextAttemptAt, updatedOperationAt: now });
      if (shadow) await tx.objectStore("syncRecords").put({ ...shadow, status: "error", retryCount: attempts, lastErrorCategory: result.errorCategory ?? "unknown" });
    }
  }
  await tx.done;
}

async function fetchIncremental(adapter: PeopleOSCloudSyncAdapter, changeToken?: string): Promise<{ records: CloudRecordEnvelope[]; changeToken?: string; tokenExpired?: boolean }> {
  const records: CloudRecordEnvelope[] = [];
  let token = changeToken;
  for (let page = 0; page < 100; page += 1) {
    const result = await adapter.fetchChanges({ changeToken: token });
    if (result.tokenExpired) return { records: [], tokenExpired: true };
    records.push(...result.records);
    for (const recordName of result.deletedRecordNames) {
      const decoded = decodeCloudRecordName(recordName);
      const deletedAt = new Date().toISOString();
      if (decoded) records.push({ ...decoded, recordName, schemaVersion: SYNC_SCHEMA_VERSION, revision: 0, updatedAt: deletedAt, deleted: true, deletedAt, originDeviceId: "cloudkit-hard-delete" });
    }
    token = result.changeToken ?? token;
    if (!result.moreComing) return { records, changeToken: token };
  }
  throw new Error("Cloud change pagination exceeded its safety bound");
}

export async function setCloudSyncEnabled(db: PeopleOsDatabase, enabled: boolean): Promise<void> {
  const state = await db.get("syncState", "app");
  if (!state) throw new Error("Sync state is missing");
  await db.put("syncState", { ...state, enabled, initialMigrationPhase: enabled ? state.initialMigrationPhase : "notStarted", lastErrorCategory: undefined });
}

export async function runCloudSync(db: PeopleOsDatabase, adapter: PeopleOSCloudSyncAdapter, now = new Date().toISOString()): Promise<void> {
  let state = await db.get("syncState", "app");
  if (!state?.enabled) return;
  await db.put("syncState", { ...state, lastAttemptedSyncAt: now, lastErrorCategory: undefined });
  try {
    const account = await adapter.getAccountStatus();
    state = { ...state, accountStatus: account.status };
    await db.put("syncState", state);
    if (account.status !== "available") throw Object.assign(new Error("iCloud account unavailable"), { category: account.status });
    await adapter.ensureZone();
    if (state.initialMigrationPhase !== "complete") {
      await db.put("syncState", { ...state, initialMigrationPhase: "readingRemote" });
      const remote = await adapter.fetchAllRecords();
      await db.put("syncState", { ...state, initialMigrationPhase: "reconciling" });
      await applyRemoteRecords(db, remote.records, state, now);
      await scanLocalChanges(db, now);
      await db.put("syncState", { ...state, initialMigrationPhase: "uploading" });
      while ((await db.count("syncOutbox")) > 0) {
        const before = await db.count("syncOutbox");
        await pushPending(db, adapter, now);
        if (await db.count("syncOutbox") >= before) break;
      }
      await db.put("syncState", { ...state, initialMigrationPhase: "verifying" });
      const verification = await fetchIncremental(adapter, remote.changeToken);
      await applyRemoteRecords(db, verification.records, state, now);
      state = { ...state, initialMigrationPhase: "complete", changeToken: verification.changeToken ?? remote.changeToken };
    } else {
      await scanLocalChanges(db, now);
      await pushPending(db, adapter, now);
      const changes = await fetchIncremental(adapter, state.changeToken);
      if (changes.tokenExpired) {
        const full = await adapter.fetchAllRecords();
        await applyRemoteRecords(db, full.records, state, now);
        state = { ...state, changeToken: full.changeToken };
      } else {
        await applyRemoteRecords(db, changes.records, state, now);
        state = { ...state, changeToken: changes.changeToken ?? state.changeToken };
      }
    }
    await db.put("syncState", { ...state, lastSuccessfulSyncAt: now, lastErrorCategory: undefined, retryCount: 0, accountStatus: "available" });
  } catch (error) {
    const category = typeof error === "object" && error && "category" in error ? String(error.category) : "unknown";
    const latest = await db.get("syncState", "app");
    if (latest) await db.put("syncState", { ...latest, lastErrorCategory: category as SyncState["lastErrorCategory"], retryCount: latest.retryCount + 1 });
    throw error;
  }
}
