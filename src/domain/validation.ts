import {
  BACKUP_SCHEMA_VERSION,
  DATA_STORE_NAMES,
  type AppSettings,
  type BackupEnvelope,
  type ContactMethod,
  type DataStoreName,
  type FollowUp,
  type FollowUpEvent,
  type Interaction,
  type LocalDate,
  type MemoryFact,
  type MutableRecord,
  type OrganisationAffiliation,
  type PeopleOsData,
  type Person,
  type ReachOutContext,
  type ReachOutEntry,
  type RelationshipEvent
} from "./schema";
import { interactionCountsAsContact } from "./interactionPolicy";

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("\n"));
    this.name = "ValidationError";
  }
}

const interactionKinds = new Set([
  "met", "contacted", "whatsapp_message", "email", "phone_call", "coffee", "meeting",
  "conference", "introduction_received", "introduction_made", "note_added",
  "follow_up_completed"
]);
const followUpActions = new Set(["message", "email", "call", "arrange_meeting", "make_introduction", "send_update", "research_contact_route", "other"]);
const reachOutActions = followUpActions;
const factKinds = new Set(["introduced_by", "interest", "seeking", "family", "communication_preference", "location", "other"]);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalInstant(value: unknown): boolean {
  return value === undefined || isIsoInstant(value);
}

function optionalDate(value: unknown): boolean {
  return value === undefined || isLocalDate(value);
}

