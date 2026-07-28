import { activeContactMethodsForAction } from "../domain/contactMethodPolicy";
import {
  addDaysToLocalDate,
  compareFollowUpsByEffectiveDate,
  effectiveFollowUpDate,
  hasFollowUpCreatedAfterSoleContact,
  localDateForInstant
} from "../domain/followUpPolicy";
import { interactionCountsAsContact } from "../domain/interactionPolicy";
import {
  deriveReachOutDisplayState,
  type ReachOutDisplayState
} from "../domain/reachOutPolicy";
import type {
  ContactMethod,
  FollowUp,
  FollowUpActionType,
  Interaction,
  LocalDate,
  MemoryFact,
  OrganisationAffiliation,
  ReachOutEntry,
  RelationshipEvent
} from "../domain/schema";
import {
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  type BuildTodayInput,
  type Explanation,
  type ExplanationFact,
  type IntendedActionCode,
  type IntendedActionContext,
  type LastContactProjection,
  type MemoryCueProjection,
  type ReachOutStateProjection,
  type RelationshipAgeProjection,
  type RelationshipAssessment,
  type RelationshipClock,
  type RelationshipPersonBundle,
  type RelationshipStageProjection,
  type SuggestedReminderProjection,
  type TodayAssessment,
  type TodayItem,
  type TodayResult
} from "./types";

function explanation(
  code: string,
  templateKey: string,
  facts: ExplanationFact[]
): Explanation {
  return { code, templateKey, facts };
}

function sourceFact(label: string, value: string, sourceId?: string): ExplanationFact {
  return { label, value, ...(sourceId ? { sourceId } : {}) };
}

function compareText(left: string, right: string): number {
  const canonical = (value: string) => value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US");
  const leftCanonical = canonical(left);
  const rightCanonical = canonical(right);
  if (leftCanonical !== rightCanonical) return leftCanonical < rightCanonical ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function localDateOrdinal(date: LocalDate): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("A valid local date is required.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = Date.UTC(year, month - 1, day);
  const parsed = new Date(value);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RangeError("The local date is invalid.");
  }
  return Math.trunc(value / 86_400_000);
}

export function calendarDaysBetween(start: LocalDate, end: LocalDate): number {
  return localDateOrdinal(end) - localDateOrdinal(start);
}

function assertClock(clock: RelationshipClock): LocalDate {
  if (clock.policyVersion !== RELATIONSHIP_ENGINE_POLICY_VERSION) {
    throw new RangeError(`Unsupported Relationship Engine policy version: ${clock.policyVersion}`);
  }
  return localDateForInstant(clock.now, clock.timeZone);
}

function compareInteractionsAscending(left: Interaction, right: Interaction): number {
  return left.occurredAt.localeCompare(right.occurredAt) || compareText(left.id, right.id);
}

function compareInteractionsDescending(left: Interaction, right: Interaction): number {
  return right.occurredAt.localeCompare(left.occurredAt) || compareText(left.id, right.id);
}

function contactInteractions(records: readonly Interaction[], personId: string): Interaction[] {
  return records
    .filter((record) => record.personId === personId && interactionCountsAsContact(record.kind))
    .sort(compareInteractionsAscending);
}

/**
 * The single most recent contact under `compareInteractionsDescending`.
 *
 * Three call sites previously copied and fully re-sorted the already-ascending
 * contact list just to read its first element. This scan is linear and exactly
 * equivalent — note it must NOT be replaced with `contacts[contacts.length - 1]`:
 * `compareInteractionsDescending` reverses the date comparison but keeps the id
 * tie-break in the same direction, so on equal `occurredAt` the descending sort
 * selects the LOWEST id while the ascending list ends on the highest. Ids are
 * unique, so the comparator is a total order and the scan keeps that ordering
 * exactly.
 */
function latestContact(contacts: readonly Interaction[]): Interaction | undefined {
  let latest: Interaction | undefined;
  for (const contact of contacts) {
    if (!latest || compareInteractionsDescending(contact, latest) < 0) latest = contact;
  }
  return latest;
}

