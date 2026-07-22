import type { IDBPObjectStore, StoreNames } from "idb";
import type { PeopleOsDatabase, PeopleOsDb } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import {
  interactionKindIsManuallySelectable
} from "../domain/interactionPolicy";
import type {
  Interaction,
  InteractionKind,
  Person,
  RelationshipEvent
} from "../domain/schema";
import { assertValidRecord, isIsoInstant, isLocalDate, ValidationError } from "../domain/validation";

export type InteractionCommandOrigin =
  | "manual"
  | "note"
  | "already_contacted"
  | "follow_up_completion";

export type RelationshipEventDraft = {
  id: string;
  name: string;
  occurredOn?: string;
  location?: string;
  createdAt: string;
};

export type InteractionDraft = {
  id: string;
  personId: string;
  kind: InteractionKind;
  occurredAt: string;
  summary?: string;
  eventId?: string;
  newEvent?: RelationshipEventDraft;
  relatedPersonId?: string;
  followUpId?: string;
  createdAt: string;
  origin: InteractionCommandOrigin;
};

export type InteractionMutationHooks = {
  beforeCommit?: () => void;
};

export class DuplicateEventError extends Error {
  constructor(public readonly existingEvent: RelationshipEvent) {
    super("An event with this name and date already exists. Select the existing event instead.");
    this.name = "DuplicateEventError";
  }
}

export class LifecycleOwnedInteractionError extends Error {
  constructor() {
    super("This interaction belongs to reminder history and must be changed from its follow-up.");
    this.name = "LifecycleOwnedInteractionError";
  }
}

type DraftOptions = {
  now?: string;
  idFactory?: () => string;
  kind?: InteractionKind;
  origin?: InteractionCommandOrigin;
};

export function createInteractionDraft(
  personId: string,
  options: DraftOptions = {}
): InteractionDraft {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  return {
    id: `interaction-${idFactory()}`,
    personId,
    kind: options.kind ?? "met",
    occurredAt: now,
    createdAt: now,
    origin: options.origin ?? (options.kind === "note_added" ? "note" : "manual")
  };
}

export function createRelationshipEventDraft(
  options: { now?: string; idFactory?: () => string } = {}
): RelationshipEventDraft {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  return {
    id: `event-${idFactory()}`,
    name: "",
    createdAt: options.now ?? new Date().toISOString()
  };
}

export function normalizeEventName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function validateCommandKind(kind: InteractionKind, origin: InteractionCommandOrigin): void {
  if (kind === "contacted" && origin !== "already_contacted") {
    throw new ValidationError(["Contacted can only be recorded from the explicit Already contacted action."]);
  }
  if (kind === "follow_up_completed" && origin !== "follow_up_completion") {
    throw new ValidationError(["Follow-up completion must be recorded by the follow-up workflow."]);
  }
  if (kind === "note_added" && origin !== "note") {
    throw new ValidationError(["Use Add note to record a free-form note."]);
  }
  if (!["contacted", "follow_up_completed", "note_added"].includes(kind)
    && !interactionKindIsManuallySelectable(kind)) {
    throw new ValidationError(["Choose an available interaction kind."]);
  }
}

function validateEventDraft(draft: RelationshipEventDraft): RelationshipEvent {
  const issues: string[] = [];
  const name = draft.name.trim().replace(/\s+/g, " ");
  const location = trimmed(draft.location);
  if (!name) issues.push("Add an event name.");
  if (name.length > 120) issues.push("Event name must be 120 characters or fewer.");
  if (draft.occurredOn && !isLocalDate(draft.occurredOn)) issues.push("Choose a valid event date.");
  if (!isIsoInstant(draft.createdAt)) issues.push("The event draft needs a valid creation time.");
  if (!draft.id.trim()) issues.push("The event draft needs a stable ID.");
  if (issues.length) throw new ValidationError(issues);
  const event: RelationshipEvent = {
    id: draft.id,
    revision: 1,
    name,
    ...(draft.occurredOn ? { occurredOn: draft.occurredOn } : {}),
    ...(location ? { location } : {}),
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt
  };
  assertValidRecord("events", event);
  return event;
}

