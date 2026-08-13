import {
  DATA_STORE_NAMES,
  DEFAULT_CONVERSATION_STARTERS,
  DEFAULT_TODAY_NOTIFICATION_TIME,
  type DataStoreName,
  type PeopleOsData
} from "../domain/schema";
import { assertValidRecord } from "../domain/validation";
import type { CloudRecordEnvelope, SyncTombstone } from "./types";

const appendStores = new Set<DataStoreName>([
  "interactions",
  "followUpEvents",
  "conversationStarterUses",
  "todaySkips",
  "reachOutEvents"
]);

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function syncKey(store: DataStoreName, entityId: string): string {
  return `${store}:${entityId}`;
}

export function cloudRecordName(store: DataStoreName, entityId: string): string {
  const bytes = new TextEncoder().encode(syncKey(store, entityId));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCloudRecordName(recordName: string): { store: DataStoreName; entityId: string } | undefined {
  try {
    const padded = recordName.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(recordName.length / 4) * 4, "=");
    const binary = atob(padded);
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    const separator = decoded.indexOf(":");
    const store = decoded.slice(0, separator) as DataStoreName;
    const entityId = decoded.slice(separator + 1);
    return separator > 0 && DATA_STORE_NAMES.includes(store) && entityId ? { store, entityId } : undefined;
  } catch { return undefined; }
}

export function recordTimestamp(store: DataStoreName, value: Record<string, unknown>): string {
  const candidate = appendStores.has(store)
    ? value.occurredAt ?? value.createdAt
    : value.updatedAt ?? value.occurredAt ?? value.createdAt;
  if (typeof candidate !== "string") throw new Error(`${store}.${String(value.id)} has no sync timestamp`);
  return candidate;
}

/**
 * CloudKit records outlive an installed application version. Normalize additive
 * AppSettings fields before current-schema validation so an older private-cloud
 * record can participate in the ordinary deterministic reconciliation path.
 * Invalid values are deliberately left untouched for validation to reject.
 */
export function migrateLegacyCloudRecord(remote: CloudRecordEnvelope): CloudRecordEnvelope {
  if (remote.deleted || remote.store !== "appSettings" || !remote.payload) return remote;
  const missingEnabled = remote.payload.todaySummaryNotificationsEnabled === undefined;
  const missingTime = remote.payload.todaySummaryNotificationTime === undefined;
  const missingConversationStarters = remote.payload.conversationStarters === undefined;
  if (!missingEnabled && !missingTime && !missingConversationStarters) return remote;
  return {
    ...remote,
    payload: {
      ...remote.payload,
      ...(missingEnabled ? { todaySummaryNotificationsEnabled: false } : {}),
      ...(missingTime ? { todaySummaryNotificationTime: DEFAULT_TODAY_NOTIFICATION_TIME } : {}),
      ...(missingConversationStarters
        ? { conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter })) }
        : {})
    }
  };
}

function compareLive(local: Record<string, unknown>, remote: CloudRecordEnvelope, localOrigin: string): number {
  const localAt = recordTimestamp(remote.store, local);
  if (localAt !== remote.updatedAt) return localAt > remote.updatedAt ? 1 : -1;
  const localRevision = typeof local.revision === "number" ? local.revision : 0;
  if (localRevision !== remote.revision) return localRevision > remote.revision ? 1 : -1;
  if (localOrigin !== remote.originDeviceId) return localOrigin > remote.originDeviceId ? 1 : -1;
  const localJson = canonicalJson(local);
  const remoteJson = canonicalJson(remote.payload);
  return localJson === remoteJson ? 0 : localJson > remoteJson ? 1 : -1;
}

export type ReconcileDecision = "keep-local" | "apply-remote" | "apply-deletion" | "equal";

export function decideRecord(
  local: Record<string, unknown> | undefined,
  incomingRemote: CloudRecordEnvelope,
  localOrigin: string,
  localTombstone?: SyncTombstone
): ReconcileDecision {
  const remote = migrateLegacyCloudRecord(incomingRemote);
  if (remote.deleted) {
    if (!local) return "apply-deletion";
    const deletedAt = remote.deletedAt ?? remote.updatedAt;
    return deletedAt >= recordTimestamp(remote.store, local) ? "apply-deletion" : "keep-local";
  }
  if (!remote.payload) throw new Error("Live remote record has no payload");
  assertValidRecord(remote.store, remote.payload);
  if (localTombstone) {
    return localTombstone.deletedAt >= remote.updatedAt ? "apply-deletion" : "apply-remote";
  }
  if (!local) return "apply-remote";
  const comparison = compareLive(local, remote, localOrigin);
  return comparison > 0 ? "keep-local" : comparison < 0 ? "apply-remote" : "equal";
}

export function recordsByKey(data: PeopleOsData): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const store of DATA_STORE_NAMES) {
    for (const value of data[store]) result.set(syncKey(store, value.id), value as unknown as Record<string, unknown>);
  }
  return result;
}

export function isAppendStore(store: DataStoreName): boolean {
  return appendStores.has(store);
}