function buildStage(
  contacts: readonly Interaction[],
  timeZone: string,
  personCreatedAt: string,
  personId: string
): RelationshipStageProjection {
  if (contacts.length === 0) {
    return {
      value: "new",
      contactCount: 0,
      contactSpanDays: 0,
      explanation: explanation("relationship_stage.new.no_contact", "relationship_stage.new.no_contact", [
        sourceFact("personCreatedAt", personCreatedAt, personId)
      ])
    };
  }
  const first = contacts[0];
  const last = contacts[contacts.length - 1];
  const firstDate = localDateForInstant(first.occurredAt, timeZone);
  const lastDate = localDateForInstant(last.occurredAt, timeZone);
  const span = Math.max(0, calendarDaysBetween(firstDate, lastDate));
  const value = contacts.length >= 5 && span >= 730
    ? "long_term"
    : contacts.length >= 5 && span >= 180
      ? "established"
      : contacts.length >= 2 && span >= 30
        ? "growing"
        : "new";
  return {
    value,
    contactCount: contacts.length,
    contactSpanDays: span,
    explanation: explanation(
      contacts.length === 1 ? "relationship_stage.new.single_contact" : `relationship_stage.${value}`,
      contacts.length === 1 ? "relationship_stage.new.single_contact" : `relationship_stage.${value}`,
      [
      sourceFact("contactCount", String(contacts.length)),
      sourceFact("contactSpanDays", String(span)),
      sourceFact("firstContactDate", firstDate, first.id),
      sourceFact("lastContactDate", lastDate, last.id)
      ]
    )
  };
}

function buildRelationshipAge(
  contacts: readonly Interaction[],
  personCreatedAt: string,
  personId: string,
  localDate: LocalDate,
  timeZone: string
): RelationshipAgeProjection {
  const first = contacts[0];
  const startedAt = first?.occurredAt ?? personCreatedAt;
  const startDate = localDateForInstant(startedAt, timeZone);
  const elapsedDays = Math.max(0, calendarDaysBetween(startDate, localDate));
  const estimated = !first;
  return {
    startedAt,
    startDate,
    elapsedDays,
    estimated,
    ...(first ? { sourceInteractionId: first.id } : {}),
    explanation: explanation(
      estimated ? "relationship_age.estimated" : "relationship_age.contact",
      estimated ? "relationship_age.estimated" : "relationship_age.contact",
      [
        sourceFact(estimated ? "personCreatedDate" : "firstContactDate", startDate, first?.id ?? personId),
        sourceFact("elapsedDays", String(elapsedDays))
      ]
    )
  };
}

function buildLastContact(
  contacts: readonly Interaction[],
  timeZone: string
): LastContactProjection | undefined {
  const latest = latestContact(contacts);
  if (!latest) return undefined;
  const localDate = localDateForInstant(latest.occurredAt, timeZone);
  return {
    interactionId: latest.id,
    kind: latest.kind,
    occurredAt: latest.occurredAt,
    localDate,
    explanation: explanation("last_contact.recorded", "last_contact.recorded", [
      sourceFact("interactionKind", latest.kind, latest.id),
      sourceFact("contactDate", localDate, latest.id)
    ])
  };
}

function currentAffiliation(records: readonly OrganisationAffiliation[], personId: string): OrganisationAffiliation | undefined {
  return [...records]
    .filter((record) => record.personId === personId && !record.archivedAt && record.isCurrent)
    .sort((left, right) => (right.startedOn ?? "").localeCompare(left.startedOn ?? "")
      || right.createdAt.localeCompare(left.createdAt)
      || compareText(left.id, right.id))[0];
}

const MEMORY_FACT_RANK: Record<MemoryFact["kind"], number> = {
  communication_preference: 0,
  seeking: 1,
  interest: 2,
  introduced_by: 3,
  location: 4,
  family: 5,
  other: 6
};

function factCueText(fact: MemoryFact): string {
  if (fact.kind !== "communication_preference") return fact.value;
  const labels: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", phone: "Phone" };
  return labels[fact.value] ?? fact.value;
}

