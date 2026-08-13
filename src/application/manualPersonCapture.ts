import type {
  ContactCadence,
  ContactMethod,
  FollowUp,
  FollowUpEvent,
  Interaction,
  LocalDate,
  OrganisationAffiliation,
  Person
} from "../domain/schema";
import { contactCadenceOf, isValidContactCadence } from "../domain/cadence";
import {
  hasRegularContactInteractionAnchor,
  regularContactSetupState
} from "../domain/regularContactSchedule";
import type { RelationshipMode } from "../domain/relationshipMode";
import { defaultConversationalName } from "../domain/personNames";
import { assertValidRecord, isLocalDate, ValidationError } from "../domain/validation";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import type { PeopleOsDatabase } from "../data/database";
import { normalizeContactValue } from "../integrations/contactValues";
import { detectDuplicatePeople } from "../domain/duplicates";
import { requireReviewedDuplicateMatches } from "./duplicateReview";
import type { PersonEditDraft } from "./personLifecycle";

export type ManualContactMethodDraft = {
  id: string;
  kind: "phone" | "email";
  value: string;
  label?: string;
  region?: string;
};

export type ManualPersonCaptureDraft = {
  personId: string;
  affiliationId: string;
  metInteractionId: string;
  initialFollowUpId: string;
  initialFollowUpEventId: string;
  createdAt: string;
  displayName: string;
  conversationalName?: string;
  relationshipMode: RelationshipMode;
  identityStatus: "confirmed" | "provisional";
  importance: "normal" | "high";
  tags: string[];
  contactCadence?: ContactCadence;
  /** @deprecated Temporary draft compatibility; preparation always writes structured cadence. */
  contactCadenceDays?: number;
  /** Initial schedule anchor used by the simple Add Person flow. */
  startDate?: LocalDate;
  contactMethods: ManualContactMethodDraft[];
  organisationName?: string;
  role?: string;
  whereMet?: string;
};

export type PreparedManualPersonCapture = {
  person: Person;
  contactMethods: ContactMethod[];
  affiliation?: OrganisationAffiliation;
  metInteraction?: Interaction;
  initialFollowUp?: FollowUp;
  initialFollowUpEvent?: FollowUpEvent;
};

export type ManualCaptureHooks = {
  beforeCommit?: () => void | Promise<void>;
  enforceDuplicateReview?: boolean;
  acknowledgedDuplicatePersonIds?: readonly string[];
};

export type DraftFactoryOptions = {
  now?: string;
  idFactory?: () => string;
};

export type PersonEditWithInitialScheduleCommand = {
  personId: string;
  expectedRevision: number;
  draft: PersonEditDraft;
  startDate?: LocalDate;
  followUpId: string;
  followUpEventId: string;
  occurredAt: string;
};

export type PersonEditWithoutRegularScheduleCommand = {
  personId: string;
  expectedRevision: number;
  draft: PersonEditDraft;
  followUpId: string;
  expectedFollowUpRevision: number;
  cancellationEventId: string;
  occurredAt: string;
};

function createId(prefix: string, idFactory: () => string): string {
  return `${prefix}-${idFactory()}`;
}

export function createManualPersonCaptureDraft(
  options: DraftFactoryOptions = {}
): ManualPersonCaptureDraft {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  return {
    personId: createId("person", idFactory),
    affiliationId: createId("affiliation", idFactory),
    metInteractionId: createId("interaction", idFactory),
    initialFollowUpId: createId("follow-up", idFactory),
    initialFollowUpEventId: createId("follow-up-event", idFactory),
    createdAt: options.now ?? new Date().toISOString(),
    displayName: "",
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    contactMethods: []
  };
}

