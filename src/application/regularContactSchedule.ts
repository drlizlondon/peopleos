import type { PeopleOsDatabase } from "../data/database";
import { RecordConflictError } from "../data/repositories";
import { isValidContactCadence, contactCadenceOf } from "../domain/cadence";
import {
  hasRegularContactInteractionAnchor,
  regularContactSetupState
} from "../domain/regularContactSchedule";
import type { FollowUp, FollowUpEvent, LocalDate, Person } from "../domain/schema";
import { assertValidRecord, isLocalDate, ValidationError } from "../domain/validation";

export type InitialiseRegularContactScheduleCommand = {
  personId: string;
  startDate: LocalDate;
  followUpId: string;
  followUpEventId: string;
  occurredAt: string;
};

export type InitialiseRegularContactScheduleResult =
  | {
    outcome: "created";
    person: Person;
    followUp: FollowUp;
    followUpEvent: FollowUpEvent;
  }
  | {
    outcome: "already_scheduled";
    person: Person;
  };

export type RegularContactStartRequirement = "existing_anchor" | "start_required";

/** Read-only UX hint; every write command rechecks the same fact atomically. */
export async function getRegularContactStartRequirement(
  db: PeopleOsDatabase,
  personId: string
): Promise<RegularContactStartRequirement> {
  const tx = db.transaction(["people", "interactions", "followUps"], "readonly");
  const [person, interactions, followUps] = await Promise.all([
    tx.objectStore("people").get(personId),
    tx.objectStore("interactions").index("by-person").getAll(personId),
    tx.objectStore("followUps").index("by-person").getAll(personId)
  ]);
  await tx.done;
  if (!person || person.archivedAt || person.identityStatus === "merged") {
    throw new RecordConflictError("This person is no longer available.");
  }
  const hasAnchor = contactCadenceOf(person)
    ? regularContactSetupState(person, interactions, followUps) === "complete"
    : hasRegularContactInteractionAnchor(person.id, interactions);
  return hasAnchor
    ? "existing_anchor"
    : "start_required";
}

/**
 * Repairs a cadence-only compatibility record by creating the same private
 * initial schedule used by Add Person. The transaction rechecks every possible
 * anchor, so retries and concurrent repair attempts cannot create two starts.
 */
export async function initialiseRegularContactSchedule(
  db: PeopleOsDatabase,
  command: InitialiseRegularContactScheduleCommand
): Promise<InitialiseRegularContactScheduleResult> {
  if (!isLocalDate(command.startDate)) {
    throw new ValidationError(["Choose Today or Tomorrow."]);
  }
  const tx = db.transaction([
    "people",
    "interactions",
    "followUps",
    "followUpEvents",
    "metadata"
  ], "readwrite");
  try {
    const people = tx.objectStore("people");
    const interactions = tx.objectStore("interactions");
    const followUps = tx.objectStore("followUps");
    const followUpEvents = tx.objectStore("followUpEvents");
    const person = await people.get(command.personId);
    if (!person || person.archivedAt || person.identityStatus === "merged") {
      throw new RecordConflictError("This person is no longer available.");
    }
    const cadence = contactCadenceOf(person);
    if (!cadence || !isValidContactCadence(cadence)) {
      throw new ValidationError(["Turn on Regular contact and choose how often first."]);
    }

    const [personInteractions, personFollowUps] = await Promise.all([
      interactions.index("by-person").getAll(person.id),
      followUps.index("by-person").getAll(person.id)
    ]);
    if (regularContactSetupState(person, personInteractions, personFollowUps) === "complete") {
      await tx.done;
      return { outcome: "already_scheduled", person };
    }

    if (!command.followUpId.trim() || !command.followUpEventId.trim()) {
      throw new ValidationError(["The initial schedule needs stable record IDs."]);
    }
    const followUp: FollowUp = {
      id: command.followUpId,
      revision: 1,
      personId: person.id,
      dueDate: command.startDate,
      reason: "Keep in touch",
      actionType: "message",
      suggestedByRule: "initial_schedule",
      status: "pending",
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt
    };
    const followUpEvent: FollowUpEvent = {
      id: command.followUpEventId,
      followUpId: followUp.id,
      personId: person.id,
      kind: "created",
      occurredAt: command.occurredAt,
      toDate: followUp.dueDate
    };
    assertValidRecord("followUps", followUp);
    assertValidRecord("followUpEvents", followUpEvent);
    if (await followUps.get(followUp.id) || await followUpEvents.get(followUpEvent.id)) {
      throw new RecordConflictError("This first reminder ID is already in use.");
    }

    let scheduledPerson = person;
    if (person.contactCadencePausedAt) {
      const {
        contactCadencePausedAt: _legacyIndefinitePause,
        contactCadenceDeferredUntilDate: _legacyFinitePause,
        todayPausedUntilDate: _finitePause,
        ...unpaused
      } = person;
      scheduledPerson = {
        ...unpaused,
        revision: person.revision + 1,
        updatedAt: command.occurredAt
      };
      assertValidRecord("people", scheduledPerson);
      await people.put(scheduledPerson);
    }

    await followUps.add(followUp);
    await followUpEvents.add(followUpEvent);
    const metadataStore = tx.objectStore("metadata");
    const metadata = await metadataStore.get("app");
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await metadataStore.put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: command.occurredAt
    });
    await tx.done;
    return { outcome: "created", person: scheduledPerson, followUp, followUpEvent };
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}