function prepareInteraction(
  draft: InteractionDraft,
  now: string,
  current?: Interaction
): { interaction: Interaction; newEvent?: RelationshipEvent } {
  const issues: string[] = [];
  validateCommandKind(draft.kind, draft.origin);
  if (!draft.id.trim()) issues.push("The interaction draft needs a stable ID.");
  if (!draft.personId.trim()) issues.push("Choose a person.");
  if (!isIsoInstant(draft.occurredAt)) issues.push("Choose a valid date and time.");
  else if (Date.parse(draft.occurredAt) > Date.parse(now)) issues.push("An interaction cannot be in the future.");
  if (!isIsoInstant(draft.createdAt)) issues.push("The interaction draft needs a valid creation time.");
  const summary = trimmed(draft.summary);
  if ((draft.summary ?? "").trim().length > 5_000) issues.push("Summary must be 5,000 characters or fewer.");
  if (draft.kind === "note_added" && !summary) issues.push("Add a note before saving.");
  if ((draft.kind === "introduction_received" || draft.kind === "introduction_made")
    && !draft.relatedPersonId && !summary) {
    issues.push("Choose the related person or add their name in the summary.");
  }
  if (draft.relatedPersonId === draft.personId) issues.push("Choose someone other than this person as the related person.");
  if (draft.eventId && draft.newEvent) issues.push("Choose an existing event or create a new one, not both.");
  if (draft.followUpId && !["already_contacted", "follow_up_completion"].includes(draft.origin)) {
    issues.push("A follow-up can only be linked by its completion workflow.");
  }
  if (issues.length) throw new ValidationError(issues);

  const newEvent = draft.newEvent ? validateEventDraft(draft.newEvent) : undefined;
  const eventId = draft.eventId ?? newEvent?.id;
  const interaction: Interaction = {
    id: draft.id,
    revision: current ? current.revision + 1 : 1,
    personId: current?.personId ?? draft.personId,
    kind: draft.kind,
    occurredAt: draft.occurredAt,
    ...(summary ? { summary } : {}),
    ...(eventId ? { eventId } : {}),
    ...(draft.relatedPersonId ? { relatedPersonId: draft.relatedPersonId } : {}),
    ...(draft.followUpId ? { followUpId: draft.followUpId } : {}),
    createdAt: current?.createdAt ?? draft.createdAt,
    updatedAt: current ? now : draft.createdAt
  };
  assertValidRecord("interactions", interaction);
  return { interaction, ...(newEvent ? { newEvent } : {}) };
}

function identical(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireWritablePerson(person: Person | undefined): Person {
  if (!person) throw new RecordConflictError("This person is no longer available.");
  if (person.archivedAt || person.identityStatus === "merged") {
    throw new RecordConflictError("Restore or open the current Person before recording an interaction.");
  }
  return person;
}

async function validateReferences(
  stores: {
    people: IDBPObjectStore<PeopleOsDb, StoreNames<PeopleOsDb>[], "people", "readwrite">;
    events: IDBPObjectStore<PeopleOsDb, StoreNames<PeopleOsDb>[], "events", "readwrite">;
    followUps: IDBPObjectStore<PeopleOsDb, StoreNames<PeopleOsDb>[], "followUps", "readwrite">;
  },
  interaction: Interaction,
  newEvent?: RelationshipEvent
): Promise<void> {
  requireWritablePerson(await stores.people.get(interaction.personId));
  if (interaction.relatedPersonId && !await stores.people.get(interaction.relatedPersonId)) {
    throw new RecordConflictError("The related person is no longer available.");
  }
  if (interaction.eventId && interaction.eventId !== newEvent?.id && !await stores.events.get(interaction.eventId)) {
    throw new RecordConflictError("The selected event is no longer available.");
  }
  if (interaction.followUpId) {
    const followUp = await stores.followUps.get(interaction.followUpId);
    if (!followUp || followUp.personId !== interaction.personId) {
      throw new RecordConflictError("The linked follow-up is no longer available.");
    }
  }
}

async function requireUniqueEvent(
  eventStore: IDBPObjectStore<PeopleOsDb, StoreNames<PeopleOsDb>[], "events", "readwrite">,
  event: RelationshipEvent
): Promise<void> {
  const sameName = (await eventStore.getAll()).find((candidate) =>
    candidate.id !== event.id
    && normalizeEventName(candidate.name) === normalizeEventName(event.name)
    && candidate.occurredOn === event.occurredOn
  );
  if (sameName) throw new DuplicateEventError(sameName);
}

async function putNewEvent(
  eventStore: IDBPObjectStore<PeopleOsDb, StoreNames<PeopleOsDb>[], "events", "readwrite">,
  event: RelationshipEvent | undefined
): Promise<void> {
  if (!event) return;
  const existing = await eventStore.get(event.id);
  if (existing) {
    if (identical(existing, event)) return;
    throw new RecordConflictError(`events already contains id ${event.id}`);
  }
  await requireUniqueEvent(eventStore, event);
  await eventStore.add(event);
}

async function updateMetadata<Names extends ArrayLike<StoreNames<PeopleOsDb>>>(
  store: IDBPObjectStore<PeopleOsDb, Names, "metadata", "readwrite">,
  now: string
): Promise<void> {
  const metadata = await store.get("app");
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  await store.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now });
}

async function abortAndRethrow(transaction: { abort: () => void; done: Promise<unknown> }, error: unknown): Promise<never> {
  try { transaction.abort(); } catch { /* already completed or aborted */ }
  try { await transaction.done; } catch { /* expected rollback */ }
  throw error;
}

