import type { IDBPObjectStore, StoreNames } from "idb";
import type { PeopleOsDatabase, PeopleOsDb } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import {
  addDaysToLocalDate,
  effectiveFollowUpDate,
  FOLLOW_UP_ACTION_OPTIONS,
  localDateForInstant
} from "../domain/followUpPolicy";
import { interactionCountsAsContact, interactionKindIsManuallySelectable } from "../domain/interactionPolicy";
import { commandFingerprint as fingerprintCommand } from "../domain/commandFingerprint";
import type {
  FollowUp,
  FollowUpActionType,
  FollowUpEvent,
  Interaction,
  InteractionKind,
  LocalDate,
  Person,
  ReachOutContext,
  ReachOutEntry,
  ReachOutEvent,
  ReachOutIntentStatus
} from "../domain/schema";
import { assertValidRecord, isIsoInstant, isLocalDate, ValidationError } from "../domain/validation";

export type ReachOutMutationHooks = {
  beforeCommit?: () => void;
};

export type NewReachOutContextInput = {
  kind: ReachOutContext["kind"];
  label: string;
  eventId?: string;
};

export type CreateReachOutInput = {
  person: Person | { provisionalLabel: string };
  reason?: string;
  intendedActionType?: FollowUpActionType;
  actionDetail?: string;
  notes?: string;
  existingContextIds?: string[];
  newContexts?: NewReachOutContextInput[];
  reminderDate?: LocalDate;
};

export type CreateReachOutCommand = {
  commandFingerprint: string;
  person:
    | { kind: "existing"; id: string; expectedRevision: number; displayName: string }
    | { kind: "provisional"; record: Person };
  entry: ReachOutEntry;
  addedEvent: ReachOutEvent;
  contextsToCreate: ReachOutContext[];
  followUp?: FollowUp;
  followUpEvent?: FollowUpEvent;
  linkedEvent?: ReachOutEvent;
  localDate: LocalDate;
};

export type CreateReachOutResult = {
  person: Person;
  entry: ReachOutEntry;
  contexts: ReachOutContext[];
  followUp?: FollowUp;
};

export type ReachOutPlanInput = {
  reason?: string;
  intendedActionType?: FollowUpActionType;
  actionDetail?: string;
  notes?: string;
  contextIds: string[];
  newContexts?: NewReachOutContextInput[];
  reminderDate?: LocalDate;
};

export type UpdateReachOutPlanCommand = {
  commandFingerprint: string;
  entryId: string;
  personId: string;
  expectedEntryRevision: number;
  expectedIntentStatus: ReachOutIntentStatus;
  expectedPersonRevision: number;
  expectedCurrentFollowUpId?: string;
  expectedCurrentFollowUpRevision?: number;
  expectedCurrentFollowUp?: FollowUp;
  input: ReachOutPlanInput;
  desiredFollowUpReason: string;
  desiredFollowUpActionType: FollowUpActionType;
  contextsToCreate: ReachOutContext[];
  replacementFollowUpId: string;
  followUpEventId: string;
  reachOutEventId: string;
  occurredAt: string;
  localDate: LocalDate;
};

export type ReachOutCompletionOrigin = "manual" | "already_contacted";

export type ReachOutCompletionInput = {
  logInteraction?: {
    kind: InteractionKind;
    occurredAt: string;
    summary?: string;
  };
  nextFollowUp?: {
    dueDate: LocalDate;
    reason?: string;
    actionType?: FollowUpActionType;
  };
};

export type CompleteReachOutCommand = {
  commandFingerprint: string;
  entryId: string;
  personId: string;
  expectedEntryRevision: number;
  expectedPersonRevision: number;
  expectedCurrentFollowUpId?: string;
  expectedCurrentFollowUpRevision?: number;
  expectedCurrentFollowUp?: FollowUp;
  completionEventId: string;
  completionInteractionId: string;
  followUpCompletionEventId: string;
  nextFollowUpId: string;
  nextFollowUpEventId: string;
  nextLinkedEventId: string;
  completionOrigin: ReachOutCompletionOrigin;
  input: ReachOutCompletionInput;
  occurredAt: string;
  localDate: LocalDate;
};

export type CompleteReachOutResult = {
  entry: ReachOutEntry;
  completionEvent: ReachOutEvent;
  completedFollowUp?: FollowUp;
  interaction?: Interaction;
  nextFollowUp?: FollowUp;
};

export type ReachOutStatusTransition = "moved_to_dormant" | "activated" | "removed";

export type ReachOutStatusCommand = {
  commandFingerprint: string;
  transition: ReachOutStatusTransition;
  expectedIntentStatus: ReachOutIntentStatus;
  entryId: string;
  personId: string;
  expectedEntryRevision: number;
  expectedPersonRevision: number;
  expectedCurrentFollowUpId?: string;
  expectedCurrentFollowUpRevision?: number;
  expectedCurrentFollowUp?: FollowUp;
  reachOutEventId: string;
  followUpEventId: string;
  occurredAt: string;
};

export type ReachOutStatusResult = {
  entry: ReachOutEntry;
  event: ReachOutEvent;
  cancelledFollowUp?: FollowUp;
};

const actionTypes = new Set(FOLLOW_UP_ACTION_OPTIONS.map((option) => option.value));

function defaultIdFactory(): string {
  return crypto.randomUUID();
}

function stableId(prefix: string, idFactory: () => string): string {
  return `${prefix}-${idFactory()}`;
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function identical(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireFingerprint(expected: string, material: unknown): void {
  if (fingerprintCommand(material) !== expected) {
    throw new RecordConflictError("The command fingerprint does not match its prepared input.");
  }
}

function requireInstant(value: string, message: string): void {
  if (!isIsoInstant(value)) throw new ValidationError([message]);
}

function requireDate(value: string, message: string): asserts value is LocalDate {
  if (!isLocalDate(value)) throw new ValidationError([message]);
}

function requireAction(value: FollowUpActionType | undefined): void {
  if (value !== undefined && !actionTypes.has(value)) throw new ValidationError(["Choose a supported next action."]);
}

function requireCompletionOrigin(
  origin: ReachOutCompletionOrigin,
  interaction: ReachOutCompletionInput["logInteraction"]
): void {
  if (origin === "already_contacted") {
    if (interaction?.kind !== "contacted") {
      throw new ValidationError(["Already contacted completion must record the generic contacted interaction."]);
    }
    return;
  }
  if (interaction?.kind === "contacted") {
    throw new ValidationError(["The generic contacted interaction is reserved for Already contacted."]);
  }
}

function validatedText(value: string | undefined, maximum: number, message: string): string | undefined {
  const result = trimmed(value);
  if (result && result.length > maximum) throw new ValidationError([message]);
  return result;
}

function validateReachOutFields(input: {
  reason?: string;
  intendedActionType?: FollowUpActionType;
  actionDetail?: string;
  notes?: string;
}): Pick<ReachOutPlanInput, "reason" | "intendedActionType" | "actionDetail" | "notes"> {
  requireAction(input.intendedActionType);
  const reason = validatedText(input.reason, 240, "Why you want to reach out must be 240 characters or fewer.");
  const actionDetail = validatedText(input.actionDetail, 240, "Action detail must be 240 characters or fewer.");
  const notes = validatedText(input.notes, 5_000, "Notes must be 5,000 characters or fewer.");
  return {
    ...(reason ? { reason } : {}),
    ...(input.intendedActionType ? { intendedActionType: input.intendedActionType } : {}),
    ...(actionDetail ? { actionDetail } : {}),
    ...(notes ? { notes } : {})
  };
}

function validateContextInput(input: NewReachOutContextInput): NewReachOutContextInput {
  const label = input.label.trim();
  if (!label) throw new ValidationError(["Add a context label."]);
  if (label.length > 120) throw new ValidationError(["Context label must be 120 characters or fewer."]);
  return { ...input, label };
}

function uniqueIds(ids: readonly string[], message: string): string[] {
  const result = [...new Set(ids)];
  if (result.length !== ids.length) throw new ValidationError([message]);
  return result;
}

function requireWritablePerson(person: Person | undefined): Person {
  if (!person) throw new RecordConflictError("This person is no longer available.");
  if (person.archivedAt || person.identityStatus === "merged") {
    throw new RecordConflictError("Restore or open the current Person before changing Reach Out.");
  }
  return person;
}

function requireCurrentEntry(entry: ReachOutEntry | undefined, command: {
  personId: string;
  expectedEntryRevision: number;
}): ReachOutEntry {
  if (!entry || entry.personId !== command.personId || entry.removedAt) {
    throw new RecordConflictError("This Reach Out entry is no longer available.");
  }
  if (entry.revision !== command.expectedEntryRevision) throw new StaleRevisionError();
  return entry;
}

function requireReciprocalPendingFollowUp(
  followUp: FollowUp | undefined,
  entry: ReachOutEntry,
  expectedId: string | undefined,
  expectedRevision: number | undefined
): FollowUp | undefined {
  if (!expectedId) {
    if (entry.currentFollowUpId) throw new StaleRevisionError();
    return undefined;
  }
  if (entry.currentFollowUpId !== expectedId || !followUp
    || followUp.id !== expectedId || followUp.personId !== entry.personId
    || followUp.reachOutEntryId !== entry.id || followUp.status !== "pending") {
    throw new StaleRevisionError();
  }
  if (followUp.revision !== expectedRevision) throw new StaleRevisionError();
  return followUp;
}

function requireExpectedFollowUpSnapshot(
  current: FollowUp | undefined,
  expected: FollowUp | undefined
): void {
  if (Boolean(current) !== Boolean(expected) || (current && !identical(current, expected))) {
    throw new StaleRevisionError();
  }
}

async function updateMetadata<Names extends ArrayLike<StoreNames<PeopleOsDb>>>(
  store: IDBPObjectStore<PeopleOsDb, Names, "metadata", "readwrite">,
  now: string
): Promise<void> {
  const metadata = await store.get("app" as never) as { datasetRevision: number; updatedAt: string } | undefined;
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  await store.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now } as never);
}

