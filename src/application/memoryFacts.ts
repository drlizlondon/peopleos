import type { IDBPObjectStore, IDBPTransaction, StoreNames } from "idb";
import type { MemoryFact, MemoryFactKind, Person } from "../domain/schema";
import { assertValidRecord, ValidationError } from "../domain/validation";
import type { PeopleOsDatabase, PeopleOsDb } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";

export const FACT_KIND_OPTIONS: ReadonlyArray<{ value: MemoryFactKind; label: string }> = [
  { value: "introduced_by", label: "Introduced by" },
  { value: "interest", label: "Interest" },
  { value: "seeking", label: "Seeking" },
  { value: "family", label: "Family" },
  { value: "communication_preference", label: "Communication preference" },
  { value: "location", label: "Location" },
  { value: "other", label: "Other" }
];

export const COMMUNICATION_PREFERENCE_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" }
] as const;

const factKinds = new Set<MemoryFactKind>(FACT_KIND_OPTIONS.map((option) => option.value));
const communicationPreferences = new Set(COMMUNICATION_PREFERENCE_OPTIONS.map((option) => option.value));
const cueDefaultOn = new Set<MemoryFactKind>([
  "introduced_by",
  "interest",
  "seeking",
  "communication_preference",
  "location"
]);
const compactKindRank: Record<MemoryFactKind, number> = {
  communication_preference: 0,
  seeking: 1,
  interest: 2,
  introduced_by: 3,
  location: 4,
  family: 5,
  other: 6
};

export type MemoryFactDraft = {
  id: string;
  personId: string;
  kind: MemoryFactKind;
  value: string;
  showAsMemoryCue: boolean;
  relatedPersonId?: string;
  sourceInteractionId?: string;
  createdAt: string;
};

export type MemoryFactMutationOptions = {
  allowDuplicate?: boolean;
  now?: string;
  beforeCommit?: () => void | Promise<void>;
};

export type MemoryFactLists = {
  active: MemoryFact[];
  archived: MemoryFact[];
};

export type SearchableMemoryFact = {
  id: string;
  personId: string;
  kind: MemoryFactKind;
  label: string;
  value: string;
  normalizedText: string;
};

export class DuplicateMemoryFactError extends Error {
  constructor(public readonly existingFact: MemoryFact) {
    super("This exact active fact is already saved. Save another only when it has a meaningful distinction.");
    this.name = "DuplicateMemoryFactError";
  }
}

export function defaultMemoryCueEligibility(kind: MemoryFactKind): boolean {
  return cueDefaultOn.has(kind);
}