function cueEnabledFacts(records: readonly MemoryFact[], personId: string): MemoryFact[] {
  return [...records]
    .filter((fact) => fact.personId === personId && !fact.archivedAt && fact.showAsMemoryCue)
    .sort((left, right) => MEMORY_FACT_RANK[left.kind] - MEMORY_FACT_RANK[right.kind]
      || right.updatedAt.localeCompare(left.updatedAt)
      || compareText(left.id, right.id));
}

function eventForInteraction(
  interaction: Interaction,
  eventsById: ReadonlyMap<string, RelationshipEvent>
): RelationshipEvent | undefined {
  return interaction.eventId ? eventsById.get(interaction.eventId) : undefined;
}

/**
 * The cue used when no due commitment supplies one: memory fact, then event,
 * then current affiliation.
 *
 * Split out because `assessRelationship` needs two cues per Person — the Today
 * cue, which prefers a due commitment, and the search-context cue, which never
 * does. Both fall back to exactly this, so computing it once and sharing it is
 * behaviour-identical and halves the cue work per Person.
 */
function buildFallbackMemoryCue(
  bundle: RelationshipPersonBundle,
  timeZone: string
): MemoryCueProjection | undefined {
  const fact = cueEnabledFacts(bundle.facts, bundle.person.id)[0];
  if (fact) {
    return {
      text: factCueText(fact),
      source: "memory_fact",
      sourceId: fact.id,
      explanation: explanation(`memory_cue.fact.${fact.kind}`, `memory_cue.fact.${fact.kind}`, [
        sourceFact("factValue", fact.value, fact.id),
        sourceFact("factAddedDate", localDateForInstant(fact.createdAt, timeZone), fact.id)
      ])
    };
  }

  const eventsById = new Map(bundle.events.map((event) => [event.id, event]));
  const eventInteraction = bundle.interactions
    .filter((interaction) => interaction.personId === bundle.person.id
      && (interaction.kind === "met" || interaction.kind === "conference")
      && Boolean(eventForInteraction(interaction, eventsById)))
    .sort(compareInteractionsAscending)[0];
  const event = eventInteraction ? eventForInteraction(eventInteraction, eventsById) : undefined;
  if (eventInteraction && event) {
    return {
      text: `Met at ${event.name}`,
      source: "event",
      sourceId: event.id,
      explanation: explanation("memory_cue.event", "memory_cue.event", [
        sourceFact("eventName", event.name, event.id),
        sourceFact("interactionDate", localDateForInstant(eventInteraction.occurredAt, timeZone), eventInteraction.id)
      ])
    };
  }

  const affiliation = currentAffiliation(bundle.affiliations, bundle.person.id);
  if (!affiliation) return undefined;
  const text = affiliation.role
    ? `${affiliation.role} at ${affiliation.organisationName}`
    : affiliation.organisationName;
  return {
    text,
    source: "affiliation",
    sourceId: affiliation.id,
    explanation: explanation("memory_cue.affiliation", "memory_cue.affiliation", [
      sourceFact("organisation", affiliation.organisationName, affiliation.id),
      ...(affiliation.role ? [sourceFact("role", affiliation.role, affiliation.id)] : [])
    ])
  };
}

/** The Today cue: a due commitment when there is one, otherwise the fallback. */
function buildMemoryCue(
  dueFollowUps: readonly FollowUp[],
  fallback: MemoryCueProjection | undefined
): MemoryCueProjection | undefined {
  const commitment = dueFollowUps[0];
  if (!commitment) return fallback;
  return {
    text: commitment.reason,
    source: "follow_up",
    sourceId: commitment.id,
    explanation: explanation("memory_cue.follow_up", "memory_cue.follow_up", [
      sourceFact("reason", commitment.reason, commitment.id),
      sourceFact("effectiveDate", effectiveFollowUpDate(commitment), commitment.id)
    ])
  };
}

function actionCode(action: FollowUpActionType): IntendedActionCode {
  return action;
}

function communicationPreference(
  records: readonly MemoryFact[],
  personId: string
): MemoryFact | undefined {
  return [...records]
    .filter((fact) => fact.personId === personId
      && fact.kind === "communication_preference"
      && !fact.archivedAt
      && fact.showAsMemoryCue)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || compareText(left.id, right.id))[0];
}

