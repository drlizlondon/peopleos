import type { IDBPObjectStore, StoreNames } from "idb";
import type { PeopleOsDatabase, PeopleOsDb } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import { commandFingerprint as fingerprintCommand } from "../domain/commandFingerprint";
import {
  effectiveFollowUpDate,
  localDateForInstant
} from "../domain/followUpPolicy";
import type {
  FollowUp,
  FollowUpEvent,
  Interaction,
  LocalDate,
  Person,
  ReachOutEntry,
  ReachOutEvent,
  TodaySkip
} from "../domain/schema";
import {
  assertValidRecord,
  isIsoInstant,
  isLocalDate,
  ValidationError
} from "../domain/validation";
import type { TodayEligibilityCode } from "../relationship-engine";
import {
  createNotTodayCommand,
  type NotTodayCommand
} from "./followUps";
import type { TodayActionContext } from "./todayQueries";

export type TodayActionMutationHooks = {
  beforeCommit?: () => void;
};

export type AlreadyContactedCommand = {
  commandFingerprint: string;
  personId: string;
  displayName: string;
  expectedPersonRevision: number;
  expectedDatasetRevision: number;
  eligibilityCode: TodayEligibilityCode;
  relevantDate: LocalDate;
  additionalDueFollowUpIds: string[];
  expectedPrimaryFollowUp?: FollowUp;
  expectedReachOutEntry?: ReachOutEntry;
  localDate: LocalDate;
  timeZone: string;
  nextDate: LocalDate;
  suppressNextFollowUp?: boolean;
  occurredAt: string;
  interactionId: string;
  followUpCompletionEventId: string;
  nextFollowUpId: string;
  nextFollowUpEventId: string;
  reachOutCompletionEventId: string;
  reachOutLinkedEventId: string;
};

export type AlreadyContactedResult = {
  interaction: Interaction;
  nextFollowUp?: FollowUp;
  nextFollowUpEvent?: FollowUpEvent;
  todaySkip: TodaySkip;
  completedPrimaryFollowUp?: FollowUp;
  primaryCompletionEvent?: FollowUpEvent;
  reachOutEntry?: ReachOutEntry;
  reachOutCompletionEvent?: ReachOutEvent;
  reachOutLinkedEvent?: ReachOutEvent;
};

type AlreadyContactedArtifacts = AlreadyContactedResult;

function defaultIdFactory(): string {
  return crypto.randomUUID();
}

function stableId(prefix: string, idFactory: () => string): string {
  return `${prefix}-${idFactory()}`;
}

