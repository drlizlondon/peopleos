import type { PeopleOsDatabase } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import { commandFingerprint } from "../domain/commandFingerprint";
import { localDateForInstant } from "../domain/followUpPolicy";
import type { FollowUp, Person, ReachOutEntry } from "../domain/schema";
import {
  assertValidRecord,
  isIsoInstant,
  ValidationError
} from "../domain/validation";
import {
  expectedAlreadyContactedResult,
  type AlreadyContactedCommand,
  type AlreadyContactedResult
} from "./todayActions";

export type TodayCompletionReceipt = {
  receiptFingerprint: string;
  command: AlreadyContactedCommand;
  result: AlreadyContactedResult;
  personBefore: Person;
};

export type TodayCompletionUndoResult = {
  person: Person;
  primaryFollowUp?: FollowUp;
  reachOutEntry?: ReachOutEntry;
  alreadyUndone: boolean;
};

export type TodayCompletionUndoOptions = {
  now?: string;
  beforeCommit?: () => void;
};

function identical(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function receiptMaterial(receipt: Omit<TodayCompletionReceipt, "receiptFingerprint">): unknown {
  return {
    command: receipt.command,
    result: receipt.result,
    personBefore: receipt.personBefore
  };
}

function personAfterCompletion(person: Person, occurredAt: string): Person {
  if (person.broughtToTodayDate
    || person.todayPausedUntilDate
    || (person.contactCadenceDays
      && (person.contactCadenceDeferredUntilDate || person.contactCadencePausedAt))) {
    const {
      contactCadenceDeferredUntilDate: _deferredUntil,
      contactCadencePausedAt: _pausedAt,
      todayPausedUntilDate: _todayPausedUntilDate,
      broughtToTodayDate: _broughtToTodayDate,
      ...unpausedPerson
    } = person;
    return {
      ...unpausedPerson,
      revision: person.revision + 1,
      updatedAt: occurredAt
    };
  }
  return person;
}

function optionalExact<T>(current: T | undefined, expected: T | undefined): boolean {
  return expected === undefined ? current === undefined : identical(current, expected);
}

function forwardRestorationMatches<T extends { revision: number; updatedAt: string }>(
  current: T | undefined,
  before: T | undefined,
  expectedRevision: number,
  completionAt: string
): current is T {
  if (!current || !before || current.revision !== expectedRevision
    || !isIsoInstant(current.updatedAt)
    || Date.parse(current.updatedAt) <= Date.parse(completionAt)) return false;
  const { revision: _currentRevision, updatedAt: _currentUpdatedAt, ...currentFields } = current;
  const { revision: _beforeRevision, updatedAt: _beforeUpdatedAt, ...beforeFields } = before;
  return identical(currentFields, beforeFields);
}

function validateReceipt(receipt: TodayCompletionReceipt): void {
  const { receiptFingerprint, ...material } = receipt;
  if (commandFingerprint(receiptMaterial(material)) !== receiptFingerprint) {
    throw new RecordConflictError("The Today completion receipt fingerprint does not match its contents.");
  }
  assertValidRecord("people", receipt.personBefore);
  if (receipt.personBefore.id !== receipt.command.personId
    || receipt.personBefore.revision !== receipt.command.expectedPersonRevision
    || receipt.personBefore.displayName !== receipt.command.displayName) {
    throw new RecordConflictError("The Today completion receipt does not match its Person snapshot.");
  }
  if (!identical(receipt.result, expectedAlreadyContactedResult(receipt.command))) {
    throw new RecordConflictError("The Today completion receipt does not match its prepared command.");
  }
}

export function createTodayCompletionReceipt(
  command: AlreadyContactedCommand,
  result: AlreadyContactedResult,
  personBefore: Person
): TodayCompletionReceipt {
  const material = clone({ command, result, personBefore });
  const receipt: TodayCompletionReceipt = {
    ...material,
    receiptFingerprint: commandFingerprint(receiptMaterial(material))
  };
  validateReceipt(receipt);
  return receipt;
}

function defaultUndoInstant(completedAt: string): string {
  return new Date(Math.max(Date.now(), Date.parse(completedAt) + 1)).toISOString();
}

async function abortAndRethrow(
  transaction: { abort: () => void; done: Promise<unknown> },
  error: unknown
): Promise<never> {
  try { transaction.abort(); } catch { /* transaction already closed */ }
  try { await transaction.done; } catch { /* expected rollback */ }
  throw error;
}

/**
 * Fully reverse one successful Today completion while its exact command-owned
 * state is still current. Mutable aggregates move forward in revision/time;
 * command-created history is removed atomically so sync can publish tombstones.
 */
export async function undoAlreadyContacted(
  db: PeopleOsDatabase,
  receipt: TodayCompletionReceipt,
  options: TodayCompletionUndoOptions = {}
): Promise<TodayCompletionUndoResult> {
  validateReceipt(receipt);
  const { command, result, personBefore } = receipt;
  const occurredAt = options.now ?? defaultUndoInstant(command.occurredAt);
  if (!isIsoInstant(occurredAt)) {
    throw new ValidationError(["Completion Undo needs a valid action time."]);
  }
  if (Date.parse(occurredAt) <= Date.parse(command.occurredAt)) {
    throw new ValidationError(["Completion Undo must happen after the completion."]);
  }
  if (localDateForInstant(occurredAt, command.timeZone) !== command.localDate) {
    throw new ValidationError(["Completion Undo is only available on the day it was recorded."]);
  }

  const tx = db.transaction([
    "people", "memoryFacts", "followUps", "followUpEvents", "interactions", "todaySkips",
    "reachOutEntries", "reachOutEvents", "metadata"
  ], "readwrite");
  try {
    const people = tx.objectStore("people");
    const followUps = tx.objectStore("followUps");
    const followUpEvents = tx.objectStore("followUpEvents");
    const interactions = tx.objectStore("interactions");
    const todaySkips = tx.objectStore("todaySkips");
    const reachOutEntries = tx.objectStore("reachOutEntries");
    const reachOutEvents = tx.objectStore("reachOutEvents");
    const [
      person,
      interaction,
      nextFollowUp,
      nextFollowUpEvent,
      todaySkip,
      primaryFollowUp,
      primaryCompletionEvent,
      reachOutEntry,
      reachOutCompletionEvent,
      reachOutLinkedEvent,
      metadata
    ] = await Promise.all([
      people.get(command.personId),
      interactions.get(command.interactionId),
      followUps.get(command.nextFollowUpId),
      followUpEvents.get(command.nextFollowUpEventId),
      todaySkips.get(result.todaySkip.id),
      command.expectedPrimaryFollowUp
        ? followUps.get(command.expectedPrimaryFollowUp.id)
        : Promise.resolve(undefined),
      followUpEvents.get(command.followUpCompletionEventId),
      command.expectedReachOutEntry
        ? reachOutEntries.get(command.expectedReachOutEntry.id)
        : Promise.resolve(undefined),
      reachOutEvents.get(command.reachOutCompletionEventId),
      reachOutEvents.get(command.reachOutLinkedEventId),
      tx.objectStore("metadata").get("app")
    ]);

    if (!metadata) throw new Error("PeopleOS metadata is missing");
    const [personInteractions, personMemoryFacts, personFollowUps, personFollowUpEvents,
      allReachOutEntries, allReachOutEvents] = await Promise.all([
      interactions.index("by-person").getAll(command.personId),
      tx.objectStore("memoryFacts").index("by-person").getAll(command.personId),
      followUps.index("by-person").getAll(command.personId),
      followUpEvents.index("by-person").getAll(command.personId),
      reachOutEntries.getAll(),
      reachOutEvents.getAll()
    ]);
    const completedPerson = personAfterCompletion(personBefore, command.occurredAt);
    const personChangedByCompletion = !identical(completedPerson, personBefore);
    const completionMatches = identical(person, completedPerson)
      && optionalExact(interaction, result.interaction)
      && optionalExact(nextFollowUp, result.nextFollowUp)
      && optionalExact(nextFollowUpEvent, result.nextFollowUpEvent)
      && optionalExact(todaySkip, result.todaySkip)
      && optionalExact(primaryFollowUp, result.completedPrimaryFollowUp)
      && optionalExact(primaryCompletionEvent, result.primaryCompletionEvent)
      && optionalExact(reachOutEntry, result.reachOutEntry)
      && optionalExact(reachOutCompletionEvent, result.reachOutCompletionEvent)
      && optionalExact(reachOutLinkedEvent, result.reachOutLinkedEvent);

    const foreignInteractionDependent = personMemoryFacts.some(
      (fact) => fact.sourceInteractionId === command.interactionId
    ) || personFollowUpEvents.some(
      (event) => event.interactionId === command.interactionId
        && event.id !== result.primaryCompletionEvent?.id
    ) || allReachOutEvents.some(
      (event) => event.interactionId === command.interactionId
        && event.id !== result.reachOutCompletionEvent?.id
    );
    const nextFollowUpId = result.nextFollowUp?.id;
    const foreignNextFollowUpDependent = Boolean(nextFollowUpId) && (
      personInteractions.some((candidate) => candidate.followUpId === nextFollowUpId)
      || personFollowUps.some((candidate) => candidate.id !== nextFollowUpId
        && (candidate.supersedesFollowUpId === nextFollowUpId
          || candidate.supersededByFollowUpId === nextFollowUpId))
      || personFollowUpEvents.some((event) => (event.followUpId === nextFollowUpId
          && event.id !== result.nextFollowUpEvent?.id)
        || event.replacementFollowUpId === nextFollowUpId)
      || allReachOutEntries.some((entry) => entry.currentFollowUpId === nextFollowUpId
        && entry.id !== result.reachOutEntry?.id)
      || allReachOutEvents.some((event) => event.followUpId === nextFollowUpId
        && event.id !== result.reachOutLinkedEvent?.id)
    );
    const linkedPendingIds = result.reachOutEntry
      ? personFollowUps.filter((candidate) => candidate.reachOutEntryId === result.reachOutEntry!.id
        && candidate.status === "pending").map((candidate) => candidate.id).sort()
      : [];
    const expectedLinkedPendingIds = result.reachOutEntry?.currentFollowUpId
      ? [result.reachOutEntry.currentFollowUpId]
      : [];
    const foreignReachOutTopology = !identical(linkedPendingIds, expectedLinkedPendingIds);
    if (completionMatches && (foreignInteractionDependent
      || foreignNextFollowUpDependent || foreignReachOutTopology)) {
      throw new StaleRevisionError();
    }

    const personAlreadyRestored = personChangedByCompletion
      ? forwardRestorationMatches(
          person,
          personBefore,
          completedPerson.revision + 1,
          command.occurredAt
        )
      : identical(person, personBefore);
    const primaryAlreadyRestored = result.completedPrimaryFollowUp
      ? forwardRestorationMatches(
          primaryFollowUp,
          command.expectedPrimaryFollowUp,
          result.completedPrimaryFollowUp.revision + 1,
          command.occurredAt
        )
      : primaryFollowUp === undefined;
    const reachOutAlreadyRestored = result.reachOutEntry
      ? forwardRestorationMatches(
          reachOutEntry,
          command.expectedReachOutEntry,
          result.reachOutEntry.revision + 1,
          command.occurredAt
        )
      : reachOutEntry === undefined;
    const commandArtifactsAbsent = interaction === undefined
      && nextFollowUp === undefined
      && nextFollowUpEvent === undefined
      && todaySkip === undefined
      && primaryCompletionEvent === undefined
      && reachOutCompletionEvent === undefined
      && reachOutLinkedEvent === undefined;

    if (!completionMatches) {
      if (personAlreadyRestored && primaryAlreadyRestored
        && reachOutAlreadyRestored && commandArtifactsAbsent) {
        await tx.done;
        return {
          person: person!,
          ...(primaryFollowUp ? { primaryFollowUp } : {}),
          ...(reachOutEntry ? { reachOutEntry } : {}),
          alreadyUndone: true
        };
      }
      throw new StaleRevisionError();
    }

    let restoredPerson = person!;
    if (personChangedByCompletion) {
      restoredPerson = {
        ...personBefore,
        revision: completedPerson.revision + 1,
        updatedAt: occurredAt
      };
      assertValidRecord("people", restoredPerson);
      await people.put(restoredPerson);
    }

    let restoredPrimary: FollowUp | undefined;
    if (result.completedPrimaryFollowUp && command.expectedPrimaryFollowUp) {
      restoredPrimary = {
        ...command.expectedPrimaryFollowUp,
        revision: result.completedPrimaryFollowUp.revision + 1,
        updatedAt: occurredAt
      };
      assertValidRecord("followUps", restoredPrimary);
      await followUps.put(restoredPrimary);
    }

    let restoredReachOut: ReachOutEntry | undefined;
    if (result.reachOutEntry && command.expectedReachOutEntry) {
      restoredReachOut = {
        ...command.expectedReachOutEntry,
        revision: result.reachOutEntry.revision + 1,
        updatedAt: occurredAt
      };
      assertValidRecord("reachOutEntries", restoredReachOut);
      await reachOutEntries.put(restoredReachOut);
    }

    await interactions.delete(command.interactionId);
    if (result.nextFollowUp) await followUps.delete(command.nextFollowUpId);
    if (result.nextFollowUpEvent) await followUpEvents.delete(command.nextFollowUpEventId);
    await todaySkips.delete(result.todaySkip.id);
    if (result.primaryCompletionEvent) {
      await followUpEvents.delete(command.followUpCompletionEventId);
    }
    if (result.reachOutCompletionEvent) {
      await reachOutEvents.delete(command.reachOutCompletionEventId);
    }
    if (result.reachOutLinkedEvent) {
      await reachOutEvents.delete(command.reachOutLinkedEventId);
    }
    await tx.objectStore("metadata").put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: occurredAt
    });
    options.beforeCommit?.();
    await tx.done;
    return {
      person: restoredPerson,
      ...(restoredPrimary ? { primaryFollowUp: restoredPrimary } : {}),
      ...(restoredReachOut ? { reachOutEntry: restoredReachOut } : {}),
      alreadyUndone: false
    };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}
