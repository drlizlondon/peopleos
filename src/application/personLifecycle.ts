import type { PeopleOsDatabase } from "../data/database";
import {
  RecordConflictError,
  StaleRevisionError,
  createRepositories
} from "../data/repositories";
import {
  contactCadenceOf,
  contactCadencesEqual,
  isValidContactCadence
} from "../domain/cadence";
import type { ContactCadence, Person } from "../domain/schema";
import {
  hasRegularContactInteractionAnchor,
  regularContactSetupState
} from "../domain/regularContactSchedule";
import type { RelationshipMode } from "../domain/relationshipMode";
import { assertValidRecord, ValidationError } from "../domain/validation";

export type PersonEditDraft = {
  displayName: string;
  relationshipMode?: RelationshipMode;
  importance: Person["importance"];
  tags: string[];
  contactCadence?: ContactCadence;
  /** @deprecated Temporary command compatibility; updates always write structured cadence. */
  contactCadenceDays?: number;
};

export type PersonUpdateCommand = {
  personId: string;
  expectedRevision: number;
  draft: PersonEditDraft;
  occurredAt: string;
};

export type PersonArchiveCommand = {
  personId: string;
  expectedRevision: number;
  occurredAt: string;
};

function normalizeDraft(draft: PersonEditDraft): PersonEditDraft {
  const displayName = draft.displayName.trim();
  const tags = draft.tags.map((tag) => tag.trim()).filter(Boolean);
  const issues: string[] = [];
  if (!displayName) issues.push("Add a name or description so you can recognise this person.");
  if (displayName.length > 120) issues.push("Use 120 characters or fewer for the name or description.");
  if (!(["normal", "high"] as const).includes(draft.importance)) issues.push("Choose a supported importance level.");
  if (draft.relationshipMode !== undefined && !(["personal", "professional", "both"] as const).includes(draft.relationshipMode)) issues.push("Choose a supported relationship type.");
  if (tags.length > 10) issues.push("Add no more than 10 tags.");
  if (tags.some((tag) => tag.length > 40)) issues.push("Each tag must be 40 characters or fewer.");
  if (draft.contactCadence !== undefined && !isValidContactCadence(draft.contactCadence)) {
    issues.push("Contact cadence must be a positive whole number no more than 3,650 days apart.");
  }
  if (draft.contactCadenceDays !== undefined
    && !isValidContactCadence({ value: draft.contactCadenceDays, unit: "days" })) {
    issues.push("Contact cadence must be a whole number from 1 to 3650 days.");
  }
  if (issues.length) throw new ValidationError(issues);
  const contactCadence = contactCadenceOf(draft);
  return {
    displayName,
    relationshipMode: draft.relationshipMode ?? "personal",
    importance: draft.importance,
    tags,
    ...(contactCadence === undefined ? {} : { contactCadence })
  };
}

function sameEditableValues(person: Person, draft: PersonEditDraft): boolean {
  return person.displayName === draft.displayName
    && (person.relationshipMode ?? "personal") === (draft.relationshipMode ?? "personal")
    && person.importance === draft.importance
    && JSON.stringify(person.tags) === JSON.stringify(draft.tags)
    && contactCadencesEqual(contactCadenceOf(person), contactCadenceOf(draft));
}

function requireEditable(person: Person | undefined): Person {
  if (!person) throw new RecordConflictError("This person is no longer available.");
  if (person.archivedAt) throw new RecordConflictError("Restore this person before editing them.");
  if (person.identityStatus === "merged") throw new RecordConflictError("Open the surviving Person before editing.");
  return person;
}

export async function updatePerson(
  db: PeopleOsDatabase,
  command: PersonUpdateCommand
): Promise<Person> {
  const draft = normalizeDraft(command.draft);
  const tx = db.transaction(["people", "interactions", "followUps", "metadata"], "readwrite");
  try {
    const people = tx.objectStore("people");
    const current = requireEditable(await people.get(command.personId));
    if (current.revision !== command.expectedRevision) {
      if (current.revision === command.expectedRevision + 1
        && current.updatedAt === command.occurredAt
        && current.contactCadenceDays === undefined
        && sameEditableValues(current, draft)) {
        await tx.done;
        return current;
      }
      throw new StaleRevisionError();
    }
    if (current.contactCadenceDays === undefined && sameEditableValues(current, draft)) {
      await tx.done;
      return current;
    }
    const updated: Person = {
      ...current,
      ...draft,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: command.occurredAt
    };
    delete updated.contactCadenceDays;
    if (draft.contactCadence === undefined) delete updated.contactCadence;
    const [interactions, followUps] = await Promise.all([
      tx.objectStore("interactions").index("by-person").getAll(current.id),
      tx.objectStore("followUps").index("by-person").getAll(current.id)
    ]);
    const enablingRegularContact = !contactCadenceOf(current) && Boolean(contactCadenceOf(updated));
    if ((enablingRegularContact && !hasRegularContactInteractionAnchor(current.id, interactions))
      || regularContactSetupState(updated, interactions, followUps) === "incomplete") {
      throw new ValidationError(["Choose Today or Tomorrow to start regular contact."]);
    }
    assertValidRecord("people", updated);
    await people.put(updated);
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

export async function archivePerson(
  db: PeopleOsDatabase,
  command: PersonArchiveCommand
): Promise<Person> {
  const current = await db.get("people", command.personId);
  if (!current) throw new RecordConflictError("This person is no longer available.");
  if (current.identityStatus === "merged") throw new RecordConflictError("The merged Person is already read-only.");
  if (current.revision !== command.expectedRevision) {
    if (current.revision === command.expectedRevision + 1
      && current.archivedAt === command.occurredAt) return current;
    throw new StaleRevisionError();
  }
  if (current.archivedAt) return current;
  return createRepositories(db).people.archive(
    current.id,
    command.expectedRevision,
    command.occurredAt
  );
}

export async function restorePerson(
  db: PeopleOsDatabase,
  command: PersonArchiveCommand
): Promise<Person> {
  const current = await db.get("people", command.personId);
  if (!current) throw new RecordConflictError("This person is no longer available.");
  if (current.identityStatus === "merged") throw new RecordConflictError("The merged Person cannot be restored.");
  if (current.revision !== command.expectedRevision) {
    if (current.revision === command.expectedRevision + 1
      && !current.archivedAt
      && current.updatedAt === command.occurredAt) return current;
    throw new StaleRevisionError();
  }
  if (!current.archivedAt) return current;
  return createRepositories(db).people.restore(
    current.id,
    command.expectedRevision,
    command.occurredAt
  );
}
