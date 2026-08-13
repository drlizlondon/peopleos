import {
  BACKUP_SCHEMA_VERSION,
  DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS,
  DEFAULT_CONVERSATION_STARTERS,
  DEFAULT_TODAY_NOTIFICATION_TIME,
  DATA_STORE_NAMES,
  emptyPeopleOsData,
  type BackupCounts,
  type BackupEnvelope,
  type BackupPreview,
  type PeopleOsData
} from "../domain/schema";
import { ValidationError, isIsoInstant, validateBackupEnvelope, validatePeopleOsData } from "../domain/validation";
import { createDefaultMetadata, createDefaultSettings, readAllData, type PeopleOsDatabase } from "./database";
import { migrateLegacySchedulingData } from "./legacyCompatibility";

type LegacyBackupEnvelope = {
  product: "peopleos";
  schemaVersion: 0;
  exportedAt: string;
  data?: Partial<PeopleOsData>;
};

type SchemaOneBackupEnvelope = {
  product: "peopleos";
  schemaVersion: 1;
  exportedAt: string;
  data?: unknown;
};

type SchemaTwoBackupEnvelope = {
  product: "peopleos";
  schemaVersion: 2;
  exportedAt: string;
  data?: unknown;
};

type SchemaThreeBackupEnvelope = {
  product: "peopleos";
  schemaVersion: 3;
  exportedAt: string;
  data?: unknown;
};

type SchemaFourBackupEnvelope = {
  product: "peopleos";
  schemaVersion: 4;
  exportedAt: string;
  data?: unknown;
};

type SchemaFiveBackupEnvelope = {
  product: "peopleos";
  schemaVersion: 5;
  exportedAt: string;
  data?: unknown;
};
export type GeneratedBackup = {
  envelope: BackupEnvelope;
  json: string;
  fileName: string;
  counts: BackupCounts;
};

export type RestoreHooks = {
  beforeCommit?: () => void | Promise<void>;
};

export function countData(data: PeopleOsData): BackupCounts {
  return Object.fromEntries(DATA_STORE_NAMES.map((store) => [store, data[store].length])) as BackupCounts;
}

function migrateAlreadyContactedDefault(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.appSettings)) return data;
  return {
    ...record,
    appSettings: record.appSettings.map((settings) => {
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return settings;
      const settingRecord = settings as Record<string, unknown>;
      if (settingRecord.alreadyContactedDefaultReminderDays !== undefined) return settings;
      return {
        ...settingRecord,
        alreadyContactedDefaultReminderDays: DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS
      };
    })
  };
}

function addRelationshipModes(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.people)) return data;
  return {
    ...record,
    people: record.people.map((person) => typeof person === "object" && person !== null && !Array.isArray(person)
      ? { relationshipMode: "personal", ...person }
      : person)
  };
}

function addTodayNotificationSettings(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.appSettings)) return data;
  return {
    ...record,
    appSettings: record.appSettings.map((settings) => {
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return settings;
      return {
        todaySummaryNotificationsEnabled: false,
        todaySummaryNotificationTime: DEFAULT_TODAY_NOTIFICATION_TIME,
        ...settings
      };
    })
  };
}

function addConversationStarters(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.appSettings)) return data;
  return {
    ...record,
    appSettings: record.appSettings.map((settings) => {
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return settings;
      const settingRecord = settings as Record<string, unknown>;
      if (settingRecord.conversationStarters !== undefined) return settings;
      return {
        ...settingRecord,
        conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter }))
      };
    })
  };
}

function migrateLegacyBackup(value: LegacyBackupEnvelope): BackupPreview {
  if (!isIsoInstant(value.exportedAt)) throw new ValidationError(["legacy backup exportedAt is invalid"]);
  const defaults = emptyPeopleOsData(createDefaultSettings(value.exportedAt));
  const supplied = value.data ?? {};
  const migrated = Object.fromEntries(DATA_STORE_NAMES.map((store) => [store, supplied[store] ?? defaults[store]])) as PeopleOsData;
  const envelope: BackupEnvelope = {
    product: "peopleos",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    data: validatePeopleOsData(addConversationStarters(addTodayNotificationSettings(addRelationshipModes(migrateAlreadyContactedDefault(migrated)))))
  };
  return { envelope, counts: countData(envelope.data), migratedFromVersion: 0 };
}

function migrateSchemaOneBackup(value: SchemaOneBackupEnvelope): BackupPreview {
  if (!isIsoInstant(value.exportedAt)) throw new ValidationError(["backup exportedAt is invalid"]);
  const envelope: BackupEnvelope = {
    product: "peopleos",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    data: validatePeopleOsData(addConversationStarters(addTodayNotificationSettings(addRelationshipModes(addExternalIdentities(migrateAlreadyContactedDefault(value.data))))))
  };
  return { envelope, counts: countData(envelope.data), migratedFromVersion: 1 };
}

function addExternalIdentities(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  return record.externalIdentities === undefined ? { ...record, externalIdentities: [] } : data;
}
function migrateSchemaTwoBackup(value: SchemaTwoBackupEnvelope): BackupPreview {
  if (!isIsoInstant(value.exportedAt)) throw new ValidationError(["backup exportedAt is invalid"]);
  const envelope: BackupEnvelope = {
    product: "peopleos",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    data: validatePeopleOsData(addConversationStarters(addTodayNotificationSettings(addRelationshipModes(addExternalIdentities(value.data)))))
  };
  return { envelope, counts: countData(envelope.data), migratedFromVersion: 2 };
}

