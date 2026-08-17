import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS,
  DEFAULT_CONVERSATION_STARTERS,
  isOriginalConversationStarterSet,
  DEFAULT_TODAY_NOTIFICATION_TIME,
  DATA_STORE_NAMES,
  type AppMetadata,
  type AppSettings,
  type ContactMethod,
  type ConversationStarterUse,
  type ExternalIdentity,
  type FollowUp,
  type FollowUpEvent,
  type Interaction,
  type MemoryFact,
  type OrganisationAffiliation,
  type PeopleOsData,
  type Person,
  type ReachOutContext,
  type ReachOutEntry,
  type ReachOutEvent,
  type RelationshipEvent,
  type TodaySkip
} from "../domain/schema";
import type { SyncOutboxOperation, SyncRecordMetadata, SyncState, SyncTombstone } from "../sync/types";
import { migrateLegacyPersonScheduling } from "./legacyCompatibility";

export interface PeopleOsDb extends DBSchema {
  people: { key: string; value: Person; indexes: { "by-updated": string } };
  contactMethods: { key: string; value: ContactMethod; indexes: { "by-person": string; "by-canonical": string } };
  externalIdentities: { key: string; value: ExternalIdentity; indexes: { "by-person": string; "by-provider": string } };
  affiliations: { key: string; value: OrganisationAffiliation; indexes: { "by-person": string; "by-organisation": string } };
  interactions: { key: string; value: Interaction; indexes: { "by-person": string; "by-event": string; "by-occurred": string } };
  events: { key: string; value: RelationshipEvent; indexes: { "by-name": string } };
  memoryFacts: { key: string; value: MemoryFact; indexes: { "by-person": string; "by-kind": string } };
  followUps: { key: string; value: FollowUp; indexes: { "by-person": string; "by-due": string; "by-status": string; "by-reach-out": string } };
  followUpEvents: { key: string; value: FollowUpEvent; indexes: { "by-follow-up": string; "by-person": string; "by-occurred": string } };
  conversationStarterUses: { key: string; value: ConversationStarterUse; indexes: { "by-person": string; "by-occurred": string } };
  todaySkips: { key: string; value: TodaySkip; indexes: { "by-person": string; "by-local-date": string } };
  reachOutEntries: { key: string; value: ReachOutEntry; indexes: { "by-person": string; "by-status": string; "by-updated": string } };
  reachOutEvents: { key: string; value: ReachOutEvent; indexes: { "by-entry": string; "by-occurred": string } };
  reachOutContexts: { key: string; value: ReachOutContext; indexes: { "by-kind": string; "by-label": string } };
  appSettings: { key: "app"; value: AppSettings };
  metadata: { key: "app"; value: AppMetadata };
  syncRecords: { key: string; value: SyncRecordMetadata; indexes: { "by-status": string } };
  syncOutbox: { key: string; value: SyncOutboxOperation; indexes: { "by-next-attempt": string } };
  syncTombstones: { key: string; value: SyncTombstone; indexes: { "by-retain-until": string } };
  syncState: { key: "app"; value: SyncState };
}

export type PeopleOsDatabase = IDBPDatabase<PeopleOsDb>;

export function defaultPhoneRegion(): string {
  try {
    const locale = new Intl.Locale(globalThis.navigator?.language ?? "en-GB");
    return locale.region && /^[A-Z]{2}$/.test(locale.region) ? locale.region : "GB";
  } catch {
    return "GB";
  }
}

export function createDefaultSettings(now = new Date().toISOString()): AppSettings {
  return {
    id: "app",
    defaultPhoneRegion: defaultPhoneRegion(),
    captureMode: "standard",
    relationshipContexts: ["personal", "professional"],
    alreadyContactedDefaultReminderDays: DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS,
    todaySummaryNotificationsEnabled: false,
    todaySummaryNotificationTime: DEFAULT_TODAY_NOTIFICATION_TIME,
    conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter })),
    revision: 1,
    createdAt: now,
    updatedAt: now
  };
}

function migrateAppSettings(settings: AppSettings): AppSettings {
  const legacy = settings as Partial<AppSettings> & Pick<AppSettings, "id" | "revision" | "createdAt" | "updatedAt">;
  const migrated = {
    ...settings,
    alreadyContactedDefaultReminderDays: legacy.alreadyContactedDefaultReminderDays
      ?? DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS,
    todaySummaryNotificationsEnabled: legacy.todaySummaryNotificationsEnabled ?? false,
    todaySummaryNotificationTime: legacy.todaySummaryNotificationTime
      ?? DEFAULT_TODAY_NOTIFICATION_TIME,
    // An install still holding the original six untouched starters receives the
    // larger default set. A list the user has edited is never overwritten.
    conversationStarters: legacy.conversationStarters === undefined
      || isOriginalConversationStarterSet(legacy.conversationStarters)
      ? DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter }))
      : legacy.conversationStarters,
    relationshipContexts: legacy.relationshipContexts
      ?? ["personal", "professional"]
  };
  return legacy.alreadyContactedDefaultReminderDays === undefined
    || legacy.todaySummaryNotificationsEnabled === undefined
    || legacy.todaySummaryNotificationTime === undefined
    || legacy.conversationStarters === undefined
    || isOriginalConversationStarterSet(legacy.conversationStarters)
    || legacy.relationshipContexts === undefined
    ? migrated
    : settings;
}

export function createDefaultMetadata(now = new Date().toISOString()): AppMetadata {
  return { id: "app", datasetRevision: 1, createdAt: now, updatedAt: now };
}

