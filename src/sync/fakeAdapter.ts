import type { CloudRecordEnvelope, FetchAllRecordsResult, FetchChangesResult, PeopleOSCloudSyncAdapter, PushOperationsResult, SyncErrorCategory, SyncOutboxOperation } from "./types";

export class FakeCloudKitAdapter implements PeopleOSCloudSyncAdapter {
  readonly records = new Map<string, CloudRecordEnvelope>();
  accountStatus: "available" | "no_account" | "restricted" | "temporarily_unavailable" = "available";
  failOperations = new Map<string, SyncErrorCategory>();
  expireNextToken = false;
  zoneEnsured = false;
  private version = 0;

  async getAccountStatus() { return { status: this.accountStatus }; }
  async ensureZone() { this.zoneEnsured = true; }
  async getSyncHealth() { return { available: this.accountStatus === "available", accountStatus: this.accountStatus }; }

  async pushOperations(input: { operations: SyncOutboxOperation[] }): Promise<PushOperationsResult> {
    return { results: input.operations.map((operation) => {
      const failure = this.failOperations.get(operation.id);
      if (failure) return { operationId: operation.id, success: false, errorCategory: failure };
      const record: CloudRecordEnvelope = {
        store: operation.store, entityId: operation.entityId, recordName: operation.cloudRecordName,
        schemaVersion: operation.schemaVersion, revision: operation.revision, updatedAt: operation.updatedAt,
        deleted: operation.kind === "delete", deletedAt: operation.deletedAt,
        originDeviceId: operation.originDeviceId, payload: operation.payload,
        changeTag: `fake-${++this.version}`, systemFields: `fake-system-${this.version}`
      };
      this.records.set(record.recordName, record);
      return { operationId: operation.id, success: true, record };
    }) };
  }

  async fetchChanges(): Promise<FetchChangesResult> {
    if (this.expireNextToken) { this.expireNextToken = false; return { records: [], deletedRecordNames: [], moreComing: false, tokenExpired: true }; }
    return { records: [...this.records.values()], deletedRecordNames: [], changeToken: `token-${this.version}`, moreComing: false };
  }

  async fetchAllRecords(): Promise<FetchAllRecordsResult> {
    return { records: [...this.records.values()], changeToken: `token-${this.version}` };
  }
}
