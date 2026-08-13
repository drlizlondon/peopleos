import { contactCadenceOf, isValidContactCadence } from "../domain/cadence";
import { interactionCountsAsContact } from "../domain/interactionPolicy";
import type {
  FollowUp,
  FollowUpEvent,
  Interaction,
  PeopleOsData,
  Person
} from "../domain/schema";
import { isLocalDate } from "../domain/validation";

const LEGACY_INITIAL_SCHEDULE_PREFIX = "compat:main-v3:regular-contact";

export function legacyInitialScheduleIds(personId: string): {
  followUpId: string;
  followUpEventId: string;
} {
  const encodedPersonId = encodeURIComponent(personId);
  return {
    followUpId: `${LEGACY_INITIAL_SCHEDULE_PREFIX}:${encodedPersonId}`,
    followUpEventId: `${LEGACY_INITIAL_SCHEDULE_PREFIX}:${encodedPersonId}:created`
  };
}

export type LegacyPersonSchedulingMigration = {
  person: Person;
  followUp?: FollowUp;
  followUpEvent?: FollowUpEvent;
};

/**
 * Translate fields persisted by GitHub main's version-3 database into the RC
 * scheduling concepts without deleting the original fields.
 *
 * A finite deferral maps to Today's finite pause. A first-due date becomes the
 * same private initial-schedule FollowUp used by the RC flow, but only when no
 * real contact or pending FollowUp already provides an anchor. An indefinite
 * legacy pause is deliberately retained without creating an active schedule;
 * the shared scheduling invariant surfaces it for an explicit user decision.
 */
export function migrateLegacyPersonScheduling(
  person: Person,
  interactions: readonly Interaction[],
  followUps: readonly FollowUp[],
  followUpEvents: readonly FollowUpEvent[]
): LegacyPersonSchedulingMigration {
  let migratedPerson = person;

  if (person.contactCadence === undefined
    && Number.isInteger(person.contactCadenceDays)
    && Number(person.contactCadenceDays) >= 1
    && Number(person.contactCadenceDays) <= 3_650) {
    migratedPerson = {
      ...migratedPerson,
      contactCadence: { value: person.contactCadenceDays!, unit: "days" }
    };
  }

  if (person.contactCadenceDeferredUntilDate) {
    const existingPause = person.todayPausedUntilDate;
    const latestPause = !existingPause || person.contactCadenceDeferredUntilDate > existingPause
      ? person.contactCadenceDeferredUntilDate
      : existingPause;
    if (latestPause !== existingPause) {
      migratedPerson = { ...migratedPerson, todayPausedUntilDate: latestPause };
    }
  }

  const cadence = contactCadenceOf(migratedPerson);
  const active = !migratedPerson.archivedAt && migratedPerson.identityStatus !== "merged";
  const hasContactAnchor = interactions.some((interaction) =>
    interaction.personId === migratedPerson.id && interactionCountsAsContact(interaction.kind)
  );
  const hasPendingAnchor = followUps.some((followUp) =>
    followUp.personId === migratedPerson.id && followUp.status === "pending"
  );
  const firstDueDate = migratedPerson.contactCadenceFirstDueDate;

  if (!active
    || !cadence
    || !isValidContactCadence(cadence)
    || !firstDueDate
    || !isLocalDate(firstDueDate)
    || migratedPerson.contactCadencePausedAt
    || hasContactAnchor
    || hasPendingAnchor) {
    return { person: migratedPerson };
  }

  const { followUpId, followUpEventId } = legacyInitialScheduleIds(migratedPerson.id);
  if (followUps.some((followUp) => followUp.id === followUpId)
    || followUpEvents.some((event) => event.id === followUpEventId)) {
    // Do not overwrite a colliding record. The Person remains intact and the
    // scheduling invariant will surface the missing anchor for reconciliation.
    return { person: migratedPerson };
  }

  const followUp: FollowUp = {
    id: followUpId,
    revision: 1,
    personId: migratedPerson.id,
    dueDate: firstDueDate,
    reason: "Keep in touch",
    actionType: "message",
    suggestedByRule: "initial_schedule",
    status: "pending",
    createdAt: migratedPerson.updatedAt,
    updatedAt: migratedPerson.updatedAt
  };
  const followUpEvent: FollowUpEvent = {
    id: followUpEventId,
    followUpId,
    personId: migratedPerson.id,
    kind: "created",
    occurredAt: migratedPerson.updatedAt,
    toDate: firstDueDate
  };
  return { person: migratedPerson, followUp, followUpEvent };
}

export function migrateLegacySchedulingData(data: PeopleOsData): PeopleOsData {
  const followUps = [...data.followUps];
  const followUpEvents = [...data.followUpEvents];
  const people = data.people.map((person) => {
    const migrated = migrateLegacyPersonScheduling(
      person,
      data.interactions,
      followUps,
      followUpEvents
    );
    if (migrated.followUp && migrated.followUpEvent) {
      followUps.push(migrated.followUp);
      followUpEvents.push(migrated.followUpEvent);
    }
    return migrated.person;
  });
  return { ...data, people, followUps, followUpEvents };
}