function identical(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireDate(value: string, message: string): asserts value is LocalDate {
  if (!isLocalDate(value)) throw new ValidationError([message]);
}

function requireInstant(value: string, message: string): void {
  if (!isIsoInstant(value)) throw new ValidationError([message]);
}

function requireFingerprint(command: AlreadyContactedCommand): void {
  const { commandFingerprint, ...material } = command;
  if (fingerprintCommand(material) !== commandFingerprint) {
    throw new RecordConflictError("The Already contacted command fingerprint does not match its prepared input.");
  }
}

function requireWritablePerson(person: Person | undefined, command: AlreadyContactedCommand): Person {
  if (!person || person.id !== command.personId) {
    throw new RecordConflictError("This person is no longer available.");
  }
  if (person.archivedAt || person.identityStatus === "merged") {
    throw new RecordConflictError("Restore or open the current Person before updating Today.");
  }
  if (person.revision !== command.expectedPersonRevision || person.displayName !== command.displayName) {
    throw new StaleRevisionError();
  }
  return person;
}

function requirePreparedContext(context: TodayActionContext): void {
  const { card, projection } = context;
  const { item } = card;
  if (item.personId !== card.person.id) {
    throw new ValidationError(["The Today card does not match this person."]);
  }
  if (item.eligibilityCode === "explicit_follow_up") {
    const primary = card.primaryFollowUp;
    if (!primary || item.primaryFollowUpId !== primary.id
      || primary.personId !== card.person.id || primary.status !== "pending"
      || effectiveFollowUpDate(primary) > projection.result.localDate) {
      throw new ValidationError(["The primary Today plan is no longer available."]);
    }
    if (primary.reachOutEntryId) {
      const entry = card.reachOut?.entry;
      if (!entry || entry.id !== primary.reachOutEntryId
        || entry.personId !== card.person.id || entry.removedAt
        || entry.intentStatus !== "active" || entry.currentFollowUpId !== primary.id) {
        throw new ValidationError(["The Reach Out plan is no longer linked to this reminder."]);
      }
    }
  } else if (item.primaryFollowUpId || card.primaryFollowUp) {
    throw new ValidationError(["A rule-based Today card cannot include a primary follow-up."]);
  }
  if (item.additionalDueFollowUpIds.length !== card.additionalDueFollowUps.length
    || item.additionalDueFollowUpIds.some((id, index) => card.additionalDueFollowUps[index]?.id !== id)) {
    throw new ValidationError(["The additional due plans no longer match this Today card."]);
  }
}

export function prepareNotTodayFromContext(
  context: TodayActionContext,
  options: { now?: string; idFactory?: () => string } = {}
): NotTodayCommand {
  requirePreparedContext(context);
  const { card, projection } = context;
  const occurredAt = options.now ?? projection.result.evaluatedAt;
  requireInstant(occurredAt, "Not today needs a valid action time.");
  if (localDateForInstant(occurredAt, projection.result.timeZone) !== projection.result.localDate) {
    throw new StaleRevisionError();
  }
  return createNotTodayCommand(card.person, {
    localDate: projection.result.localDate,
    eligibilityCode: card.item.eligibilityCode,
    ...(card.primaryFollowUp ? { primaryFollowUp: card.primaryFollowUp } : {}),
    expectedDatasetRevision: projection.datasetRevision,
    now: occurredAt,
    ...(options.idFactory ? { idFactory: options.idFactory } : {})
  });
}

export function prepareAlreadyContactedCommand(
  context: TodayActionContext,
  nextDate: LocalDate,
  options: { now?: string; idFactory?: () => string; suppressNextFollowUp?: boolean } = {}
): AlreadyContactedCommand {
  requirePreparedContext(context);
  const { card, projection } = context;
  const { item } = card;
  const occurredAt = options.now ?? projection.result.evaluatedAt;
  requireInstant(occurredAt, "Already contacted needs a valid action time.");
  requireDate(nextDate, "Choose a valid next reminder date.");
  if (nextDate <= projection.result.localDate) {
    throw new ValidationError(["Choose a reminder date after today."]);
  }
  if (localDateForInstant(occurredAt, projection.result.timeZone) !== projection.result.localDate) {
    throw new StaleRevisionError();
  }
  const idFactory = options.idFactory ?? defaultIdFactory;
  const material = {
    personId: card.person.id,
    displayName: card.person.displayName,
    expectedPersonRevision: card.person.revision,
    expectedDatasetRevision: projection.datasetRevision,
    eligibilityCode: item.eligibilityCode,
    relevantDate: item.relevantDate,
    additionalDueFollowUpIds: [...item.additionalDueFollowUpIds],
    ...(card.primaryFollowUp ? { expectedPrimaryFollowUp: card.primaryFollowUp } : {}),
    ...(card.reachOut?.entry ? { expectedReachOutEntry: card.reachOut.entry } : {}),
    localDate: projection.result.localDate,
    timeZone: projection.result.timeZone,
    nextDate,
    ...(options.suppressNextFollowUp ? { suppressNextFollowUp: true } : {}),
    occurredAt,
    interactionId: stableId("interaction", idFactory),
    followUpCompletionEventId: stableId("follow-up-event", idFactory),
    nextFollowUpId: stableId("follow-up", idFactory),
    nextFollowUpEventId: stableId("follow-up-event", idFactory),
    reachOutCompletionEventId: stableId("reach-out-event", idFactory),
    reachOutLinkedEventId: stableId("reach-out-event", idFactory)
  };
  return { ...material, commandFingerprint: fingerprintCommand(material) };
}

function buildArtifacts(command: AlreadyContactedCommand): AlreadyContactedArtifacts {
  const primary = command.expectedPrimaryFollowUp;
  const reachOut = command.expectedReachOutEntry;
  const interaction: Interaction = {
    id: command.interactionId,
    revision: 1,
    personId: command.personId,
    kind: "contacted",
    occurredAt: command.occurredAt,
    ...(primary ? { followUpId: primary.id } : {}),
    createdAt: command.occurredAt,
    updatedAt: command.occurredAt
  };
  const nextFollowUp: FollowUp = {
    id: command.nextFollowUpId,
    revision: 1,
    personId: command.personId,
    dueDate: command.nextDate,
    reason: primary?.reason ?? `Reconnect with ${command.displayName}`,
    actionType: primary?.actionType ?? "other",
    ...(primary?.reachOutEntryId ? { reachOutEntryId: primary.reachOutEntryId } : {}),
    ...(!primary ? { suggestedByRule: "today_already_contacted" } : {}),
    status: "pending",
    createdAt: command.occurredAt,
    updatedAt: command.occurredAt
  };
  const nextFollowUpEvent: FollowUpEvent = {
    id: command.nextFollowUpEventId,
    followUpId: nextFollowUp.id,
    personId: command.personId,
    kind: "created",
    occurredAt: command.occurredAt,
    toDate: command.nextDate
  };
  const todaySkip: TodaySkip = {
    id: `${command.personId}:${command.localDate}`,
    personId: command.personId,
    localDate: command.localDate,
    createdAt: command.occurredAt
  };
  const completedPrimaryFollowUp: FollowUp | undefined = primary ? {
    ...primary,
    revision: primary.revision + 1,
    status: "completed",
    completedAt: command.occurredAt,
    updatedAt: command.occurredAt
  } : undefined;
  const primaryCompletionEvent: FollowUpEvent | undefined = primary ? {
    id: command.followUpCompletionEventId,
    followUpId: primary.id,
    personId: command.personId,
    kind: "completed_with_contact",
    occurredAt: command.occurredAt,
    interactionId: interaction.id
  } : undefined;

  let reachOutEntry: ReachOutEntry | undefined;
  let reachOutCompletionEvent: ReachOutEvent | undefined;
  let reachOutLinkedEvent: ReachOutEvent | undefined;
  if (reachOut && primary) {
    const { currentFollowUpId: _current, ...withoutCurrent } = reachOut;
    reachOutEntry = {
      ...withoutCurrent,
      revision: reachOut.revision + 1,
      intentStatus: command.suppressNextFollowUp ? "completed" : "active",
      ...(!command.suppressNextFollowUp ? { currentFollowUpId: nextFollowUp.id } : {}),
      lastCompletedAt: command.occurredAt,
      updatedAt: command.occurredAt
    };
    reachOutCompletionEvent = {
      id: command.reachOutCompletionEventId,
      reachOutEntryId: reachOut.id,
      kind: "completed",
      occurredAt: command.occurredAt,
      followUpId: primary.id,
      interactionId: interaction.id,
      commandFingerprint: command.commandFingerprint
    };
    reachOutLinkedEvent = command.suppressNextFollowUp ? undefined : {
      id: command.reachOutLinkedEventId,
      reachOutEntryId: reachOut.id,
      kind: "follow_up_linked",
      occurredAt: command.occurredAt,
      followUpId: nextFollowUp.id
    };
  }

  assertValidRecord("interactions", interaction);
  if (!command.suppressNextFollowUp) {
    assertValidRecord("followUps", nextFollowUp);
    assertValidRecord("followUpEvents", nextFollowUpEvent);
  }
  assertValidRecord("todaySkips", todaySkip);
  if (completedPrimaryFollowUp) assertValidRecord("followUps", completedPrimaryFollowUp);
  if (primaryCompletionEvent) assertValidRecord("followUpEvents", primaryCompletionEvent);
  if (reachOutEntry) assertValidRecord("reachOutEntries", reachOutEntry);
  if (reachOutCompletionEvent) assertValidRecord("reachOutEvents", reachOutCompletionEvent);
  if (reachOutLinkedEvent) assertValidRecord("reachOutEvents", reachOutLinkedEvent);
  return {
    interaction,
    ...(!command.suppressNextFollowUp ? { nextFollowUp, nextFollowUpEvent } : {}),
    todaySkip,
    ...(completedPrimaryFollowUp ? { completedPrimaryFollowUp } : {}),
    ...(primaryCompletionEvent ? { primaryCompletionEvent } : {}),
    ...(reachOutEntry ? { reachOutEntry } : {}),
    ...(reachOutCompletionEvent ? { reachOutCompletionEvent } : {}),
    ...(reachOutLinkedEvent ? { reachOutLinkedEvent } : {})
  };
}

async function updateMetadata<Names extends ArrayLike<StoreNames<PeopleOsDb>>>(
  store: IDBPObjectStore<PeopleOsDb, Names, "metadata", "readwrite">,
  expectedRevision: number,
  now: string
): Promise<void> {
  const metadata = await store.get("app" as never) as {
    datasetRevision: number;
    updatedAt: string;
  } | undefined;
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  if (metadata.datasetRevision !== expectedRevision) throw new StaleRevisionError();
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

function exactRetryMatches(
  expected: AlreadyContactedArtifacts,
  stored: {
    interaction?: Interaction;
    nextFollowUp?: FollowUp;
    nextFollowUpEvent?: FollowUpEvent;
    todaySkip?: TodaySkip;
    completedPrimaryFollowUp?: FollowUp;
    primaryCompletionEvent?: FollowUpEvent;
    reachOutEntry?: ReachOutEntry;
    reachOutCompletionEvent?: ReachOutEvent;
    reachOutLinkedEvent?: ReachOutEvent;
  }
): boolean {
  return identical(stored.interaction, expected.interaction)
    && identical(stored.nextFollowUp, expected.nextFollowUp)
    && identical(stored.nextFollowUpEvent, expected.nextFollowUpEvent)
    && identical(stored.todaySkip, expected.todaySkip)
    && identical(stored.completedPrimaryFollowUp, expected.completedPrimaryFollowUp)
    && identical(stored.primaryCompletionEvent, expected.primaryCompletionEvent)
    && identical(stored.reachOutEntry, expected.reachOutEntry)
    && identical(stored.reachOutCompletionEvent, expected.reachOutCompletionEvent)
    && identical(stored.reachOutLinkedEvent, expected.reachOutLinkedEvent);
}

export async function alreadyContacted(
  db: PeopleOsDatabase,
  command: AlreadyContactedCommand,
  hooks: TodayActionMutationHooks = {}
): Promise<AlreadyContactedResult> {
  requireFingerprint(command);
  requireInstant(command.occurredAt, "Already contacted needs a valid action time.");
  requireDate(command.localDate, "Already contacted needs a valid local date.");
  requireDate(command.nextDate, "Choose a valid next reminder date.");
  if (command.nextDate <= command.localDate) {
    throw new ValidationError(["Choose a reminder date after today."]);
  }
  if (localDateForInstant(command.occurredAt, command.timeZone) !== command.localDate) {
    throw new StaleRevisionError();
  }
  const expected = buildArtifacts(command);
  const tx = db.transaction([
    "people", "followUps", "followUpEvents", "interactions", "todaySkips",
    "reachOutEntries", "reachOutEvents", "metadata"
  ], "readwrite");
  try {
    const followUps = tx.objectStore("followUps");
    const followUpEvents = tx.objectStore("followUpEvents");
    const interactions = tx.objectStore("interactions");
    const todaySkips = tx.objectStore("todaySkips");
    const reachOutEntries = tx.objectStore("reachOutEntries");
    const reachOutEvents = tx.objectStore("reachOutEvents");
    const [
      person,
      storedInteraction,
      storedNextFollowUp,
      storedNextFollowUpEvent,
      storedTodaySkip,
      storedPrimary,
      storedPrimaryEvent,
      storedReachOutEntry,
      storedReachOutCompletion,
      storedReachOutLink
    ] = await Promise.all([
      tx.objectStore("people").get(command.personId),
      interactions.get(command.interactionId),
      followUps.get(command.nextFollowUpId),
      followUpEvents.get(command.nextFollowUpEventId),
      todaySkips.get(expected.todaySkip.id),
      command.expectedPrimaryFollowUp
        ? followUps.get(command.expectedPrimaryFollowUp.id)
        : Promise.resolve(undefined),
      command.expectedPrimaryFollowUp
        ? followUpEvents.get(command.followUpCompletionEventId)
        : Promise.resolve(undefined),
      command.expectedReachOutEntry
        ? reachOutEntries.get(command.expectedReachOutEntry.id)
        : Promise.resolve(undefined),
      command.expectedReachOutEntry
        ? reachOutEvents.get(command.reachOutCompletionEventId)
        : Promise.resolve(undefined),
      command.expectedReachOutEntry
        ? reachOutEvents.get(command.reachOutLinkedEventId)
        : Promise.resolve(undefined)
    ]);

    const commandArtifactExists = Boolean(
      storedInteraction || storedNextFollowUp || storedNextFollowUpEvent
      || storedPrimaryEvent || storedReachOutCompletion || storedReachOutLink
    );
    if (commandArtifactExists) {
      const stored = {
        interaction: storedInteraction,
        nextFollowUp: storedNextFollowUp,
        nextFollowUpEvent: storedNextFollowUpEvent,
        todaySkip: storedTodaySkip,
        ...(expected.completedPrimaryFollowUp ? { completedPrimaryFollowUp: storedPrimary } : {}),
        ...(expected.primaryCompletionEvent ? { primaryCompletionEvent: storedPrimaryEvent } : {}),
        ...(expected.reachOutEntry ? { reachOutEntry: storedReachOutEntry } : {}),
        ...(expected.reachOutCompletionEvent ? { reachOutCompletionEvent: storedReachOutCompletion } : {}),
        ...(expected.reachOutLinkedEvent ? { reachOutLinkedEvent: storedReachOutLink } : {})
      };
      if (!exactRetryMatches(expected, stored)) {
        throw new RecordConflictError("The Already contacted command IDs conflict with stored history.");
      }
      await tx.done;
      return expected;
    }

    const writablePerson = requireWritablePerson(person, command);
    await updateMetadata(tx.objectStore("metadata"), command.expectedDatasetRevision, command.occurredAt);
    if (storedTodaySkip) throw new StaleRevisionError();
    if (storedNextFollowUp || storedNextFollowUpEvent || storedInteraction) {
      throw new RecordConflictError("The Already contacted command IDs have already been used.");
    }

    if (command.expectedPrimaryFollowUp) {
      if (!storedPrimary || !identical(storedPrimary, command.expectedPrimaryFollowUp)
        || storedPrimary.status !== "pending"
        || effectiveFollowUpDate(storedPrimary) > command.localDate) {
        throw new StaleRevisionError();
      }
    } else if (command.eligibilityCode === "explicit_follow_up") {
      throw new RecordConflictError("An explicit Today action requires its primary FollowUp.");
    }

    if (command.expectedReachOutEntry) {
      const primary = command.expectedPrimaryFollowUp;
      if (!primary?.reachOutEntryId
        || primary.reachOutEntryId !== command.expectedReachOutEntry.id
        || !storedReachOutEntry || !identical(storedReachOutEntry, command.expectedReachOutEntry)
        || storedReachOutEntry.intentStatus !== "active" || storedReachOutEntry.removedAt
        || storedReachOutEntry.currentFollowUpId !== primary.id) {
        throw new StaleRevisionError();
      }
      const linkedPending = (await followUps.index("by-reach-out").getAll(storedReachOutEntry.id))
        .filter((followUp) => followUp.status === "pending");
      if (linkedPending.length !== 1 || linkedPending[0]?.id !== primary.id) {
        throw new RecordConflictError("The Reach Out plan no longer has one reciprocal current reminder.");
      }
    } else if (command.expectedPrimaryFollowUp?.reachOutEntryId) {
      throw new RecordConflictError("The linked Reach Out entry is missing from this command.");
    }

    if (writablePerson.contactCadenceDays
      && (writablePerson.contactCadenceDeferredUntilDate || writablePerson.contactCadencePausedAt)) {
      const {
        contactCadenceDeferredUntilDate: _deferredUntil,
        contactCadencePausedAt: _pausedAt,
        ...unpausedPerson
      } = writablePerson;
      const resumedPerson: Person = {
        ...unpausedPerson,
        revision: writablePerson.revision + 1,
        updatedAt: command.occurredAt
      };
      assertValidRecord("people", resumedPerson);
      await tx.objectStore("people").put(resumedPerson);
    }

    if (command.expectedPrimaryFollowUp) {
      await followUps.put(expected.completedPrimaryFollowUp!);
      await followUpEvents.add(expected.primaryCompletionEvent!);
    }
    if (command.expectedReachOutEntry) {
      await reachOutEntries.put(expected.reachOutEntry!);
      await reachOutEvents.add(expected.reachOutCompletionEvent!);
      if (expected.reachOutLinkedEvent) {
        await reachOutEvents.add(expected.reachOutLinkedEvent);
      }
    }
    await interactions.add(expected.interaction);
    if (expected.nextFollowUp && expected.nextFollowUpEvent) {
      await followUps.add(expected.nextFollowUp);
      await followUpEvents.add(expected.nextFollowUpEvent);
    }
    await todaySkips.add(expected.todaySkip);
    hooks.beforeCommit?.();
    await tx.done;
    return expected;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}