export function createDefaultSyncState(): SyncState {
  return {
    id: "app",
    enabled: false,
    installationId: globalThis.crypto?.randomUUID?.() ?? `installation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    initialMigrationPhase: "notStarted",
    lastScannedDatasetRevision: 0,
    retryCount: 0,
    accountStatus: "unknown"
  };
}

export async function openPeopleOsDatabase(
  databaseName = DATABASE_NAME,
  now = new Date().toISOString()
): Promise<PeopleOsDatabase> {
  const db = await openDB<PeopleOsDb>(databaseName, DATABASE_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
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

        const events = database.createObjectStore("events", { keyPath: "id" });
        events.createIndex("by-name", "name");

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
      }

      // Both histories shipped DATABASE_VERSION 3, but origin/main's v3 did
      // not contain Contacts/iCloud stores. Version 4 must therefore inspect
      // the actual schema rather than infer it from oldVersion alone.
      const identities = database.objectStoreNames.contains("externalIdentities")
        ? transaction.objectStore("externalIdentities")
        : database.createObjectStore("externalIdentities", { keyPath: "id" });
      if (!identities.indexNames.contains("by-person")) identities.createIndex("by-person", "personId");
      if (!identities.indexNames.contains("by-provider")) identities.createIndex("by-provider", "provider");

      const syncRecords = database.objectStoreNames.contains("syncRecords")
        ? transaction.objectStore("syncRecords")
        : database.createObjectStore("syncRecords", { keyPath: "key" });
      if (!syncRecords.indexNames.contains("by-status")) syncRecords.createIndex("by-status", "status");

      const syncOutbox = database.objectStoreNames.contains("syncOutbox")
        ? transaction.objectStore("syncOutbox")
        : database.createObjectStore("syncOutbox", { keyPath: "id" });
      if (!syncOutbox.indexNames.contains("by-next-attempt")) {
        syncOutbox.createIndex("by-next-attempt", "nextAttemptAt");
      }

      const syncTombstones = database.objectStoreNames.contains("syncTombstones")
        ? transaction.objectStore("syncTombstones")
        : database.createObjectStore("syncTombstones", { keyPath: "key" });
      if (!syncTombstones.indexNames.contains("by-retain-until")) {
        syncTombstones.createIndex("by-retain-until", "retainUntil");
      }

      if (!database.objectStoreNames.contains("syncState")) {
        database.createObjectStore("syncState", { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains("conversationStarterUses")) {
        const starterUses = database.createObjectStore("conversationStarterUses", { keyPath: "id" });
        starterUses.createIndex("by-person", "personId");
        starterUses.createIndex("by-occurred", "occurredAt");
      }

      if (oldVersion < 4) {
        const people = transaction.objectStore("people");
        const schedulingStoresAvailable = database.objectStoreNames.contains("interactions")
          && database.objectStoreNames.contains("followUps")
          && database.objectStoreNames.contains("followUpEvents");
        const interactions = schedulingStoresAvailable
          ? transaction.objectStore("interactions")
          : undefined;
        const followUps = schedulingStoresAvailable
          ? transaction.objectStore("followUps")
          : undefined;
        const followUpEvents = schedulingStoresAvailable
          ? transaction.objectStore("followUpEvents")
          : undefined;
        void people.openCursor().then(async function migrateMainV3(cursor): Promise<void> {
          if (!cursor) return;
          const person = cursor.value.relationshipMode
            ? cursor.value
            : { ...cursor.value, relationshipMode: "personal" as const };
          const [personInteractions, personFollowUps, personFollowUpEvents] = interactions
            && followUps && followUpEvents
            ? await Promise.all([
              interactions.index("by-person").getAll(person.id),
              followUps.index("by-person").getAll(person.id),
              followUpEvents.index("by-person").getAll(person.id)
            ])
            : [[], [], []];
          const migrated = migrateLegacyPersonScheduling(
            person,
            personInteractions,
            personFollowUps,
            personFollowUpEvents
          );
          if (JSON.stringify(migrated.person) !== JSON.stringify(cursor.value)) {
            await cursor.update(migrated.person);
          }
          if (migrated.followUp && migrated.followUpEvent && followUps && followUpEvents) {
            const [occupiedFollowUp, occupiedEvent] = await Promise.all([
              followUps.get(migrated.followUp.id),
              followUpEvents.get(migrated.followUpEvent.id)
            ]);
            if (!occupiedFollowUp && !occupiedEvent) {
              await followUps.add(migrated.followUp);
              await followUpEvents.add(migrated.followUpEvent);
            }
          }
          const nextCursor = await cursor.continue();
          await migrateMainV3(nextCursor);
        });
      }
    }
  });

  const tx = db.transaction(["appSettings", "metadata", "syncState"], "readwrite");
  const settings = await tx.objectStore("appSettings").get("app");
  const metadata = await tx.objectStore("metadata").get("app");
  const syncState = await tx.objectStore("syncState").get("app");
  if (!settings) {
    await tx.objectStore("appSettings").add(createDefaultSettings(now));
  } else {
    const migratedSettings = migrateAppSettings(settings);
    if (JSON.stringify(migratedSettings) !== JSON.stringify(settings)) await tx.objectStore("appSettings").put(migratedSettings);
  }
  if (!metadata) await tx.objectStore("metadata").add(createDefaultMetadata(now));
  if (!syncState) await tx.objectStore("syncState").add(createDefaultSyncState());
  await tx.done;
  return db;
}

export async function deletePeopleOsDatabase(databaseName = DATABASE_NAME): Promise<void> {
  await deleteDB(databaseName);
}

export async function readAllData(db: PeopleOsDatabase): Promise<PeopleOsData> {
  const tx = db.transaction(DATA_STORE_NAMES, "readonly");
  const entries = await Promise.all(DATA_STORE_NAMES.map(async (name) => [name, await tx.objectStore(name).getAll()] as const));
  await tx.done;
  return Object.fromEntries(entries) as PeopleOsData;
}
