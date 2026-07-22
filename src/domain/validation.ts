import {
  BACKUP_SCHEMA_VERSION,
  DATA_STORE_NAMES,
  type AppSettings,
  type BackupEnvelope,
  type ContactMethod,
  type DataStoreName,
  type FollowUp,
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

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("\n"));
    this.name = "ValidationError";
  }
}

const interactionKinds = new Set([
  "met", "whatsapp_message", "email", "phone_call", "coffee", "meeting",
  "conference", "introduction_received", "introduction_made", "note_added",
  "follow_up_completed"
]);
const followUpActions = new Set(["message", "email", "call", "arrange_meeting", "make_introduction", "send_update", "other"]);
const reachOutActions = new Set([...followUpActions, "research_contact_route"]);
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
    && (value.contactCadenceDays === undefined || (Number.isInteger(value.contactCadenceDays) && Number(value.contactCadenceDays) > 0))
    && optionalInstant(value.archivedAt)
    && optionalString(value.mergedIntoPersonId)
    && (status === "merged" ? nonEmpty(value.mergedIntoPersonId) : value.mergedIntoPersonId === undefined);
}

function validateContact(value: unknown): value is ContactMethod {
  if (!object(value) || !mutable(value) || !nonEmpty(value.personId) || !["phone", "email"].includes(String(value.kind))) return false;
  if (!nonEmpty(value.rawValue) || !nonEmpty(value.canonicalValue) || typeof value.isPreferred !== "boolean") return false;
  if (!optionalString(value.label) || !optionalInstant(value.archivedAt)) return false;
  if (value.kind === "phone") return /^\+[1-9]\d{1,14}$/.test(String(value.canonicalValue)) && optionalString(value.region);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value.canonicalValue));
}

function validateAffiliation(value: unknown): value is OrganisationAffiliation {
  return object(value) && mutable(value) && nonEmpty(value.personId) && nonEmpty(value.organisationName)
    && optionalString(value.role) && optionalDate(value.startedOn) && optionalDate(value.endedOn)
    && typeof value.isCurrent === "boolean" && optionalInstant(value.archivedAt);
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
    && nonEmpty(value.value) && typeof value.showAsMemoryCue === "boolean"
    && optionalString(value.relatedPersonId) && optionalString(value.sourceInteractionId) && optionalInstant(value.archivedAt)
    && (value.kind !== "communication_preference" || ["whatsapp", "email", "phone"].includes(String(value.value)));
}

function validateFollowUp(value: unknown): value is FollowUp {
  return object(value) && mutable(value) && nonEmpty(value.personId) && isLocalDate(value.dueDate)
    && nonEmpty(value.reason) && followUpActions.has(String(value.actionType))
    && ["pending", "completed", "cancelled", "superseded"].includes(String(value.status))
    && optionalString(value.suggestedByRule) && optionalString(value.reachOutEntryId)
    && optionalInstant(value.completedAt) && optionalDate(value.snoozedUntilDate)
    && optionalString(value.supersedesFollowUpId) && optionalString(value.supersededByFollowUpId);
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
  followUpEvents: (value) => object(value) && nonEmpty(value.id) && nonEmpty(value.followUpId) && nonEmpty(value.personId)
    && ["created", "snoozed", "rescheduled", "completed_with_contact", "completed_without_contact", "cancelled"].includes(String(value.kind))
    && isIsoInstant(value.occurredAt) && optionalDate(value.fromDate) && optionalDate(value.toDate)
    && optionalString(value.replacementFollowUpId) && optionalString(value.interactionId),
  todaySkips: (value) => object(value) && nonEmpty(value.id) && nonEmpty(value.personId) && isLocalDate(value.localDate) && isIsoInstant(value.createdAt),
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
    if (record.followUpId) requireReference(issues, followUpIds.has(record.followUpId), `interactions.${record.id}.followUpId`);
  });
  data.memoryFacts.forEach((record) => {
    if (record.relatedPersonId) requireReference(issues, personIds.has(record.relatedPersonId), `memoryFacts.${record.id}.relatedPersonId`);
    if (record.sourceInteractionId) requireReference(issues, interactionIds.has(record.sourceInteractionId), `memoryFacts.${record.id}.sourceInteractionId`);
  });
  data.followUps.forEach((record) => {
    if (record.reachOutEntryId) {
      const entry = data.reachOutEntries.find((candidate) => candidate.id === record.reachOutEntryId);
      requireReference(issues, Boolean(entry && entry.personId === record.personId), `followUps.${record.id}.reachOutEntryId`);
    }
    if (record.supersedesFollowUpId) requireReference(issues, followUpIds.has(record.supersedesFollowUpId), `followUps.${record.id}.supersedesFollowUpId`);
    if (record.supersededByFollowUpId) requireReference(issues, followUpIds.has(record.supersededByFollowUpId), `followUps.${record.id}.supersededByFollowUpId`);
  });
  data.followUpEvents.forEach((record) => {
    const followUp = data.followUps.find((candidate) => candidate.id === record.followUpId);
    requireReference(issues, Boolean(followUp && followUp.personId === record.personId), `followUpEvents.${record.id}.followUpId`);
    if (record.replacementFollowUpId) requireReference(issues, followUpIds.has(record.replacementFollowUpId), `followUpEvents.${record.id}.replacementFollowUpId`);
    if (record.interactionId) requireReference(issues, interactionIds.has(record.interactionId), `followUpEvents.${record.id}.interactionId`);
  });
  data.todaySkips.forEach((record) => {
    if (record.id !== `${record.personId}:${record.localDate}`) issues.push(`todaySkips.${record.id}.id must equal personId:localDate`);
  });
  data.reachOutEntries.forEach((record) => {
    if (record.currentFollowUpId) {
      const followUp = data.followUps.find((candidate) => candidate.id === record.currentFollowUpId);
      requireReference(issues, Boolean(followUp && followUp.personId === record.personId && followUp.reachOutEntryId === record.id), `reachOutEntries.${record.id}.currentFollowUpId`);
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