function methodMatchesPreference(method: ContactMethod, preference: string): boolean {
  if (preference === "email") return method.kind === "email";
  if (preference === "phone" || preference === "whatsapp") return method.kind === "phone";
  return false;
}

function preferenceAction(preference: string): IntendedActionCode {
  if (preference === "email") return "email";
  if (preference === "phone") return "call";
  return "message";
}

function methodAction(method: ContactMethod): IntendedActionCode {
  return method.kind === "email" ? "email" : "call";
}

function buildIntendedAction(
  bundle: RelationshipPersonBundle,
  primaryFollowUp?: FollowUp
): IntendedActionContext {
  if (primaryFollowUp) {
    return {
      code: actionCode(primaryFollowUp.actionType),
      source: "follow_up",
      sourceId: primaryFollowUp.id,
      explanation: explanation("intended_action.follow_up", "intended_action.follow_up", [
        sourceFact("actionType", primaryFollowUp.actionType, primaryFollowUp.id),
        sourceFact("reason", primaryFollowUp.reason, primaryFollowUp.id)
      ])
    };
  }

  const methods = activeContactMethodsForAction(
    bundle.contactMethods.filter((method) => method.personId === bundle.person.id)
  );
  const preference = communicationPreference(bundle.facts, bundle.person.id);
  const preferredMatch = preference
    ? methods.find((method) => methodMatchesPreference(method, preference.value))
    : undefined;
  if (preference && preferredMatch) {
    return {
      code: preferenceAction(preference.value),
      source: "communication_preference",
      sourceId: preference.id,
      explanation: explanation("intended_action.communication_preference", "intended_action.communication_preference", [
        sourceFact("preference", preference.value, preference.id),
        sourceFact("contactMethodKind", preferredMatch.kind, preferredMatch.id)
      ])
    };
  }

  const first = methods[0];
  if (first) {
    return {
      code: methodAction(first),
      source: "contact_method",
      sourceId: first.id,
      explanation: explanation(
        preference ? "intended_action.preference_unavailable_fallback" : "intended_action.contact_method",
        preference ? "intended_action.preference_unavailable_fallback" : "intended_action.contact_method",
        [
          ...(preference ? [sourceFact("unavailablePreference", preference.value, preference.id)] : []),
          sourceFact("contactMethodKind", first.kind, first.id)
        ]
      )
    };
  }

  return {
    code: "add_contact_details",
    source: "none",
    explanation: explanation(
      preference ? "intended_action.preference_unavailable_no_method" : "intended_action.no_contact_method",
      preference ? "intended_action.preference_unavailable_no_method" : "intended_action.no_contact_method",
      preference ? [sourceFact("unavailablePreference", preference.value, preference.id)] : []
    )
  };
}

function currentReachOutForFollowUp(
  entries: readonly ReachOutEntry[],
  followUp: FollowUp
): ReachOutEntry | undefined {
  if (!followUp.reachOutEntryId) return undefined;
  return entries.find((entry) => entry.id === followUp.reachOutEntryId
    && entry.personId === followUp.personId
    && !entry.removedAt
    && entry.intentStatus === "active"
    && entry.currentFollowUpId === followUp.id);
}

function followUpExplanation(
  followUp: FollowUp,
  dueState: "overdue" | "due_today",
  reachOut?: ReachOutEntry
): Explanation {
  return explanation(
    reachOut?.reason ? "today.explicit_follow_up.reach_out" : "today.explicit_follow_up",
    reachOut?.reason
      ? `today.explicit_follow_up.${dueState}.reach_out`
      : `today.explicit_follow_up.${dueState}`,
    [
      sourceFact("reason", followUp.reason, followUp.id),
      sourceFact("effectiveDate", effectiveFollowUpDate(followUp), followUp.id),
      ...(followUp.snoozedUntilDate ? [sourceFact("originalDate", followUp.dueDate, followUp.id)] : []),
      ...(reachOut?.reason ? [sourceFact("reachOutReason", reachOut.reason, reachOut.id)] : [])
    ]
  );
}

