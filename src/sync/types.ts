import type { DataStoreName, IsoInstant } from "../domain/schema";

export const SYNC_SCHEMA_VERSION = 1;
export const SYNC_ZONE_NAME = "PeopleOSZoneV1";
export const SYNC_RECORD_TYPE = "PeopleOSEntityV1";

export type SyncErrorCategory =
  | "no_account" | "restricted" | "temporarily_unavailable" | "network_unavailable"
  | "quota_exceeded" | "authentication_changed" | "partial_failure" | "rate_limited"
  | "server_rejected" | "change_token_expired" | "record_conflict" | "malformed_payload" | "unknown";

export type SyncRecordStatus = "pending" | "synced" | "error" | "deleted";
export type SyncOperationKind = "save" | "delete";

export interface SyncRecordMetadata {
  key: string;
  store: DataStoreName;
  entityId: string;
  status: SyncRecordStatus;
  localRevision: number;
  localUpdatedAt: IsoInstant;
  localFingerprint: string;
  acknowledgedRemoteRevision?: number;
  acknowledgedRemoteUpdatedAt?: IsoInstant;
  cloudRecordName: string;
  changeTag?: string;
  systemFields?: string;
  retryCount: number;
  lastErrorCategory?: SyncErrorCategory;
  acknowledgedAt?: IsoInstant;
}

export interface SyncOutboxOperation {
  id: string;
  key: string;
  kind: SyncOperationKind;
  store: DataStoreName;
  entityId: string;
  cloudRecordName: string;
  schemaVersion: number;
  revision: number;
  updatedAt: IsoInstant;
  deletedAt?: IsoInstant;
  originDeviceId: string;
  payload?: Record<string, unknown>;
  changeTag?: string;
  attemptCount: number;
  nextAttemptAt: IsoInstant;
  createdAt: IsoInstant;
  updatedOperationAt: IsoInstant;
}

export interface SyncTombstone {
  key: string;
  store: DataStoreName;
  entityId: string;
  cloudRecordName: string;
  deletedAt: IsoInstant;
  originDeviceId: string;
  acknowledgedAt?: IsoInstant;
  retainUntil: IsoInstant;
}

export type InitialSyncPhase = "notStarted" | "readingRemote" | "reconciling" | "uploading" | "verifying" | "complete";

export interface SyncState {
  id: "app";
  enabled: boolean;
  installationId: string;
  changeToken?: string;
  initialMigrationPhase: InitialSyncPhase;
  lastScannedDatasetRevision: number;
  lastAttemptedSyncAt?: IsoInstant;
  lastSuccessfulSyncAt?: IsoInstant;
  lastErrorCategory?: SyncErrorCategory;
  retryCount: number;
  nextRetryAt?: IsoInstant;
  accountStatus: "available" | "no_account" | "restricted" | "temporarily_unavailable" | "unknown";
}

export interface CloudRecordEnvelope {
  store: DataStoreName;
  entityId: string;
  recordName: string;
  schemaVersion: number;
  revision: number;
  updatedAt: IsoInstant;
  deleted: boolean;
  deletedAt?: IsoInstant;
  originDeviceId: string;
  payload?: Record<string, unknown>;
  changeTag?: string;
  systemFields?: string;
}

export interface AccountStatusResult { status: SyncState["accountStatus"]; }
export interface PushOperationResult { operationId: string; success: boolean; record?: CloudRecordEnvelope; errorCategory?: SyncErrorCategory; retryAfterSeconds?: number; }
export interface PushOperationsResult { results: PushOperationResult[]; }
export interface FetchChangesResult { records: CloudRecordEnvelope[]; deletedRecordNames: string[]; changeToken?: string; moreComing: boolean; tokenExpired?: boolean; }
export interface FetchAllRecordsResult { records: CloudRecordEnvelope[]; changeToken?: string; }
export interface NativeSyncHealthResult { available: boolean; accountStatus: SyncState["accountStatus"]; }

export interface PeopleOSCloudSyncAdapter {
  getAccountStatus(): Promise<AccountStatusResult>;
  ensureZone(): Promise<void>;
  pushOperations(input: { operations: SyncOutboxOperation[] }): Promise<PushOperationsResult>;
  fetchChanges(input: { changeToken?: string }): Promise<FetchChangesResult>;
  fetchAllRecords(): Promise<FetchAllRecordsResult>;
  getSyncHealth(): Promise<NativeSyncHealthResult>;
}
