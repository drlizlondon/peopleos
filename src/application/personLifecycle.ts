import type { PeopleOsDatabase } from "../data/database";
import {
  RecordConflictError,
  StaleRevisionError,
  createRepositories
} from "../data/repositories";
import type { Person } from "../domain/schema";
import type { RelationshipMode } from "../domain/relationshipMode";
import { ValidationError } from "../domain/validation";

export type PersonEditDraft = {
  displayName: string;
  relationshipMode?: RelationshipMode;
  importance: Person["importance"];
  tags: string[];
  contactCadenceDays?: number;
  contactCadenceFirstDueDate?: string;
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
  if (draft.contactCadenceDays !== undefined
    && (!Number.isInteger(draft.contactCadenceDays)
      || draft.contactCadenceDays < 1
      || draft.contactCadenceDays > 3_650)) {
    issues.push("Choose a whole number from 1 to 3650 days.");
  }
  if (issues.length) throw new ValidationError(issues);
  return {
    displayName,
    relationshipMode: draft.relationshipMode ?? "personal",
    importance: draft.importance,
    tags,
    ...(draft.contactCadenceDays === undefined ? {} : {
      contactCadenceDays: draft.contactCadenceDays,
      ...(draft.contactCadenceFirstDueDate ? { contactCadenceFirstDueDate: draft.contactCadenceFirstDueDate } : {})
    })
  };
}

function sameEditableValues(person: Person, draft: PersonEditDraft): boolean {
  return person.displayName === draft.displayName
    && (person.relationshipMode ?? "personal") === (draft.relationshipMode ?? "personal")
    && person.importance === draft.importance
    && JSON.stringify(person.tags) === JSON.stringify(draft.tags)
    && person.contactCadenceDays === draft.contactCadenceDays
    && (draft.contactCadenceDays === undefined || person.contactCadenceFirstDueDate === draft.contactCadenceFirstDueDate);
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
  const current = requireEditable(await db.get("people", command.personId));
  if (current.revision !== command.expectedRevision) {
    if (current.revision === command.expectedRevision + 1
      && current.updatedAt === command.occurredAt
      && sameEditableValues(current, draft)) return current;
    throw new StaleRevisionError();
  }
  if (sameEditableValues(current, draft)) return current;
  const updated: Person = { ...current, ...draft };
  if (draft.contactCadenceDays === undefined) {
    delete updated.contactCadenceDays;
    delete updated.contactCadenceFirstDueDate;
    delete updated.contactCadenceDeferredUntilDate;
    delete updated.contactCadencePausedAt;
  } else if (draft.contactCadenceFirstDueDate) {
    updated.contactCadenceFirstDueDate = draft.contactCadenceFirstDueDate;
    delete updated.contactCadenceDeferredUntilDate;
    delete updated.contactCadencePausedAt;
  } else if (draft.contactCadenceDays !== current.contactCadenceDays) {
    const next = new Date(command.occurredAt);
    next.setUTCDate(next.getUTCDate() + draft.contactCadenceDays);
    updated.contactCadenceFirstDueDate = next.toISOString().slice(0, 10);
    delete updated.contactCadenceDeferredUntilDate;
    delete updated.contactCadencePausedAt;
  }
  return createRepositories(db).people.update(updated, command.expectedRevision, command.occurredAt);
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
