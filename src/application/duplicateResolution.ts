import type {
  ContactMethod,
  OrganisationAffiliation,
  Person
} from "../domain/schema";
import { assertValidRecord, ValidationError } from "../domain/validation";
import type { PeopleOsDatabase } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import type { PreparedManualPersonCapture } from "./manualPersonCapture";
import { normaliseDuplicateText, reviewedHumanName } from "../domain/duplicates";
import { defaultConversationalName } from "../domain/personNames";

export type AddReviewedDetailsInput = {
  targetPersonId: string;
  expectedPersonRevision: number;
  candidate: PreparedManualPersonCapture;
  selectedContactMethodIds: string[];
  includeAffiliation: boolean;
  /** Explicit review choice; never inferred by the write command. */
  includeDisplayName?: boolean;
  now?: string;
};

export type AddReviewedDetailsHooks = {
  beforeCommit?: () => void | Promise<void>;
};

export type AddReviewedDetailsResult = {
  person: Person;
  displayNameUpdated: boolean;
  addedContactMethods: ContactMethod[];
  skippedContactMethodIds: string[];
  addedAffiliation?: OrganisationAffiliation;
  skippedAffiliationId?: string;
};

function phoneIdentity(value: string): string {
  return value.replace(/\D/gu, "");
}

export function personUsesOwnContactAsDisplayName(
  person: Pick<Person, "displayName">,
  contacts: readonly ContactMethod[]
): boolean {
  const displayName = person.displayName.trim();
  if (!displayName) return false;
  return contacts.some((contact) => {
    if (contact.archivedAt) return false;
    if (contact.kind === "email") {
      const candidate = displayName.toLocaleLowerCase("en-US");
      return candidate === contact.rawValue.trim().toLocaleLowerCase("en-US")
        || candidate === contact.canonicalValue;
    }
    const candidate = phoneIdentity(displayName);
    return Boolean(candidate) && (
      candidate === phoneIdentity(contact.rawValue)
      || candidate === phoneIdentity(contact.canonicalValue)
    );
  });
}

export function reviewedDisplayNameCandidate(
  candidate: Pick<PreparedManualPersonCapture, "person">
): string | undefined {
  return reviewedHumanName(candidate.person.displayName);
}

function sameAffiliationDetails(
  left: OrganisationAffiliation,
  right: OrganisationAffiliation
): boolean {
  return normaliseDuplicateText(left.organisationName) === normaliseDuplicateText(right.organisationName)
    && normaliseDuplicateText(left.role ?? "") === normaliseDuplicateText(right.role ?? "")
    && left.startedOn === right.startedOn
    && left.endedOn === right.endedOn
    && left.isCurrent === right.isCurrent;
}

function sameContactRecord(left: ContactMethod, right: ContactMethod): boolean {
  return left.id === right.id
    && left.revision === right.revision
    && left.personId === right.personId
    && left.kind === right.kind
    && left.label === right.label
    && left.rawValue === right.rawValue
    && left.canonicalValue === right.canonicalValue
    && left.isPreferred === right.isPreferred
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && left.archivedAt === right.archivedAt
    && (left.kind !== "phone" || right.kind !== "phone" || left.region === right.region);
}

function sameAffiliationRecord(
  left: OrganisationAffiliation,
  right: OrganisationAffiliation
): boolean {
  return left.id === right.id
    && left.revision === right.revision
    && left.personId === right.personId
    && left.organisationName === right.organisationName
    && left.role === right.role
    && left.startedOn === right.startedOn
    && left.endedOn === right.endedOn
    && left.isCurrent === right.isCurrent
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && left.archivedAt === right.archivedAt;
}

function contactKey(contact: Pick<ContactMethod, "kind" | "canonicalValue">): string {
  return `${contact.kind}:${contact.canonicalValue}`;
}

function prepareContactForTarget(
  source: ContactMethod,
  targetPersonId: string,
  isPreferred: boolean,
  now: string
): ContactMethod {
  const base = {
    id: source.id,
    revision: 1,
    personId: targetPersonId,
    ...(source.label ? { label: source.label } : {}),
    rawValue: source.rawValue,
    canonicalValue: source.canonicalValue,
    isPreferred,
    createdAt: now,
    updatedAt: now
  };
  const contact: ContactMethod = source.kind === "phone"
    ? { ...base, kind: "phone", ...(source.region ? { region: source.region } : {}) }
    : { ...base, kind: "email" };
  assertValidRecord("contactMethods", contact);
  return contact;
}

function prepareAffiliationForTarget(
  source: OrganisationAffiliation,
  targetPersonId: string,
  now: string
): OrganisationAffiliation {
  const affiliation: OrganisationAffiliation = {
    id: source.id,
    revision: 1,
    personId: targetPersonId,
    organisationName: source.organisationName,
    ...(source.role ? { role: source.role } : {}),
    ...(source.startedOn ? { startedOn: source.startedOn } : {}),
    ...(source.endedOn ? { endedOn: source.endedOn } : {}),
    isCurrent: source.isCurrent,
    createdAt: now,
    updatedAt: now
  };
  assertValidRecord("affiliations", affiliation);
  return affiliation;
}

