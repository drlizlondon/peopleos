import type {
  ContactMethod,
  Interaction,
  OrganisationAffiliation,
  Person
} from "../domain/schema";
import { assertValidRecord, ValidationError } from "../domain/validation";
import { RecordConflictError } from "../data/repositories";
import type { PeopleOsDatabase } from "../data/database";
import { normalizeContactValue } from "../integrations/contactValues";

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
  createdAt: string;
  displayName: string;
  identityStatus: "confirmed" | "provisional";
  importance: "normal" | "high";
  tags: string[];
  contactCadenceDays?: number;
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
};

export type ManualCaptureHooks = {
  beforeCommit?: () => void | Promise<void>;
};

export type DraftFactoryOptions = {
  now?: string;
  idFactory?: () => string;
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
    createdAt: options.now ?? new Date().toISOString(),
    displayName: "",
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
  if (!displayName) {
    issues.push(draft.identityStatus === "provisional"
      ? "Add a temporary description so you can recognise this person later."
      : "Add a name so you can recognise this person later.");
  }
  if (displayName.length > 120) issues.push("Name or temporary description must be 120 characters or fewer.");
  if (draft.tags.length > 10) issues.push("Add no more than 10 tags.");
  if (draft.tags.some((tag) => tag.trim().length > 40)) issues.push("Each tag must be 40 characters or fewer.");
  if (draft.contactCadenceDays !== undefined
    && (!Number.isInteger(draft.contactCadenceDays) || draft.contactCadenceDays < 1 || draft.contactCadenceDays > 3650)) {
    issues.push("Contact cadence must be between 1 and 3650 days.");
  }
  if (optionalTrimmed(draft.role) && !optionalTrimmed(draft.organisationName)) {
    issues.push("Add an organisation before adding a role.");
  }
  draft.contactMethods.forEach((contact) => {
    if (!contact.value.trim() && optionalTrimmed(contact.label)) {
      issues.push(`Enter a ${contact.kind === "phone" ? "phone number" : "email address"} or remove its labelled row.`);
    }
  });
  const ids = [draft.personId, draft.affiliationId, draft.metInteractionId, ...draft.contactMethods.map((contact) => contact.id)];
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
  const person: Person = {
    id: draft.personId,
    revision: 1,
    displayName: draft.displayName.trim(),
    identityStatus: draft.identityStatus,
    importance: draft.importance,
    tags,
    ...(draft.contactCadenceDays === undefined ? {} : { contactCadenceDays: draft.contactCadenceDays }),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const preferredKinds = new Set<"phone" | "email">();
  const contactMethods = draft.contactMethods.flatMap((contact): ContactMethod[] => {
    if (!contact.value.trim()) return [];
    const normalized = normalizeContactValue(contact.kind, contact.value, contact.region ?? defaultPhoneRegion);
    const isPreferred = !preferredKinds.has(contact.kind);
    preferredKinds.add(contact.kind);
    const base = {
      id: contact.id,
      revision: 1,
      personId: person.id,
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

  assertValidRecord("people", person);
  contactMethods.forEach((record) => assertValidRecord("contactMethods", record));
  if (affiliation) assertValidRecord("affiliations", affiliation);
  if (metInteraction) assertValidRecord("interactions", metInteraction);
  return { person, contactMethods, affiliation, metInteraction };
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
    ...(capture.metInteraction ? [["interactions", capture.metInteraction] as const] : [])
  ] as const;

  const tx = db.transaction(["people", "contactMethods", "affiliations", "interactions", "metadata"], "readwrite");
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
