import type { IDBPObjectStore, StoreNames } from "idb";
import type { PeopleOsDatabase, PeopleOsDb } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import type { OrganisationAffiliation, Person } from "../domain/schema";
import { assertValidRecord, isLocalDate, ValidationError } from "../domain/validation";
import { normalizeMemorySearchText } from "./memoryFacts";

export type AffiliationDraft = {
  id: string;
  personId: string;
  organisationName: string;
  role?: string;
  startedOn?: string;
  endedOn?: string;
  isCurrent: boolean;
  createdAt: string;
};

export type AffiliationMutationOptions = {
  now?: string;
  beforeCommit?: () => void | Promise<void>;
};

export type PersonAffiliations = {
  current: OrganisationAffiliation[];
  past: OrganisationAffiliation[];
  archived: OrganisationAffiliation[];
};

export type SearchableAffiliation = {
  id: string;
  personId: string;
  organisationName: string;
  role?: string;
  isCurrent: boolean;
  normalizedText: string;
};

export function createAffiliationDraft(
  personId: string,
  options: { now?: string; idFactory?: () => string } = {}
): AffiliationDraft {
  return {
    id: `affiliation-${(options.idFactory ?? (() => crypto.randomUUID()))()}`,
    personId,
    organisationName: "",
    isCurrent: true,
    createdAt: options.now ?? new Date().toISOString()
  };
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function prepareAffiliation(
  draft: AffiliationDraft,
  now: string,
  current?: OrganisationAffiliation
): OrganisationAffiliation {
  const issues: string[] = [];
  const organisationName = draft.organisationName.trim();
  const role = trimmed(draft.role);
  const startedOn = trimmed(draft.startedOn);
  const endedOn = draft.isCurrent ? undefined : trimmed(draft.endedOn);
  if (!draft.id.trim()) issues.push("The affiliation draft needs a stable ID.");
  if (!draft.personId.trim()) issues.push("Choose a person.");
  if (!organisationName) issues.push("Add an organisation.");
  if (startedOn && !isLocalDate(startedOn)) issues.push("Choose a valid start date.");
  if (endedOn && !isLocalDate(endedOn)) issues.push("Choose a valid end date.");
  if (startedOn && endedOn && startedOn > endedOn) issues.push("Start date cannot be after end date.");
  if (issues.length) throw new ValidationError(issues);

  const affiliation: OrganisationAffiliation = {
    id: current?.id ?? draft.id,
    revision: current ? current.revision + 1 : 1,
    personId: current?.personId ?? draft.personId,
    organisationName,
    ...(role ? { role } : {}),
    ...(startedOn ? { startedOn } : {}),
    ...(endedOn ? { endedOn } : {}),
    isCurrent: draft.isCurrent,
    createdAt: current?.createdAt ?? draft.createdAt,
    updatedAt: current ? now : draft.createdAt
  };
  assertValidRecord("affiliations", affiliation);
  return affiliation;
}

function requireWritablePerson(person: Person | undefined): Person {
  if (!person) throw new RecordConflictError("This person is no longer available.");
  if (person.archivedAt || person.identityStatus === "merged") {
    throw new RecordConflictError("Restore or open the current Person before changing affiliations.");
  }
  return person;
}

function identical(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function updateMetadata<Names extends ArrayLike<StoreNames<PeopleOsDb>>>(
  store: IDBPObjectStore<PeopleOsDb, Names, "metadata", "readwrite">,
  now: string
): Promise<void> {
  const metadata = await store.get("app");
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  await store.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now });
}

async function abortAndRethrow(transaction: { abort: () => void; done: Promise<unknown> }, error: unknown): Promise<never> {
  try { transaction.abort(); } catch { /* already completed or aborted */ }
  try { await transaction.done; } catch { /* expected rollback */ }
  throw error;
}

export async function createAffiliation(
  db: PeopleOsDatabase,
  draft: AffiliationDraft,
  options: AffiliationMutationOptions = {}
): Promise<OrganisationAffiliation> {
  const affiliation = prepareAffiliation(draft, options.now ?? draft.createdAt);
  const transaction = db.transaction(["people", "affiliations", "metadata"], "readwrite");
  try {
    requireWritablePerson(await transaction.objectStore("people").get(affiliation.personId));
    const store = transaction.objectStore("affiliations");
    const existing = await store.get(affiliation.id);
    if (existing) {
      if (identical(existing, affiliation)) {
        await transaction.done;
        return existing;
      }
      throw new RecordConflictError(`affiliations already contains id ${affiliation.id}`);
    }
    await store.add(affiliation);
    await updateMetadata(transaction.objectStore("metadata"), affiliation.updatedAt);
    await options.beforeCommit?.();
    await transaction.done;
    return affiliation;
  } catch (error) {
    return abortAndRethrow(transaction, error);
  }
}

