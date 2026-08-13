import { contactCadenceInDays, contactCadenceOf } from "./cadence";
import { interactionCountsAsContact } from "./interactionPolicy";
import type { FollowUp, Interaction, Person } from "./schema";

export type RegularContactSetupState =
  | "not_enabled"
  | "complete"
  | "incomplete";

export function hasRegularContactInteractionAnchor(
  personId: string,
  interactions: readonly Interaction[]
): boolean {
  return interactions.some((interaction) =>
    interaction.personId === personId && interactionCountsAsContact(interaction.kind)
  );
}

export function hasRegularContactScheduleAnchor(
  personId: string,
  interactions: readonly Interaction[],
  followUps: readonly FollowUp[]
): boolean {
  return hasRegularContactInteractionAnchor(personId, interactions) || followUps.some((followUp) =>
    followUp.personId === personId && followUp.status === "pending"
  );
}

/**
 * Whether Regular contact has enough persisted evidence to produce a date.
 *
 * A real contact Interaction is a recurrence anchor. A pending FollowUp is an
 * explicit date anchor (including the private `initial_schedule` FollowUp used
 * by Start today/tomorrow). Person creation time is deliberately not an
 * anchor: treating it as one would fabricate real-world contact activity.
 */
export function regularContactSetupState(
  person: Pick<Person,
    | "id"
    | "archivedAt"
    | "identityStatus"
    | "contactCadence"
    | "contactCadenceDays"
    | "contactCadencePausedAt">,
  interactions: readonly Interaction[],
  followUps: readonly FollowUp[]
): RegularContactSetupState {
  if (person.archivedAt || person.identityStatus === "merged") return "not_enabled";
  const cadence = contactCadenceOf(person);
  if (!cadence) return "not_enabled";

  // Validate the persisted frequency at the invariant boundary. Corrupt values
  // remain evaluation issues rather than being mistaken for incomplete setup.
  contactCadenceInDays(cadence);

  // origin/main supported an indefinite cadence pause. The RC model only has
  // finite Today pauses, so activating this record automatically would lose
  // the user's intent. Keep it in the explicit reconciliation path instead.
  if (person.contactCadencePausedAt) return "incomplete";

  return hasRegularContactScheduleAnchor(person.id, interactions, followUps)
    ? "complete"
    : "incomplete";
}