function buildTodayAssessment(
  bundle: RelationshipPersonBundle,
  contacts: readonly Interaction[],
  localDate: LocalDate,
  timeZone: string
): TodayAssessment | undefined {
  if (bundle.person.archivedAt || bundle.person.identityStatus === "merged") return undefined;
  const followUps = bundle.followUps.filter((followUp) => followUp.personId === bundle.person.id);
  const pending = followUps.filter((followUp) => followUp.status === "pending");
  const due = pending
    .filter((followUp) => effectiveFollowUpDate(followUp) <= localDate)
    .sort(compareFollowUpsByEffectiveDate);
  const primary = due[0];
  if (primary) {
    const relevantDate = effectiveFollowUpDate(primary);
    const dueState = relevantDate < localDate ? "overdue" : "due_today";
    const reachOut = currentReachOutForFollowUp(bundle.reachOutEntries, primary);
    return {
      eligibilityCode: "explicit_follow_up",
      dueState,
      relevantDate,
      primaryFollowUpId: primary.id,
      additionalDueFollowUpIds: due.slice(1).map((followUp) => followUp.id),
      explanation: followUpExplanation(primary, dueState, reachOut),
      intendedActionContext: buildIntendedAction(bundle, primary)
    };
  }

  if (pending.some((followUp) => effectiveFollowUpDate(followUp) > localDate)) return undefined;

  if (contacts.length === 1) {
    const onlyContact = contacts[0];
    const contactDate = localDateForInstant(onlyContact.occurredAt, timeZone);
    const elapsed = calendarDaysBetween(contactDate, localDate);
    if (elapsed >= 7 && !hasFollowUpCreatedAfterSoleContact(contacts, followUps)) {
      const event = (onlyContact.kind === "met" || onlyContact.kind === "conference") && onlyContact.eventId
        ? bundle.events.find((candidate) => candidate.id === onlyContact.eventId)
        : undefined;
      return {
        eligibilityCode: "new_relationship",
        dueState: "rule_due",
        relevantDate: addDaysToLocalDate(contactDate, 7),
        additionalDueFollowUpIds: [],
        explanation: explanation(
          event ? "today.new_relationship.event" : "today.new_relationship",
          event ? "today.new_relationship.event" : "today.new_relationship",
          [
            sourceFact("contactDate", contactDate, onlyContact.id),
            sourceFact("elapsedDays", String(elapsed), onlyContact.id),
            ...(event ? [sourceFact("eventName", event.name, event.id)] : [])
          ]
        ),
        intendedActionContext: buildIntendedAction(bundle)
      };
    }
  }

  const cadence = bundle.person.contactCadenceDays;
  if (cadence && !bundle.person.contactCadencePausedAt) {
    const lastContact = latestContact(contacts);
    const contactDate = lastContact ? localDateForInstant(lastContact.occurredAt, timeZone) : undefined;
    const cadenceDate = contactDate ? addDaysToLocalDate(contactDate, cadence) : bundle.person.contactCadenceFirstDueDate;
    const dueDate = bundle.person.contactCadenceDeferredUntilDate && cadenceDate
      ? (bundle.person.contactCadenceDeferredUntilDate > cadenceDate ? bundle.person.contactCadenceDeferredUntilDate : cadenceDate)
      : cadenceDate;
    if (dueDate && dueDate <= localDate) {
      return {
        eligibilityCode: "cadence_due",
        dueState: dueDate < localDate ? "overdue" : "due_today",
        relevantDate: dueDate,
        additionalDueFollowUpIds: [],
        explanation: explanation("today.cadence_due", "today.cadence_due", [
          sourceFact("cadenceDays", String(cadence), bundle.person.id),
          sourceFact("nextDueDate", dueDate, bundle.person.id),
          ...(contactDate && lastContact ? [sourceFact("lastContactDate", contactDate, lastContact.id)] : [])
        ]),
        intendedActionContext: buildIntendedAction(bundle)
      };
    }
  }
  return undefined;
}

