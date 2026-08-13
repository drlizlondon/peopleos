import type { IDBPObjectStore, StoreNames } from "idb";
import type { PeopleOsDatabase, PeopleOsDb } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import {
  interactionCountsAsContact,
  interactionKindIsManuallySelectable
} from "../domain/interactionPolicy";
import { regularContactSetupState } from "../domain/regularContactSchedule";
import {
  contactCadenceOf,
  contactCadencesEqual,
  isValidContactCadence
} from "../domain/cadence";
import {
  addDaysToLocalDate,
  effectiveFollowUpDate,
  FOLLOW_UP_ACTION_OPTIONS,
  localDateForInstant
} from "../domain/followUpPolicy";
import type {
  ContactCadence,
  FollowUp,
  FollowUpActionType,
  FollowUpEvent,
  Interaction,
  InteractionKind,
  LocalDate,
  Person,
  TodaySkip
} from "../domain/schema";
import {
  assertValidRecord,
  isIsoInstant,
  isLocalDate,
  ValidationError
} from "../domain/validation";

export type FollowUpMutationHooks = {
  beforeCommit?: () => void;
};

export type FollowUpDraft = {
  id: string;
  createdEventId: string;
  personId: string;
  reason: string;
  actionType: FollowUpActionType;
  dueDate: LocalDate;
  suggestedByRule?: string;
  createdAt: string;
};

export type CreateFollowUpOptions = FollowUpMutationHooks & {
  localDate?: LocalDate;
  timeZone?: string;
};

export type SnoozeFollowUpCommand = {
  eventId: string;
  followUpId: string;
  personId: string;
  expectedRevision: number;
  fromDate: LocalDate;
  toDate: LocalDate;
  occurredAt: string;
};

export type RescheduleFollowUpCommand = {
  eventId: string;
  followUpId: string;
  personId: string;
  expectedRevision: number;
  fromDate: LocalDate;
  replacement: {
    id: string;
    reason: string;
    actionType: FollowUpActionType;
    dueDate: LocalDate;
    suggestedByRule?: string;
  };
  occurredAt: string;
};

export type CancelFollowUpCommand = {
  eventId: string;
  followUpId: string;
  personId: string;
  expectedRevision: number;
  occurredAt: string;
};

export type CompleteFollowUpWithContactCommand = {
  eventId: string;
  interactionId: string;
  followUpId: string;
  personId: string;
  expectedRevision: number;
  interactionKind: InteractionKind;
  interactionOccurredAt: string;
  summary?: string;
  occurredAt: string;
};

export type CompleteFollowUpWithoutContactCommand = {
  eventId: string;
  interactionId: string;
  followUpId: string;
  personId: string;
  expectedRevision: number;
  occurredAt: string;
};

export type ContactCadenceCommand = {
  personId: string;
  expectedRevision: number;
  cadence?: ContactCadence;
  /** @deprecated Temporary command compatibility; updates always write structured cadence. */
  cadenceDays?: number;
  occurredAt: string;
};

type NotTodayBase = {
  eventId: string;
  personId: string;
  expectedPersonRevision: number;
  expectedDatasetRevision: number;
  localDate: LocalDate;
  tomorrowDate: LocalDate;
  occurredAt: string;
};

export type NotTodayCommand = NotTodayBase & (
  | {
    eligibilityCode: "explicit_follow_up";
    primaryFollowUpId: string;
    expectedFollowUpRevision: number;
    fromDate: LocalDate;
  }
  | {
    eligibilityCode: "new_relationship" | "cadence_due";
    followUpId: string;
    displayName: string;
  }
);

export type FollowUpCompletionResult = {
  followUp: FollowUp;
  event: FollowUpEvent;
  interaction: Interaction;
};

export type NotTodayResult = {
  followUp: FollowUp;
  event: FollowUpEvent;
  todaySkip: TodaySkip;
};

export class ReachOutOwnedFollowUpError extends Error {
  constructor() {
    super("This follow-up belongs to Reach Out and must be changed from its Reach Out plan.");
    this.name = "ReachOutOwnedFollowUpError";
  }
}

const actionTypes = new Set(FOLLOW_UP_ACTION_OPTIONS.map((option) => option.value));

