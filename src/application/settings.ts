import type { PeopleOsDatabase } from "../data/database";
import { StaleRevisionError } from "../data/repositories";
import type { AppSettings } from "../domain/schema";
import { assertValidRecord, isIsoInstant, ValidationError } from "../domain/validation";

export type UpdateAlreadyContactedDefaultCommand = {
  expectedRevision: number;
  days: number;
  occurredAt: string;
};

export type SettingsMutationHooks = {
  beforeCommit?: () => void;
};

function validateCommand(command: UpdateAlreadyContactedDefaultCommand): void {
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
    throw new ValidationError(["The Settings revision is invalid."]);
  }
  if (!Number.isInteger(command.days) || command.days < 1 || command.days > 3_650) {
    throw new ValidationError(["Enter a whole number from 1 to 3650 days."]);
  }
  if (!isIsoInstant(command.occurredAt)) {
    throw new ValidationError(["The Settings update time is invalid."]);
  }
}

function isExactRetry(
  settings: AppSettings,
  command: UpdateAlreadyContactedDefaultCommand
): boolean {
  return settings.revision === command.expectedRevision + 1
    && settings.alreadyContactedDefaultReminderDays === command.days
    && settings.updatedAt === command.occurredAt;
}

export async function updateAlreadyContactedDefault(
  db: PeopleOsDatabase,
  command: UpdateAlreadyContactedDefaultCommand,
  hooks: SettingsMutationHooks = {}
): Promise<AppSettings> {
  validateCommand(command);
  const tx = db.transaction(["appSettings", "metadata"], "readwrite");
  try {
    const settingsStore = tx.objectStore("appSettings");
    const metadataStore = tx.objectStore("metadata");
    const current = await settingsStore.get("app");
    if (!current) throw new Error("PeopleOS settings are missing");
    if (isExactRetry(current, command)) {
      await tx.done;
      return current;
    }
    if (current.revision !== command.expectedRevision) throw new StaleRevisionError();

    const updated: AppSettings = {
      ...current,
      alreadyContactedDefaultReminderDays: command.days,
      revision: current.revision + 1,
      updatedAt: command.occurredAt
    };
    assertValidRecord("appSettings", updated);

    const metadata = await metadataStore.get("app");
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await settingsStore.put(updated);
    await metadataStore.put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: command.occurredAt
    });
    hooks.beforeCommit?.();
    await tx.done;
    return updated;
  } catch (error) {
    try { tx.abort(); } catch { /* transaction already closed */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}

export async function updateRelationshipContexts(
  db: PeopleOsDatabase,
  contexts: Array<"personal" | "professional">,
  now = new Date().toISOString()
): Promise<AppSettings> {
  if (contexts.length < 1 || contexts.length > 2 || new Set(contexts).size !== contexts.length) {
    throw new ValidationError(["Keep at least one relationship type enabled."]);
  }
  const tx = db.transaction(["appSettings", "metadata"], "readwrite");
  const settingsStore = tx.objectStore("appSettings");
  const metadataStore = tx.objectStore("metadata");
  const current = await settingsStore.get("app");
  const metadata = await metadataStore.get("app");
  if (!current || !metadata) throw new Error("PeopleOS settings are missing");
  const updated: AppSettings = {
    ...current,
    relationshipContexts: contexts,
    revision: current.revision + 1,
    updatedAt: now
  };
  assertValidRecord("appSettings", updated);
  await settingsStore.put(updated);
  await metadataStore.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now });
  await tx.done;
  return updated;
}