export async function createInteraction(
  db: PeopleOsDatabase,
  draft: InteractionDraft,
  now = new Date().toISOString(),
  hooks: InteractionMutationHooks = {}
): Promise<Interaction> {
  const prepared = prepareInteraction(draft, now);
  const tx = db.transaction(["people", "interactions", "events", "followUps", "metadata"], "readwrite");
  try {
    const interactionStore = tx.objectStore("interactions");
    const existing = await interactionStore.get(prepared.interaction.id);
    if (existing) {
      if (identical(existing, prepared.interaction)) {
        if (prepared.newEvent) {
          const storedEvent = await tx.objectStore("events").get(prepared.newEvent.id);
          if (!storedEvent || !identical(storedEvent, prepared.newEvent)) {
            throw new RecordConflictError(
              `events does not match the original compound create for id ${prepared.newEvent.id}`
            );
          }
        }
        await tx.done;
        return existing;
      }
      throw new RecordConflictError(`interactions already contains id ${prepared.interaction.id}`);
    }
    const stores = {
      people: tx.objectStore("people"),
      events: tx.objectStore("events"),
      followUps: tx.objectStore("followUps")
    };
    await validateReferences(stores, prepared.interaction, prepared.newEvent);
    await putNewEvent(stores.events, prepared.newEvent);
    await interactionStore.add(prepared.interaction);
    await updateMetadata(tx.objectStore("metadata"), prepared.interaction.updatedAt);
    hooks.beforeCommit?.();
    await tx.done;
    return prepared.interaction;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export async function updateInteraction(
  db: PeopleOsDatabase,
  draft: InteractionDraft,
  expectedRevision: number,
  now = new Date().toISOString(),
  hooks: InteractionMutationHooks = {}
): Promise<Interaction> {
  const tx = db.transaction(["people", "interactions", "events", "followUps", "followUpEvents", "reachOutEvents", "metadata"], "readwrite");
  try {
    const interactionStore = tx.objectStore("interactions");
    const current = await interactionStore.get(draft.id);
    if (!current) throw new RecordConflictError(`interactions does not contain id ${draft.id}`);
    if (current.revision !== expectedRevision) throw new StaleRevisionError();
    if (current.personId !== draft.personId) throw new RecordConflictError("An interaction cannot be moved to another person.");
    const [followUpLinks, reachOutLinks] = await Promise.all([
      tx.objectStore("followUpEvents").getAll(),
      tx.objectStore("reachOutEvents").getAll()
    ]);
    if (current.followUpId
      || followUpLinks.some((event) => event.interactionId === current.id)
      || reachOutLinks.some((event) => event.interactionId === current.id)) {
      throw new LifecycleOwnedInteractionError();
    }
    const prepared = prepareInteraction(draft, now, current);
    const stores = {
      people: tx.objectStore("people"),
      events: tx.objectStore("events"),
      followUps: tx.objectStore("followUps")
    };
    await validateReferences(stores, prepared.interaction, prepared.newEvent);
    await putNewEvent(stores.events, prepared.newEvent);
    await interactionStore.put(prepared.interaction);
    await updateMetadata(tx.objectStore("metadata"), now);
    hooks.beforeCommit?.();
    await tx.done;
    return prepared.interaction;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export async function deleteInteraction(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  now = new Date().toISOString(),
  hooks: InteractionMutationHooks = {}
): Promise<void> {
  const tx = db.transaction([
    "people", "interactions", "memoryFacts", "followUpEvents", "reachOutEvents", "metadata"
  ], "readwrite");
  try {
    const interactionStore = tx.objectStore("interactions");
    const current = await interactionStore.get(id);
    if (!current) {
      await tx.done;
      return;
    }
    requireWritablePerson(await tx.objectStore("people").get(current.personId));
    if (current.revision !== expectedRevision) throw new StaleRevisionError();
    const [followUpLinks, reachOutLinks] = await Promise.all([
      tx.objectStore("followUpEvents").getAll(),
      tx.objectStore("reachOutEvents").getAll()
    ]);
    if (current.followUpId
      || followUpLinks.some((event) => event.interactionId === current.id)
      || reachOutLinks.some((event) => event.interactionId === current.id)) {
      throw new LifecycleOwnedInteractionError();
    }
    const factStore = tx.objectStore("memoryFacts");
    const facts = await factStore.getAll();
    for (const fact of facts.filter((candidate) => candidate.sourceInteractionId === id)) {
      const { sourceInteractionId: _sourceInteractionId, ...withoutSource } = fact;
      await factStore.put({
        ...withoutSource,
        revision: fact.revision + 1,
        updatedAt: now
      });
    }
    await interactionStore.delete(id);
    await updateMetadata(tx.objectStore("metadata"), now);
    hooks.beforeCommit?.();
    await tx.done;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}