async function abortAndRethrow(
  transaction: { abort: () => void; done: Promise<unknown> },
  error: unknown
): Promise<never> {
  try { transaction.abort(); } catch { /* transaction already closed */ }
  try { await transaction.done; } catch { /* original error is authoritative */ }
  throw error;
}

function sameCreatedContext(current: ReachOutContext, prepared: ReachOutContext): boolean {
  return current.id === prepared.id
    && current.kind === prepared.kind
    && current.label === prepared.label
    && current.eventId === prepared.eventId
    && current.createdAt === prepared.createdAt;
}

function sameCreatedFollowUp(current: FollowUp, prepared: FollowUp): boolean {
  return current.id === prepared.id
    && current.personId === prepared.personId
    && current.dueDate === prepared.dueDate
    && current.reason === prepared.reason
    && current.actionType === prepared.actionType
    && current.reachOutEntryId === prepared.reachOutEntryId
    && current.createdAt === prepared.createdAt;
}

function buildPendingFollowUp(input: {
  id: string;
  personId: string;
  reachOutEntryId: string;
  dueDate: LocalDate;
  reason: string;
  actionType: FollowUpActionType;
  createdAt: string;
  supersedesFollowUpId?: string;
}): FollowUp {
  return {
    id: input.id,
    revision: 1,
    personId: input.personId,
    reachOutEntryId: input.reachOutEntryId,
    dueDate: input.dueDate,
    reason: input.reason,
    actionType: input.actionType,
    status: "pending",
    ...(input.supersedesFollowUpId ? { supersedesFollowUpId: input.supersedesFollowUpId } : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

function buildCreatedFollowUpEvent(followUp: FollowUp, eventId: string): FollowUpEvent {
  return {
    id: eventId,
    followUpId: followUp.id,
    personId: followUp.personId,
    kind: "created",
    occurredAt: followUp.createdAt,
    toDate: followUp.dueDate
  };
}

export function prepareCreateReachOutCommand(
  input: CreateReachOutInput,
  options: {
    now?: string;
    localDate?: LocalDate;
    timeZone?: string;
    idFactory?: () => string;
  } = {}
): CreateReachOutCommand {
  const occurredAt = options.now ?? new Date().toISOString();
  requireInstant(occurredAt, "Reach Out capture needs a valid time.");
  const localDate = options.localDate ?? localDateForInstant(occurredAt, options.timeZone);
  requireDate(localDate, "Reach Out capture needs a valid local date.");
  const idFactory = options.idFactory ?? defaultIdFactory;
  const fields = validateReachOutFields(input);

  let person: CreateReachOutCommand["person"];
  let personId: string;
  let displayName: string;
  if ("provisionalLabel" in input.person) {
    const label = input.person.provisionalLabel.trim();
    if (!label) throw new ValidationError(["Add a person or temporary description."]);
    if (label.length > 120) throw new ValidationError(["Temporary description must be 120 characters or fewer."]);
    const record: Person = {
      id: stableId("person", idFactory),
      revision: 1,
      displayName: label,
      relationshipMode: "personal",
      identityStatus: "provisional",
      importance: "normal",
      tags: [],
      createdAt: occurredAt,
      updatedAt: occurredAt
    };
    assertValidRecord("people", record);
    person = { kind: "provisional", record };
    personId = record.id;
    displayName = record.displayName;
  } else {
    const record = requireWritablePerson(input.person);
    person = { kind: "existing", id: record.id, expectedRevision: record.revision, displayName: record.displayName };
    personId = record.id;
    displayName = record.displayName;
  }

  const contextsToCreate = (input.newContexts ?? []).map((candidate) => {
    const context = validateContextInput(candidate);
    const record: ReachOutContext = {
      id: stableId("reach-out-context", idFactory),
      revision: 1,
      kind: context.kind,
      label: context.label,
      ...(context.eventId ? { eventId: context.eventId } : {}),
      createdAt: occurredAt,
      updatedAt: occurredAt
    };
    assertValidRecord("reachOutContexts", record);
    return record;
  });
  const contextIds = uniqueIds([
    ...(input.existingContextIds ?? []),
    ...contextsToCreate.map((context) => context.id)
  ], "Choose each Reach Out context once.");

  const entryId = stableId("reach-out", idFactory);
  const followUpId = input.reminderDate ? stableId("follow-up", idFactory) : undefined;
  if (input.reminderDate) {
    requireDate(input.reminderDate, "Choose a valid reminder date.");
    if (input.reminderDate < localDate) throw new ValidationError(["Reminder date cannot be in the past."]);
  }
  const entry: ReachOutEntry = {
    id: entryId,
    revision: 1,
    personId,
    ...fields,
    intentStatus: "active",
    ...(followUpId ? { currentFollowUpId: followUpId } : {}),
    contextIds,
    addedAt: occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
  assertValidRecord("reachOutEntries", entry);
  const addedEvent: ReachOutEvent = {
    id: stableId("reach-out-event", idFactory),
    reachOutEntryId: entry.id,
    kind: "added",
    occurredAt
  };
  assertValidRecord("reachOutEvents", addedEvent);

  let followUp: FollowUp | undefined;
  let followUpEvent: FollowUpEvent | undefined;
  let linkedEvent: ReachOutEvent | undefined;
  if (followUpId && input.reminderDate) {
    followUp = buildPendingFollowUp({
      id: followUpId,
      personId,
      reachOutEntryId: entry.id,
      dueDate: input.reminderDate,
      reason: fields.reason ?? `Reach out to ${displayName}`,
      actionType: fields.intendedActionType ?? "other",
      createdAt: occurredAt
    });
    assertValidRecord("followUps", followUp);
    followUpEvent = buildCreatedFollowUpEvent(followUp, stableId("follow-up-event", idFactory));
    assertValidRecord("followUpEvents", followUpEvent);
    linkedEvent = {
      id: stableId("reach-out-event", idFactory),
      reachOutEntryId: entry.id,
      kind: "follow_up_linked",
      occurredAt,
      followUpId: followUp.id
    };
    assertValidRecord("reachOutEvents", linkedEvent);
  }
  const prepared = {
    person,
    entry,
    addedEvent,
    contextsToCreate,
    ...(followUp ? { followUp } : {}),
    ...(followUpEvent ? { followUpEvent } : {}),
    ...(linkedEvent ? { linkedEvent } : {}),
    localDate
  };
  const commandFingerprint = fingerprintCommand(prepared);
  return {
    ...prepared,
    commandFingerprint,
    addedEvent: { ...addedEvent, commandFingerprint }
  };
}

export async function createReachOut(
  db: PeopleOsDatabase,
  command: CreateReachOutCommand,
  hooks: ReachOutMutationHooks = {}
): Promise<CreateReachOutResult> {
  const { commandFingerprint, addedEvent, ...commandRest } = command;
  const { commandFingerprint: _eventFingerprint, ...addedEventMaterial } = addedEvent;
  requireFingerprint(commandFingerprint, { ...commandRest, addedEvent: addedEventMaterial });
  const stores = [
    "people", "reachOutEntries", "reachOutEvents", "reachOutContexts", "events",
    "followUps", "followUpEvents", "metadata"
  ] as const;
  const tx = db.transaction(stores, "readwrite");
  try {
    const people = tx.objectStore("people");
    const entries = tx.objectStore("reachOutEntries");
    const events = tx.objectStore("reachOutEvents");
    const contexts = tx.objectStore("reachOutContexts");
    const followUps = tx.objectStore("followUps");
    const followUpEvents = tx.objectStore("followUpEvents");
    const [storedEntry, storedAddedEvent] = await Promise.all([
      entries.get(command.entry.id),
      events.get(command.addedEvent.id)
    ]);
    if (storedAddedEvent || storedEntry) {
      if (!storedEntry || !storedAddedEvent
        || storedEntry.personId !== command.entry.personId
        || storedEntry.addedAt !== command.entry.addedAt
        || storedAddedEvent.commandFingerprint !== command.commandFingerprint
        || !identical(storedAddedEvent, command.addedEvent)) {
        throw new RecordConflictError("The Reach Out capture IDs conflict with stored data.");
      }
      const storedPerson = await people.get(storedEntry.personId);
      if (!storedPerson) throw new RecordConflictError("The captured Person is missing.");
      const storedContexts = await Promise.all(storedEntry.contextIds.map((id) => contexts.get(id)));
      const storedFollowUp = command.followUp ? await followUps.get(command.followUp.id) : undefined;
      const storedFollowUpEvent = command.followUpEvent
        ? await followUpEvents.get(command.followUpEvent.id)
        : undefined;
      const storedLinkedEvent = command.linkedEvent
        ? await events.get(command.linkedEvent.id)
        : undefined;
      const contextsMatch = command.contextsToCreate.every((prepared) => {
        const stored = storedContexts.find((context) => context?.id === prepared.id);
        return Boolean(stored && sameCreatedContext(stored, prepared));
      });
      if (command.followUp && (!storedFollowUp || !sameCreatedFollowUp(storedFollowUp, command.followUp))) {
        throw new RecordConflictError("The Reach Out reminder IDs conflict with stored data.");
      }
      if (!contextsMatch
        || Boolean(command.followUpEvent) !== Boolean(storedFollowUpEvent)
        || Boolean(command.linkedEvent) !== Boolean(storedLinkedEvent)
        || (command.followUpEvent && !identical(storedFollowUpEvent, command.followUpEvent))
        || (command.linkedEvent && !identical(storedLinkedEvent, command.linkedEvent))) {
        throw new RecordConflictError("The Reach Out capture history is incomplete or conflicts with stored data.");
      }
      await tx.done;
      return {
        person: storedPerson,
        entry: storedEntry,
        contexts: storedContexts.filter((context): context is ReachOutContext => Boolean(context)),
        ...(storedFollowUp ? { followUp: storedFollowUp } : {})
      };
    }

    let person: Person;
    if (command.person.kind === "existing") {
      person = requireWritablePerson(await people.get(command.person.id));
      if (person.revision !== command.person.expectedRevision) throw new StaleRevisionError();
    } else {
      const storedPerson = await people.get(command.person.record.id);
      if (storedPerson) throw new RecordConflictError(`people already contains id ${command.person.record.id}`);
      person = command.person.record;
      await people.add(person);
    }

    const currentEntries = await entries.index("by-person").getAll(person.id);
    const current = currentEntries.find((entry) => !entry.removedAt && entry.intentStatus !== "completed");
    if (current) throw new RecordConflictError(`This Person is already in Reach Out:${current.id}`);

    const resolvedContexts: ReachOutContext[] = [];
    for (const id of command.entry.contextIds) {
      const prepared = command.contextsToCreate.find((context) => context.id === id);
      if (prepared) {
        if (prepared.eventId && !await tx.objectStore("events").get(prepared.eventId)) {
          throw new RecordConflictError("The selected Event context is no longer available.");
        }
        const existing = await contexts.get(id);
        if (existing && !sameCreatedContext(existing, prepared)) {
          throw new RecordConflictError(`reachOutContexts already contains id ${id}`);
        }
        if (!existing) await contexts.add(prepared);
        resolvedContexts.push(existing ?? prepared);
      } else {
        const existing = await contexts.get(id);
        if (!existing || existing.archivedAt) throw new RecordConflictError("A selected Reach Out context is no longer available.");
        resolvedContexts.push(existing);
      }
    }

    await entries.add(command.entry);
    await events.add(command.addedEvent);
    if (command.followUp && command.followUpEvent && command.linkedEvent) {
      await followUps.add(command.followUp);
      await followUpEvents.add(command.followUpEvent);
      await events.add(command.linkedEvent);
    }
    await updateMetadata(tx.objectStore("metadata"), command.entry.createdAt);
    hooks.beforeCommit?.();
    await tx.done;
    return {
      person,
      entry: command.entry,
      contexts: resolvedContexts,
      ...(command.followUp ? { followUp: command.followUp } : {})
    };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function reminderDateFromDefault(
  localDate: LocalDate,
  defaultDays: 1 | 7 | 14 | 30 | undefined
): LocalDate | undefined {
  return defaultDays === undefined ? undefined : addDaysToLocalDate(localDate, defaultDays);
}

export type UpdateReachOutPlanResult = {
  entry: ReachOutEntry;
  currentFollowUp?: FollowUp;
};

export function prepareUpdateReachOutPlanCommand(
  entry: ReachOutEntry,
  person: Person,
  currentFollowUp: FollowUp | undefined,
  input: ReachOutPlanInput,
  options: {
    now?: string;
    localDate?: LocalDate;
    timeZone?: string;
    idFactory?: () => string;
  } = {}
): UpdateReachOutPlanCommand {
  if (entry.personId !== person.id || entry.removedAt || entry.intentStatus === "completed") {
    throw new RecordConflictError("Only a current Reach Out plan can be edited.");
  }
  if (entry.intentStatus === "dormant" && input.reminderDate) {
    throw new RecordConflictError("Reactivate this Reach Out plan before adding a reminder.");
  }
  if (entry.currentFollowUpId !== currentFollowUp?.id) {
    if (entry.currentFollowUpId || currentFollowUp) throw new StaleRevisionError();
  }
  if (currentFollowUp && (currentFollowUp.personId !== person.id
    || currentFollowUp.reachOutEntryId !== entry.id || currentFollowUp.status !== "pending")) {
    throw new StaleRevisionError();
  }
  const occurredAt = options.now ?? new Date().toISOString();
  requireInstant(occurredAt, "Reach Out editing needs a valid time.");
  const localDate = options.localDate ?? localDateForInstant(occurredAt, options.timeZone);
  requireDate(localDate, "Reach Out editing needs a valid local date.");
  if (input.reminderDate) {
    requireDate(input.reminderDate, "Choose a valid reminder date.");
    const unchangedEffectiveDate = currentFollowUp
      && input.reminderDate === effectiveFollowUpDate(currentFollowUp);
    if (input.reminderDate < localDate && !unchangedEffectiveDate) {
      throw new ValidationError(["Reminder date cannot be in the past."]);
    }
  }
  const idFactory = options.idFactory ?? defaultIdFactory;
  const fields = validateReachOutFields(input);
  const contextsToCreate = (input.newContexts ?? []).map((candidate) => {
    const context = validateContextInput(candidate);
    const record: ReachOutContext = {
      id: stableId("reach-out-context", idFactory),
      revision: 1,
      kind: context.kind,
      label: context.label,
      ...(context.eventId ? { eventId: context.eventId } : {}),
      createdAt: occurredAt,
      updatedAt: occurredAt
    };
    assertValidRecord("reachOutContexts", record);
    return record;
  });
  const contextIds = uniqueIds([
    ...input.contextIds,
    ...contextsToCreate.map((context) => context.id)
  ], "Choose each Reach Out context once.");
  const prepared = {
    entryId: entry.id,
    personId: person.id,
    expectedEntryRevision: entry.revision,
    expectedIntentStatus: entry.intentStatus,
    expectedPersonRevision: person.revision,
    ...(currentFollowUp ? {
      expectedCurrentFollowUpId: currentFollowUp.id,
      expectedCurrentFollowUpRevision: currentFollowUp.revision,
      expectedCurrentFollowUp: currentFollowUp
    } : {}),
    input: {
      ...fields,
      contextIds,
      ...(input.reminderDate ? { reminderDate: input.reminderDate } : {})
    },
    desiredFollowUpReason: fields.reason ?? `Reach out to ${person.displayName}`,
    desiredFollowUpActionType: fields.intendedActionType ?? "other",
    contextsToCreate,
    replacementFollowUpId: stableId("follow-up", idFactory),
    followUpEventId: stableId("follow-up-event", idFactory),
    reachOutEventId: stableId("reach-out-event", idFactory),
    occurredAt,
    localDate
  };
  return { ...prepared, commandFingerprint: fingerprintCommand(prepared) };
}

function entryFieldsMatch(entry: ReachOutEntry, input: ReachOutPlanInput): boolean {
  return entry.reason === input.reason
    && entry.intendedActionType === input.intendedActionType
    && entry.actionDetail === input.actionDetail
    && entry.notes === input.notes
    && identical(entry.contextIds, input.contextIds);
}

export async function updateReachOutPlan(
  db: PeopleOsDatabase,
  command: UpdateReachOutPlanCommand,
  hooks: ReachOutMutationHooks = {}
): Promise<UpdateReachOutPlanResult> {
  const { commandFingerprint, ...commandMaterial } = command;
  requireFingerprint(commandFingerprint, commandMaterial);
  const tx = db.transaction([
    "people", "reachOutEntries", "reachOutContexts", "events", "followUps",
    "followUpEvents", "reachOutEvents", "metadata"
  ], "readwrite");
  try {
    const entries = tx.objectStore("reachOutEntries");
    const followUps = tx.objectStore("followUps");
    const followUpEvents = tx.objectStore("followUpEvents");
    const reachOutEvents = tx.objectStore("reachOutEvents");
    const currentStored = await entries.get(command.entryId);
    if (currentStored?.lastCommandFingerprint === command.commandFingerprint
      && currentStored.revision === command.expectedEntryRevision + 1
      && currentStored.updatedAt === command.occurredAt
      && currentStored.intentStatus === command.expectedIntentStatus
      && !currentStored.removedAt
      && entryFieldsMatch(currentStored, command.input)) {
      const currentPlan = currentStored.currentFollowUpId
        ? await followUps.get(currentStored.currentFollowUpId)
        : undefined;
      const reminderMatches = command.input.reminderDate
        ? Boolean(currentPlan && currentPlan.status === "pending"
          && currentPlan.personId === command.personId
          && currentPlan.reachOutEntryId === command.entryId
          && effectiveFollowUpDate(currentPlan) === command.input.reminderDate
          && currentPlan.reason === command.desiredFollowUpReason
          && currentPlan.actionType === command.desiredFollowUpActionType)
        : !currentStored.currentFollowUpId;
      const contextStore = tx.objectStore("reachOutContexts");
      const contextMatches = (await Promise.all(command.contextsToCreate.map(async (prepared) => {
        const stored = await contextStore.get(prepared.id);
        return Boolean(stored && sameCreatedContext(stored, prepared));
      }))).every(Boolean);
      const expectedPrevious = command.expectedCurrentFollowUp;
      let lifecycleMatches = true;
      if (expectedPrevious && !command.input.reminderDate) {
        const [storedPrevious, storedEvent] = await Promise.all([
          followUps.get(expectedPrevious.id),
          followUpEvents.get(command.followUpEventId)
        ]);
        lifecycleMatches = identical(storedPrevious, {
          ...expectedPrevious,
          revision: expectedPrevious.revision + 1,
          status: "cancelled",
          updatedAt: command.occurredAt
        }) && identical(storedEvent, {
          id: command.followUpEventId,
          followUpId: expectedPrevious.id,
          personId: expectedPrevious.personId,
          kind: "cancelled",
          occurredAt: command.occurredAt
        });
      } else if (expectedPrevious && command.input.reminderDate
        && command.input.reminderDate !== effectiveFollowUpDate(expectedPrevious)) {
        const [storedPrevious, storedReplacement, storedEvent, storedLink] = await Promise.all([
          followUps.get(expectedPrevious.id),
          followUps.get(command.replacementFollowUpId),
          followUpEvents.get(command.followUpEventId),
          reachOutEvents.get(command.reachOutEventId)
        ]);
        const expectedReplacement = buildPendingFollowUp({
          id: command.replacementFollowUpId,
          personId: command.personId,
          reachOutEntryId: command.entryId,
          dueDate: command.input.reminderDate,
          reason: command.desiredFollowUpReason,
          actionType: command.desiredFollowUpActionType,
          createdAt: command.occurredAt,
          supersedesFollowUpId: expectedPrevious.id
        });
        lifecycleMatches = identical(storedPrevious, {
          ...expectedPrevious,
          revision: expectedPrevious.revision + 1,
          status: "superseded",
          supersededByFollowUpId: expectedReplacement.id,
          updatedAt: command.occurredAt
        }) && identical(storedReplacement, expectedReplacement)
          && identical(storedEvent, {
            id: command.followUpEventId,
            followUpId: expectedPrevious.id,
            personId: expectedPrevious.personId,
            kind: "rescheduled",
            occurredAt: command.occurredAt,
            fromDate: effectiveFollowUpDate(expectedPrevious),
            toDate: expectedReplacement.dueDate,
            replacementFollowUpId: expectedReplacement.id
          })
          && identical(storedLink, {
            id: command.reachOutEventId,
            reachOutEntryId: command.entryId,
            kind: "follow_up_linked",
            occurredAt: command.occurredAt,
            followUpId: expectedReplacement.id,
            commandFingerprint: command.commandFingerprint
          });
      } else if (!expectedPrevious && command.input.reminderDate) {
        const [storedCreated, storedEvent, storedLink] = await Promise.all([
          followUps.get(command.replacementFollowUpId),
          followUpEvents.get(command.followUpEventId),
          reachOutEvents.get(command.reachOutEventId)
        ]);
        const expectedCreated = buildPendingFollowUp({
          id: command.replacementFollowUpId,
          personId: command.personId,
          reachOutEntryId: command.entryId,
          dueDate: command.input.reminderDate,
          reason: command.desiredFollowUpReason,
          actionType: command.desiredFollowUpActionType,
          createdAt: command.occurredAt
        });
        lifecycleMatches = identical(storedCreated, expectedCreated)
          && identical(storedEvent, buildCreatedFollowUpEvent(expectedCreated, command.followUpEventId))
          && identical(storedLink, {
            id: command.reachOutEventId,
            reachOutEntryId: command.entryId,
            kind: "follow_up_linked",
            occurredAt: command.occurredAt,
            followUpId: expectedCreated.id,
            commandFingerprint: command.commandFingerprint
          });
      } else if (expectedPrevious && command.input.reminderDate) {
        const followUpChanged = expectedPrevious.reason !== command.desiredFollowUpReason
          || expectedPrevious.actionType !== command.desiredFollowUpActionType;
        lifecycleMatches = identical(currentPlan, followUpChanged ? {
          ...expectedPrevious,
          revision: expectedPrevious.revision + 1,
          reason: command.desiredFollowUpReason,
          actionType: command.desiredFollowUpActionType,
          updatedAt: command.occurredAt
        } : expectedPrevious);
      }
      if (reminderMatches && contextMatches && lifecycleMatches) {
        await tx.done;
        return { entry: currentStored, ...(currentPlan ? { currentFollowUp: currentPlan } : {}) };
      }
    }

    const person = requireWritablePerson(await tx.objectStore("people").get(command.personId));
    if (person.revision !== command.expectedPersonRevision) throw new StaleRevisionError();
    const entry = requireCurrentEntry(currentStored, command);
    if (entry.intentStatus !== command.expectedIntentStatus) throw new StaleRevisionError();
    if (entry.intentStatus === "completed") throw new RecordConflictError("Completed outreach is read-only.");
    const currentFollowUp = requireReciprocalPendingFollowUp(
      command.expectedCurrentFollowUpId ? await followUps.get(command.expectedCurrentFollowUpId) : undefined,
      entry,
      command.expectedCurrentFollowUpId,
      command.expectedCurrentFollowUpRevision
    );
    requireExpectedFollowUpSnapshot(currentFollowUp, command.expectedCurrentFollowUp);
    const contextStore = tx.objectStore("reachOutContexts");
    for (const id of command.input.contextIds) {
      const prepared = command.contextsToCreate.find((context) => context.id === id);
      const existing = await contextStore.get(id);
      if (prepared) {
        if (prepared.eventId && !await tx.objectStore("events").get(prepared.eventId)) {
          throw new RecordConflictError("The selected Event context is no longer available.");
        }
        if (existing && !sameCreatedContext(existing, prepared)) {
          throw new RecordConflictError(`reachOutContexts already contains id ${id}`);
        }
        if (!existing) await contextStore.add(prepared);
      } else if (!existing || existing.archivedAt) {
        throw new RecordConflictError("A selected Reach Out context is no longer available.");
      }
    }

    const displayReason = command.desiredFollowUpReason;
    const actionType = command.desiredFollowUpActionType;
    let nextCurrent = currentFollowUp;
    let currentFollowUpId = entry.currentFollowUpId;
    let planChanged = false;

    if (currentFollowUp && !command.input.reminderDate) {
      const cancelled: FollowUp = {
        ...currentFollowUp,
        revision: currentFollowUp.revision + 1,
        status: "cancelled",
        updatedAt: command.occurredAt
      };
      const event: FollowUpEvent = {
        id: command.followUpEventId,
        followUpId: currentFollowUp.id,
        personId: currentFollowUp.personId,
        kind: "cancelled",
        occurredAt: command.occurredAt
      };
      assertValidRecord("followUps", cancelled);
      assertValidRecord("followUpEvents", event);
      await followUps.put(cancelled);
      await followUpEvents.add(event);
      nextCurrent = undefined;
      currentFollowUpId = undefined;
      planChanged = true;
    } else if (currentFollowUp && command.input.reminderDate
      && command.input.reminderDate !== effectiveFollowUpDate(currentFollowUp)) {
      const replacement = buildPendingFollowUp({
        id: command.replacementFollowUpId,
        personId: entry.personId,
        reachOutEntryId: entry.id,
        dueDate: command.input.reminderDate,
        reason: displayReason,
        actionType,
        createdAt: command.occurredAt,
        supersedesFollowUpId: currentFollowUp.id
      });
      const superseded: FollowUp = {
        ...currentFollowUp,
        revision: currentFollowUp.revision + 1,
        status: "superseded",
        supersededByFollowUpId: replacement.id,
        updatedAt: command.occurredAt
      };
      const event: FollowUpEvent = {
        id: command.followUpEventId,
        followUpId: currentFollowUp.id,
        personId: currentFollowUp.personId,
        kind: "rescheduled",
        occurredAt: command.occurredAt,
        fromDate: effectiveFollowUpDate(currentFollowUp),
        toDate: replacement.dueDate,
        replacementFollowUpId: replacement.id
      };
      const linked: ReachOutEvent = {
        id: command.reachOutEventId,
        reachOutEntryId: entry.id,
        kind: "follow_up_linked",
        occurredAt: command.occurredAt,
        followUpId: replacement.id,
        commandFingerprint: command.commandFingerprint
      };
      [replacement, superseded].forEach((record) => assertValidRecord("followUps", record));
      assertValidRecord("followUpEvents", event);
      assertValidRecord("reachOutEvents", linked);
      await followUps.put(superseded);
      await followUps.add(replacement);
      await followUpEvents.add(event);
      await reachOutEvents.add(linked);
      nextCurrent = replacement;
      currentFollowUpId = replacement.id;
      planChanged = true;
    } else if (currentFollowUp && command.input.reminderDate) {
      if (currentFollowUp.reason !== displayReason || currentFollowUp.actionType !== actionType) {
        nextCurrent = {
          ...currentFollowUp,
          revision: currentFollowUp.revision + 1,
          reason: displayReason,
          actionType,
          updatedAt: command.occurredAt
        };
        assertValidRecord("followUps", nextCurrent);
        await followUps.put(nextCurrent);
        planChanged = true;
      }
    } else if (!currentFollowUp && command.input.reminderDate) {
      const created = buildPendingFollowUp({
        id: command.replacementFollowUpId,
        personId: entry.personId,
        reachOutEntryId: entry.id,
        dueDate: command.input.reminderDate,
        reason: displayReason,
        actionType,
        createdAt: command.occurredAt
      });
      const event = buildCreatedFollowUpEvent(created, command.followUpEventId);
      const linked: ReachOutEvent = {
        id: command.reachOutEventId,
        reachOutEntryId: entry.id,
        kind: "follow_up_linked",
        occurredAt: command.occurredAt,
        followUpId: created.id,
        commandFingerprint: command.commandFingerprint
      };
      assertValidRecord("followUps", created);
      assertValidRecord("followUpEvents", event);
      assertValidRecord("reachOutEvents", linked);
      await followUps.add(created);
      await followUpEvents.add(event);
      await reachOutEvents.add(linked);
      nextCurrent = created;
      currentFollowUpId = created.id;
      planChanged = true;
    }

    const fieldsChanged = !entryFieldsMatch(entry, command.input)
      || entry.currentFollowUpId !== currentFollowUpId;
    if (!fieldsChanged && !planChanged && command.contextsToCreate.length === 0) {
      await tx.done;
      return { entry, ...(nextCurrent ? { currentFollowUp: nextCurrent } : {}) };
    }
    const { reason: _reason, intendedActionType: _action, actionDetail: _detail, notes: _notes,
      currentFollowUpId: _current, ...base } = entry;
    const updated: ReachOutEntry = {
      ...base,
      ...validateReachOutFields(command.input),
      ...(currentFollowUpId ? { currentFollowUpId } : {}),
      contextIds: command.input.contextIds,
      lastCommandFingerprint: command.commandFingerprint,
      revision: entry.revision + 1,
      updatedAt: command.occurredAt
    };
    assertValidRecord("reachOutEntries", updated);
    await entries.put(updated);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return { entry: updated, ...(nextCurrent ? { currentFollowUp: nextCurrent } : {}) };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function prepareCompleteReachOutCommand(
  entry: ReachOutEntry,
  person: Person,
  currentFollowUp: FollowUp | undefined,
  input: ReachOutCompletionInput,
  options: {
    now?: string;
    localDate?: LocalDate;
    timeZone?: string;
    idFactory?: () => string;
    completionOrigin?: ReachOutCompletionOrigin;
  } = {}
): CompleteReachOutCommand {
  if (entry.personId !== person.id || entry.removedAt || entry.intentStatus !== "active") {
    throw new RecordConflictError("Only active outreach can be completed.");
  }
  if (entry.currentFollowUpId !== currentFollowUp?.id) {
    if (entry.currentFollowUpId || currentFollowUp) throw new StaleRevisionError();
  }
  if (currentFollowUp && (currentFollowUp.personId !== person.id
    || currentFollowUp.reachOutEntryId !== entry.id || currentFollowUp.status !== "pending")) {
    throw new StaleRevisionError();
  }
  const occurredAt = options.now ?? new Date().toISOString();
  requireInstant(occurredAt, "Outreach completion needs a valid time.");
  const localDate = options.localDate ?? localDateForInstant(occurredAt, options.timeZone);
  requireDate(localDate, "Outreach completion needs a valid local date.");
  const idFactory = options.idFactory ?? defaultIdFactory;
  const completionOrigin = options.completionOrigin ?? "manual";

  let logInteraction: ReachOutCompletionInput["logInteraction"];
  if (input.logInteraction) {
    requireInstant(input.logInteraction.occurredAt, "Choose when the contact happened.");
    if (Date.parse(input.logInteraction.occurredAt) > Date.parse(occurredAt)) {
      throw new ValidationError(["Contact time cannot be in the future."]);
    }
    const selectable = completionOrigin === "already_contacted"
      ? input.logInteraction.kind === "contacted"
      : interactionKindIsManuallySelectable(input.logInteraction.kind);
    if (!selectable || !interactionCountsAsContact(input.logInteraction.kind)) {
      throw new ValidationError(["Choose a contact interaction type."]);
    }
    const summary = validatedText(input.logInteraction.summary, 5_000, "Interaction summary must be 5,000 characters or fewer.");
    logInteraction = {
      kind: input.logInteraction.kind,
      occurredAt: input.logInteraction.occurredAt,
      ...(summary ? { summary } : {})
    };
  }
  requireCompletionOrigin(completionOrigin, logInteraction);
  let nextFollowUp: ReachOutCompletionInput["nextFollowUp"];
  if (input.nextFollowUp) {
    requireDate(input.nextFollowUp.dueDate, "Choose a valid next follow-up date.");
    if (input.nextFollowUp.dueDate <= localDate) {
      throw new ValidationError(["The next follow-up must be after the completion date."]);
    }
    requireAction(input.nextFollowUp.actionType);
    const requestedReason = trimmed(input.nextFollowUp.reason)
      ?? currentFollowUp?.reason
      ?? entry.reason
      ?? `Reach out to ${person.displayName}`;
    nextFollowUp = {
      dueDate: input.nextFollowUp.dueDate,
      reason: validatedText(
        requestedReason,
        240,
        "Follow-up reason must be 240 characters or fewer."
      )!,
      actionType: input.nextFollowUp.actionType ?? currentFollowUp?.actionType ?? entry.intendedActionType ?? "other"
    };
  }
  const prepared = {
    entryId: entry.id,
    personId: person.id,
    expectedEntryRevision: entry.revision,
    expectedPersonRevision: person.revision,
    ...(currentFollowUp ? {
      expectedCurrentFollowUpId: currentFollowUp.id,
      expectedCurrentFollowUpRevision: currentFollowUp.revision,
      expectedCurrentFollowUp: currentFollowUp
    } : {}),
    completionEventId: stableId("reach-out-event", idFactory),
    completionInteractionId: stableId("interaction", idFactory),
    followUpCompletionEventId: stableId("follow-up-event", idFactory),
    nextFollowUpId: stableId("follow-up", idFactory),
    nextFollowUpEventId: stableId("follow-up-event", idFactory),
    nextLinkedEventId: stableId("reach-out-event", idFactory),
    completionOrigin,
    input: {
      ...(logInteraction ? { logInteraction } : {}),
      ...(nextFollowUp ? { nextFollowUp } : {})
    },
    occurredAt,
    localDate
  };
  return { ...prepared, commandFingerprint: fingerprintCommand(prepared) };
}

function completionInteraction(
  command: CompleteReachOutCommand,
  currentFollowUp: FollowUp | undefined
): Interaction | undefined {
  if (command.input.logInteraction) {
    const record: Interaction = {
      id: command.completionInteractionId,
      revision: 1,
      personId: command.personId,
      kind: command.input.logInteraction.kind,
      occurredAt: command.input.logInteraction.occurredAt,
      ...(command.input.logInteraction.summary ? { summary: command.input.logInteraction.summary } : {}),
      ...(currentFollowUp ? { followUpId: currentFollowUp.id } : {}),
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt
    };
    assertValidRecord("interactions", record);
    return record;
  }
  if (currentFollowUp) {
    const lifecycle: Interaction = {
      id: command.completionInteractionId,
      revision: 1,
      personId: command.personId,
      kind: "follow_up_completed",
      occurredAt: command.occurredAt,
      followUpId: currentFollowUp.id,
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt
    };
    assertValidRecord("interactions", lifecycle);
    return lifecycle;
  }
  return undefined;
}

export async function completeReachOut(
  db: PeopleOsDatabase,
  command: CompleteReachOutCommand,
  hooks: ReachOutMutationHooks = {}
): Promise<CompleteReachOutResult> {
  const { commandFingerprint, ...commandMaterial } = command;
  requireFingerprint(commandFingerprint, commandMaterial);
  requireCompletionOrigin(command.completionOrigin, command.input.logInteraction);
  const tx = db.transaction([
    "people", "reachOutEntries", "reachOutEvents", "followUps", "followUpEvents",
    "interactions", "metadata"
  ], "readwrite");
  try {
    const entries = tx.objectStore("reachOutEntries");
    const reachOutEvents = tx.objectStore("reachOutEvents");
    const followUps = tx.objectStore("followUps");
    const followUpEvents = tx.objectStore("followUpEvents");
    const interactions = tx.objectStore("interactions");
    const storedCompletionEvent = await reachOutEvents.get(command.completionEventId);
    if (storedCompletionEvent) {
      const expectedCompletionEvent: ReachOutEvent = {
        id: command.completionEventId,
        reachOutEntryId: command.entryId,
        kind: "completed",
        occurredAt: command.occurredAt,
        commandFingerprint: command.commandFingerprint,
        ...(command.expectedCurrentFollowUpId ? { followUpId: command.expectedCurrentFollowUpId } : {}),
        ...(command.input.logInteraction ? { interactionId: command.completionInteractionId } : {})
      };
      if (!identical(storedCompletionEvent, expectedCompletionEvent)) {
        throw new RecordConflictError("The outreach completion ID conflicts with stored history.");
      }
      const storedEntry = await entries.get(command.entryId);
      if (!storedEntry) throw new RecordConflictError("The completed Reach Out entry is missing.");
      const storedInteraction = await interactions.get(command.completionInteractionId);
      const storedCompletedFollowUp = command.expectedCurrentFollowUpId
        ? await followUps.get(command.expectedCurrentFollowUpId)
        : undefined;
      const storedFollowUpCompletionEvent = command.expectedCurrentFollowUpId
        ? await followUpEvents.get(command.followUpCompletionEventId)
        : undefined;
      const storedNext = command.input.nextFollowUp ? await followUps.get(command.nextFollowUpId) : undefined;
      const storedNextEvent = command.input.nextFollowUp
        ? await followUpEvents.get(command.nextFollowUpEventId)
        : undefined;
      const storedNextLink = command.input.nextFollowUp
        ? await reachOutEvents.get(command.nextLinkedEventId)
        : undefined;
      const expectedInteraction = command.input.logInteraction || command.expectedCurrentFollowUpId
        ? completionInteraction(command, command.expectedCurrentFollowUp)
        : undefined;
      if (Boolean(expectedInteraction) !== Boolean(storedInteraction)
        || (expectedInteraction && !identical(storedInteraction, expectedInteraction))) {
        throw new RecordConflictError("The outreach completion interaction conflicts with stored history.");
      }
      const expectedCompletedFollowUp = command.expectedCurrentFollowUp ? {
        ...command.expectedCurrentFollowUp,
        revision: command.expectedCurrentFollowUp.revision + 1,
        status: "completed" as const,
        completedAt: command.occurredAt,
        updatedAt: command.occurredAt
      } : undefined;
      const expectedFollowUpCompletionEvent: FollowUpEvent | undefined = command.expectedCurrentFollowUp ? {
        id: command.followUpCompletionEventId,
        followUpId: command.expectedCurrentFollowUp.id,
        personId: command.expectedCurrentFollowUp.personId,
        kind: command.input.logInteraction ? "completed_with_contact" : "completed_without_contact",
        occurredAt: command.occurredAt,
        interactionId: command.completionInteractionId
      } : undefined;
      if (Boolean(expectedCompletedFollowUp) !== Boolean(storedCompletedFollowUp)
        || (expectedCompletedFollowUp && !identical(storedCompletedFollowUp, expectedCompletedFollowUp))
        || Boolean(expectedFollowUpCompletionEvent) !== Boolean(storedFollowUpCompletionEvent)
        || (expectedFollowUpCompletionEvent
          && !identical(storedFollowUpCompletionEvent, expectedFollowUpCompletionEvent))) {
        throw new RecordConflictError("The linked reminder completion is incomplete or conflicts with stored history.");
      }
      const expectedNext = command.input.nextFollowUp ? buildPendingFollowUp({
        id: command.nextFollowUpId,
        personId: command.personId,
        reachOutEntryId: command.entryId,
        dueDate: command.input.nextFollowUp.dueDate,
        reason: command.input.nextFollowUp.reason!,
        actionType: command.input.nextFollowUp.actionType!,
        createdAt: command.occurredAt
      }) : undefined;
      if (Boolean(expectedNext) !== Boolean(storedNext)
        || (expectedNext && !identical(storedNext, expectedNext))) {
        throw new RecordConflictError("The next Reach Out reminder ID conflicts with stored data.");
      }
      const expectedNextEvent = expectedNext
        ? buildCreatedFollowUpEvent(expectedNext, command.nextFollowUpEventId)
        : undefined;
      const expectedNextLink: ReachOutEvent | undefined = expectedNext ? {
        id: command.nextLinkedEventId,
        reachOutEntryId: command.entryId,
        kind: "follow_up_linked",
        occurredAt: command.occurredAt,
        followUpId: expectedNext.id
      } : undefined;
      if (Boolean(expectedNextEvent) !== Boolean(storedNextEvent)
        || (expectedNextEvent && !identical(storedNextEvent, expectedNextEvent))
        || Boolean(expectedNextLink) !== Boolean(storedNextLink)
        || (expectedNextLink && !identical(storedNextLink, expectedNextLink))) {
        throw new RecordConflictError("The next Reach Out reminder history is incomplete or conflicts with stored data.");
      }
      const expectedCurrentId = expectedNext?.id;
      if (storedEntry.personId !== command.personId
        || storedEntry.revision !== command.expectedEntryRevision + 1
        || storedEntry.updatedAt !== command.occurredAt
        || storedEntry.lastCompletedAt !== command.occurredAt
        || storedEntry.intentStatus !== (expectedNext ? "active" : "completed")
        || storedEntry.currentFollowUpId !== expectedCurrentId) {
        throw new RecordConflictError("The completed Reach Out entry conflicts with stored history.");
      }
      await tx.done;
      return {
        entry: storedEntry,
        completionEvent: storedCompletionEvent,
        ...(storedCompletedFollowUp ? { completedFollowUp: storedCompletedFollowUp } : {}),
        ...(storedInteraction ? { interaction: storedInteraction } : {}),
        ...(storedNext ? { nextFollowUp: storedNext } : {})
      };
    }

    const person = requireWritablePerson(await tx.objectStore("people").get(command.personId));
    if (person.revision !== command.expectedPersonRevision) throw new StaleRevisionError();
    const entry = requireCurrentEntry(await entries.get(command.entryId), command);
    if (entry.intentStatus !== "active") throw new RecordConflictError("Only active outreach can be completed.");
    const currentFollowUp = requireReciprocalPendingFollowUp(
      command.expectedCurrentFollowUpId ? await followUps.get(command.expectedCurrentFollowUpId) : undefined,
      entry,
      command.expectedCurrentFollowUpId,
      command.expectedCurrentFollowUpRevision
    );
    requireExpectedFollowUpSnapshot(currentFollowUp, command.expectedCurrentFollowUp);
    const interaction = completionInteraction(command, currentFollowUp);
    let completedFollowUp: FollowUp | undefined;
    if (currentFollowUp && interaction) {
      completedFollowUp = {
        ...currentFollowUp,
        revision: currentFollowUp.revision + 1,
        status: "completed",
        completedAt: command.occurredAt,
        updatedAt: command.occurredAt
      };
      const event: FollowUpEvent = {
        id: command.followUpCompletionEventId,
        followUpId: currentFollowUp.id,
        personId: currentFollowUp.personId,
        kind: command.input.logInteraction ? "completed_with_contact" : "completed_without_contact",
        occurredAt: command.occurredAt,
        interactionId: interaction.id
      };
      assertValidRecord("followUps", completedFollowUp);
      assertValidRecord("followUpEvents", event);
      await interactions.add(interaction);
      await followUps.put(completedFollowUp);
      await followUpEvents.add(event);
    } else if (interaction) {
      await interactions.add(interaction);
    }

    const completionEvent: ReachOutEvent = {
      id: command.completionEventId,
      reachOutEntryId: entry.id,
      kind: "completed",
      occurredAt: command.occurredAt,
      commandFingerprint: command.commandFingerprint,
      ...(currentFollowUp ? { followUpId: currentFollowUp.id } : {}),
      ...(command.input.logInteraction && interaction ? { interactionId: interaction.id } : {})
    };
    assertValidRecord("reachOutEvents", completionEvent);
    await reachOutEvents.add(completionEvent);

    let nextFollowUp: FollowUp | undefined;
    if (command.input.nextFollowUp) {
      nextFollowUp = buildPendingFollowUp({
        id: command.nextFollowUpId,
        personId: entry.personId,
        reachOutEntryId: entry.id,
        dueDate: command.input.nextFollowUp.dueDate,
        reason: command.input.nextFollowUp.reason!,
        actionType: command.input.nextFollowUp.actionType!,
        createdAt: command.occurredAt
      });
      const createdEvent = buildCreatedFollowUpEvent(nextFollowUp, command.nextFollowUpEventId);
      const linkedEvent: ReachOutEvent = {
        id: command.nextLinkedEventId,
        reachOutEntryId: entry.id,
        kind: "follow_up_linked",
        occurredAt: command.occurredAt,
        followUpId: nextFollowUp.id
      };
      assertValidRecord("followUps", nextFollowUp);
      assertValidRecord("followUpEvents", createdEvent);
      assertValidRecord("reachOutEvents", linkedEvent);
      await followUps.add(nextFollowUp);
      await followUpEvents.add(createdEvent);
      await reachOutEvents.add(linkedEvent);
    }
    const { currentFollowUpId: _current, ...withoutCurrent } = entry;
    const updated: ReachOutEntry = {
      ...withoutCurrent,
      revision: entry.revision + 1,
      intentStatus: nextFollowUp ? "active" : "completed",
      ...(nextFollowUp ? { currentFollowUpId: nextFollowUp.id } : {}),
      lastCompletedAt: command.occurredAt,
      updatedAt: command.occurredAt
    };
    assertValidRecord("reachOutEntries", updated);
    await entries.put(updated);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return {
      entry: updated,
      completionEvent,
      ...(completedFollowUp ? { completedFollowUp } : {}),
      ...(interaction ? { interaction } : {}),
      ...(nextFollowUp ? { nextFollowUp } : {})
    };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function prepareReachOutStatusCommand(
  entry: ReachOutEntry,
  person: Person,
  currentFollowUp: FollowUp | undefined,
  transition: ReachOutStatusTransition,
  options: { now?: string; idFactory?: () => string } = {}
): ReachOutStatusCommand {
  if (entry.personId !== person.id || entry.removedAt) {
    throw new RecordConflictError("This Reach Out entry is no longer available.");
  }
  if (entry.currentFollowUpId !== currentFollowUp?.id) {
    if (entry.currentFollowUpId || currentFollowUp) throw new StaleRevisionError();
  }
  if (currentFollowUp && (currentFollowUp.personId !== person.id
    || currentFollowUp.reachOutEntryId !== entry.id || currentFollowUp.status !== "pending")) {
    throw new StaleRevisionError();
  }
  if (transition === "moved_to_dormant" && entry.intentStatus !== "active") {
    throw new RecordConflictError("Only active outreach can move to Dormant.");
  }
  if (transition === "activated" && entry.intentStatus !== "dormant") {
    throw new RecordConflictError("Only Dormant outreach can be reactivated.");
  }
  const occurredAt = options.now ?? new Date().toISOString();
  requireInstant(occurredAt, "Reach Out status changes need a valid time.");
  const idFactory = options.idFactory ?? defaultIdFactory;
  const prepared = {
    transition,
    expectedIntentStatus: entry.intentStatus,
    entryId: entry.id,
    personId: person.id,
    expectedEntryRevision: entry.revision,
    expectedPersonRevision: person.revision,
    ...(currentFollowUp ? {
      expectedCurrentFollowUpId: currentFollowUp.id,
      expectedCurrentFollowUpRevision: currentFollowUp.revision,
      expectedCurrentFollowUp: currentFollowUp
    } : {}),
    reachOutEventId: stableId("reach-out-event", idFactory),
    followUpEventId: stableId("follow-up-event", idFactory),
    occurredAt
  };
  return { ...prepared, commandFingerprint: fingerprintCommand(prepared) };
}

async function applyReachOutStatus(
  db: PeopleOsDatabase,
  command: ReachOutStatusCommand,
  expectedTransition: ReachOutStatusTransition,
  hooks: ReachOutMutationHooks
): Promise<ReachOutStatusResult> {
  const { commandFingerprint, ...commandMaterial } = command;
  requireFingerprint(commandFingerprint, commandMaterial);
  if (command.transition !== expectedTransition) {
    throw new RecordConflictError("The Reach Out status command was prepared for a different action.");
  }
  const kind = command.transition;
  const tx = db.transaction([
    "people", "reachOutEntries", "reachOutEvents", "followUps", "followUpEvents", "metadata"
  ], "readwrite");
  try {
    const entries = tx.objectStore("reachOutEntries");
    const reachOutEvents = tx.objectStore("reachOutEvents");
    const followUps = tx.objectStore("followUps");
    const followUpEvents = tx.objectStore("followUpEvents");
    const storedEvent = await reachOutEvents.get(command.reachOutEventId);
    if (storedEvent) {
      const expectedEvent: ReachOutEvent = {
        id: command.reachOutEventId,
        reachOutEntryId: command.entryId,
        kind,
        occurredAt: command.occurredAt,
        commandFingerprint: command.commandFingerprint,
        ...(command.expectedCurrentFollowUpId ? { followUpId: command.expectedCurrentFollowUpId } : {})
      };
      if (!identical(storedEvent, expectedEvent)) {
        throw new RecordConflictError("The Reach Out status command ID conflicts with stored history.");
      }
      const storedEntry = await entries.get(command.entryId);
      if (!storedEntry) throw new RecordConflictError("The updated Reach Out entry is missing.");
      const storedFollowUp = command.expectedCurrentFollowUpId
        ? await followUps.get(command.expectedCurrentFollowUpId)
        : undefined;
      const storedFollowUpEvent = command.expectedCurrentFollowUpId
        ? await followUpEvents.get(command.followUpEventId)
        : undefined;
      const expectedCancelled = command.expectedCurrentFollowUp ? {
        ...command.expectedCurrentFollowUp,
        revision: command.expectedCurrentFollowUp.revision + 1,
        status: "cancelled" as const,
        updatedAt: command.occurredAt
      } : undefined;
      const expectedCancellationEvent: FollowUpEvent | undefined = command.expectedCurrentFollowUp ? {
        id: command.followUpEventId,
        followUpId: command.expectedCurrentFollowUp.id,
        personId: command.expectedCurrentFollowUp.personId,
        kind: "cancelled",
        occurredAt: command.occurredAt
      } : undefined;
      if (Boolean(expectedCancelled) !== Boolean(storedFollowUp)
        || (expectedCancelled && !identical(storedFollowUp, expectedCancelled))
        || Boolean(expectedCancellationEvent) !== Boolean(storedFollowUpEvent)
        || (expectedCancellationEvent && !identical(storedFollowUpEvent, expectedCancellationEvent))) {
        throw new RecordConflictError("The Reach Out reminder cancellation is incomplete or conflicts with stored history.");
      }
      const expectedStatus: ReachOutIntentStatus = kind === "moved_to_dormant"
        ? "dormant"
        : kind === "activated"
          ? "active"
          : command.expectedIntentStatus;
      if (storedEntry.personId !== command.personId
        || storedEntry.revision !== command.expectedEntryRevision + 1
        || storedEntry.updatedAt !== command.occurredAt
        || storedEntry.intentStatus !== expectedStatus
        || storedEntry.currentFollowUpId !== undefined
        || storedEntry.removedAt !== (kind === "removed" ? command.occurredAt : undefined)) {
        throw new RecordConflictError("The Reach Out status result conflicts with stored history.");
      }
      await tx.done;
      return {
        entry: storedEntry,
        event: storedEvent,
        ...(storedFollowUp?.status === "cancelled" ? { cancelledFollowUp: storedFollowUp } : {})
      };
    }

    const person = requireWritablePerson(await tx.objectStore("people").get(command.personId));
    if (person.revision !== command.expectedPersonRevision) throw new StaleRevisionError();
    const entry = requireCurrentEntry(await entries.get(command.entryId), command);
    if (entry.intentStatus !== command.expectedIntentStatus) throw new StaleRevisionError();
    if (kind === "moved_to_dormant" && entry.intentStatus !== "active") {
      throw new RecordConflictError("Only active outreach can move to Dormant.");
    }
    if (kind === "activated" && entry.intentStatus !== "dormant") {
      throw new RecordConflictError("Only Dormant outreach can be reactivated.");
    }
    const currentFollowUp = requireReciprocalPendingFollowUp(
      command.expectedCurrentFollowUpId ? await followUps.get(command.expectedCurrentFollowUpId) : undefined,
      entry,
      command.expectedCurrentFollowUpId,
      command.expectedCurrentFollowUpRevision
    );
    requireExpectedFollowUpSnapshot(currentFollowUp, command.expectedCurrentFollowUp);
    if (kind === "activated" && currentFollowUp) {
      throw new RecordConflictError("Dormant outreach cannot keep a current reminder.");
    }

    let cancelledFollowUp: FollowUp | undefined;
    if (currentFollowUp) {
      cancelledFollowUp = {
        ...currentFollowUp,
        revision: currentFollowUp.revision + 1,
        status: "cancelled",
        updatedAt: command.occurredAt
      };
      const cancelEvent: FollowUpEvent = {
        id: command.followUpEventId,
        followUpId: currentFollowUp.id,
        personId: currentFollowUp.personId,
        kind: "cancelled",
        occurredAt: command.occurredAt
      };
      assertValidRecord("followUps", cancelledFollowUp);
      assertValidRecord("followUpEvents", cancelEvent);
      await followUps.put(cancelledFollowUp);
      await followUpEvents.add(cancelEvent);
    }
    const { currentFollowUpId: _current, removedAt: _removed, ...base } = entry;
    const intentStatus: ReachOutIntentStatus = kind === "moved_to_dormant"
      ? "dormant"
      : kind === "activated"
        ? "active"
        : entry.intentStatus;
    const updated: ReachOutEntry = {
      ...base,
      revision: entry.revision + 1,
      intentStatus,
      ...(kind === "removed" ? { removedAt: command.occurredAt } : {}),
      updatedAt: command.occurredAt
    };
    const event: ReachOutEvent = {
      id: command.reachOutEventId,
      reachOutEntryId: entry.id,
      kind,
      occurredAt: command.occurredAt,
      commandFingerprint: command.commandFingerprint,
      ...(currentFollowUp ? { followUpId: currentFollowUp.id } : {})
    };
    assertValidRecord("reachOutEntries", updated);
    assertValidRecord("reachOutEvents", event);
    await entries.put(updated);
    await reachOutEvents.add(event);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return {
      entry: updated,
      event,
      ...(cancelledFollowUp ? { cancelledFollowUp } : {})
    };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function moveReachOutToDormant(
  db: PeopleOsDatabase,
  command: ReachOutStatusCommand,
  hooks: ReachOutMutationHooks = {}
): Promise<ReachOutStatusResult> {
  return applyReachOutStatus(db, command, "moved_to_dormant", hooks);
}

export function reactivateReachOut(
  db: PeopleOsDatabase,
  command: ReachOutStatusCommand,
  hooks: ReachOutMutationHooks = {}
): Promise<ReachOutStatusResult> {
  return applyReachOutStatus(db, command, "activated", hooks);
}

export function removeReachOut(
  db: PeopleOsDatabase,
  command: ReachOutStatusCommand,
  hooks: ReachOutMutationHooks = {}
): Promise<ReachOutStatusResult> {
  return applyReachOutStatus(db, command, "removed", hooks);
}