function idFactoryDefault(): string {
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

function defaultLocalDate(instant: string, timeZone?: string): LocalDate {
  return localDateForInstant(instant, timeZone);
}

function sameCreatedFollowUp(
  current: FollowUp,
  prepared: FollowUp
): boolean {
  return current.id === prepared.id
    && current.personId === prepared.personId
    && current.dueDate === prepared.dueDate
    && current.reason === prepared.reason
    && current.actionType === prepared.actionType
    && current.suggestedByRule === prepared.suggestedByRule
    && current.supersedesFollowUpId === prepared.supersedesFollowUpId
    && current.createdAt === prepared.createdAt;
}

function requireInstant(value: string, message: string): void {
  if (!isIsoInstant(value)) throw new ValidationError([message]);
}

function requireDate(value: string, message: string): asserts value is LocalDate {
  if (!isLocalDate(value)) throw new ValidationError([message]);
}

function requireReason(value: string): string {
  const reason = value.trim();
  const issues: string[] = [];
  if (!reason) issues.push("Add why you want to follow up.");
  if (reason.length > 240) issues.push("Reason must be 240 characters or fewer.");
  if (issues.length) throw new ValidationError(issues);
  return reason;
}

function requireActionType(value: FollowUpActionType): void {
  if (!actionTypes.has(value)) throw new ValidationError(["Choose a supported next action."]);
}

function requireWritablePerson(person: Person | undefined): Person {
  if (!person) throw new RecordConflictError("This person is no longer available.");
  if (person.archivedAt || person.identityStatus === "merged") {
    throw new RecordConflictError("Restore or open the current Person before changing follow-ups.");
  }
  return person;
}

function requirePendingFollowUp(
  current: FollowUp | undefined,
  command: { personId: string; expectedRevision: number }
): FollowUp {
  if (!current || current.personId !== command.personId) {
    throw new RecordConflictError("This follow-up is no longer available.");
  }
  if (current.revision !== command.expectedRevision) throw new StaleRevisionError();
  if (current.status !== "pending") {
    throw new RecordConflictError("Completed, cancelled and superseded follow-ups are read-only.");
  }
  return current;
}

function requireReachOutIndependent(followUp: FollowUp): void {
  if (followUp.reachOutEntryId) throw new ReachOutOwnedFollowUpError();
}

async function updateMetadata<Names extends ArrayLike<StoreNames<PeopleOsDb>>>(
  store: IDBPObjectStore<PeopleOsDb, Names, "metadata", "readwrite">,
  now: string
): Promise<void> {
  const metadata = await store.get("app" as never) as {
    datasetRevision: number;
    updatedAt: string;
  } | undefined;
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  await store.put({
    ...metadata,
    datasetRevision: metadata.datasetRevision + 1,
    updatedAt: now
  } as never);
}

async function abortAndRethrow(
  transaction: { abort: () => void; done: Promise<unknown> },
  error: unknown
): Promise<never> {
  try { transaction.abort(); } catch { /* transaction already closed */ }
  try { await transaction.done; } catch { /* expected rollback */ }
  throw error;
}

function prepareNewFollowUp(
  draft: Omit<FollowUpDraft, "createdEventId">,
  localDate: LocalDate,
  extra: Pick<FollowUp, "supersedesFollowUpId"> | Record<string, never> = {}
): FollowUp {
  const reason = requireReason(draft.reason);
  requireActionType(draft.actionType);
  requireDate(draft.dueDate, "Choose a valid follow-up date.");
  requireDate(localDate, "A valid current local date is required.");
  requireInstant(draft.createdAt, "The follow-up draft needs a valid creation time.");
  if (!draft.id.trim()) throw new ValidationError(["The follow-up draft needs a stable ID."]);
  if (!draft.personId.trim()) throw new ValidationError(["Choose a person."]);
  if (draft.dueDate < localDate) throw new ValidationError(["Choose today or a future date."]);
  const suggestedByRule = trimmed(draft.suggestedByRule);
  const followUp: FollowUp = {
    id: draft.id,
    revision: 1,
    personId: draft.personId,
    dueDate: draft.dueDate,
    reason,
    actionType: draft.actionType,
    ...(suggestedByRule ? { suggestedByRule } : {}),
    status: "pending",
    ...extra,
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt
  };
  assertValidRecord("followUps", followUp);
  return followUp;
}

export function createFollowUpDraft(
  personId: string,
  options: {
    now?: string;
    idFactory?: () => string;
    dueDate?: LocalDate;
    actionType?: FollowUpActionType;
    timeZone?: string;
  } = {}
): FollowUpDraft {
  const createdAt = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? idFactoryDefault;
  return {
    id: stableId("follow-up", idFactory),
    createdEventId: stableId("follow-up-event", idFactory),
    personId,
    reason: "",
    actionType: options.actionType ?? "other",
    dueDate: options.dueDate ?? defaultLocalDate(createdAt, options.timeZone),
    createdAt
  };
}

export async function createFollowUp(
  db: PeopleOsDatabase,
  draft: FollowUpDraft,
  options: CreateFollowUpOptions = {}
): Promise<FollowUp> {
  const localDate = options.localDate ?? defaultLocalDate(draft.createdAt, options.timeZone);
  const followUp = prepareNewFollowUp(draft, localDate);
  if (!draft.createdEventId.trim()) throw new ValidationError(["The lifecycle event needs a stable ID."]);
  const event: FollowUpEvent = {
    id: draft.createdEventId,
    followUpId: followUp.id,
    personId: followUp.personId,
    kind: "created",
    occurredAt: draft.createdAt,
    toDate: followUp.dueDate
  };
  assertValidRecord("followUpEvents", event);
  const tx = db.transaction(["people", "followUps", "followUpEvents", "metadata"], "readwrite");
  try {
    const followUpStore = tx.objectStore("followUps");
    const eventStore = tx.objectStore("followUpEvents");
    const [existingFollowUp, existingEvent] = await Promise.all([
      followUpStore.get(followUp.id),
      eventStore.get(event.id)
    ]);
    if (existingFollowUp || existingEvent) {
      if (existingFollowUp && existingEvent
        && sameCreatedFollowUp(existingFollowUp, followUp) && identical(existingEvent, event)) {
        await tx.done;
        return existingFollowUp;
      }
      throw new RecordConflictError("The follow-up create IDs have already been used by another command.");
    }
    requireWritablePerson(await tx.objectStore("people").get(followUp.personId));
    await followUpStore.add(followUp);
    await eventStore.add(event);
    await updateMetadata(tx.objectStore("metadata"), followUp.updatedAt);
    options.beforeCommit?.();
    await tx.done;
    return followUp;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function createSnoozeFollowUpCommand(
  followUp: FollowUp,
  toDate: LocalDate,
  options: { now?: string; idFactory?: () => string } = {}
): SnoozeFollowUpCommand {
  const idFactory = options.idFactory ?? idFactoryDefault;
  return {
    eventId: stableId("follow-up-event", idFactory),
    followUpId: followUp.id,
    personId: followUp.personId,
    expectedRevision: followUp.revision,
    fromDate: effectiveFollowUpDate(followUp),
    toDate,
    occurredAt: options.now ?? new Date().toISOString()
  };
}

export async function snoozeFollowUp(
  db: PeopleOsDatabase,
  command: SnoozeFollowUpCommand,
  hooks: FollowUpMutationHooks = {}
): Promise<FollowUp> {
  requireInstant(command.occurredAt, "The snooze command needs a valid time.");
  requireDate(command.fromDate, "The current effective date is invalid.");
  requireDate(command.toDate, "Choose a valid snooze date.");
  if (command.toDate <= command.fromDate) {
    throw new ValidationError(["Snooze must move the follow-up after its current date."]);
  }
  const event: FollowUpEvent = {
    id: command.eventId,
    followUpId: command.followUpId,
    personId: command.personId,
    kind: "snoozed",
    occurredAt: command.occurredAt,
    fromDate: command.fromDate,
    toDate: command.toDate
  };
  assertValidRecord("followUpEvents", event);
  const tx = db.transaction(["people", "followUps", "followUpEvents", "metadata"], "readwrite");
  try {
    const followUpStore = tx.objectStore("followUps");
    const eventStore = tx.objectStore("followUpEvents");
    const [storedEvent, storedFollowUp] = await Promise.all([
      eventStore.get(command.eventId),
      followUpStore.get(command.followUpId)
    ]);
    if (storedEvent) {
      if (!identical(storedEvent, event) || !storedFollowUp) {
        throw new RecordConflictError(`followUpEvents already contains id ${command.eventId}`);
      }
      await tx.done;
      return storedFollowUp;
    }
    const current = requirePendingFollowUp(storedFollowUp, command);
    requireWritablePerson(await tx.objectStore("people").get(current.personId));
    if (effectiveFollowUpDate(current) !== command.fromDate) throw new StaleRevisionError();
    const updated: FollowUp = {
      ...current,
      revision: current.revision + 1,
      snoozedUntilDate: command.toDate,
      updatedAt: command.occurredAt
    };
    assertValidRecord("followUps", updated);
    await followUpStore.put(updated);
    await eventStore.add(event);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return updated;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function createRescheduleFollowUpCommand(
  followUp: FollowUp,
  replacement: {
    dueDate: LocalDate;
    reason?: string;
    actionType?: FollowUpActionType;
  },
  options: { now?: string; idFactory?: () => string } = {}
): RescheduleFollowUpCommand {
  const idFactory = options.idFactory ?? idFactoryDefault;
  return {
    eventId: stableId("follow-up-event", idFactory),
    followUpId: followUp.id,
    personId: followUp.personId,
    expectedRevision: followUp.revision,
    fromDate: effectiveFollowUpDate(followUp),
    replacement: {
      id: stableId("follow-up", idFactory),
      reason: replacement.reason ?? followUp.reason,
      actionType: replacement.actionType ?? followUp.actionType,
      dueDate: replacement.dueDate,
      ...(followUp.suggestedByRule ? { suggestedByRule: followUp.suggestedByRule } : {})
    },
    occurredAt: options.now ?? new Date().toISOString()
  };
}

export async function rescheduleFollowUp(
  db: PeopleOsDatabase,
  command: RescheduleFollowUpCommand,
  options: CreateFollowUpOptions = {}
): Promise<{ original: FollowUp; replacement: FollowUp }> {
  requireInstant(command.occurredAt, "The reschedule command needs a valid time.");
  requireDate(command.fromDate, "The current effective date is invalid.");
  const replacement = prepareNewFollowUp({
    ...command.replacement,
    personId: command.personId,
    createdAt: command.occurredAt
  }, options.localDate ?? defaultLocalDate(command.occurredAt, options.timeZone), {
    supersedesFollowUpId: command.followUpId
  });
  const event: FollowUpEvent = {
    id: command.eventId,
    followUpId: command.followUpId,
    personId: command.personId,
    kind: "rescheduled",
    occurredAt: command.occurredAt,
    fromDate: command.fromDate,
    toDate: replacement.dueDate,
    replacementFollowUpId: replacement.id
  };
  assertValidRecord("followUpEvents", event);
  const tx = db.transaction(["people", "followUps", "followUpEvents", "metadata"], "readwrite");
  try {
    const followUpStore = tx.objectStore("followUps");
    const eventStore = tx.objectStore("followUpEvents");
    const [storedEvent, storedOriginal, storedReplacement] = await Promise.all([
      eventStore.get(command.eventId),
      followUpStore.get(command.followUpId),
      followUpStore.get(replacement.id)
    ]);
    if (storedEvent) {
      if (!identical(storedEvent, event) || !storedOriginal || !storedReplacement
        || storedOriginal.supersededByFollowUpId !== storedReplacement.id
        || storedReplacement.supersedesFollowUpId !== storedOriginal.id) {
        throw new RecordConflictError(`followUpEvents already contains id ${command.eventId}`);
      }
      await tx.done;
      return { original: storedOriginal, replacement: storedReplacement };
    }
    if (storedReplacement) throw new RecordConflictError(`followUps already contains id ${replacement.id}`);
    const current = requirePendingFollowUp(storedOriginal, command);
    requireReachOutIndependent(current);
    requireWritablePerson(await tx.objectStore("people").get(current.personId));
    if (effectiveFollowUpDate(current) !== command.fromDate) throw new StaleRevisionError();
    const original: FollowUp = {
      ...current,
      revision: current.revision + 1,
      status: "superseded",
      supersededByFollowUpId: replacement.id,
      updatedAt: command.occurredAt
    };
    assertValidRecord("followUps", original);
    await followUpStore.put(original);
    await followUpStore.add(replacement);
    await eventStore.add(event);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    options.beforeCommit?.();
    await tx.done;
    return { original, replacement };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function createCancelFollowUpCommand(
  followUp: FollowUp,
  options: { now?: string; idFactory?: () => string } = {}
): CancelFollowUpCommand {
  return {
    eventId: stableId("follow-up-event", options.idFactory ?? idFactoryDefault),
    followUpId: followUp.id,
    personId: followUp.personId,
    expectedRevision: followUp.revision,
    occurredAt: options.now ?? new Date().toISOString()
  };
}

export async function cancelFollowUp(
  db: PeopleOsDatabase,
  command: CancelFollowUpCommand,
  hooks: FollowUpMutationHooks = {}
): Promise<FollowUp> {
  requireInstant(command.occurredAt, "The cancel command needs a valid time.");
  const event: FollowUpEvent = {
    id: command.eventId,
    followUpId: command.followUpId,
    personId: command.personId,
    kind: "cancelled",
    occurredAt: command.occurredAt
  };
  assertValidRecord("followUpEvents", event);
  const tx = db.transaction(["people", "followUps", "followUpEvents", "metadata"], "readwrite");
  try {
    const followUpStore = tx.objectStore("followUps");
    const eventStore = tx.objectStore("followUpEvents");
    const [storedEvent, storedFollowUp] = await Promise.all([
      eventStore.get(command.eventId), followUpStore.get(command.followUpId)
    ]);
    if (storedEvent) {
      if (!identical(storedEvent, event) || !storedFollowUp) {
        throw new RecordConflictError(`followUpEvents already contains id ${command.eventId}`);
      }
      await tx.done;
      return storedFollowUp;
    }
    const current = requirePendingFollowUp(storedFollowUp, command);
    requireReachOutIndependent(current);
    requireWritablePerson(await tx.objectStore("people").get(current.personId));
    const updated: FollowUp = {
      ...current,
      revision: current.revision + 1,
      status: "cancelled",
      updatedAt: command.occurredAt
    };
    assertValidRecord("followUps", updated);
    await followUpStore.put(updated);
    await eventStore.add(event);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return updated;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function createCompleteFollowUpWithContactCommand(
  followUp: FollowUp,
  interaction: { kind: InteractionKind; occurredAt?: string; summary?: string },
  options: { now?: string; idFactory?: () => string } = {}
): CompleteFollowUpWithContactCommand {
  const occurredAt = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? idFactoryDefault;
  return {
    eventId: stableId("follow-up-event", idFactory),
    interactionId: stableId("interaction", idFactory),
    followUpId: followUp.id,
    personId: followUp.personId,
    expectedRevision: followUp.revision,
    interactionKind: interaction.kind,
    interactionOccurredAt: interaction.occurredAt ?? occurredAt,
    ...(interaction.summary !== undefined ? { summary: interaction.summary } : {}),
    occurredAt
  };
}

function prepareContactInteraction(command: CompleteFollowUpWithContactCommand): Interaction {
  requireInstant(command.occurredAt, "The completion command needs a valid time.");
  requireInstant(command.interactionOccurredAt, "Choose a valid contact date and time.");
  if (Date.parse(command.interactionOccurredAt) > Date.parse(command.occurredAt)) {
    throw new ValidationError(["Contact cannot be recorded in the future."]);
  }
  if (command.interactionKind === "contacted"
    || !interactionKindIsManuallySelectable(command.interactionKind)
    || !interactionCountsAsContact(command.interactionKind)) {
    throw new ValidationError(["Choose a contact interaction type."]);
  }
  const summary = trimmed(command.summary);
  if ((command.summary ?? "").trim().length > 5_000) {
    throw new ValidationError(["Summary must be 5,000 characters or fewer."]);
  }
  const interaction: Interaction = {
    id: command.interactionId,
    revision: 1,
    personId: command.personId,
    kind: command.interactionKind,
    occurredAt: command.interactionOccurredAt,
    ...(summary ? { summary } : {}),
    followUpId: command.followUpId,
    createdAt: command.occurredAt,
    updatedAt: command.occurredAt
  };
  assertValidRecord("interactions", interaction);
  return interaction;
}

function prepareCompletionFollowUp(current: FollowUp, occurredAt: string): FollowUp {
  const completed: FollowUp = {
    ...current,
    revision: current.revision + 1,
    status: "completed",
    completedAt: occurredAt,
    updatedAt: occurredAt
  };
  assertValidRecord("followUps", completed);
  return completed;
}

async function executeCompletion(
  db: PeopleOsDatabase,
  command: CompleteFollowUpWithContactCommand | CompleteFollowUpWithoutContactCommand,
  interaction: Interaction,
  eventKind: "completed_with_contact" | "completed_without_contact",
  hooks: FollowUpMutationHooks
): Promise<FollowUpCompletionResult> {
  const event: FollowUpEvent = {
    id: command.eventId,
    followUpId: command.followUpId,
    personId: command.personId,
    kind: eventKind,
    occurredAt: command.occurredAt,
    interactionId: command.interactionId
  };
  assertValidRecord("followUpEvents", event);
  const tx = db.transaction(["people", "followUps", "followUpEvents", "interactions", "metadata"], "readwrite");
  try {
    const followUpStore = tx.objectStore("followUps");
    const eventStore = tx.objectStore("followUpEvents");
    const interactionStore = tx.objectStore("interactions");
    const [storedEvent, storedFollowUp, storedInteraction] = await Promise.all([
      eventStore.get(command.eventId),
      followUpStore.get(command.followUpId),
      interactionStore.get(command.interactionId)
    ]);
    if (storedEvent) {
      if (!identical(storedEvent, event) || !storedFollowUp
        || !storedInteraction || !identical(storedInteraction, interaction)) {
        throw new RecordConflictError(`followUpEvents already contains id ${command.eventId}`);
      }
      await tx.done;
      return { followUp: storedFollowUp, event: storedEvent, interaction: storedInteraction };
    }
    if (storedInteraction) throw new RecordConflictError(`interactions already contains id ${interaction.id}`);
    const current = requirePendingFollowUp(storedFollowUp, command);
    requireReachOutIndependent(current);
    requireWritablePerson(await tx.objectStore("people").get(current.personId));
    const completed = prepareCompletionFollowUp(current, command.occurredAt);
    await followUpStore.put(completed);
    await interactionStore.add(interaction);
    await eventStore.add(event);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return { followUp: completed, event, interaction };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export async function completeFollowUpWithContact(
  db: PeopleOsDatabase,
  command: CompleteFollowUpWithContactCommand,
  hooks: FollowUpMutationHooks = {}
): Promise<FollowUpCompletionResult> {
  return executeCompletion(db, command, prepareContactInteraction(command), "completed_with_contact", hooks);
}

export function createCompleteFollowUpWithoutContactCommand(
  followUp: FollowUp,
  options: { now?: string; idFactory?: () => string } = {}
): CompleteFollowUpWithoutContactCommand {
  const idFactory = options.idFactory ?? idFactoryDefault;
  return {
    eventId: stableId("follow-up-event", idFactory),
    interactionId: stableId("interaction", idFactory),
    followUpId: followUp.id,
    personId: followUp.personId,
    expectedRevision: followUp.revision,
    occurredAt: options.now ?? new Date().toISOString()
  };
}

export async function completeFollowUpWithoutContact(
  db: PeopleOsDatabase,
  command: CompleteFollowUpWithoutContactCommand,
  hooks: FollowUpMutationHooks = {}
): Promise<FollowUpCompletionResult> {
  requireInstant(command.occurredAt, "The completion command needs a valid time.");
  const interaction: Interaction = {
    id: command.interactionId,
    revision: 1,
    personId: command.personId,
    kind: "follow_up_completed",
    occurredAt: command.occurredAt,
    followUpId: command.followUpId,
    createdAt: command.occurredAt,
    updatedAt: command.occurredAt
  };
  assertValidRecord("interactions", interaction);
  return executeCompletion(db, command, interaction, "completed_without_contact", hooks);
}

export async function updateContactCadence(
  db: PeopleOsDatabase,
  command: ContactCadenceCommand,
  hooks: FollowUpMutationHooks = {}
): Promise<Person> {
  requireInstant(command.occurredAt, "The cadence command needs a valid time.");
  if (command.cadence !== undefined && !isValidContactCadence(command.cadence)) {
    throw new ValidationError(["Contact cadence must be a positive whole number no more than 3,650 days apart."]);
  }
  if (command.cadenceDays !== undefined
    && !isValidContactCadence({ value: command.cadenceDays, unit: "days" })) {
    throw new ValidationError(["Custom cadence must be between 1 and 3,650 days."]);
  }
  const contactCadence = contactCadenceOf({
    contactCadence: command.cadence,
    contactCadenceDays: command.cadenceDays
  });
  const tx = db.transaction(["people", "interactions", "followUps", "metadata"], "readwrite");
  try {
    const people = tx.objectStore("people");
    const current = requireWritablePerson(await people.get(command.personId));
    const sameCadence = contactCadencesEqual(contactCadenceOf(current), contactCadence);
    const canonicalStorage = current.contactCadenceDays === undefined
      && contactCadencesEqual(current.contactCadence, contactCadence);
    if (current.revision === command.expectedRevision + 1
      && sameCadence && canonicalStorage && current.updatedAt === command.occurredAt) {
      await tx.done;
      return current;
    }
    if (current.revision !== command.expectedRevision) throw new StaleRevisionError();
    if (sameCadence && canonicalStorage) {
      await tx.done;
      return current;
    }
    const {
      contactCadence: _oldCadence,
      contactCadenceDays: _legacyCadenceDays,
      ...withoutCadence
    } = current;
    const updated: Person = {
      ...withoutCadence,
      ...(contactCadence === undefined ? {} : { contactCadence }),
      revision: current.revision + 1,
      updatedAt: command.occurredAt
    };
    const [interactions, followUps] = await Promise.all([
      tx.objectStore("interactions").index("by-person").getAll(current.id),
      tx.objectStore("followUps").index("by-person").getAll(current.id)
    ]);
    if (regularContactSetupState(updated, interactions, followUps) === "incomplete") {
      throw new ValidationError(["Choose Today or Tomorrow to start regular contact."]);
    }
    assertValidRecord("people", updated);
    await people.put(updated);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return updated;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export function createNotTodayCommand(
  person: Person,
  options: {
    localDate: LocalDate;
    eligibilityCode: "explicit_follow_up" | "new_relationship" | "cadence_due";
    primaryFollowUp?: FollowUp;
    expectedDatasetRevision: number;
    now?: string;
    idFactory?: () => string;
  }
): NotTodayCommand {
  const idFactory = options.idFactory ?? idFactoryDefault;
  if (!Number.isInteger(options.expectedDatasetRevision) || options.expectedDatasetRevision < 1) {
    throw new ValidationError(["Not today requires a current assessment revision."]);
  }
  const base: NotTodayBase = {
    eventId: stableId("follow-up-event", idFactory),
    personId: person.id,
    expectedPersonRevision: person.revision,
    expectedDatasetRevision: options.expectedDatasetRevision,
    localDate: options.localDate,
    tomorrowDate: addDaysToLocalDate(options.localDate, 1),
    occurredAt: options.now ?? new Date().toISOString()
  };
  if (options.eligibilityCode === "explicit_follow_up") {
    const followUp = options.primaryFollowUp;
    if (!followUp || followUp.personId !== person.id || followUp.status !== "pending"
      || effectiveFollowUpDate(followUp) > options.localDate) {
      throw new ValidationError(["Choose the due primary follow-up for Not today."]);
    }
    return {
      ...base,
      eligibilityCode: "explicit_follow_up",
      primaryFollowUpId: followUp.id,
      expectedFollowUpRevision: followUp.revision,
      fromDate: effectiveFollowUpDate(followUp)
    };
  }
  if (options.primaryFollowUp) {
    throw new ValidationError(["New and cadence Not today commands cannot include a primary follow-up."]);
  }
  return {
    ...base,
    eligibilityCode: options.eligibilityCode,
    followUpId: stableId("follow-up", idFactory),
    displayName: person.displayName
  };
}

export async function notToday(
  db: PeopleOsDatabase,
  command: NotTodayCommand,
  hooks: FollowUpMutationHooks = {}
): Promise<NotTodayResult> {
  requireDate(command.localDate, "A valid current local date is required.");
  requireDate(command.tomorrowDate, "A valid tomorrow date is required.");
  requireInstant(command.occurredAt, "The Not today command needs a valid time.");
  if (command.tomorrowDate !== addDaysToLocalDate(command.localDate, 1)) {
    throw new ValidationError(["Not today must move the plan to tomorrow."]);
  }
  const todaySkip: TodaySkip = {
    id: `${command.personId}:${command.localDate}`,
    personId: command.personId,
    localDate: command.localDate,
    createdAt: command.occurredAt
  };
  assertValidRecord("todaySkips", todaySkip);

  const isExplicit = command.eligibilityCode === "explicit_follow_up";
  const followUpId = isExplicit ? command.primaryFollowUpId : command.followUpId;
  const event: FollowUpEvent = isExplicit ? {
    id: command.eventId,
    followUpId,
    personId: command.personId,
    kind: "snoozed",
    occurredAt: command.occurredAt,
    fromDate: command.fromDate,
    toDate: command.tomorrowDate
  } : {
    id: command.eventId,
    followUpId,
    personId: command.personId,
    kind: "created",
    occurredAt: command.occurredAt,
    toDate: command.tomorrowDate
  };
  assertValidRecord("followUpEvents", event);
  const preparedRuleFollowUp = !isExplicit ? prepareNewFollowUp({
    id: command.followUpId,
    personId: command.personId,
    reason: `Reconnect with ${command.displayName}`,
    actionType: "other",
    dueDate: command.tomorrowDate,
    suggestedByRule: "today_not_today",
    createdAt: command.occurredAt
  }, command.localDate) : undefined;

  const tx = db.transaction(["people", "followUps", "followUpEvents", "todaySkips", "metadata"], "readwrite");
  try {
    const followUps = tx.objectStore("followUps");
    const events = tx.objectStore("followUpEvents");
    const skips = tx.objectStore("todaySkips");
    const [storedFollowUp, storedEvent, storedSkip, person, metadata] = await Promise.all([
      followUps.get(followUpId),
      events.get(command.eventId),
      skips.get(todaySkip.id),
      tx.objectStore("people").get(command.personId),
      tx.objectStore("metadata").get("app")
    ]);
    if (storedEvent) {
      const followUpMatches = storedFollowUp && (isExplicit
        ? storedFollowUp.personId === command.personId
        : sameCreatedFollowUp(storedFollowUp, preparedRuleFollowUp!));
      if (!storedSkip || !followUpMatches || !identical(storedEvent, event)
        || storedSkip.personId !== command.personId || storedSkip.localDate !== command.localDate) {
        throw new RecordConflictError("The Not today command IDs conflict with stored history.");
      }
      await tx.done;
      return { followUp: storedFollowUp, event: storedEvent, todaySkip: storedSkip };
    }
    if (storedSkip && (storedSkip.personId !== command.personId || storedSkip.localDate !== command.localDate)) {
      throw new RecordConflictError("The current-day skip ID belongs to another record.");
    }
    const writablePerson = requireWritablePerson(person);
    if (writablePerson.revision !== command.expectedPersonRevision) throw new StaleRevisionError();
    if (metadata?.datasetRevision !== command.expectedDatasetRevision) throw new StaleRevisionError();

    let followUp: FollowUp;
    if (isExplicit) {
      const current = requirePendingFollowUp(storedFollowUp, {
        personId: command.personId,
        expectedRevision: command.expectedFollowUpRevision
      });
      if (effectiveFollowUpDate(current) !== command.fromDate
        || effectiveFollowUpDate(current) > command.localDate) throw new StaleRevisionError();
      followUp = {
        ...current,
        revision: current.revision + 1,
        snoozedUntilDate: command.tomorrowDate,
        updatedAt: command.occurredAt
      };
      assertValidRecord("followUps", followUp);
      await followUps.put(followUp);
    } else {
      if (storedFollowUp) throw new RecordConflictError(`followUps already contains id ${followUpId}`);
      followUp = preparedRuleFollowUp!;
      await followUps.add(followUp);
    }
    await events.add(event);
    if (!storedSkip) await skips.add(todaySkip);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return { followUp, event, todaySkip: storedSkip ?? todaySkip };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}