function migrateSchemaThreeBackup(value: SchemaThreeBackupEnvelope): BackupPreview {
  if (!isIsoInstant(value.exportedAt)) throw new ValidationError(["backup exportedAt is invalid"]);
  const envelope: BackupEnvelope = {
    product: "peopleos",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    // Schema version 3 was independently used by both histories. Main's
    // version has no ExternalIdentity collection, while the RC's does.
    data: validatePeopleOsData(addConversationStarters(addTodayNotificationSettings(addRelationshipModes(addExternalIdentities(value.data)))))
  };
  return { envelope, counts: countData(envelope.data), migratedFromVersion: 3 };
}

function migrateSchemaFourBackup(value: SchemaFourBackupEnvelope): BackupPreview {
  if (!isIsoInstant(value.exportedAt)) throw new ValidationError(["backup exportedAt is invalid"]);
  const mainCompatibleData = validatePeopleOsData(
    addConversationStarters(addTodayNotificationSettings(addExternalIdentities(value.data)))
  );
  const envelope: BackupEnvelope = {
    product: "peopleos",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    data: validatePeopleOsData(migrateLegacySchedulingData(mainCompatibleData))
  };
  return { envelope, counts: countData(envelope.data), migratedFromVersion: 4 };
}

function migrateSchemaFiveBackup(value: SchemaFiveBackupEnvelope): BackupPreview {
  if (!isIsoInstant(value.exportedAt)) throw new ValidationError(["backup exportedAt is invalid"]);
  const envelope: BackupEnvelope = {
    product: "peopleos",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    data: validatePeopleOsData(addConversationStarters(value.data))
  };
  return { envelope, counts: countData(envelope.data), migratedFromVersion: 5 };
}

export function previewBackup(input: string | unknown): BackupPreview {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      throw new ValidationError(["backup is not valid JSON"]);
    }
  }
  if (typeof value !== "object" || value === null) throw new ValidationError(["backup must be an object"]);
  const candidate = value as { product?: unknown; schemaVersion?: unknown };
  if (candidate.product !== "peopleos") throw new ValidationError(["backup is not a PeopleOS backup"]);
  if (typeof candidate.schemaVersion !== "number" || !Number.isInteger(candidate.schemaVersion)) throw new ValidationError(["backup schema version is missing"]);
  if (candidate.schemaVersion > BACKUP_SCHEMA_VERSION) throw new ValidationError(["backup was created by a newer unsupported PeopleOS version"]);
  if (candidate.schemaVersion === 0) return migrateLegacyBackup(value as LegacyBackupEnvelope);
  if (candidate.schemaVersion === 1) return migrateSchemaOneBackup(value as SchemaOneBackupEnvelope);
  if (candidate.schemaVersion === 2) return migrateSchemaTwoBackup(value as SchemaTwoBackupEnvelope);
  if (candidate.schemaVersion === 3) return migrateSchemaThreeBackup(value as SchemaThreeBackupEnvelope);
  if (candidate.schemaVersion === 4) return migrateSchemaFourBackup(value as SchemaFourBackupEnvelope);
  if (candidate.schemaVersion === 5) return migrateSchemaFiveBackup(value as SchemaFiveBackupEnvelope);
  const envelope = validateBackupEnvelope(value);
  return { envelope, counts: countData(envelope.data) };
}

export async function generateBackup(db: PeopleOsDatabase, now = new Date().toISOString()): Promise<GeneratedBackup> {
  const data = validatePeopleOsData(await readAllData(db));
  const envelope: BackupEnvelope = { product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: now, data };
  const json = JSON.stringify(envelope, null, 2);
  JSON.parse(json);

  const tx = db.transaction("metadata", "readwrite");
  const current = await tx.store.get("app") ?? createDefaultMetadata(now);
  await tx.store.put({ ...current, lastBackupGeneratedAt: now, updatedAt: now });
  await tx.done;

  return {
    envelope,
    json,
    fileName: `peopleos-backup-${now.slice(0, 10)}.json`,
    counts: countData(data)
  };
}

export async function restoreBackup(
  db: PeopleOsDatabase,
  preview: BackupPreview,
  now = new Date().toISOString(),
  hooks: RestoreHooks = {}
): Promise<void> {
  const data = validatePeopleOsData(preview.envelope.data);
  const stores = [...DATA_STORE_NAMES, "metadata"] as const;
  const tx = db.transaction(stores, "readwrite");
  try {
    for (const storeName of DATA_STORE_NAMES) {
      const store = tx.objectStore(storeName);
      await store.clear();
      for (const record of data[storeName]) await store.add(record as never);
    }
    const previous = await tx.objectStore("metadata").get("app");
    const metadata = previous ?? createDefaultMetadata(now);
    await tx.objectStore("metadata").put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: now
    });
    await hooks.beforeCommit?.();
    await tx.done;
  } catch (error) {
    tx.abort();
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}
