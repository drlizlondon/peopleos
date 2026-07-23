import type { IDBPObjectStore, StoreNames } from "idb";
import type { ContactMethod, Person } from "../domain/schema";
import { assertValidRecord } from "../domain/validation";
import type { PeopleOsDatabase, PeopleOsDb } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import { normalizeContactValue } from "../integrations/contactValues";
import { detectDuplicatePeople } from "../domain/duplicates";
import { requireReviewedDuplicateMatches } from "./duplicateReview";

export type ContactMethodDraft = {
  id: string;
  personId: string;
  kind: "phone" | "email";
  value: string;
  label?: string;
  region?: string;
  createdAt: string;
};

export type ContactMethodMutationHooks = {
  beforeCommit?: () => void | Promise<void>;
  enforceDuplicateReview?: boolean;
  acknowledgedDuplicatePersonIds?: readonly string[];
};

export type ContactMethodDraftOptions = {
  now?: string;
  idFactory?: () => string;
};

export function createContactMethodDraft(
  personId: string,
  kind: "phone" | "email" = "phone",
  options: ContactMethodDraftOptions = {}
): ContactMethodDraft {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  return {
    id: `contact-${idFactory()}`,
    personId,
    kind,
    value: "",
    createdAt: options.now ?? new Date().toISOString()
  };
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function prepareNewContactMethod(
  draft: ContactMethodDraft,
  defaultPhoneRegion: string,
  isPreferred: boolean
): ContactMethod {
  const normalized = normalizeContactValue(draft.kind, draft.value, draft.region ?? defaultPhoneRegion);
  const record = {
    id: draft.id,
    revision: 1,
    personId: draft.personId,
    kind: draft.kind,
    ...(optionalTrimmed(draft.label) ? { label: optionalTrimmed(draft.label) } : {}),
    rawValue: normalized.rawValue,
    canonicalValue: normalized.canonicalValue,
    ...(draft.kind === "phone" && normalized.region ? { region: normalized.region } : {}),
    isPreferred,
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt
  } as ContactMethod;
  assertValidRecord("contactMethods", record);
  return record;
}

function semanticMatch(existing: ContactMethod, candidate: ContactMethod): boolean {
  return existing.id === candidate.id
    && existing.revision === candidate.revision
    && existing.personId === candidate.personId
    && existing.kind === candidate.kind
    && existing.rawValue === candidate.rawValue
    && existing.canonicalValue === candidate.canonicalValue
    && existing.isPreferred === candidate.isPreferred
    && existing.label === candidate.label
    && existing.createdAt === candidate.createdAt
    && existing.updatedAt === candidate.updatedAt
    && existing.archivedAt === candidate.archivedAt
    && (existing.kind !== "phone" || candidate.kind !== "phone" || existing.region === candidate.region);
}

async function requireWritablePerson(
  person: Person | undefined,
  personId: string
): Promise<Person> {
  if (!person) throw new RecordConflictError(`people does not contain id ${personId}`);
  if (person.archivedAt || person.identityStatus === "merged") {
    throw new RecordConflictError("Restore or open the current Person before changing contact details.");
  }
  return person;
}

async function requireReviewedContactDuplicate(
  peopleStore: IDBPObjectStore<PeopleOsDb, StoreNames<PeopleOsDb>[], "people", "readwrite">,
  contactStore: IDBPObjectStore<PeopleOsDb, StoreNames<PeopleOsDb>[], "contactMethods", "readwrite">,
  person: Person,
  candidate: ContactMethod,
  hooks: ContactMethodMutationHooks
): Promise<void> {
  if (!hooks.enforceDuplicateReview) return;
  const [people, contactMethods] = await Promise.all([peopleStore.getAll(), contactStore.getAll()]);
  requireReviewedDuplicateMatches(detectDuplicatePeople({
    candidate: { person, contactMethods: [candidate] },
    people,
    contactMethods,
    affiliations: [],
    interactions: []
  }), hooks.acknowledgedDuplicatePersonIds ?? []);
}

export async function addContactMethod(
  db: PeopleOsDatabase,
  draft: ContactMethodDraft,
  defaultPhoneRegion: string,
  hooks: ContactMethodMutationHooks = {}
): Promise<ContactMethod> {
  const tx = db.transaction(["people", "contactMethods", "metadata"], "readwrite");
  try {
    const people = tx.objectStore("people");
    const person = await requireWritablePerson(await people.get(draft.personId), draft.personId);
    const store = tx.objectStore("contactMethods");
    const siblings = await store.index("by-person").getAll(draft.personId);
    const isPreferred = !siblings.some((contact) =>
      contact.id !== draft.id && !contact.archivedAt && contact.kind === draft.kind && contact.isPreferred
    );
    const record = prepareNewContactMethod(draft, defaultPhoneRegion, isPreferred);
    const existing = await store.get(draft.id);
    if (existing) {
      if (semanticMatch(existing, record)) {
        await tx.done;
        return existing;
      }
      throw new RecordConflictError(`contactMethods already contains id ${draft.id}`);
    }
    await requireReviewedContactDuplicate(people, store, person, record, hooks);
    await store.add(record);
    await updateMetadata(tx.objectStore("metadata"), draft.createdAt);
    await hooks.beforeCommit?.();
    await tx.done;
    return record;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}

export type EditContactMethodInput = {
  id: string;
  expectedRevision: number;
  kind: "phone" | "email";
  value: string;
  label?: string;
  region?: string;
};

export async function editContactMethod(
  db: PeopleOsDatabase,
  input: EditContactMethodInput,
  defaultPhoneRegion: string,
  now = new Date().toISOString(),
  hooks: ContactMethodMutationHooks = {}
): Promise<ContactMethod> {
  const normalized = normalizeContactValue(input.kind, input.value, input.region ?? defaultPhoneRegion);
  const tx = db.transaction(["people", "contactMethods", "metadata"], "readwrite");
  try {
    const store = tx.objectStore("contactMethods");
    const current = await store.get(input.id);
    if (!current) throw new RecordConflictError(`contactMethods does not contain id ${input.id}`);
    const people = tx.objectStore("people");
    const person = await requireWritablePerson(await people.get(current.personId), current.personId);
    if (current.revision !== input.expectedRevision) throw new StaleRevisionError();
    if (current.archivedAt) throw new RecordConflictError("Restore this contact method before editing it.");

    let isPreferred = current.isPreferred;
    if (current.kind !== input.kind) {
      const siblings = await store.index("by-person").getAll(current.personId);
      isPreferred = !siblings.some((contact) =>
        contact.id !== current.id && !contact.archivedAt && contact.kind === input.kind && contact.isPreferred
      );
    }
    const updated = {
      id: current.id,
      revision: current.revision + 1,
      personId: current.personId,
      kind: input.kind,
      ...(optionalTrimmed(input.label) ? { label: optionalTrimmed(input.label) } : {}),
      rawValue: normalized.rawValue,
      canonicalValue: normalized.canonicalValue,
      ...(input.kind === "phone" && normalized.region ? { region: normalized.region } : {}),
      isPreferred,
      createdAt: current.createdAt,
      updatedAt: now
    } as ContactMethod;
    assertValidRecord("contactMethods", updated);
    await requireReviewedContactDuplicate(people, store, person, updated, hooks);
    await store.put(updated);
    await updateMetadata(tx.objectStore("metadata"), now);
    await hooks.beforeCommit?.();
    await tx.done;
    return updated;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}

export async function setPreferredContactMethod(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  now = new Date().toISOString(),
  hooks: ContactMethodMutationHooks = {}
): Promise<ContactMethod> {
  const tx = db.transaction(["people", "contactMethods", "metadata"], "readwrite");
  try {
    const store = tx.objectStore("contactMethods");
    const target = await store.get(id);
    if (!target) throw new RecordConflictError(`contactMethods does not contain id ${id}`);
    await requireWritablePerson(await tx.objectStore("people").get(target.personId), target.personId);
    if (target.revision !== expectedRevision) throw new StaleRevisionError();
    if (target.archivedAt) throw new RecordConflictError("Restore this contact method before making it preferred.");
    if (target.isPreferred) {
      await tx.done;
      return target;
    }

    const siblings = await store.index("by-person").getAll(target.personId);
    for (const sibling of siblings) {
      if (sibling.id !== target.id && !sibling.archivedAt && sibling.kind === target.kind && sibling.isPreferred) {
        await store.put({ ...sibling, revision: sibling.revision + 1, isPreferred: false, updatedAt: now });
      }
    }
    const updated = { ...target, revision: target.revision + 1, isPreferred: true, updatedAt: now };
    assertValidRecord("contactMethods", updated);
    await store.put(updated);
    await updateMetadata(tx.objectStore("metadata"), now);
    await hooks.beforeCommit?.();
    await tx.done;
    return updated;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}

export async function archiveContactMethod(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  now = new Date().toISOString(),
  hooks: ContactMethodMutationHooks = {}
): Promise<ContactMethod> {
  const tx = db.transaction(["people", "contactMethods", "metadata"], "readwrite");
  try {
    const store = tx.objectStore("contactMethods");
    const current = await store.get(id);
    if (!current) throw new RecordConflictError(`contactMethods does not contain id ${id}`);
    await requireWritablePerson(await tx.objectStore("people").get(current.personId), current.personId);
    if (current.revision !== expectedRevision) throw new StaleRevisionError();
    if (current.archivedAt) throw new RecordConflictError("This contact method is already archived.");
    const archived = {
      ...current,
      revision: current.revision + 1,
      isPreferred: false,
      archivedAt: now,
      updatedAt: now
    };
    assertValidRecord("contactMethods", archived);
    await store.put(archived);
    await updateMetadata(tx.objectStore("metadata"), now);
    await hooks.beforeCommit?.();
    await tx.done;
    return archived;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}

export async function restoreContactMethod(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  restorePreferred = false,
  now = new Date().toISOString(),
  hooks: ContactMethodMutationHooks = {}
): Promise<ContactMethod> {
  const tx = db.transaction(["people", "contactMethods", "metadata"], "readwrite");
  try {
    const store = tx.objectStore("contactMethods");
    const current = await store.get(id);
    if (!current) throw new RecordConflictError(`contactMethods does not contain id ${id}`);
    await requireWritablePerson(await tx.objectStore("people").get(current.personId), current.personId);
    if (current.revision !== expectedRevision) throw new StaleRevisionError();
    if (!current.archivedAt) throw new RecordConflictError("This contact method is not archived.");
    const siblings = await store.index("by-person").getAll(current.personId);
    const alreadyPreferred = siblings.some((contact) =>
      contact.id !== current.id && !contact.archivedAt && contact.kind === current.kind && contact.isPreferred
    );
    const { archivedAt: _archivedAt, ...active } = current;
    const restored = {
      ...active,
      revision: current.revision + 1,
      isPreferred: restorePreferred && !alreadyPreferred,
      updatedAt: now
    } as ContactMethod;
    assertValidRecord("contactMethods", restored);
    await store.put(restored);
    await updateMetadata(tx.objectStore("metadata"), now);
    await hooks.beforeCommit?.();
    await tx.done;
    return restored;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}

export async function listContactMethodsForPerson(
  db: PeopleOsDatabase,
  personId: string,
  includeArchived = false
): Promise<ContactMethod[]> {
  const records = await db.getAllFromIndex("contactMethods", "by-person", personId);
  return records
    .filter((record) => includeArchived || !record.archivedAt)
    .sort(compareContactMethods);
}

function compareContactMethods(left: ContactMethod, right: ContactMethod): number {
  const leftArchived = left.archivedAt ? 1 : 0;
  const rightArchived = right.archivedAt ? 1 : 0;
  if (leftArchived !== rightArchived) return leftArchived - rightArchived;
  if (left.isPreferred !== right.isPreferred) return left.isPreferred ? -1 : 1;
  if (left.kind !== right.kind) return left.kind === "phone" ? -1 : 1;
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

async function updateMetadata<Names extends ArrayLike<StoreNames<PeopleOsDb>>>(
  store: IDBPObjectStore<PeopleOsDb, Names, "metadata", "readwrite">,
  now: string
): Promise<void> {
  const metadata = await store.get("app");
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  await store.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now });
}