function validateInput(input: AddReviewedDetailsInput): ContactMethod[] {
  const issues: string[] = [];
  if (!input.targetPersonId.trim()) issues.push("Choose an existing Person.");
  if (!Number.isInteger(input.expectedPersonRevision) || input.expectedPersonRevision < 1) {
    issues.push("The expected Person revision must be a positive integer.");
  }
  assertValidRecord("people", input.candidate.person);
  const selectedIds = new Set(input.selectedContactMethodIds);
  if (selectedIds.size !== input.selectedContactMethodIds.length) {
    issues.push("Each reviewed contact method may be selected only once.");
  }
  const candidateById = new Map(input.candidate.contactMethods.map((contact) => [contact.id, contact]));
  const selected = input.selectedContactMethodIds.flatMap((id) => {
    const contact = candidateById.get(id);
    if (!contact) {
      issues.push(`Selected contact method ${id} is not part of this candidate.`);
      return [];
    }
    assertValidRecord("contactMethods", contact);
    if (contact.personId !== input.candidate.person.id || contact.archivedAt) {
      issues.push(`Selected contact method ${id} is not an active detail owned by this candidate.`);
    }
    return [contact];
  });
  if (input.includeAffiliation) {
    if (!input.candidate.affiliation) issues.push("This candidate has no affiliation to add.");
    else {
      assertValidRecord("affiliations", input.candidate.affiliation);
      if (input.candidate.affiliation.personId !== input.candidate.person.id || input.candidate.affiliation.archivedAt) {
        issues.push("The selected affiliation is not an active detail owned by this candidate.");
      }
    }
  }
  if (input.includeDisplayName && !reviewedDisplayNameCandidate(input.candidate)) {
    issues.push("Choose a recognisable name before adding it to the existing Person.");
  }
  if (issues.length) throw new ValidationError(issues);
  return selected;
}

/**
 * Adds only the explicitly reviewed child details to an existing Person.
 * The candidate Person and meeting Interaction are never persisted.
 */