function mutable(value: Record<string, unknown>): boolean {
  return nonEmpty(value.id) && Number.isInteger(value.revision) && Number(value.revision) >= 1 && isIsoInstant(value.createdAt) && isIsoInstant(value.updatedAt);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validatePerson(value: unknown): value is Person {
  if (!object(value) || !mutable(value)) return false;
  const status = value.identityStatus;
  return nonEmpty(value.displayName)
    && ["provisional", "confirmed", "merged"].includes(String(status))
    && ["normal", "high"].includes(String(value.importance))
    && strings(value.tags)
    && (value.contactCadenceDays === undefined || (Number.isInteger(value.contactCadenceDays) && Number(value.contactCadenceDays) >= 1 && Number(value.contactCadenceDays) <= 3_650))
    && optionalInstant(value.archivedAt)
    && optionalString(value.mergedIntoPersonId)
    && (status === "merged" ? nonEmpty(value.mergedIntoPersonId) : value.mergedIntoPersonId === undefined);
}

function validateContact(value: unknown): value is ContactMethod {
  if (!object(value) || !mutable(value) || !nonEmpty(value.personId) || !["phone", "email"].includes(String(value.kind))) return false;
  if (!nonEmpty(value.rawValue) || !nonEmpty(value.canonicalValue) || typeof value.isPreferred !== "boolean") return false;
  if (!optionalString(value.label) || !optionalInstant(value.archivedAt)) return false;
  if (value.kind === "phone") return /^\+[1-9]\d{1,14}$/.test(String(value.canonicalValue)) && optionalString(value.region);
  const canonical = String(value.canonicalValue);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(canonical) && canonical === canonical.toLowerCase();
}

function validateAffiliation(value: unknown): value is OrganisationAffiliation {
  return object(value) && mutable(value) && nonEmpty(value.personId) && nonEmpty(value.organisationName)
    && optionalString(value.role) && optionalDate(value.startedOn) && optionalDate(value.endedOn)
    && typeof value.isCurrent === "boolean" && optionalInstant(value.archivedAt)
    && (!value.startedOn || !value.endedOn || String(value.startedOn) <= String(value.endedOn))
    && (!value.isCurrent || value.endedOn === undefined);
}

function validateInteraction(value: unknown): value is Interaction {
  return object(value) && mutable(value) && nonEmpty(value.personId) && interactionKinds.has(String(value.kind))
    && isIsoInstant(value.occurredAt) && optionalString(value.summary) && optionalString(value.eventId)
    && optionalString(value.relatedPersonId) && optionalString(value.followUpId);
}

function validateEvent(value: unknown): value is RelationshipEvent {
  return object(value) && mutable(value) && nonEmpty(value.name) && optionalDate(value.occurredOn) && optionalString(value.location);
}

function validateFact(value: unknown): value is MemoryFact {
  return object(value) && mutable(value) && nonEmpty(value.personId) && factKinds.has(String(value.kind))
    && nonEmpty(value.value) && String(value.value) === String(value.value).trim() && String(value.value).length <= 240
    && typeof value.showAsMemoryCue === "boolean"
    && optionalString(value.relatedPersonId) && optionalString(value.sourceInteractionId) && optionalInstant(value.archivedAt)
    && (value.relatedPersonId === undefined || (value.kind === "introduced_by" && value.relatedPersonId !== value.personId))
    && (value.kind !== "communication_preference" || ["whatsapp", "email", "phone"].includes(String(value.value)));
}

function validateFollowUp(value: unknown): value is FollowUp {
  if (!object(value) || !mutable(value) || !nonEmpty(value.personId) || !isLocalDate(value.dueDate)) return false;
  const reason = String(value.reason ?? "");
  const status = String(value.status);
  if (!reason.trim() || reason !== reason.trim() || reason.length > 240) return false;
  if (!followUpActions.has(String(value.actionType)) || !["pending", "completed", "cancelled", "superseded"].includes(status)) return false;
  if (!optionalString(value.suggestedByRule) || !optionalString(value.reachOutEntryId)
    || !optionalInstant(value.completedAt) || !optionalDate(value.snoozedUntilDate)
    || !optionalString(value.supersedesFollowUpId) || !optionalString(value.supersededByFollowUpId)) return false;
  if ((status === "completed") !== (value.completedAt !== undefined)) return false;
  if ((status === "superseded") !== (value.supersededByFollowUpId !== undefined)) return false;
  if (value.supersedesFollowUpId === value.id || value.supersededByFollowUpId === value.id) return false;
  if (value.snoozedUntilDate !== undefined && String(value.snoozedUntilDate) <= String(value.dueDate)) return false;
  return true;
}

function validateFollowUpEvent(value: unknown): value is FollowUpEvent {
  if (!object(value) || !nonEmpty(value.id) || !nonEmpty(value.followUpId) || !nonEmpty(value.personId)
    || !["created", "snoozed", "rescheduled", "completed_with_contact", "completed_without_contact", "cancelled"].includes(String(value.kind))
    || !isIsoInstant(value.occurredAt) || !optionalDate(value.fromDate) || !optionalDate(value.toDate)
    || !optionalString(value.replacementFollowUpId) || !optionalString(value.interactionId)) return false;
  const hasFrom = value.fromDate !== undefined;
  const hasTo = value.toDate !== undefined;
  const hasReplacement = value.replacementFollowUpId !== undefined;
  const hasInteraction = value.interactionId !== undefined;
  switch (value.kind) {
    case "created":
      return !hasFrom && hasTo && !hasReplacement && !hasInteraction;
    case "snoozed":
      return hasFrom && hasTo && String(value.toDate) > String(value.fromDate)
        && !hasReplacement && !hasInteraction;
    case "rescheduled":
      return hasFrom && hasTo && hasReplacement && !hasInteraction;
    case "completed_with_contact":
    case "completed_without_contact":
      return !hasFrom && !hasTo && !hasReplacement && hasInteraction;
    case "cancelled":
      return !hasFrom && !hasTo && !hasReplacement && !hasInteraction;
    default:
      return false;
  }
}

function validateReachOutEntry(value: unknown): value is ReachOutEntry {
  return object(value) && mutable(value) && nonEmpty(value.personId)
    && optionalString(value.reason) && (value.intendedActionType === undefined || reachOutActions.has(String(value.intendedActionType)))
    && optionalString(value.actionDetail) && optionalString(value.notes)
    && ["active", "completed", "dormant"].includes(String(value.intentStatus))
    && optionalString(value.currentFollowUpId) && strings(value.contextIds) && isIsoInstant(value.addedAt)
    && optionalInstant(value.lastCompletedAt) && optionalInstant(value.removedAt);
}

function validateReachOutContext(value: unknown): value is ReachOutContext {
  return object(value) && mutable(value) && ["project", "organisation", "event", "fellowship", "other"].includes(String(value.kind))
    && nonEmpty(value.label) && optionalString(value.eventId) && optionalInstant(value.archivedAt);
}

export function validateAppSettings(value: unknown): value is AppSettings {
  if (!object(value) || !mutable(value) || value.id !== "app") return false;
  const reminder = value.reachOutDefaultReminderDays;
  return /^[A-Z]{2}$/.test(String(value.defaultPhoneRegion))
    && ["standard", "networking"].includes(String(value.captureMode))
    && (reminder === undefined || [1, 7, 14, 30].includes(Number(reminder)));
}

const storeValidators: Record<DataStoreName, (value: unknown) => boolean> = {
  people: validatePerson,
  contactMethods: validateContact,
  affiliations: validateAffiliation,
  interactions: validateInteraction,
  events: validateEvent,
  memoryFacts: validateFact,
  followUps: validateFollowUp,
  followUpEvents: validateFollowUpEvent,
  todaySkips: (value) => object(value) && nonEmpty(value.id) && nonEmpty(value.personId)
    && isLocalDate(value.localDate) && value.id === `${value.personId}:${value.localDate}`
    && isIsoInstant(value.createdAt),
  reachOutEntries: validateReachOutEntry,
  reachOutEvents: (value) => object(value) && nonEmpty(value.id) && nonEmpty(value.reachOutEntryId)
    && ["added", "activated", "completed", "moved_to_dormant", "removed", "follow_up_linked"].includes(String(value.kind))
    && isIsoInstant(value.occurredAt) && optionalString(value.followUpId) && optionalString(value.interactionId),
  reachOutContexts: validateReachOutContext,
  appSettings: validateAppSettings
};

function ids(records: Array<{ id: string }>): Set<string> {
  return new Set(records.map((record) => record.id));
}

function requireReference(issues: string[], condition: boolean, path: string): void {
  if (!condition) issues.push(`${path} references a missing or incompatible record`);
}

export function validatePeopleOsData(value: unknown): PeopleOsData {
  const issues: string[] = [];
  if (!object(value)) throw new ValidationError(["data must be an object"]);

  for (const store of DATA_STORE_NAMES) {
    const records = value[store];
    if (!Array.isArray(records)) {
      issues.push(`${store} must be an array`);
      continue;
    }
    const seen = new Set<string>();
    records.forEach((record, index) => {
      if (!storeValidators[store](record)) issues.push(`${store}[${index}] is invalid`);
      if (object(record) && nonEmpty(record.id)) {
        if (seen.has(record.id)) issues.push(`${store} contains duplicate id ${record.id}`);
        seen.add(record.id);
      }
    });
  }
  if (issues.length) throw new ValidationError(issues);

  const data = value as PeopleOsData;
  const personIds = ids(data.people);
  const eventIds = ids(data.events);
  const interactionIds = ids(data.interactions);
  const followUpIds = ids(data.followUps);
  const reachOutIds = ids(data.reachOutEntries);
  const contextIds = ids(data.reachOutContexts);

  data.people.forEach((person) => {
    if (person.identityStatus === "merged") requireReference(issues, person.mergedIntoPersonId !== person.id && personIds.has(person.mergedIntoPersonId!), `people.${person.id}.mergedIntoPersonId`);
  });

  const personChildren: Array<[string, Array<{ id: string; personId: string }>]> = [
    ["contactMethods", data.contactMethods], ["affiliations", data.affiliations],
    ["interactions", data.interactions], ["memoryFacts", data.memoryFacts],
    ["followUps", data.followUps], ["todaySkips", data.todaySkips],
    ["reachOutEntries", data.reachOutEntries], ["followUpEvents", data.followUpEvents]
  ];
  personChildren.forEach(([store, records]) => records.forEach((record) => requireReference(issues, personIds.has(record.personId), `${store}.${record.id}.personId`)));

  data.interactions.forEach((record) => {
    if (record.eventId) requireReference(issues, eventIds.has(record.eventId), `interactions.${record.id}.eventId`);
    if (record.relatedPersonId) requireReference(issues, personIds.has(record.relatedPersonId), `interactions.${record.id}.relatedPersonId`);
    if (record.followUpId) {
      const followUp = data.followUps.find((candidate) => candidate.id === record.followUpId);
      requireReference(issues, Boolean(followUp && followUp.personId === record.personId), `interactions.${record.id}.followUpId`);
      const expectedKind = record.kind === "follow_up_completed"
        ? "completed_without_contact"
        : interactionCountsAsContact(record.kind)
          ? "completed_with_contact"
          : undefined;
      const matchingEvents = data.followUpEvents.filter((event) => event.followUpId === record.followUpId
        && event.interactionId === record.id && event.kind === expectedKind);
      if (!expectedKind || followUp?.status !== "completed" || matchingEvents.length !== 1) {
        issues.push(`interactions.${record.id}.followUpId must have one reciprocal completion event`);
      }
    }
  });
  data.memoryFacts.forEach((record) => {
    if (record.relatedPersonId) requireReference(issues, personIds.has(record.relatedPersonId), `memoryFacts.${record.id}.relatedPersonId`);
    if (record.sourceInteractionId) {
      const interaction = data.interactions.find((candidate) => candidate.id === record.sourceInteractionId);
      requireReference(issues, Boolean(interaction && interaction.personId === record.personId), `memoryFacts.${record.id}.sourceInteractionId`);
    }
  });
  data.followUps.forEach((record) => {
    if (record.reachOutEntryId) {
      const entry = data.reachOutEntries.find((candidate) => candidate.id === record.reachOutEntryId);
      requireReference(issues, Boolean(entry && entry.personId === record.personId), `followUps.${record.id}.reachOutEntryId`);
    }
    if (record.supersedesFollowUpId) {
      const previous = data.followUps.find((candidate) => candidate.id === record.supersedesFollowUpId);
      requireReference(issues, Boolean(previous && previous.personId === record.personId && previous.supersededByFollowUpId === record.id), `followUps.${record.id}.supersedesFollowUpId`);
    }
    if (record.supersededByFollowUpId) {
      const next = data.followUps.find((candidate) => candidate.id === record.supersededByFollowUpId);
      requireReference(issues, Boolean(next && next.personId === record.personId && next.supersedesFollowUpId === record.id), `followUps.${record.id}.supersededByFollowUpId`);
    }
    const events = data.followUpEvents.filter((event) => event.followUpId === record.id);
    const completionEvents = events.filter((event) => event.kind === "completed_with_contact" || event.kind === "completed_without_contact");
    const cancellationEvents = events.filter((event) => event.kind === "cancelled");
    const rescheduleEvents = events.filter((event) => event.kind === "rescheduled");
    const createdEvents = events.filter((event) => event.kind === "created");
    const snoozeEvents = events.filter((event) => event.kind === "snoozed");
    if (!record.supersedesFollowUpId) {
      if (createdEvents.length !== 1 || createdEvents[0].toDate !== record.dueDate
        || createdEvents[0].occurredAt !== record.createdAt) {
        issues.push(`followUps.${record.id} must have exactly one matching created event`);
      }
    } else if (createdEvents.length > 0) {
      issues.push(`followUps.${record.id} is a replacement and cannot have a created event`);
    }
    if (record.snoozedUntilDate && !snoozeEvents.some((event) => event.toDate === record.snoozedUntilDate)) {
      issues.push(`followUps.${record.id}.snoozedUntilDate requires matching history`);
    }
    if (!record.snoozedUntilDate && snoozeEvents.length > 0) {
      issues.push(`followUps.${record.id} has snooze history without a snoozed effective date`);
    }
    if (record.status === "completed" && completionEvents.length !== 1) {
      issues.push(`followUps.${record.id} must have exactly one completion event`);
    }
    if (record.status === "completed" && completionEvents[0]?.occurredAt !== record.completedAt) {
      issues.push(`followUps.${record.id}.completedAt must match its completion event`);
    }
    if (record.status === "cancelled" && cancellationEvents.length !== 1) {
      issues.push(`followUps.${record.id} must have exactly one cancellation event`);
    }
    if (record.status === "superseded" && rescheduleEvents.filter((event) => event.replacementFollowUpId === record.supersededByFollowUpId).length !== 1) {
      issues.push(`followUps.${record.id} must have exactly one reschedule event`);
    }
    if (record.status !== "completed" && completionEvents.length > 0) {
      issues.push(`followUps.${record.id} has completion history incompatible with status ${record.status}`);
    }
    if (record.status !== "cancelled" && cancellationEvents.length > 0) {
      issues.push(`followUps.${record.id} has cancellation history incompatible with status ${record.status}`);
    }
    if (record.status !== "superseded" && rescheduleEvents.length > 0) {
      issues.push(`followUps.${record.id} has reschedule history incompatible with status ${record.status}`);
    }
  });
  data.followUpEvents.forEach((record) => {
    const followUp = data.followUps.find((candidate) => candidate.id === record.followUpId);
    requireReference(issues, Boolean(followUp && followUp.personId === record.personId), `followUpEvents.${record.id}.followUpId`);
    if (record.replacementFollowUpId) {
      const replacement = data.followUps.find((candidate) => candidate.id === record.replacementFollowUpId);
      requireReference(issues, Boolean(followUp && replacement && replacement.personId === record.personId
        && followUp.supersededByFollowUpId === replacement.id && replacement.supersedesFollowUpId === followUp.id
        && record.fromDate === (followUp.snoozedUntilDate ?? followUp.dueDate)
        && record.toDate === replacement.dueDate), `followUpEvents.${record.id}.replacementFollowUpId`);
    }
    if (record.interactionId) {
      const interaction = data.interactions.find((candidate) => candidate.id === record.interactionId);
      const kindMatches = record.kind === "completed_with_contact"
        ? Boolean(interaction && interactionCountsAsContact(interaction.kind))
        : record.kind === "completed_without_contact"
          ? interaction?.kind === "follow_up_completed"
          : true;
      requireReference(issues, Boolean(interaction && followUp && interaction.personId === record.personId
        && interaction.followUpId === followUp.id && kindMatches), `followUpEvents.${record.id}.interactionId`);
    }
  });
  data.todaySkips.forEach((record) => {
    if (record.id !== `${record.personId}:${record.localDate}`) issues.push(`todaySkips.${record.id}.id must equal personId:localDate`);
  });
  data.reachOutEntries.forEach((record) => {
    if (record.currentFollowUpId) {
      const followUp = data.followUps.find((candidate) => candidate.id === record.currentFollowUpId);
      requireReference(issues, Boolean(followUp && followUp.personId === record.personId && followUp.reachOutEntryId === record.id && followUp.status === "pending"), `reachOutEntries.${record.id}.currentFollowUpId`);
    }
    record.contextIds.forEach((id) => requireReference(issues, contextIds.has(id), `reachOutEntries.${record.id}.contextIds.${id}`));
  });
  const currentReachOutPeople = new Set<string>();
  data.reachOutEntries.filter((record) => !record.removedAt && record.intentStatus !== "completed").forEach((record) => {
    if (currentReachOutPeople.has(record.personId)) issues.push(`reachOutEntries contains more than one current entry for person ${record.personId}`);
    currentReachOutPeople.add(record.personId);
  });
  data.reachOutEvents.forEach((record) => {
    requireReference(issues, reachOutIds.has(record.reachOutEntryId), `reachOutEvents.${record.id}.reachOutEntryId`);
    if (record.followUpId) requireReference(issues, followUpIds.has(record.followUpId), `reachOutEvents.${record.id}.followUpId`);
    if (record.interactionId) requireReference(issues, interactionIds.has(record.interactionId), `reachOutEvents.${record.id}.interactionId`);
  });
  data.reachOutContexts.forEach((record) => {
    if (record.eventId) requireReference(issues, eventIds.has(record.eventId), `reachOutContexts.${record.id}.eventId`);
  });
  const preferredContactKinds = new Set<string>();
  data.contactMethods.filter((record) => !record.archivedAt && record.isPreferred).forEach((record) => {
    const key = `${record.personId}:${record.kind}`;
    if (preferredContactKinds.has(key)) {
      issues.push(`contactMethods contains more than one active preferred ${record.kind} for person ${record.personId}`);
    }
    preferredContactKinds.add(key);
  });
  if (data.appSettings.length !== 1 || data.appSettings[0]?.id !== "app") issues.push("appSettings must contain exactly one app singleton");

  if (issues.length) throw new ValidationError(issues);
  return data;
}

export function validateBackupEnvelope(value: unknown): BackupEnvelope {
  if (!object(value) || value.product !== "peopleos" || value.schemaVersion !== BACKUP_SCHEMA_VERSION || !isIsoInstant(value.exportedAt)) {
    throw new ValidationError(["backup envelope is invalid or unsupported"]);
  }
  return { product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: value.exportedAt, data: validatePeopleOsData(value.data) };
}

export function assertValidRecord(store: DataStoreName, value: unknown): void {
  if (!storeValidators[store](value)) throw new ValidationError([`${store} record is invalid`]);
}

export function isMutableRecord(value: unknown): value is MutableRecord {
  return object(value) && mutable(value);
}
