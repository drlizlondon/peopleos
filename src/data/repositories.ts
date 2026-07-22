import type { IDBPDatabase } from "idb";
import type { PeopleOsDb, PeopleOsDatabase } from "./database";
import type {
  AppSettings,
  ContactMethod,
  FollowUp,
  FollowUpEvent,
  Interaction,
  MemoryFact,
  OrganisationAffiliation,
  Person,
  ReachOutContext,
  ReachOutEntry,
  ReachOutEvent,
  RelationshipEvent,
  TodaySkip
} from "../domain/schema";
import { assertValidRecord, isMutableRecord } from "../domain/validation";

export class RecordConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordConflictError";
  }
}

export class StaleRevisionError extends Error {
  constructor() {
    super("This changed elsewhere—reload and try again.");
    this.name = "StaleRevisionError";
  }
}

type MutableStoreName = "people" | "contactMethods" | "affiliations" | "interactions" | "events" | "memoryFacts" | "followUps" | "reachOutEntries" | "reachOutContexts" | "appSettings";

type StoreRecords = {
  people: Person;
  contactMethods: ContactMethod;
  affiliations: OrganisationAffiliation;
  interactions: Interaction;
  events: RelationshipEvent;
  memoryFacts: MemoryFact;
  followUps: FollowUp;
  reachOutEntries: ReachOutEntry;
  reachOutContexts: ReachOutContext;
  appSettings: AppSettings;
};

type AppendOnlyStoreRecords = {
  followUpEvents: FollowUpEvent;
  todaySkips: TodaySkip;
  reachOutEvents: ReachOutEvent;
};

function identical(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function assertWriteReferences<S extends MutableStoreName>(db: PeopleOsDatabase, store: S, record: StoreRecords[S]): Promise<void> {
  if ("personId" in record) {
    const person = await db.get("people", String(record.personId));
    if (!person) throw new RecordConflictError(`${store}.${record.id} references missing person ${String(record.personId)}`);
  }
  if (store === "interactions") {
    const interaction = record as Interaction;
    if (interaction.eventId && !await db.get("events", interaction.eventId)) throw new RecordConflictError(`interactions.${record.id} references missing event`);
    if (interaction.relatedPersonId && !await db.get("people", interaction.relatedPersonId)) throw new RecordConflictError(`interactions.${record.id} references missing related person`);
    if (interaction.followUpId && !await db.get("followUps", interaction.followUpId)) throw new RecordConflictError(`interactions.${record.id} references missing follow-up`);
  }
  if (store === "memoryFacts") {
    const fact = record as MemoryFact;
    if (fact.relatedPersonId && !await db.get("people", fact.relatedPersonId)) throw new RecordConflictError(`memoryFacts.${record.id} references missing related person`);
    if (fact.sourceInteractionId && !await db.get("interactions", fact.sourceInteractionId)) throw new RecordConflictError(`memoryFacts.${record.id} references missing interaction`);
  }
  if (store === "followUps") {
    const followUp = record as FollowUp;
    if (followUp.reachOutEntryId && !await db.get("reachOutEntries", followUp.reachOutEntryId)) throw new RecordConflictError(`followUps.${record.id} references missing Reach Out entry`);
  }
  if (store === "reachOutEntries") {
    const entry = record as ReachOutEntry;
    if (entry.currentFollowUpId && !await db.get("followUps", entry.currentFollowUpId)) throw new RecordConflictError(`reachOutEntries.${record.id} references missing follow-up`);
    for (const contextId of entry.contextIds) if (!await db.get("reachOutContexts", contextId)) throw new RecordConflictError(`reachOutEntries.${record.id} references missing context`);
    const existing = await db.getAllFromIndex("reachOutEntries", "by-person", entry.personId);
    if (existing.some((candidate) => candidate.id !== entry.id && !candidate.removedAt && candidate.intentStatus !== "completed") && !entry.removedAt && entry.intentStatus !== "completed") {
      throw new RecordConflictError(`person ${entry.personId} already has a current Reach Out entry`);
    }
  }
  if (store === "reachOutContexts") {
    const context = record as ReachOutContext;
    if (context.eventId && !await db.get("events", context.eventId)) throw new RecordConflictError(`reachOutContexts.${record.id} references missing event`);
  }
}

export class MutableRepository<S extends MutableStoreName> {
  constructor(private readonly db: PeopleOsDatabase, readonly store: S) {}

  async get(id: string): Promise<StoreRecords[S] | undefined> {
    return this.db.get(this.store, id as never) as Promise<StoreRecords[S] | undefined>;
  }

  async list(): Promise<StoreRecords[S][]> {
    return this.db.getAll(this.store) as Promise<StoreRecords[S][]>;
  }

  async create(record: StoreRecords[S]): Promise<StoreRecords[S]> {
    assertValidRecord(this.store, record);
    await assertWriteReferences(this.db, this.store, record);
    const tx = this.db.transaction([this.store, "metadata"] as never, "readwrite");
    const recordStore = tx.objectStore(this.store as never) as ReturnType<typeof tx.objectStore>;
    const existing = await recordStore.get(record.id as never) as StoreRecords[S] | undefined;
    if (existing) {
      if (identical(existing, record)) {
        await tx.done;
        return existing;
      }
      throw new RecordConflictError(`${this.store} already contains id ${record.id}`);
    }
    await recordStore.add(record as never);
    const metadataStore = tx.objectStore("metadata" as never);
    const metadata = await metadataStore.get("app" as never) as { datasetRevision: number; updatedAt: string } | undefined;
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await metadataStore.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: record.updatedAt } as never);
    await tx.done;
    return record;
  }

  async update(record: StoreRecords[S], expectedRevision: number, now = new Date().toISOString()): Promise<StoreRecords[S]> {
    if (!isMutableRecord(record)) throw new Error(`${this.store} cannot be revision-updated`);
    assertValidRecord(this.store, record);
    await assertWriteReferences(this.db, this.store, record);
    const tx = this.db.transaction([this.store, "metadata"] as never, "readwrite");
    const recordStore = tx.objectStore(this.store as never) as ReturnType<typeof tx.objectStore>;
    const existing = await recordStore.get(record.id as never) as StoreRecords[S] | undefined;
    if (!existing) {
      throw new RecordConflictError(`${this.store} does not contain id ${record.id}`);
    }
    if (!isMutableRecord(existing) || existing.revision !== expectedRevision) {
      throw new StaleRevisionError();
    }
    const updated = { ...record, revision: expectedRevision + 1, createdAt: existing.createdAt, updatedAt: now } as StoreRecords[S];
    assertValidRecord(this.store, updated);
    await recordStore.put(updated as never);
    const metadataStore = tx.objectStore("metadata" as never);
    const metadata = await metadataStore.get("app" as never) as { datasetRevision: number; updatedAt: string } | undefined;
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await metadataStore.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now } as never);
    await tx.done;
    return updated;
  }
}