export async function addReviewedDetailsToExistingPerson(
  db: PeopleOsDatabase,
  input: AddReviewedDetailsInput,
  hooks: AddReviewedDetailsHooks = {}
): Promise<AddReviewedDetailsResult> {
  const selectedContacts = validateInput(input);
  const now = input.now ?? new Date().toISOString();
  const tx = db.transaction(["people", "contactMethods", "affiliations", "metadata"], "readwrite");

  try {
    const people = tx.objectStore("people");
    const contacts = tx.objectStore("contactMethods");
    const affiliations = tx.objectStore("affiliations");
    const target = await people.get(input.targetPersonId);
    if (!target) throw new RecordConflictError(`people does not contain id ${input.targetPersonId}`);
    if (target.archivedAt || target.identityStatus === "merged") {
      throw new RecordConflictError("Restore or open the current Person before adding details.");
    }

    const selectedIds = new Set(selectedContacts.map((contact) => contact.id));
    const targetContacts = await contacts.index("by-person").getAll(input.targetPersonId);
    const requestedDisplayName = input.includeDisplayName
      ? reviewedDisplayNameCandidate(input.candidate)
      : undefined;
    const displayNameAlreadyApplied = Boolean(
      requestedDisplayName && target.displayName === requestedDisplayName
    );
    const displayNameWillChange = Boolean(
      requestedDisplayName
      && target.displayName !== requestedDisplayName
      && personUsesOwnContactAsDisplayName(target, targetContacts)
    );
    const candidateConversationalName = input.candidate.person.conversationalName
      ?? (requestedDisplayName ? defaultConversationalName(requestedDisplayName) : undefined);
    const conversationalNameWillChange = Boolean(
      displayNameWillChange
      && candidateConversationalName
      && (target.conversationalName === undefined
        || target.conversationalName === defaultConversationalName(target.displayName))
    );
    if (requestedDisplayName && !displayNameAlreadyApplied && !displayNameWillChange) {
      throw new RecordConflictError("This Person's name changed while you were reviewing it. Review the match again.");
    }
    const baseTargetContacts = targetContacts.filter((contact) => !selectedIds.has(contact.id));
    const preferredKinds = new Set(
      baseTargetContacts
        .filter((contact) => !contact.archivedAt && contact.isPreferred)
        .map((contact) => contact.kind)
    );
    const activeTargetCanonicals = new Set(
      baseTargetContacts
        .filter((contact) => !contact.archivedAt)
        .map(contactKey)
    );

    const pendingContacts: ContactMethod[] = [];
    const replayedContacts: ContactMethod[] = [];
    const skippedContactMethodIds: string[] = [];

    for (const source of selectedContacts) {
      const existingWithId = await contacts.get(source.id);
      if (existingWithId && existingWithId.personId !== input.targetPersonId) {
        throw new RecordConflictError(`contactMethods already contains id ${source.id}`);
      }

      const canonicalMatches = (await contacts.index("by-canonical").getAll(source.canonicalValue))
        .filter((contact) => !contact.archivedAt && contact.kind === source.kind && contact.id !== source.id);
      for (const match of canonicalMatches) {
        if (match.personId === input.targetPersonId) continue;
        const owner = await people.get(match.personId);
        if (owner && !owner.archivedAt && owner.identityStatus !== "merged") {
          throw new RecordConflictError("Contact details changed while you were reviewing them—review duplicates again.");
        }
      }

      const key = contactKey(source);
      if (activeTargetCanonicals.has(key)) {
        if (existingWithId) {
          throw new RecordConflictError("Contact details changed while you were reviewing them—review duplicates again.");
        }
        skippedContactMethodIds.push(source.id);
        continue;
      }

      const isPreferred = !preferredKinds.has(source.kind);
      const desired = prepareContactForTarget(source, input.targetPersonId, isPreferred, now);
      if (existingWithId) {
        if (!sameContactRecord(existingWithId, desired)) {
          throw new RecordConflictError(`contactMethods already contains id ${source.id}`);
        }
        replayedContacts.push(existingWithId);
      } else {
        pendingContacts.push(desired);
      }
      activeTargetCanonicals.add(key);
      if (isPreferred) preferredKinds.add(source.kind);
    }

    let pendingAffiliation: OrganisationAffiliation | undefined;
    let replayedAffiliation: OrganisationAffiliation | undefined;
    let skippedAffiliationId: string | undefined;
    if (input.includeAffiliation && input.candidate.affiliation) {
      const source = input.candidate.affiliation;
      const existingWithId = await affiliations.get(source.id);
      if (existingWithId && existingWithId.personId !== input.targetPersonId) {
        throw new RecordConflictError(`affiliations already contains id ${source.id}`);
      }
      const targetAffiliations = (await affiliations.index("by-person").getAll(input.targetPersonId))
        .filter((affiliation) => affiliation.id !== source.id && !affiliation.archivedAt);
      if (targetAffiliations.some((affiliation) => sameAffiliationDetails(affiliation, source))) {
        if (existingWithId) {
          throw new RecordConflictError("Affiliation details changed while you were reviewing them—review them again.");
        }
        skippedAffiliationId = source.id;
      } else {
        const desired = prepareAffiliationForTarget(source, input.targetPersonId, now);
        if (existingWithId) {
          if (!sameAffiliationRecord(existingWithId, desired)) {
            throw new RecordConflictError(`affiliations already contains id ${source.id}`);
          }
          replayedAffiliation = existingWithId;
        } else {
          pendingAffiliation = desired;
        }
      }
    }

    const hasPendingDetails = pendingContacts.length > 0 || Boolean(pendingAffiliation) || displayNameWillChange;
    const hasReplayedDetails = replayedContacts.length > 0 || Boolean(replayedAffiliation) || displayNameAlreadyApplied;
    if (target.revision !== input.expectedPersonRevision) {
      const isExactRetry = target.revision > input.expectedPersonRevision
        && hasReplayedDetails
        && !hasPendingDetails;
      if (!isExactRetry) throw new StaleRevisionError();
      await tx.done;
      return {
        person: target,
        displayNameUpdated: displayNameAlreadyApplied,
        addedContactMethods: replayedContacts,
        skippedContactMethodIds,
        ...(replayedAffiliation ? { addedAffiliation: replayedAffiliation } : {}),
        ...(skippedAffiliationId ? { skippedAffiliationId } : {})
      };
    }
    if (hasReplayedDetails) {
      throw new RecordConflictError("Reviewed details already use stable IDs but were not applied by this Person revision.");
    }

    if (!hasPendingDetails) {
      await tx.done;
      return {
        person: target,
        displayNameUpdated: false,
        addedContactMethods: [],
        skippedContactMethodIds,
        ...(skippedAffiliationId ? { skippedAffiliationId } : {})
      };
    }

    for (const contact of pendingContacts) await contacts.add(contact);
    if (pendingAffiliation) await affiliations.add(pendingAffiliation);
    const updatedPerson: Person = {
      ...target,
      revision: target.revision + 1,
      ...(displayNameWillChange && requestedDisplayName ? { displayName: requestedDisplayName } : {}),
      ...(conversationalNameWillChange && candidateConversationalName
        ? { conversationalName: candidateConversationalName }
        : {}),
      updatedAt: now
    };
    assertValidRecord("people", updatedPerson);
    await people.put(updatedPerson);

    const metadata = await tx.objectStore("metadata").get("app");
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await tx.objectStore("metadata").put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: now
    });
    await hooks.beforeCommit?.();
    await tx.done;
    return {
      person: updatedPerson,
      displayNameUpdated: displayNameWillChange,
      addedContactMethods: pendingContacts,
      skippedContactMethodIds,
      ...(pendingAffiliation ? { addedAffiliation: pendingAffiliation } : {}),
      ...(skippedAffiliationId ? { skippedAffiliationId } : {})
    };
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}