function buildOverdueFollowUp(
  followUps: readonly FollowUp[],
  personId: string,
  localDate: LocalDate
) {
  const overdue = followUps
    .filter((followUp) => followUp.personId === personId
      && followUp.status === "pending"
      && effectiveFollowUpDate(followUp) < localDate)
    .sort(compareFollowUpsByEffectiveDate)[0];
  if (!overdue) return undefined;
  const effectiveDate = effectiveFollowUpDate(overdue);
  return {
    followUpId: overdue.id,
    effectiveDate,
    originalDate: overdue.dueDate,
    explanation: explanation(
      overdue.snoozedUntilDate ? "follow_up.overdue.snoozed" : "follow_up.overdue",
      overdue.snoozedUntilDate ? "follow_up.overdue.snoozed" : "follow_up.overdue",
      [
        sourceFact("effectiveDate", effectiveDate, overdue.id),
        ...(overdue.snoozedUntilDate ? [sourceFact("originalDate", overdue.dueDate, overdue.id)] : [])
      ]
    )
  };
}

function buildSuggestedReminder(
  bundle: RelationshipPersonBundle,
  contacts: readonly Interaction[],
  localDate: LocalDate,
  timeZone: string
): SuggestedReminderProjection | undefined {
  if (bundle.person.archivedAt || bundle.person.identityStatus === "merged") return undefined;
  const hasFuture = bundle.followUps.some((followUp) => followUp.personId === bundle.person.id
    && followUp.status === "pending"
    && effectiveFollowUpDate(followUp) > localDate);
  if (hasFuture) return undefined;
  const trigger = bundle.triggeringInteractionId
    ? contacts.find((interaction) => interaction.id === bundle.triggeringInteractionId)
    : latestContact(contacts);
  if (bundle.triggeringInteractionId && !trigger) {
    throw new RangeError("The triggering interaction must be a contact Interaction for this Person.");
  }
  if (!trigger) return undefined;
  const triggerDate = localDateForInstant(trigger.occurredAt, timeZone);
  const event = trigger.eventId ? bundle.events.find((candidate) => candidate.id === trigger.eventId) : undefined;
  if ((trigger.kind === "met" || trigger.kind === "conference") && event) {
    const dueDate = addDaysToLocalDate(triggerDate, 7);
    return {
      dueDate,
      rule: "event_contact",
      sourceInteractionId: trigger.id,
      explanation: explanation("suggested_reminder.event_contact", "suggested_reminder.event_contact", [
        sourceFact("dueDate", dueDate, trigger.id),
        sourceFact("triggerDate", triggerDate, trigger.id),
        sourceFact("daysAfter", "7", trigger.id),
        sourceFact("eventName", event.name, event.id)
      ])
    };
  }
  if (trigger.kind === "introduction_received") {
    const dueDate = addDaysToLocalDate(triggerDate, 30);
    return {
      dueDate,
      rule: "introduction_received",
      sourceInteractionId: trigger.id,
      explanation: explanation("suggested_reminder.introduction_received", "suggested_reminder.introduction_received", [
        sourceFact("dueDate", dueDate, trigger.id),
        sourceFact("triggerDate", triggerDate, trigger.id),
        sourceFact("daysAfter", "30", trigger.id)
      ])
    };
  }
  if (bundle.person.contactCadenceDays) {
    const dueDate = addDaysToLocalDate(triggerDate, bundle.person.contactCadenceDays);
    return {
      dueDate,
      rule: "cadence",
      sourceInteractionId: trigger.id,
      explanation: explanation("suggested_reminder.cadence", "suggested_reminder.cadence", [
        sourceFact("dueDate", dueDate, trigger.id),
        sourceFact("triggerDate", triggerDate, trigger.id),
        sourceFact("cadenceDays", String(bundle.person.contactCadenceDays), bundle.person.id)
      ])
    };
  }
  return undefined;
}

function reciprocalPendingFollowUp(
  entry: ReachOutEntry,
  followUps: readonly FollowUp[]
): FollowUp | undefined {
  if (!entry.currentFollowUpId) return undefined;
  return followUps.find((followUp) => followUp.id === entry.currentFollowUpId
    && followUp.personId === entry.personId
    && followUp.reachOutEntryId === entry.id
    && followUp.status === "pending");
}