export class PersonRepository extends MutableRepository<"people"> {
  constructor(db: PeopleOsDatabase) {
    super(db, "people");
  }

  async archive(id: string, expectedRevision: number, now = new Date().toISOString()): Promise<Person> {
    const person = await this.get(id);
    if (!person) throw new RecordConflictError(`people does not contain id ${id}`);
    return this.update({ ...person, archivedAt: now }, expectedRevision, now);
  }

  async restore(id: string, expectedRevision: number, now = new Date().toISOString()): Promise<Person> {
    const person = await this.get(id);
    if (!person) throw new RecordConflictError(`people does not contain id ${id}`);
    const { archivedAt: _archivedAt, ...active } = person;
    return this.update(active as Person, expectedRevision, now);
  }
}

export function createRepositories(db: PeopleOsDatabase) {
  return {
    people: new PersonRepository(db),
    contactMethods: new MutableRepository(db, "contactMethods"),
    affiliations: new MutableRepository(db, "affiliations"),
    interactions: new MutableRepository(db, "interactions"),
    events: new MutableRepository(db, "events"),
    memoryFacts: new MutableRepository(db, "memoryFacts"),
    followUps: new MutableRepository(db, "followUps"),
    reachOutEntries: new MutableRepository(db, "reachOutEntries"),
    reachOutContexts: new MutableRepository(db, "reachOutContexts"),
    appSettings: new MutableRepository(db, "appSettings")
  };
}

export async function createAppendOnlyRecord<S extends keyof AppendOnlyStoreRecords>(
  db: IDBPDatabase<PeopleOsDb>,
  store: S,
  record: AppendOnlyStoreRecords[S]
): Promise<void> {
  assertValidRecord(store, record);
  const candidate = record as Record<string, unknown>;
  if (store === "todaySkips" && !await db.get("people", String(candidate.personId))) throw new RecordConflictError(`${store}.${record.id} references missing person`);
  if (store === "followUpEvents") {
    const followUp = await db.get("followUps", String(candidate.followUpId));
    if (!followUp || followUp.personId !== candidate.personId) throw new RecordConflictError(`${store}.${record.id} references missing or incompatible follow-up`);
  }
  if (store === "reachOutEvents" && !await db.get("reachOutEntries", String(candidate.reachOutEntryId))) throw new RecordConflictError(`${store}.${record.id} references missing Reach Out entry`);
  const now = String(candidate.occurredAt ?? candidate.createdAt ?? new Date().toISOString());
  const tx = db.transaction([store, "metadata"] as never, "readwrite");
  const recordStore = tx.objectStore(store as never);
  const existing = await recordStore.get(record.id as never);
  if (existing) {
    if (identical(existing, record)) {
      await tx.done;
      return;
    }
    throw new RecordConflictError(`${store} already contains id ${record.id}`);
  }
  await recordStore.add(record as never);
  const metadataStore = tx.objectStore("metadata" as never);
  const metadata = await metadataStore.get("app" as never) as { datasetRevision: number; updatedAt: string } | undefined;
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  await metadataStore.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now } as never);
  await tx.done;
}
