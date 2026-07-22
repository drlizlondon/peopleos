import type {
  ContactMethod,
  Interaction,
  OrganisationAffiliation,
  Person,
  RelationshipEvent
} from "./schema";

export type DuplicateEvidenceCode =
  | "same_phone"
  | "same_email"
  | "similar_name_same_organisation"
  | "similar_name_same_event";

export type DuplicateEvidenceStrength = "strong" | "review";

type DuplicateEvidenceBase = {
  code: DuplicateEvidenceCode;
  strength: DuplicateEvidenceStrength;
  candidateSourceIds: string[];
  existingSourceIds: string[];
  explanation: string;
};

export type DuplicateEvidence =
  | (DuplicateEvidenceBase & {
      code: "same_phone";
      strength: "strong";
      canonicalValue: string;
    })
  | (DuplicateEvidenceBase & {
      code: "same_email";
      strength: "strong";
      canonicalValue: string;
    })
  | (DuplicateEvidenceBase & {
      code: "similar_name_same_organisation";
      strength: "review";
      normalisedOrganisation: string;
      organisationName: string;
    })
  | (DuplicateEvidenceBase & {
      code: "similar_name_same_event";
      strength: "review";
      eventId: string;
      eventName?: string;
    });

export type DuplicatePersonSnapshot = {
  person: Person;
  contactMethods?: readonly ContactMethod[];
  affiliations?: readonly OrganisationAffiliation[];
  interactions?: readonly Interaction[];
};

export type DuplicateDetectionInput = {
  candidate: DuplicatePersonSnapshot;
  people: readonly Person[];
  contactMethods: readonly ContactMethod[];
  affiliations: readonly OrganisationAffiliation[];
  interactions: readonly Interaction[];
  events?: readonly RelationshipEvent[];
};

export type DuplicateMatch = {
  person: Person;
  strength: DuplicateEvidenceStrength;
  evidence: DuplicateEvidence[];
  /** Whether the possible match is saved or is an earlier row in this import. */
  source: "stored" | "import";
};

const evidenceOrder: Record<DuplicateEvidenceCode, number> = {
  same_phone: 0,
  same_email: 1,
  similar_name_same_organisation: 2,
  similar_name_same_event: 3
};