export function createManualContactMethodDraft(
  kind: "phone" | "email" = "phone",
  idFactory: () => string = () => crypto.randomUUID()
): ManualContactMethodDraft {
  return { id: createId("contact", idFactory), kind, value: "" };
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertCaptureFields(draft: ManualPersonCaptureDraft): void {
  const issues: string[] = [];
  const displayName = draft.displayName.trim();
  const hasContactIdentity = draft.contactMethods.some((contact) => Boolean(contact.value.trim()));
  if (!displayName && !hasContactIdentity) {
    issues.push("Add a name, mobile number or email address.");
  }
  if (displayName.length > 120) issues.push("Name or description must be 120 characters or fewer.");
  if (draft.conversationalName !== undefined
    && (!draft.conversationalName.trim() || draft.conversationalName.trim().length > 120)) {
    issues.push("What you call them must be 120 characters or fewer.");
  }
  if (draft.tags.length > 10) issues.push("Add no more than 10 tags.");
  if (draft.tags.some((tag) => tag.trim().length > 40)) issues.push("Each tag must be 40 characters or fewer.");
  if (draft.contactCadence !== undefined && !isValidContactCadence(draft.contactCadence)) {
    issues.push("Contact cadence must be a positive whole number no more than 3,650 days apart.");
  }
  if (draft.contactCadenceDays !== undefined
    && !isValidContactCadence({ value: draft.contactCadenceDays, unit: "days" })) {
    issues.push("Contact cadence must be between 1 and 3650 days.");
  }
  if (draft.startDate !== undefined && !isLocalDate(draft.startDate)) {
    issues.push("Choose Today or Tomorrow as the first contact date.");
  }
  if (draft.startDate !== undefined && contactCadenceOf(draft) === undefined) {
    issues.push("Choose how often you want to contact this person.");
  }
  if (contactCadenceOf(draft) !== undefined
    && draft.startDate === undefined
    && !optionalTrimmed(draft.whereMet)) {
    issues.push("Choose Today or Tomorrow to start regular contact.");
  }
  if (optionalTrimmed(draft.role) && !optionalTrimmed(draft.organisationName)) {
    issues.push("Add an organisation before adding a role.");
  }
  draft.contactMethods.forEach((contact) => {
    if (!contact.value.trim() && optionalTrimmed(contact.label)) {
      issues.push(`Enter a ${contact.kind === "phone" ? "phone number" : "email address"} or remove its labelled row.`);
    }
  });
  const ids = [
    draft.personId,
    draft.affiliationId,
    draft.metInteractionId,
    draft.initialFollowUpId,
    draft.initialFollowUpEventId,
    ...draft.contactMethods.map((contact) => contact.id)
  ];
  if (ids.some((id) => !id.trim())) issues.push("Every draft record needs a stable ID.");
  if (new Set(ids).size !== ids.length) issues.push("Draft record IDs must be unique.");
  if (issues.length) throw new ValidationError(issues);
}

export function prepareManualPersonCapture(
  draft: ManualPersonCaptureDraft,
  defaultPhoneRegion: string
): PreparedManualPersonCapture {
  assertCaptureFields(draft);
  const timestamp = draft.createdAt;
  const tags = draft.tags.map((tag) => tag.trim()).filter(Boolean);
  const contactCadence = contactCadenceOf(draft);
  const preferredKinds = new Set<"phone" | "email">();
  const contactMethods = draft.contactMethods.flatMap((contact): ContactMethod[] => {
    if (!contact.value.trim()) return [];
    const normalized = normalizeContactValue(contact.kind, contact.value, contact.region ?? defaultPhoneRegion);
    const isPreferred = !preferredKinds.has(contact.kind);
    preferredKinds.add(contact.kind);
    const base = {
      id: contact.id,
      revision: 1,
      personId: draft.personId,
      ...(optionalTrimmed(contact.label) ? { label: optionalTrimmed(contact.label) } : {}),
      rawValue: normalized.rawValue,
      canonicalValue: normalized.canonicalValue,
      isPreferred,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return contact.kind === "phone"
      ? [{ ...base, kind: "phone", ...(normalized.region ? { region: normalized.region } : {}) }]
      : [{ ...base, kind: "email" }];
  });

  // Person.displayName remains non-empty for storage/back-up/sync compatibility.
  // When the user has not supplied a name, keep the useful identifier they did
  // supply instead: prefer the first valid phone, then the first valid email.
  const displayName = draft.displayName.trim()
    || contactMethods.find((contact) => contact.kind === "phone")?.rawValue
    || contactMethods.find((contact) => contact.kind === "email")?.rawValue;
  if (!displayName) throw new ValidationError(["Add a name, mobile number or email address."]);
  const person: Person = {
    id: draft.personId,
    revision: 1,
    displayName,
    conversationalName: optionalTrimmed(draft.conversationalName)
      ?? defaultConversationalName(displayName),
    relationshipMode: draft.relationshipMode,
    identityStatus: draft.identityStatus,
    importance: draft.importance,
    tags,
    ...(contactCadence === undefined ? {} : { contactCadence }),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const organisationName = optionalTrimmed(draft.organisationName);
  const affiliation: OrganisationAffiliation | undefined = organisationName ? {
    id: draft.affiliationId,
    revision: 1,
    personId: person.id,
    organisationName,
    ...(optionalTrimmed(draft.role) ? { role: optionalTrimmed(draft.role) } : {}),
    isCurrent: true,
    createdAt: timestamp,
    updatedAt: timestamp
  } : undefined;

  const whereMet = optionalTrimmed(draft.whereMet);
  const metInteraction: Interaction | undefined = whereMet ? {
    id: draft.metInteractionId,
    revision: 1,
    personId: person.id,
    kind: "met",
    occurredAt: timestamp,
    summary: whereMet,
    createdAt: timestamp,
    updatedAt: timestamp
  } : undefined;

  // A cadence needs a real contact before the relationship engine can derive a
  // due date. The initial pending FollowUp anchors Today/Upcoming without
  // inventing a contact that never happened. It remains an implementation
  // detail of the simple Start Today/Tomorrow control.
  const initialFollowUp: FollowUp | undefined = draft.startDate ? {
    id: draft.initialFollowUpId,
    revision: 1,
    personId: person.id,
    dueDate: draft.startDate,
    reason: "Keep in touch",
    actionType: "message",
    suggestedByRule: "initial_schedule",
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp
  } : undefined;
  const initialFollowUpEvent: FollowUpEvent | undefined = initialFollowUp ? {
    id: draft.initialFollowUpEventId,
    followUpId: initialFollowUp.id,
    personId: person.id,
    kind: "created",
    occurredAt: timestamp,
    toDate: initialFollowUp.dueDate
  } : undefined;

  assertValidRecord("people", person);
  contactMethods.forEach((record) => assertValidRecord("contactMethods", record));
  if (affiliation) assertValidRecord("affiliations", affiliation);
  if (metInteraction) assertValidRecord("interactions", metInteraction);
  if (initialFollowUp) assertValidRecord("followUps", initialFollowUp);
  if (initialFollowUpEvent) assertValidRecord("followUpEvents", initialFollowUpEvent);
  return { person, contactMethods, affiliation, metInteraction, initialFollowUp, initialFollowUpEvent };
}

function identical(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertPreparedCapture(capture: PreparedManualPersonCapture): void {
  const issues: string[] = [];
  assertValidRecord("people", capture.person);
  capture.contactMethods.forEach((record) => {
    assertValidRecord("contactMethods", record);
    if (record.personId !== capture.person.id) issues.push(`Contact method ${record.id} must belong to the captured Person.`);
  });
  if (capture.affiliation) {
    assertValidRecord("affiliations", capture.affiliation);
    if (capture.affiliation.personId !== capture.person.id) issues.push("The first affiliation must belong to the captured Person.");
  }
  if (capture.metInteraction) {
    assertValidRecord("interactions", capture.metInteraction);
    if (capture.metInteraction.personId !== capture.person.id || capture.metInteraction.kind !== "met") {
      issues.push("Meeting context must be a met Interaction owned by the captured Person.");
    }
  }
  if (capture.initialFollowUp || capture.initialFollowUpEvent) {
    if (!capture.initialFollowUp || !capture.initialFollowUpEvent) {
      issues.push("The initial schedule needs both a FollowUp and its created event.");
    } else {
      assertValidRecord("followUps", capture.initialFollowUp);
      assertValidRecord("followUpEvents", capture.initialFollowUpEvent);
      if (capture.initialFollowUp.personId !== capture.person.id
        || capture.initialFollowUpEvent.personId !== capture.person.id
        || capture.initialFollowUpEvent.followUpId !== capture.initialFollowUp.id
        || capture.initialFollowUpEvent.kind !== "created") {
        issues.push("The initial schedule must belong to the captured Person.");
      }
    }
  }
  if (regularContactSetupState(
    capture.person,
    capture.metInteraction ? [capture.metInteraction] : [],
    capture.initialFollowUp ? [capture.initialFollowUp] : []
  ) === "incomplete") {
    issues.push("Choose Today or Tomorrow to start regular contact.");
  }
  const preferredKinds = new Set<"phone" | "email">();
  capture.contactMethods.filter((record) => !record.archivedAt && record.isPreferred).forEach((record) => {
    if (preferredKinds.has(record.kind)) issues.push(`Only one preferred ${record.kind} may be captured.`);
    preferredKinds.add(record.kind);
  });
  if (issues.length) throw new ValidationError(issues);
}

export async function savePreparedManualPersonCapture(
  db: PeopleOsDatabase,
  capture: PreparedManualPersonCapture,
  hooks: ManualCaptureHooks = {}
): Promise<PreparedManualPersonCapture> {
  assertPreparedCapture(capture);
  const records = [
    ["people", capture.person],
    ...capture.contactMethods.map((record) => ["contactMethods", record] as const),
    ...(capture.affiliation ? [["affiliations", capture.affiliation] as const] : []),
    ...(capture.metInteraction ? [["interactions", capture.metInteraction] as const] : []),
    ...(capture.initialFollowUp ? [["followUps", capture.initialFollowUp] as const] : []),
    ...(capture.initialFollowUpEvent ? [["followUpEvents", capture.initialFollowUpEvent] as const] : [])
  ] as const;

  const tx = db.transaction([
    "people",
    "contactMethods",
    "affiliations",
    "interactions",
    "followUps",
    "followUpEvents",
    "events",
    "metadata"
  ], "readwrite");
  try {
    const existing = await Promise.all(records.map(async ([store, record]) =>
      tx.objectStore(store).get(record.id as never) as Promise<unknown>
    ));
    if (existing.every((record, index) => record !== undefined && identical(record, records[index][1]))) {
      await tx.done;
      return capture;
    }
    const collisionIndex = existing.findIndex((record) => record !== undefined);
    if (collisionIndex >= 0) {
      const [store, record] = records[collisionIndex];
      throw new RecordConflictError(`${store} already contains id ${record.id}`);
    }

    if (hooks.enforceDuplicateReview) {
      const [people, contactMethods, affiliations, interactions, events] = await Promise.all([
        tx.objectStore("people").getAll(),
        tx.objectStore("contactMethods").getAll(),
        tx.objectStore("affiliations").getAll(),
        tx.objectStore("interactions").getAll(),
        tx.objectStore("events").getAll()
      ]);
      requireReviewedDuplicateMatches(detectDuplicatePeople({
        candidate: {
          person: capture.person,
          contactMethods: capture.contactMethods,
          affiliations: capture.affiliation ? [capture.affiliation] : [],
          interactions: capture.metInteraction ? [capture.metInteraction] : []
        },
        people,
        contactMethods,
        affiliations,
        interactions,
        events
      }), hooks.acknowledgedDuplicatePersonIds ?? []);
    }

    for (const [store, record] of records) {
      await tx.objectStore(store).add(record as never);
    }
    const metadataStore = tx.objectStore("metadata");
    const metadata = await metadataStore.get("app");
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await metadataStore.put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: capture.person.updatedAt
    });
    await hooks.beforeCommit?.();
    await tx.done;
    return capture;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}

export async function captureManualPerson(
  db: PeopleOsDatabase,
  draft: ManualPersonCaptureDraft,
  defaultPhoneRegion: string,
  hooks: ManualCaptureHooks = {}
): Promise<PreparedManualPersonCapture> {
  return savePreparedManualPersonCapture(db, prepareManualPersonCapture(draft, defaultPhoneRegion), hooks);
}

/**
 * Saves an existing Person's first frequency and its Today/Upcoming anchor in
 * one transaction. This is deliberately narrow: later frequency edits use the
 * normal Person update because their next date is already grounded in stored
 * activity or a pending reminder.
 */
export async function updatePersonWithInitialSchedule(
  db: PeopleOsDatabase,
  command: PersonEditWithInitialScheduleCommand
): Promise<Person> {
  if (command.startDate !== undefined && !isLocalDate(command.startDate)) {
    throw new ValidationError(["Choose Today or Tomorrow."]);
  }
  const cadence = contactCadenceOf(command.draft);
  if (!cadence || !isValidContactCadence(cadence)) {
    throw new ValidationError(["Choose how often you want to contact this person."]);
  }
  const displayName = command.draft.displayName.trim();
  const conversationalName = command.draft.conversationalName?.trim()
    || defaultConversationalName(displayName);
  const tags = command.draft.tags.map((tag) => tag.trim()).filter(Boolean);
  if (!displayName || displayName.length > 120) throw new ValidationError(["Add a name using 120 characters or fewer."]);
  if (!conversationalName || conversationalName.length > 120) throw new ValidationError(["Use 120 characters or fewer for what you call them."]);
  if (tags.length > 10 || tags.some((tag) => tag.length > 40)) throw new ValidationError(["Check this person's tags."]);

  const tx = db.transaction(["people", "interactions", "followUps", "followUpEvents", "metadata"], "readwrite");
  try {
    const people = tx.objectStore("people");
    const current = await people.get(command.personId);
    if (!current || current.archivedAt || current.identityStatus === "merged") {
      throw new RecordConflictError("This person is no longer available.");
    }
    if (current.revision !== command.expectedRevision) throw new StaleRevisionError();
    const [personInteractions, personFollowUps] = await Promise.all([
      tx.objectStore("interactions").index("by-person").getAll(current.id),
      tx.objectStore("followUps").index("by-person").getAll(current.id)
    ]);
    const requiresInitialSchedule = contactCadenceOf(current)
      ? regularContactSetupState(
        { ...current, contactCadence: cadence, contactCadenceDays: undefined },
        personInteractions,
        personFollowUps
      ) === "incomplete"
      : !hasRegularContactInteractionAnchor(current.id, personInteractions);
    if (requiresInitialSchedule && command.startDate === undefined) {
      throw new ValidationError(["Choose Today or Tomorrow to start regular contact."]);
    }
    const updated: Person = {
      ...current,
      revision: current.revision + 1,
      displayName,
      conversationalName,
      relationshipMode: command.draft.relationshipMode ?? "personal",
      importance: command.draft.importance,
      tags,
      contactCadence: cadence,
      updatedAt: command.occurredAt
    };
    delete updated.contactCadenceDays;
    const followUp: FollowUp | undefined = requiresInitialSchedule ? {
      id: command.followUpId,
      revision: 1,
      personId: current.id,
      dueDate: command.startDate!,
      reason: "Keep in touch",
      actionType: "message",
      suggestedByRule: "initial_schedule",
      status: "pending",
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt
    } : undefined;
    const followUpEvent: FollowUpEvent | undefined = followUp ? {
      id: command.followUpEventId,
      followUpId: followUp.id,
      personId: current.id,
      kind: "created",
      occurredAt: command.occurredAt,
      toDate: followUp.dueDate
    } : undefined;
    assertValidRecord("people", updated);
    if (followUp && followUpEvent) {
      assertValidRecord("followUps", followUp);
      assertValidRecord("followUpEvents", followUpEvent);
      if (await tx.objectStore("followUps").get(followUp.id)
        || await tx.objectStore("followUpEvents").get(followUpEvent.id)) {
        throw new RecordConflictError("This first reminder has already been created.");
      }
    }
    await people.put(updated);
    if (followUp && followUpEvent) {
      await tx.objectStore("followUps").add(followUp);
      await tx.objectStore("followUpEvents").add(followUpEvent);
    }
    const metadataStore = tx.objectStore("metadata");
    const metadata = await metadataStore.get("app");
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await metadataStore.put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: command.occurredAt
    });
    await tx.done;
    return updated;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}

/**
 * Removes a Person's visible frequency and cancels only the private reminder
 * generated by the regular-contact loop. User-authored follow-ups are never
 * cancelled by this command.
 */
export async function updatePersonWithoutRegularSchedule(
  db: PeopleOsDatabase,
  command: PersonEditWithoutRegularScheduleCommand
): Promise<Person> {
  if (contactCadenceOf(command.draft)) {
    throw new ValidationError(["Remove the contact frequency before turning off the schedule."]);
  }
  const displayName = command.draft.displayName.trim();
  const conversationalName = command.draft.conversationalName?.trim()
    || defaultConversationalName(displayName);
  const tags = command.draft.tags.map((tag) => tag.trim()).filter(Boolean);
  if (!displayName || displayName.length > 120) throw new ValidationError(["Add a name using 120 characters or fewer."]);
  if (!conversationalName || conversationalName.length > 120) throw new ValidationError(["Use 120 characters or fewer for what you call them."]);
  if (tags.length > 10 || tags.some((tag) => tag.length > 40)) throw new ValidationError(["Check this person's tags."]);
  const cancellationEvent: FollowUpEvent = {
    id: command.cancellationEventId,
    followUpId: command.followUpId,
    personId: command.personId,
    kind: "cancelled",
    occurredAt: command.occurredAt
  };
  assertValidRecord("followUpEvents", cancellationEvent);

  const tx = db.transaction(["people", "followUps", "followUpEvents", "metadata"], "readwrite");
  try {
    const people = tx.objectStore("people");
    const followUps = tx.objectStore("followUps");
    const followUpEvents = tx.objectStore("followUpEvents");
    const [current, currentFollowUp, storedEvent] = await Promise.all([
      people.get(command.personId),
      followUps.get(command.followUpId),
      followUpEvents.get(command.cancellationEventId)
    ]);
    if (!current || current.archivedAt || current.identityStatus === "merged") {
      throw new RecordConflictError("This person is no longer available.");
    }
    if (current.revision !== command.expectedRevision) throw new StaleRevisionError();
    if (!currentFollowUp
      || currentFollowUp.personId !== current.id
      || currentFollowUp.revision !== command.expectedFollowUpRevision
      || currentFollowUp.status !== "pending"
      || !["initial_schedule", "today_already_contacted"].includes(currentFollowUp.suggestedByRule ?? "")
      || currentFollowUp.reachOutEntryId) {
      throw new RecordConflictError("This regular reminder changed before it could be turned off.");
    }
    if (storedEvent) throw new RecordConflictError(`followUpEvents already contains id ${command.cancellationEventId}`);

    const updated: Person = {
      ...current,
      revision: current.revision + 1,
      displayName,
      conversationalName,
      relationshipMode: command.draft.relationshipMode ?? "personal",
      importance: command.draft.importance,
      tags,
      updatedAt: command.occurredAt
    };
    delete updated.contactCadence;
    delete updated.contactCadenceDays;
    const cancelledFollowUp: FollowUp = {
      ...currentFollowUp,
      revision: currentFollowUp.revision + 1,
      status: "cancelled",
      updatedAt: command.occurredAt
    };
    assertValidRecord("people", updated);
    assertValidRecord("followUps", cancelledFollowUp);
    await people.put(updated);
    await followUps.put(cancelledFollowUp);
    await followUpEvents.add(cancellationEvent);
    const metadataStore = tx.objectStore("metadata");
    const metadata = await metadataStore.get("app");
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await metadataStore.put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: command.occurredAt
    });
    await tx.done;
    return updated;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}