function reachOutExplanation(
  entry: ReachOutEntry,
  state: ReachOutDisplayState,
  followUp: FollowUp | undefined,
  timeZone: string
): Explanation {
  const date = followUp ? effectiveFollowUpDate(followUp) : undefined;
  const completionDate = entry.lastCompletedAt
    ? localDateForInstant(entry.lastCompletedAt, timeZone)
    : undefined;
  return explanation(`reach_out.${state}`, `reach_out.${state}`, [
    sourceFact("reachOutEntryId", entry.id, entry.id),
    ...(date ? [sourceFact("effectiveDate", date, followUp?.id)] : []),
    ...(followUp?.snoozedUntilDate ? [sourceFact("originalDate", followUp.dueDate, followUp.id)] : []),
    ...(completionDate ? [sourceFact("completionDate", completionDate, entry.id)] : [])
  ]);
}

function buildReachOutStates(
  entries: readonly ReachOutEntry[],
  followUps: readonly FollowUp[],
  personId: string,
  localDate: LocalDate,
  timeZone: string
): ReachOutStateProjection[] {
  return entries
    .filter((entry) => entry.personId === personId && !entry.removedAt)
    .map((entry) => {
      const followUp = reciprocalPendingFollowUp(entry, followUps);
      const state = deriveReachOutDisplayState(entry, followUp, localDate);
      const date = followUp ? effectiveFollowUpDate(followUp) : undefined;
      return {
        reachOutEntryId: entry.id,
        state,
        ...(followUp ? { currentFollowUpId: followUp.id } : {}),
        ...(date ? { effectiveDate: date } : {}),
        due: state === "active" && date === localDate,
        upcoming: Boolean(date && date > localDate),
        explanation: reachOutExplanation(entry, state, followUp, timeZone)
      };
    })
    .sort((left, right) => compareText(left.reachOutEntryId, right.reachOutEntryId));
}

/**
 * Just the relationship stage for one Person.
 *
 * Search needs a stage for every Person — the stage filter and the filter-option
 * list both depend on it — but needs the rest of the assessment only for the
 * handful of People it actually returns. Running the full projection over 3,000
 * People to read one enum was 52ms of every query.
 *
 * This is additive: it changes no existing contract, and it shares
 * `contactInteractions` and `buildStage` with `assessRelationship`, so the stage
 * it reports is the same value by construction rather than by coincidence.
 */
export function assessRelationshipStage(
  bundle: RelationshipPersonBundle,
  clock: RelationshipClock
): RelationshipStageProjection {
  assertClock(clock);
  return buildStage(
    contactInteractions(bundle.interactions, bundle.person.id),
    clock.timeZone,
    bundle.person.createdAt,
    bundle.person.id
  );
}

export function assessRelationship(
  bundle: RelationshipPersonBundle,
  clock: RelationshipClock
): RelationshipAssessment {
  const localDate = assertClock(clock);
  const contacts = contactInteractions(bundle.interactions, bundle.person.id);
  const personFollowUps = bundle.followUps.filter((followUp) => followUp.personId === bundle.person.id);
  const dueFollowUps = personFollowUps
    .filter((followUp) => followUp.status === "pending" && effectiveFollowUpDate(followUp) <= localDate)
    .sort(compareFollowUpsByEffectiveDate);
  const relationshipAge = buildRelationshipAge(
    contacts,
    bundle.person.createdAt,
    bundle.person.id,
    localDate,
    clock.timeZone
  );
  const lastContact = buildLastContact(contacts, clock.timeZone);
  const active = !bundle.person.archivedAt && bundle.person.identityStatus !== "merged";
  const today = buildTodayAssessment(bundle, contacts, localDate, clock.timeZone);
  const searchContextCue = buildFallbackMemoryCue(bundle, clock.timeZone);
  const memoryCue = buildMemoryCue(dueFollowUps, searchContextCue);
  const overdueFollowUp = active
    ? buildOverdueFollowUp(bundle.followUps, bundle.person.id, localDate)
    : undefined;
  const suggestedReminder = buildSuggestedReminder(bundle, contacts, localDate, clock.timeZone);
  return {
    policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION,
    evaluatedAt: clock.now,
    timeZone: clock.timeZone,
    localDate,
    personId: bundle.person.id,
    displayName: bundle.person.displayName,
    importance: bundle.person.importance,
    active,
    ...(today ? { today } : {}),
    relationshipStage: buildStage(contacts, clock.timeZone, bundle.person.createdAt, bundle.person.id),
    ...(memoryCue ? { memoryCue } : {}),
    ...(searchContextCue ? { searchContextCue } : {}),
    ...(overdueFollowUp ? { overdueFollowUp } : {}),
    ...(suggestedReminder ? { suggestedReminder } : {}),
    ...(lastContact ? { lastContact, lastContactAt: lastContact.occurredAt } : {}),
    relationshipAge,
    relationshipStartedAt: relationshipAge.startedAt,
    reachOutStates: buildReachOutStates(
      bundle.reachOutEntries,
      bundle.followUps,
      bundle.person.id,
      localDate,
      clock.timeZone
    )
  };
}