export function memoryFactKindLabel(kind: MemoryFactKind): string {
  return FACT_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

export function memoryFactValueLabel(fact: Pick<MemoryFact, "kind" | "value">): string {
  if (fact.kind !== "communication_preference") return fact.value;
  return COMMUNICATION_PREFERENCE_OPTIONS.find((option) => option.value === fact.value)?.label ?? fact.value;
}

export function createMemoryFactDraft(
  personId: string,
  options: {
    now?: string;
    idFactory?: () => string;
    kind?: MemoryFactKind;
    sourceInteractionId?: string;
  } = {}
): MemoryFactDraft {
  const kind = options.kind ?? "interest";
  return {
    id: `fact-${(options.idFactory ?? (() => crypto.randomUUID()))()}`,
    personId,
    kind,
    value: "",
    showAsMemoryCue: defaultMemoryCueEligibility(kind),
    ...(options.sourceInteractionId ? { sourceInteractionId: options.sourceInteractionId } : {}),
    createdAt: options.now ?? new Date().toISOString()
  };
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function prepareFact(draft: MemoryFactDraft, now: string, current?: MemoryFact): MemoryFact {
  const issues: string[] = [];
  const value = draft.value.trim();
  if (!draft.id.trim()) issues.push("The memory fact draft needs a stable ID.");
  if (!draft.personId.trim()) issues.push("Choose a person.");
  if (!factKinds.has(draft.kind)) issues.push("Choose a supported fact kind.");
  if (!value) issues.push("Add what you want to remember.");
  if (value.length > 240) issues.push("Memory facts must be 240 characters or fewer.");
  if (draft.kind === "communication_preference" && !communicationPreferences.has(value as "whatsapp" | "email" | "phone")) {
    issues.push("Choose WhatsApp, Email or Phone as the communication preference.");
  }
  if (draft.relatedPersonId && draft.kind !== "introduced_by") {
    issues.push("A related person can only be linked to an Introduced by fact.");
  }
  if (draft.relatedPersonId === draft.personId) issues.push("Choose someone other than this person.");
  if (issues.length) throw new ValidationError(issues);

  const fact: MemoryFact = {
    id: current?.id ?? draft.id,
    revision: current ? current.revision + 1 : 1,
    personId: current?.personId ?? draft.personId,
    kind: draft.kind,
    value,
    showAsMemoryCue: draft.showAsMemoryCue,
    ...(draft.kind === "introduced_by" && trimmed(draft.relatedPersonId)
      ? { relatedPersonId: trimmed(draft.relatedPersonId) }
      : {}),
    ...(trimmed(draft.sourceInteractionId) ? { sourceInteractionId: trimmed(draft.sourceInteractionId) } : {}),
    createdAt: current?.createdAt ?? draft.createdAt,
    updatedAt: current ? now : draft.createdAt
  };
  assertValidRecord("memoryFacts", fact);
  return fact;
}

function requireWritablePerson(person: Person | undefined): Person {
  if (!person) throw new RecordConflictError("This person is no longer available.");
  if (person.archivedAt || person.identityStatus === "merged") {
    throw new RecordConflictError("Restore or open the current Person before changing memory facts.");
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
  const metadata = await store.get("app" as never) as { datasetRevision: number; updatedAt: string } | undefined;
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  await store.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now } as never);
}

async function abortAndRethrow(transaction: { abort: () => void; done: Promise<unknown> }, error: unknown): Promise<never> {
  try { transaction.abort(); } catch { /* already completed or aborted */ }
  try { await transaction.done; } catch { /* expected rollback */ }
  throw error;
}

async function validateFactReferences(
  transaction: IDBPTransaction<PeopleOsDb, ["people", "interactions", "memoryFacts", "metadata"], "readwrite">,
  fact: MemoryFact
): Promise<void> {
  const people = transaction.objectStore("people");
  requireWritablePerson(await people.get(fact.personId));
  if (fact.relatedPersonId) {
    const related = await people.get(fact.relatedPersonId);
    if (!related) {
      throw new RecordConflictError("The linked person is no longer available.");
    }
  }
  if (fact.sourceInteractionId) {
    const source = await transaction.objectStore("interactions").get(fact.sourceInteractionId);
    if (!source || source.personId !== fact.personId) {
      throw new RecordConflictError("The source interaction is no longer available.");
    }
  }
}

async function requireNoDuplicate(
  transaction: IDBPTransaction<PeopleOsDb, ["people", "interactions", "memoryFacts", "metadata"], "readwrite">,
  fact: MemoryFact,
  allowDuplicate = false
): Promise<void> {
  if (allowDuplicate) return;
  const sibling = (await transaction.objectStore("memoryFacts").index("by-person").getAll(fact.personId))
    .find((candidate) => candidate.id !== fact.id
      && !candidate.archivedAt
      && candidate.kind === fact.kind
      && candidate.value === fact.value);
  if (sibling) throw new DuplicateMemoryFactError(sibling);
}

export async function createMemoryFact(
  db: PeopleOsDatabase,
  draft: MemoryFactDraft,
  options: MemoryFactMutationOptions = {}
): Promise<MemoryFact> {
  const fact = prepareFact(draft, options.now ?? draft.createdAt);
  const transaction = db.transaction(["people", "interactions", "memoryFacts", "metadata"], "readwrite");
  try {
    const store = transaction.objectStore("memoryFacts");
    const existing = await store.get(fact.id);
    if (existing) {
      if (identical(existing, fact)) {
        await transaction.done;
        return existing;
      }
      throw new RecordConflictError(`memoryFacts already contains id ${fact.id}`);
    }
    await validateFactReferences(transaction, fact);
    await requireNoDuplicate(transaction, fact, options.allowDuplicate);
    await store.add(fact);
    await updateMetadata(transaction.objectStore("metadata"), fact.updatedAt);
    await options.beforeCommit?.();
    await transaction.done;
    return fact;
  } catch (error) {
    return abortAndRethrow(transaction, error);
  }
}

export async function updateMemoryFact(
  db: PeopleOsDatabase,
  draft: MemoryFactDraft,
  expectedRevision: number,
  options: MemoryFactMutationOptions = {}
): Promise<MemoryFact> {
  const now = options.now ?? new Date().toISOString();
  const transaction = db.transaction(["people", "interactions", "memoryFacts", "metadata"], "readwrite");
  try {
    const store = transaction.objectStore("memoryFacts");
    const current = await store.get(draft.id);
    if (!current) throw new RecordConflictError(`memoryFacts does not contain id ${draft.id}`);
    if (current.revision !== expectedRevision) throw new StaleRevisionError();
    if (current.archivedAt) throw new RecordConflictError("Restore this memory fact before editing it.");
    if (draft.personId !== current.personId) throw new RecordConflictError("A memory fact cannot move to another Person.");
    if (draft.sourceInteractionId !== current.sourceInteractionId) {
      throw new RecordConflictError("A memory fact's source interaction cannot be changed.");
    }
    const updated = prepareFact(draft, now, current);
    await validateFactReferences(transaction, updated);
    await requireNoDuplicate(transaction, updated, options.allowDuplicate);
    await store.put(updated);
    await updateMetadata(transaction.objectStore("metadata"), now);
    await options.beforeCommit?.();
    await transaction.done;
    return updated;
  } catch (error) {
    return abortAndRethrow(transaction, error);
  }
}

async function setFactArchived(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  archived: boolean,
  options: MemoryFactMutationOptions = {}
): Promise<MemoryFact> {
  const now = options.now ?? new Date().toISOString();
  const transaction = db.transaction(["people", "memoryFacts", "metadata"], "readwrite");
  try {
    const store = transaction.objectStore("memoryFacts");
    const current = await store.get(id);
    if (!current) throw new RecordConflictError(`memoryFacts does not contain id ${id}`);
    if (current.revision !== expectedRevision) throw new StaleRevisionError();
    if (archived && current.archivedAt) throw new RecordConflictError("This memory fact is already archived.");
    if (!archived && !current.archivedAt) throw new RecordConflictError("This memory fact is not archived.");
    requireWritablePerson(await transaction.objectStore("people").get(current.personId));
    if (!archived && !options.allowDuplicate) {
      const duplicate = (await store.index("by-person").getAll(current.personId)).find((candidate) =>
        candidate.id !== current.id
        && !candidate.archivedAt
        && candidate.kind === current.kind
        && candidate.value === current.value
      );
      if (duplicate) throw new DuplicateMemoryFactError(duplicate);
    }
    const { archivedAt: _archivedAt, ...active } = current;
    const updated: MemoryFact = {
      ...active,
      revision: current.revision + 1,
      updatedAt: now,
      ...(archived ? { archivedAt: now } : {})
    };
    assertValidRecord("memoryFacts", updated);
    await store.put(updated);
    await updateMetadata(transaction.objectStore("metadata"), now);
    await options.beforeCommit?.();
    await transaction.done;
    return updated;
  } catch (error) {
    return abortAndRethrow(transaction, error);
  }
}

export function archiveMemoryFact(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  now = new Date().toISOString(),
  beforeCommit?: () => void | Promise<void>
): Promise<MemoryFact> {
  return setFactArchived(db, id, expectedRevision, true, { now, beforeCommit });
}

export function restoreMemoryFact(
  db: PeopleOsDatabase,
  id: string,
  expectedRevision: number,
  optionsOrNow: MemoryFactMutationOptions | string = {},
  beforeCommit?: () => void | Promise<void>
): Promise<MemoryFact> {
  const options = typeof optionsOrNow === "string"
    ? { now: optionsOrNow, beforeCommit }
    : optionsOrNow;
  return setFactArchived(db, id, expectedRevision, false, options);
}

function descending(left: string, right: string): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function ascending(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function sortMemoryFacts(records: readonly MemoryFact[]): MemoryFact[] {
  return [...records].sort((left, right) =>
    (FACT_KIND_OPTIONS.findIndex((option) => option.value === left.kind)
      - FACT_KIND_OPTIONS.findIndex((option) => option.value === right.kind))
    || descending(left.updatedAt, right.updatedAt)
    || ascending(left.id, right.id)
  );
}

export async function listPersonMemoryFacts(
  db: PeopleOsDatabase,
  personId: string
): Promise<MemoryFactLists> {
  const records = await db.getAllFromIndex("memoryFacts", "by-person", personId);
  return {
    active: sortMemoryFacts(records.filter((fact) => !fact.archivedAt)),
    archived: sortMemoryFacts(records.filter((fact) => Boolean(fact.archivedAt)))
  };
}

export function selectMemoryCueFactCandidates(records: readonly MemoryFact[]): MemoryFact[] {
  return [...records]
    .filter((fact) => !fact.archivedAt && fact.showAsMemoryCue)
    .sort((left, right) => compactKindRank[left.kind] - compactKindRank[right.kind]
      || descending(left.updatedAt, right.updatedAt)
      || ascending(left.id, right.id));
}

export function selectCompactProfileFacts(
  records: readonly MemoryFact[],
  options: { excludeFactId?: string; limit?: number } = {}
): MemoryFact[] {
  return [...records]
    .filter((fact) => !fact.archivedAt
      && fact.id !== options.excludeFactId
      && (!["family", "other"].includes(fact.kind) || fact.showAsMemoryCue))
    .sort((left, right) => compactKindRank[left.kind] - compactKindRank[right.kind]
      || descending(left.updatedAt, right.updatedAt)
      || ascending(left.id, right.id))
    .slice(0, options.limit ?? 3);
}

export function normalizeMemorySearchText(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

export function projectSearchableMemoryFacts(records: readonly MemoryFact[]): SearchableMemoryFact[] {
  return sortMemoryFacts(records.filter((fact) => !fact.archivedAt)).map((fact) => ({
    id: fact.id,
    personId: fact.personId,
    kind: fact.kind,
    label: memoryFactKindLabel(fact.kind),
    value: memoryFactValueLabel(fact),
    normalizedText: normalizeMemorySearchText(`${memoryFactKindLabel(fact.kind)} ${memoryFactValueLabel(fact)}`)
  }));
}
