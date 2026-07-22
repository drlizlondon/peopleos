import { describe, expect, it } from "vitest";
import type {
  ContactMethod,
  Interaction,
  OrganisationAffiliation,
  Person,
  RelationshipEvent
} from "./schema";
import {
  detectDuplicatePeople,
  normaliseDuplicateText,
  type DuplicateDetectionInput,
  type DuplicatePersonSnapshot
} from "./duplicates";

const now = "2026-08-01T09:00:00.000Z";

function person(id: string, displayName: string, patch: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

function phone(id: string, personId: string, canonicalValue: string, archived = false): ContactMethod {
  return {
    id,
    revision: 1,
    personId,
    kind: "phone",
    rawValue: canonicalValue,
    canonicalValue,
    isPreferred: true,
    createdAt: now,
    updatedAt: now,
    ...(archived ? { archivedAt: now } : {})
  };
}

function email(id: string, personId: string, canonicalValue: string, archived = false): ContactMethod {
  return {
    id,
    revision: 1,
    personId,
    kind: "email",
    rawValue: canonicalValue,
    canonicalValue,
    isPreferred: true,
    createdAt: now,
    updatedAt: now,
    ...(archived ? { archivedAt: now } : {})
  };
}

function affiliation(
  id: string,
  personId: string,
  organisationName: string,
  patch: Partial<OrganisationAffiliation> = {}
): OrganisationAffiliation {
  return {
    id,
    revision: 1,
    personId,
    organisationName,
    isCurrent: true,
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

function interaction(id: string, personId: string, eventId: string): Interaction {
  return {
    id,
    revision: 1,
    personId,
    kind: "met",
    eventId,
    occurredAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function event(id: string, name: string): RelationshipEvent {
  return {
    id,
    revision: 1,
    name,
    createdAt: now,
    updatedAt: now
  };
}

function input(
  candidate: DuplicatePersonSnapshot,
  patch: Partial<Omit<DuplicateDetectionInput, "candidate">> = {}
): DuplicateDetectionInput {
  return {
    candidate,
    people: [],
    contactMethods: [],
    affiliations: [],
    interactions: [],
    events: [],
    ...patch
  };
}

describe("duplicate text normalisation", () => {
  it("normalises Unicode case, decomposed diacritics, punctuation and whitespace", () => {
    expect(normaliseDuplicateText("  SÁRAH—JÖNES!!\t  ")).toBe("sarah jones");
    expect(normaliseDuplicateText("Sarah   Jones")).toBe("sarah jones");
    expect(normaliseDuplicateText("Élodie")).toBe(normaliseDuplicateText("E\u0301LODIE"));
  });
});

describe("deterministic duplicate evidence", () => {
  it("aggregates exact active canonical phone and email evidence as a strong match", () => {
    const candidatePerson = person("person-candidate", "Candidate");
    const existing = person("person-existing", "Existing");
    const result = detectDuplicatePeople(input({
      person: candidatePerson,
      contactMethods: [
        phone("candidate-phone-b", candidatePerson.id, "+447900123456"),
        phone("candidate-phone-a", candidatePerson.id, "+447900123456"),
        email("candidate-email", candidatePerson.id, "same@example.com")
      ]
    }, {
      people: [existing],
      contactMethods: [
        email("existing-email", existing.id, "same@example.com"),
        phone("existing-phone", existing.id, "+447900123456")
      ]
    }));

    expect(result).toHaveLength(1);
    expect(result[0].person.id).toBe(existing.id);
    expect(result[0].strength).toBe("strong");
    expect(result[0].source).toBe("stored");
    expect(result[0].evidence.map((item) => item.code)).toEqual(["same_phone", "same_email"]);
    expect(result[0].evidence[0]).toMatchObject({
      candidateSourceIds: ["candidate-phone-a", "candidate-phone-b"],
      existingSourceIds: ["existing-phone"],
      explanation: "Same phone number: +447900123456"
    });
    expect(result[0].evidence[1].explanation).toBe("Same email address: same@example.com");
  });

  it("ignores archived contact methods, archived or non-current affiliations, and inactive People", () => {
    const candidatePerson = person("person-candidate", "Sarah Jones");
    const active = person("person-active", "Sarah Jones");
    const archived = person("person-archived", "Sarah Jones", { archivedAt: now });
    const merged = person("person-merged", "Sarah Jones", {
      identityStatus: "merged",
      mergedIntoPersonId: active.id
    });
    const result = detectDuplicatePeople(input({
      person: candidatePerson,
      contactMethods: [phone("candidate-phone", candidatePerson.id, "+447900123456")],
      affiliations: [affiliation("candidate-org", candidatePerson.id, "NHS England")]
    }, {
      people: [active, archived, merged],
      contactMethods: [
        phone("active-archived-phone", active.id, "+447900123456", true),
        phone("archived-phone", archived.id, "+447900123456"),
        phone("merged-phone", merged.id, "+447900123456")
      ],
      affiliations: [
        affiliation("active-old-org", active.id, "NHS England", { isCurrent: false }),
        affiliation("active-archived-org", active.id, "NHS England", { archivedAt: now })
      ]
    }));

    expect(result).toEqual([]);
  });

  it("requires normalised-name equality plus a current organisation for organisation review", () => {
    const candidatePerson = person("person-candidate", " SÁRAH—JONES ");
    const organisationMatch = person("person-org", "sarah jones");
    const nameOnly = person("person-name-only", "Sarah Jones");
    const fuzzyName = person("person-fuzzy", "Sarah Jane");
    const result = detectDuplicatePeople(input({
      person: candidatePerson,
      affiliations: [affiliation("candidate-org", candidatePerson.id, "NHS—England")]
    }, {
      people: [fuzzyName, nameOnly, organisationMatch],
      affiliations: [
        affiliation("match-org", organisationMatch.id, "nhs england"),
        affiliation("fuzzy-org", fuzzyName.id, "NHS England")
      ]
    }));

    expect(result.map((match) => match.person.id)).toEqual([organisationMatch.id]);
    expect(result[0]).toMatchObject({
      strength: "review",
      evidence: [{
        code: "similar_name_same_organisation",
        candidateSourceIds: ["candidate-org"],
        existingSourceIds: ["match-org"],
        normalisedOrganisation: "nhs england"
      }]
    });
    expect(result[0].evidence[0].explanation).toContain("same organisation");
  });

  it("requires normalised-name equality plus an explicit shared Event ID for event review", () => {
    const candidatePerson = person("person-candidate", "Aaron Smith");
    const eventMatch = person("person-event", "AARON SMITH");
    const wrongName = person("person-wrong-name", "Aaron Smyth");
    const wrongEvent = person("person-wrong-event", "Aaron Smith");
    const result = detectDuplicatePeople(input({
      person: candidatePerson,
      interactions: [interaction("candidate-met", candidatePerson.id, "event-hackathon")]
    }, {
      people: [wrongEvent, wrongName, eventMatch],
      interactions: [
        interaction("existing-met", eventMatch.id, "event-hackathon"),
        interaction("wrong-name-met", wrongName.id, "event-hackathon"),
        interaction("wrong-event-met", wrongEvent.id, "event-other")
      ],
      events: [event("event-hackathon", "NHS AI Hackathon")]
    }));

    expect(result.map((match) => match.person.id)).toEqual([eventMatch.id]);
    expect(result[0].evidence[0]).toMatchObject({
      code: "similar_name_same_event",
      eventId: "event-hackathon",
      eventName: "NHS AI Hackathon",
      candidateSourceIds: ["candidate-met"],
      existingSourceIds: ["existing-met"],
      explanation: "Same name after normalisation and same event: NHS AI Hackathon"
    });
  });

  it("excludes the candidate Person itself during an existing-Person edit", () => {
    const candidatePerson = person("person-existing", "Existing");
    const result = detectDuplicatePeople(input({
      person: candidatePerson,
      contactMethods: [email("candidate-email", candidatePerson.id, "same@example.com")]
    }, {
      people: [candidatePerson],
      contactMethods: [email("stored-email", candidatePerson.id, "same@example.com")]
    }));

    expect(result).toEqual([]);
  });

  it("orders matches by strength, evidence kind, normalised name and stable Person ID", () => {
    const candidatePerson = person("person-candidate", "Same Name");
    const strongPhone = person("person-z-phone", "Zulu");
    const strongEmailA = person("person-b-email", "Alpha");
    const strongEmailB = person("person-a-email", "Alpha");
    const reviewOrganisation = person("person-z-org", "Same Name");
    const reviewEvent = person("person-a-event", "Same Name");
    const result = detectDuplicatePeople(input({
      person: candidatePerson,
      contactMethods: [
        phone("candidate-phone", candidatePerson.id, "+447900123456"),
        email("candidate-email", candidatePerson.id, "same@example.com")
      ],
      affiliations: [affiliation("candidate-org", candidatePerson.id, "PeopleOS")],
      interactions: [interaction("candidate-event", candidatePerson.id, "event-one")]
    }, {
      people: [reviewEvent, strongEmailA, reviewOrganisation, strongPhone, strongEmailB],
      contactMethods: [
        email("email-a", strongEmailA.id, "same@example.com"),
        phone("phone-z", strongPhone.id, "+447900123456"),
        email("email-b", strongEmailB.id, "same@example.com")
      ],
      affiliations: [affiliation("org-z", reviewOrganisation.id, "PeopleOS")],
      interactions: [interaction("event-a", reviewEvent.id, "event-one")]
    }));

    expect(result.map((match) => match.person.id)).toEqual([
      strongPhone.id,
      strongEmailB.id,
      strongEmailA.id,
      reviewOrganisation.id,
      reviewEvent.id
    ]);
  });

  it("returns byte-for-byte equivalent output when every input collection is reordered", () => {
    const candidatePerson = person("person-candidate", "Sarah Jones");
    const existing = person("person-existing", "Sarah Jones");
    const base = input({
      person: candidatePerson,
      contactMethods: [
        email("candidate-email", candidatePerson.id, "sarah@example.com"),
        phone("candidate-phone", candidatePerson.id, "+447900123456")
      ],
      affiliations: [affiliation("candidate-org-b", candidatePerson.id, "NHS England"), affiliation("candidate-org-a", candidatePerson.id, "NHS—England")],
      interactions: [interaction("candidate-event-b", candidatePerson.id, "event-b"), interaction("candidate-event-a", candidatePerson.id, "event-a")]
    }, {
      people: [existing],
      contactMethods: [
        phone("existing-phone", existing.id, "+447900123456"),
        email("existing-email", existing.id, "sarah@example.com")
      ],
      affiliations: [affiliation("existing-org", existing.id, "nhs england")],
      interactions: [interaction("existing-event-a", existing.id, "event-a"), interaction("existing-event-b", existing.id, "event-b")],
      events: [event("event-b", "Second event"), event("event-a", "First event")]
    });
    const reversed: DuplicateDetectionInput = {
      candidate: {
        person: base.candidate.person,
        contactMethods: [...(base.candidate.contactMethods ?? [])].reverse(),
        affiliations: [...(base.candidate.affiliations ?? [])].reverse(),
        interactions: [...(base.candidate.interactions ?? [])].reverse()
      },
      people: [...base.people].reverse(),
      contactMethods: [...base.contactMethods].reverse(),
      affiliations: [...base.affiliations].reverse(),
      interactions: [...base.interactions].reverse(),
      events: [...(base.events ?? [])].reverse()
    };

    expect(detectDuplicatePeople(reversed)).toEqual(detectDuplicatePeople(base));
  });
});