function todayBand(today: TodayAssessment): number {
  if (today.eligibilityCode === "explicit_follow_up") return today.dueState === "overdue" ? 0 : 1;
  if (today.eligibilityCode === "new_relationship") return 2;
  return 3;
}

function compareImportance(left: RelationshipAssessment, right: RelationshipAssessment): number {
  if (left.importance === right.importance) return 0;
  return left.importance === "high" ? -1 : 1;
}

function compareTodayAssessments(left: RelationshipAssessment, right: RelationshipAssessment): number {
  const leftToday = left.today;
  const rightToday = right.today;
  if (!leftToday || !rightToday) return leftToday ? -1 : rightToday ? 1 : 0;
  const bandDifference = todayBand(leftToday) - todayBand(rightToday);
  if (bandDifference) return bandDifference;
  if (todayBand(leftToday) === 0) {
    const date = leftToday.relevantDate.localeCompare(rightToday.relevantDate);
    if (date) return date;
  }
  const importance = compareImportance(left, right);
  if (importance) return importance;
  if (todayBand(leftToday) !== 0) {
    const date = leftToday.relevantDate.localeCompare(rightToday.relevantDate);
    if (date) return date;
  }
  return compareText(left.displayName, right.displayName) || compareText(left.personId, right.personId);
}

function todayItem(assessment: RelationshipAssessment): TodayItem {
  if (!assessment.today) throw new Error("A Today item requires an eligible assessment.");
  return {
    personId: assessment.personId,
    ...assessment.today,
    additionalDueFollowUpIds: [...assessment.today.additionalDueFollowUpIds],
    explanation: {
      ...assessment.today.explanation,
      facts: assessment.today.explanation.facts.map((fact) => ({ ...fact }))
    },
    intendedActionContext: {
      ...assessment.today.intendedActionContext,
      explanation: {
        ...assessment.today.intendedActionContext.explanation,
        facts: assessment.today.intendedActionContext.explanation.facts.map((fact) => ({ ...fact }))
      }
    }
  };
}

export function buildToday({ assessments, todaySkips, clock }: BuildTodayInput): TodayResult {
  const localDate = assertClock(clock);
  const personIds = new Set<string>();
  for (const assessment of assessments) {
    if (personIds.has(assessment.personId)) {
      throw new RangeError(`Duplicate RelationshipAssessment for Person ${assessment.personId}.`);
    }
    personIds.add(assessment.personId);
    if (assessment.policyVersion !== clock.policyVersion
      || assessment.evaluatedAt !== clock.now
      || assessment.timeZone !== clock.timeZone
      || assessment.localDate !== localDate) {
      throw new RangeError("Relationship assessments must use the same clock and policy as buildToday.");
    }
  }
  const skippedPeople = new Set(todaySkips
    .filter((skip) => skip.localDate === localDate)
    .map((skip) => skip.personId));
  const ordered = [...assessments]
    .filter((assessment) => assessment.active && assessment.today && !skippedPeople.has(assessment.personId))
    .sort(compareTodayAssessments)
    .map(todayItem);
  return {
    policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION,
    evaluatedAt: clock.now,
    timeZone: clock.timeZone,
    localDate,
    orderedItems: ordered,
    totalCount: ordered.length
  };
}
