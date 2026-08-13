import type { PeopleOsDatabase } from "../data/database";
import { StaleRevisionError } from "../data/repositories";
import type { AppSettings, ConversationStarter } from "../domain/schema";
import {
  assertValidRecord,
  isIsoInstant,
  validateConversationStarters,
  ValidationError
} from "../domain/validation";

export type UpdateAlreadyContactedDefaultCommand = {
  expectedRevision: number;
  days: number;
  occurredAt: string;
};

export type UpdateTodaySummaryNotificationSettingsCommand = {
  expectedRevision: number;
  enabled: boolean;
  time: string;
  occurredAt: string;
};

export type UpdateConversationStartersCommand = {
  expectedRevision: number;
  starters: ConversationStarter[];
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

function validateTodaySummaryCommand(command: UpdateTodaySummaryNotificationSettingsCommand): void {
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
    throw new ValidationError(["The Settings revision is invalid."]);
  }
  if (typeof command.enabled !== "boolean") {
    throw new ValidationError(["The notification setting is invalid."]);
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(command.time)) {
    throw new ValidationError(["Choose a valid reminder time."]);
  }
  if (!isIsoInstant(command.occurredAt)) {
    throw new ValidationError(["The Settings update time is invalid."]);
  }
}

function isExactTodaySummaryRetry(
  settings: AppSettings,
  command: UpdateTodaySummaryNotificationSettingsCommand
): boolean {
  return settings.revision === command.expectedRevision + 1
    && settings.todaySummaryNotificationsEnabled === command.enabled
    && settings.todaySummaryNotificationTime === command.time
    && settings.updatedAt === command.occurredAt;
}

function validateConversationStartersCommand(command: UpdateConversationStartersCommand): void {
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
    throw new ValidationError(["The Settings revision is invalid."]);
  }
  if (!validateConversationStarters(command.starters)) {
    throw new ValidationError([
      "Keep 1 to 100 valid conversation starters, including Personal and Professional options."
    ]);
  }
  if (!isIsoInstant(command.occurredAt)) {
    throw new ValidationError(["The Settings update time is invalid."]);
  }
}

function sameConversationStarters(
  left: readonly ConversationStarter[],
  right: readonly ConversationStarter[]
): boolean {
  return left.length === right.length && left.every((starter, index) => {
    const other = right[index];
    return other !== undefined
      && starter.id === other.id
      && starter.template === other.template
      && starter.relationshipMode === other.relationshipMode;
  });
}

function isExactConversationStartersRetry(
  settings: AppSettings,
  command: UpdateConversationStartersCommand
): boolean {
  return settings.revision === command.expectedRevision + 1
    && sameConversationStarters(settings.conversationStarters, command.starters)
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

export async function updateTodaySummaryNotificationSettings(
  db: PeopleOsDatabase,
  command: UpdateTodaySummaryNotificationSettingsCommand,
  hooks: SettingsMutationHooks = {}
): Promise<AppSettings> {
  validateTodaySummaryCommand(command);
  const tx = db.transaction(["appSettings", "metadata"], "readwrite");
  try {
    const settingsStore = tx.objectStore("appSettings");
    const metadataStore = tx.objectStore("metadata");
    const current = await settingsStore.get("app");
    if (!current) throw new Error("PeopleOS settings are missing");
    if (isExactTodaySummaryRetry(current, command)) {
      await tx.done;
      return current;
    }
    if (current.revision !== command.expectedRevision) throw new StaleRevisionError();

    const updated: AppSettings = {
      ...current,
      todaySummaryNotificationsEnabled: command.enabled,
      todaySummaryNotificationTime: command.time,
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

export async function updateConversationStarters(
  db: PeopleOsDatabase,
  command: UpdateConversationStartersCommand,
  hooks: SettingsMutationHooks = {}
): Promise<AppSettings> {
  validateConversationStartersCommand(command);
  const tx = db.transaction(["appSettings", "metadata"], "readwrite");
  try {
    const settingsStore = tx.objectStore("appSettings");
    const metadataStore = tx.objectStore("metadata");
    const current = await settingsStore.get("app");
    if (!current) throw new Error("PeopleOS settings are missing");
    if (isExactConversationStartersRetry(current, command)) {
      await tx.done;
      return current;
    }
    if (current.revision !== command.expectedRevision) throw new StaleRevisionError();

    const updated: AppSettings = {
      ...current,
      conversationStarters: command.starters.map((starter) => ({ ...starter })),
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