function ascending(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Deterministic, deliberately conservative text normalisation for duplicate
 * evidence. It does not perform edit-distance or phonetic matching.
 */
export function normaliseDuplicateText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function ids(records: readonly { id: string }[]): string[] {
  return [...new Set(records.map((record) => record.id))].sort(ascending);
}

function activeContactsFor(
  records: readonly ContactMethod[],
  personId: string
): ContactMethod[] {
  return records.filter((record) => record.personId === personId && !record.archivedAt);
}

function currentAffiliationsFor(
  records: readonly OrganisationAffiliation[],
  personId: string
): OrganisationAffiliation[] {
  return records.filter((record) =>
    record.personId === personId && record.isCurrent && !record.archivedAt
  );
}

function eventInteractionsFor(
  records: readonly Interaction[],
  personId: string
): Interaction[] {
  return records.filter((record) => record.personId === personId && Boolean(record.eventId));
}

function groupContactsByCanonical(
  records: readonly ContactMethod[],
  kind: ContactMethod["kind"]
): Map<string, ContactMethod[]> {
  const grouped = new Map<string, ContactMethod[]>();
  for (const record of records) {
    if (record.kind !== kind) continue;
    const matches = grouped.get(record.canonicalValue) ?? [];
    matches.push(record);
    grouped.set(record.canonicalValue, matches);
  }
  return grouped;
}

function groupAffiliationsByName(
  records: readonly OrganisationAffiliation[]
): Map<string, OrganisationAffiliation[]> {
  const grouped = new Map<string, OrganisationAffiliation[]>();
  for (const record of records) {
    const normalised = normaliseDuplicateText(record.organisationName);
    if (!normalised) continue;
    const matches = grouped.get(normalised) ?? [];
    matches.push(record);
    grouped.set(normalised, matches);
  }
  return grouped;
}

function groupInteractionsByEvent(
  records: readonly Interaction[]
): Map<string, Interaction[]> {
  const grouped = new Map<string, Interaction[]>();
  for (const record of records) {
    if (!record.eventId) continue;
    const matches = grouped.get(record.eventId) ?? [];
    matches.push(record);
    grouped.set(record.eventId, matches);
  }
  return grouped;
}

function exactContactEvidence(
  candidate: readonly ContactMethod[],
  existing: readonly ContactMethod[],
  kind: ContactMethod["kind"]
): DuplicateEvidence[] {
  const candidateByValue = groupContactsByCanonical(candidate, kind);
  const existingByValue = groupContactsByCanonical(existing, kind);
  const sharedValues = [...candidateByValue.keys()]
    .filter((value) => existingByValue.has(value))
    .sort(ascending);

  return sharedValues.map((canonicalValue): DuplicateEvidence => {
    const shared = {
      strength: "strong",
      canonicalValue,
      candidateSourceIds: ids(candidateByValue.get(canonicalValue) ?? []),
      existingSourceIds: ids(existingByValue.get(canonicalValue) ?? [])
    } as const;
    return kind === "phone"
      ? {
          ...shared,
          code: "same_phone",
          explanation: `Same phone number: ${canonicalValue}`
        }
      : {
          ...shared,
          code: "same_email",
          explanation: `Same email address: ${canonicalValue}`
        };
  });
}

function organisationEvidence(
  candidate: readonly OrganisationAffiliation[],
  existing: readonly OrganisationAffiliation[]
): DuplicateEvidence[] {
  const candidateByName = groupAffiliationsByName(candidate);
  const existingByName = groupAffiliationsByName(existing);
  const sharedNames = [...candidateByName.keys()]
    .filter((value) => existingByName.has(value))
    .sort(ascending);

  return sharedNames.map((normalisedOrganisation): DuplicateEvidence => {
    const candidateRecords = candidateByName.get(normalisedOrganisation) ?? [];
    const existingRecords = existingByName.get(normalisedOrganisation) ?? [];
    const organisationName = [...candidateRecords, ...existingRecords]
      .sort((left, right) => ascending(left.id, right.id))[0]?.organisationName
      ?? normalisedOrganisation;
    return {
      code: "similar_name_same_organisation",
      strength: "review",
      normalisedOrganisation,
      organisationName,
      candidateSourceIds: ids(candidateRecords),
      existingSourceIds: ids(existingRecords),
      explanation: `Same name after normalisation and same organisation: ${organisationName}`
    };
  });
}

function sharedEventEvidence(
  candidate: readonly Interaction[],
  existing: readonly Interaction[],
  eventNames: ReadonlyMap<string, string>
): DuplicateEvidence[] {
  const candidateByEvent = groupInteractionsByEvent(candidate);
  const existingByEvent = groupInteractionsByEvent(existing);
  const sharedEventIds = [...candidateByEvent.keys()]
    .filter((value) => existingByEvent.has(value))
    .sort(ascending);

  return sharedEventIds.map((eventId): DuplicateEvidence => {
    const eventName = eventNames.get(eventId);
    return {
      code: "similar_name_same_event",
      strength: "review",
      eventId,
      ...(eventName ? { eventName } : {}),
      candidateSourceIds: ids(candidateByEvent.get(eventId) ?? []),
      existingSourceIds: ids(existingByEvent.get(eventId) ?? []),
      explanation: eventName
        ? `Same name after normalisation and same event: ${eventName}`
        : "Same name after normalisation and the same linked event."
    };
  });
}

function evidenceStableValue(evidence: DuplicateEvidence): string {
  switch (evidence.code) {
    case "same_phone":
    case "same_email":
      return evidence.canonicalValue;
    case "similar_name_same_organisation":
      return evidence.normalisedOrganisation;
    case "similar_name_same_event":
      return evidence.eventId;
  }
}

function compareEvidence(left: DuplicateEvidence, right: DuplicateEvidence): number {
  return evidenceOrder[left.code] - evidenceOrder[right.code]
    || ascending(evidenceStableValue(left), evidenceStableValue(right))
    || ascending(left.candidateSourceIds.join("\0"), right.candidateSourceIds.join("\0"))
    || ascending(left.existingSourceIds.join("\0"), right.existingSourceIds.join("\0"));
}

function matchEvidenceRank(match: DuplicateMatch): number {
  return Math.min(...match.evidence.map((evidence) => evidenceOrder[evidence.code]));
}

/**
 * Returns explained possible duplicates without changing or merging records.
 * Existing archived/merged People and archived contact/affiliation records do
 * not participate. The candidate Person itself is excluded for edit flows.
 */
export function detectDuplicatePeople(input: DuplicateDetectionInput): DuplicateMatch[] {
  const candidatePersonId = input.candidate.person.id;
  const candidateName = normaliseDuplicateText(input.candidate.person.displayName);
  const candidateContacts = activeContactsFor(
    input.candidate.contactMethods ?? [],
    candidatePersonId
  );
  const candidateAffiliations = currentAffiliationsFor(
    input.candidate.affiliations ?? [],
    candidatePersonId
  );
  const candidateInteractions = eventInteractionsFor(
    input.candidate.interactions ?? [],
    candidatePersonId
  );
  const eventNames = new Map(
    [...(input.events ?? [])]
      .sort((left, right) => ascending(left.id, right.id))
      .map((event) => [event.id, event.name] as const)
  );

  const matches = input.people
    .filter((person) =>
      person.id !== candidatePersonId
      && !person.archivedAt
      && person.identityStatus !== "merged"
    )
    .map((person): DuplicateMatch | undefined => {
      const existingContacts = activeContactsFor(input.contactMethods, person.id);
      const evidence: DuplicateEvidence[] = [
        ...exactContactEvidence(candidateContacts, existingContacts, "phone"),
        ...exactContactEvidence(candidateContacts, existingContacts, "email")
      ];

      const namesMatch = Boolean(candidateName)
        && candidateName === normaliseDuplicateText(person.displayName);
      if (namesMatch) {
        evidence.push(...organisationEvidence(
          candidateAffiliations,
          currentAffiliationsFor(input.affiliations, person.id)
        ));
        evidence.push(...sharedEventEvidence(
          candidateInteractions,
          eventInteractionsFor(input.interactions, person.id),
          eventNames
        ));
      }

      if (!evidence.length) return undefined;
      evidence.sort(compareEvidence);
      return {
        person,
        strength: evidence.some((item) => item.strength === "strong") ? "strong" : "review",
        evidence,
        source: "stored"
      };
    })
    .filter((match): match is DuplicateMatch => Boolean(match));

  return matches.sort((left, right) => {
    if (left.strength !== right.strength) return left.strength === "strong" ? -1 : 1;
    return matchEvidenceRank(left) - matchEvidenceRank(right)
      || ascending(
        normaliseDuplicateText(left.person.displayName),
        normaliseDuplicateText(right.person.displayName)
      )
      || ascending(left.person.id, right.person.id);
  });
}