export async function updateAffiliation(
  db: PeopleOsDatabase,
  draft: AffiliationDraft,
  expectedRevision: number,
  options: AffiliationMutationOptions = {}
): Promise<OrganisationAffiliation> {
  const now = options.now ?? new Date().toISOString();
  const transaction = db.transaction(["people", "affiliations", "metadata"], "readwrite");
  try {
    const store = transaction.objectStore("affiliations");
    const current = await store.get(draft.id);
    if (!current) throw new RecordConflictError(`affiliations does not contain id ${draft.id}`);
    if (current.revision !== expectedRevision) throw new StaleRevisionError();
    if (current.archivedAt) throw new RecordConflictError("Restore this affiliation before editing it.");
    if (draft.personId !== current.personId) throw new RecordConflictError("An affiliation cannot move to another Person.");
    requireWritablePerson(await transaction.objectStore("people").get(current.personId));
    const updated = prepareAffiliation(draft, now, current);
    await store.put(updated);
    await updateMetadata(transaction.objectStore("metadata"), now);
    await options.beforeCommit?.();
    await transaction.done;
    return updated;
  } catch (error) {
    return abortAndRethrow(transaction, error);
  }
}

async function setAffiliationArchived(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  archived: boolean,
  options: AffiliationMutationOptions = {}
): Promise<OrganisationAffiliation> {
  const now = options.now ?? new Date().toISOString();
  const transaction = db.transaction(["people", "affiliations", "metadata"], "readwrite");
  try {
    const store = transaction.objectStore("affiliations");
    const current = await store.get(id);
    if (!current) throw new RecordConflictError(`affiliations does not contain id ${id}`);
    if (current.revision !== expectedRevision) throw new StaleRevisionError();
    if (archived && current.archivedAt) throw new RecordConflictError("This affiliation is already archived.");
    if (!archived && !current.archivedAt) throw new RecordConflictError("This affiliation is not archived.");
    requireWritablePerson(await transaction.objectStore("people").get(current.personId));
    const { archivedAt: _archivedAt, ...active } = current;
    const updated: OrganisationAffiliation = {
      ...active,
      revision: current.revision + 1,
      updatedAt: now,
      ...(archived ? { archivedAt: now } : {})
    };
    assertValidRecord("affiliations", updated);
    await store.put(updated);
    await updateMetadata(transaction.objectStore("metadata"), now);
    await options.beforeCommit?.();
    await transaction.done;
    return updated;
  } catch (error) {
    return abortAndRethrow(transaction, error);
  }
}

export function archiveAffiliation(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  now = new Date().toISOString(),
  beforeCommit?: () => void | Promise<void>
): Promise<OrganisationAffiliation> {
  return setAffiliationArchived(db, id, expectedRevision, true, { now, beforeCommit });
}

export function restoreAffiliation(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  now = new Date().toISOString(),
  beforeCommit?: () => void | Promise<void>
): Promise<OrganisationAffiliation> {
  return setAffiliationArchived(db, id, expectedRevision, false, { now, beforeCommit });
}

function descending(left: string, right: string): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function ascending(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function sortCurrentAffiliations(records: readonly OrganisationAffiliation[]): OrganisationAffiliation[] {
  return [...records]
    .filter((record) => !record.archivedAt && record.isCurrent)
    .sort((left, right) => descending(left.startedOn ?? "", right.startedOn ?? "")
      || descending(left.createdAt, right.createdAt)
      || ascending(left.id, right.id));
}

export function sortPastAffiliations(records: readonly OrganisationAffiliation[]): OrganisationAffiliation[] {
  return [...records]
    .filter((record) => !record.archivedAt && !record.isCurrent)
    .sort((left, right) => descending(left.endedOn ?? "", right.endedOn ?? "")
      || descending(left.startedOn ?? "", right.startedOn ?? "")
      || descending(left.createdAt, right.createdAt)
      || ascending(left.id, right.id));
}

export function selectDisplayAffiliation(
  records: readonly OrganisationAffiliation[]
): OrganisationAffiliation | undefined {
  return sortCurrentAffiliations(records)[0];
}

export async function listPersonAffiliations(
  db: PeopleOsDatabase,
  personId: string
): Promise<PersonAffiliations> {
  const records = await db.getAllFromIndex("affiliations", "by-person", personId);
  return {
    current: sortCurrentAffiliations(records),
    past: sortPastAffiliations(records),
    archived: [...records]
      .filter((record) => Boolean(record.archivedAt))
      .sort((left, right) => descending(left.updatedAt, right.updatedAt) || ascending(left.id, right.id))
  };
}

export function projectSearchableAffiliations(
  records: readonly OrganisationAffiliation[]
): SearchableAffiliation[] {
  return [...sortCurrentAffiliations(records), ...sortPastAffiliations(records)].map((record) => ({
    id: record.id,
    personId: record.personId,
    organisationName: record.organisationName,
    ...(record.role ? { role: record.role } : {}),
    isCurrent: record.isCurrent,
    normalizedText: normalizeMemorySearchText(`${record.organisationName} ${record.role ?? ""}`)
  }));
}
