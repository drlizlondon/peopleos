import { describe, expect, it } from "vitest";
import { addDaysToLocalDate } from "../domain/followUpPolicy";
import type {
  ContactMethod,
  FollowUp,
  Interaction,
  InteractionKind,
  MemoryFact,
  OrganisationAffiliation,
  Person,
  ReachOutEntry,
  RelationshipEvent,
  TodaySkip
} from "../domain/schema";
import {
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  assessRelationship,
  buildToday,
  calendarDaysBetween,
  deriveReachOutDisplayState,
  formatExplanation,
  type RelationshipAssessment,
  type RelationshipClock,
  type RelationshipPersonBundle
} from ".";

const clock: RelationshipClock = {
  now: "2026-08-14T12:00:00.000Z",
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
};

function instant(date: string, hour = "12:00:00.000Z"): string {
  return `${date}T${hour}`;
}

function person(id = "person-one", overrides: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName: "Sarah Ahmed",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: instant("2025-01-01"),
    updatedAt: instant("2025-01-01"),
    ...overrides
  };
}

function interaction(
  id: string,
  kind: InteractionKind,
  date: string,
  overrides: Partial<Interaction> = {}
): Interaction {
  return {
    id,
    revision: 1,
    personId: "person-one",
    kind,
    occurredAt: instant(date),
    createdAt: instant(date),
    updatedAt: instant(date),
    ...overrides
  };
}

function followUp(id: string, date: string, overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id,
    revision: 1,
    personId: "person-one",
    dueDate: date,
    reason: `Reason ${id}`,
    actionType: "message",
    status: "pending",
    createdAt: instant("2026-08-01"),
    updatedAt: instant("2026-08-01"),
    ...overrides
  };
}

function contactMethod(
  id: string,
  kind: ContactMethod["kind"],
  overrides: Partial<ContactMethod> = {}
): ContactMethod {
  const base = {
    id,
    revision: 1,
    personId: "person-one",
    rawValue: kind === "phone" ? "07900123456" : "person@example.com",
    canonicalValue: kind === "phone" ? "+447900123456" : "person@example.com",
    isPreferred: false,
    createdAt: instant("2026-01-01"),
    updatedAt: instant("2026-01-01"),
    ...overrides
  };
  return kind === "phone" ? { ...base, kind, region: "GB" } as ContactMethod : { ...base, kind } as ContactMethod;
}

function fact(
  id: string,
  kind: MemoryFact["kind"],
  value: string,
  overrides: Partial<MemoryFact> = {}
): MemoryFact {
  return {
    id,
    revision: 1,
    personId: "person-one",
    kind,
    value,
    showAsMemoryCue: true,
    createdAt: instant("2026-07-01"),
    updatedAt: instant("2026-07-01"),
    ...overrides
  };
}

function affiliation(id: string, overrides: Partial<OrganisationAffiliation> = {}): OrganisationAffiliation {
  return {
    id,
    revision: 1,
    personId: "person-one",
    organisationName: "HealthTech UK",
    role: "Clinical advisor",
    isCurrent: true,
    createdAt: instant("2026-01-01"),
    updatedAt: instant("2026-01-01"),
    ...overrides
  };
}

function event(id = "event-fellowship", overrides: Partial<RelationshipEvent> = {}): RelationshipEvent {
  return {
    id,
    revision: 1,
    name: "HealthTech Fellowship",
    occurredOn: "2026-08-01",
    createdAt: instant("2026-08-01"),
    updatedAt: instant("2026-08-01"),
    ...overrides
  };
}

function reachOut(id = "reach-out-one", overrides: Partial<ReachOutEntry> = {}): ReachOutEntry {
  return {
    id,
    revision: 1,
    personId: "person-one",
    reason: "Worth reconnecting with",
    intendedActionType: "message",
    intentStatus: "active",
    contextIds: [],
    addedAt: instant("2026-08-01"),
    createdAt: instant("2026-08-01"),
    updatedAt: instant("2026-08-01"),
    ...overrides
  };
}

function bundle(overrides: Partial<RelationshipPersonBundle> = {}): RelationshipPersonBundle {
  return {
    person: person(),
    contactMethods: [],
    interactions: [],
    followUps: [],
    reachOutEntries: [],
    facts: [],
    affiliations: [],
    events: [],
    ...overrides
  };
}

function assessmentFor(
  candidate: Person,
  options: Partial<RelationshipPersonBundle> = {}
): RelationshipAssessment {
  const remap = <T extends { personId: string }>(records: readonly T[]) => records.map((record) => ({
    ...record,
    personId: candidate.id
  }));
  return assessRelationship(bundle({
    person: candidate,
    contactMethods: remap(options.contactMethods ?? []),
    interactions: remap(options.interactions ?? []),
    followUps: remap(options.followUps ?? []),
    reachOutEntries: remap(options.reachOutEntries ?? []),
    facts: remap(options.facts ?? []),
    affiliations: remap(options.affiliations ?? []),
    events: options.events ?? []
  }), clock);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

describe("Relationship Engine clock and contact policy", () => {
  it("uses injected timezone boundaries rather than the host day", () => {
    const candidate = bundle({
      interactions: [interaction("contact", "met", "2026-08-08")]
    });
    const beforeMidnight = assessRelationship(candidate, {
      ...clock,
      now: "2026-08-14T22:59:59.000Z"
    });
    const afterMidnight = assessRelationship(candidate, {
      ...clock,
      now: "2026-08-14T23:00:00.000Z"
    });
    expect(beforeMidnight.localDate).toBe("2026-08-14");
    expect(beforeMidnight.today).toBeUndefined();
    expect(afterMidnight.localDate).toBe("2026-08-15");
    expect(afterMidnight.today?.eligibilityCode).toBe("new_relationship");
  });

  it("calculates calendar days across a daylight-saving transition", () => {
    expect(calendarDaysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(calendarDaysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("rejects a mismatched policy version", () => {
    expect(() => assessRelationship(bundle(), {
      ...clock,
      policyVersion: "future-policy" as typeof RELATIONSHIP_ENGINE_POLICY_VERSION
    })).toThrow(/Unsupported Relationship Engine policy/);
  });

  const contactKinds: InteractionKind[] = [
    "met", "contacted", "whatsapp_message", "email", "phone_call", "coffee",
    "meeting", "conference", "introduction_received"
  ];
  const nonContactKinds: InteractionKind[] = ["introduction_made", "note_added", "follow_up_completed"];

  it.each(contactKinds)("counts %s as contact", (kind) => {
    const result = assessRelationship(bundle({ interactions: [interaction(`interaction-${kind}`, kind, "2026-08-13")] }), clock);
    expect(result.relationshipStage.contactCount).toBe(1);
    expect(result.lastContact?.kind).toBe(kind);
  });

  it.each(nonContactKinds)("does not count %s as contact", (kind) => {
    const result = assessRelationship(bundle({ interactions: [interaction(`interaction-${kind}`, kind, "2026-08-13")] }), clock);
    expect(result.relationshipStage.contactCount).toBe(0);
    expect(result.lastContact).toBeUndefined();
  });
});

describe("Today eligibility", () => {
  it("returns Sarah's due-today explicit plan with structured evidence", () => {
    const result = assessRelationship(bundle({
      followUps: [followUp("follow-up-sarah", "2026-08-14", {
        reason: "reconnect after the NHS AI Fellowship"
      })]
    }), clock);
    expect(result.today).toMatchObject({
      eligibilityCode: "explicit_follow_up",
      dueState: "due_today",
      relevantDate: "2026-08-14",
      primaryFollowUpId: "follow-up-sarah",
      additionalDueFollowUpIds: []
    });
    expect(formatExplanation(result.today!.explanation)).toBe(
      "You planned to reconnect after the NHS AI Fellowship today."
    );
  });

  it("uses the snoozed effective date and preserves original-date evidence", () => {
    const result = assessRelationship(bundle({
      followUps: [followUp("snoozed", "2026-08-01", { snoozedUntilDate: "2026-08-13" })]
    }), clock);
    expect(result.today).toMatchObject({ dueState: "overdue", relevantDate: "2026-08-13" });
    expect(result.overdueFollowUp).toMatchObject({
      followUpId: "snoozed",
      effectiveDate: "2026-08-13",
      originalDate: "2026-08-01"
    });
  });

  it.each(["completed", "cancelled", "superseded"] as const)(
    "does not treat a %s FollowUp as explicit eligibility",
    (status) => {
      const result = assessRelationship(bundle({ followUps: [followUp(status, "2026-08-01", { status })] }), clock);
      expect(result.today).toBeUndefined();
    }
  );

  it("selects one card and deterministically returns every other due FollowUp", () => {
    const result = assessRelationship(bundle({
      followUps: [
        followUp("later", "2026-08-15"),
        followUp("same-b", "2026-08-10", { createdAt: instant("2026-07-02") }),
        followUp("oldest", "2026-08-09"),
        followUp("same-a", "2026-08-10", { createdAt: instant("2026-07-02") })
      ]
    }), clock);
    expect(result.today?.primaryFollowUpId).toBe("oldest");
    expect(result.today?.additionalDueFollowUpIds).toEqual(["same-a", "same-b"]);
  });

  it.each([
    { days: 6, eligible: false },
    { days: 7, eligible: true },
    { days: 8, eligible: true }
  ])("applies the New rule at the seven-day boundary: $days days", ({ days, eligible }) => {
    const date = addDaysToLocalDate("2026-08-14", -days);
    const result = assessRelationship(bundle({ interactions: [interaction("sole", "phone_call", date)] }), clock);
    expect(result.today?.eligibilityCode === "new_relationship").toBe(eligible);
  });

  it("uses Event-specific New wording only for an explicit Met/Conference Event", () => {
    const fellowship = event();
    const withEvent = assessRelationship(bundle({
      interactions: [interaction("sole", "met", "2026-08-06", { eventId: fellowship.id })],
      events: [fellowship]
    }), clock);
    expect(formatExplanation(withEvent.today!.explanation)).toContain("met at HealthTech Fellowship 8 days ago");
    const emailWithEvent = assessRelationship(bundle({
      interactions: [interaction("sole", "email", "2026-08-06", { eventId: fellowship.id })],
      events: [fellowship]
    }), clock);
    expect(formatExplanation(emailWithEvent.today!.explanation)).toContain("only recorded contact");
    expect(formatExplanation(emailWithEvent.today!.explanation)).not.toContain("met at");
  });

  it.each(["pending", "completed", "cancelled", "superseded"] as const)(
    "suppresses New after any later %s FollowUp",
    (status) => {
      const sole = interaction("sole", "met", "2026-08-01");
      const result = assessRelationship(bundle({
        interactions: [sole],
        followUps: [followUp(`later-${status}`, "2026-08-20", {
          status,
          createdAt: "2026-08-02T12:00:00.000Z"
        })]
      }), clock);
      expect(result.today).toBeUndefined();
    }
  );

  it("does not let a FollowUp created before the sole contact suppress New", () => {
    const result = assessRelationship(bundle({
      interactions: [interaction("sole", "met", "2026-08-01")],
      followUps: [followUp("earlier", "2026-07-20", {
        status: "cancelled",
        createdAt: "2026-07-01T12:00:00.000Z"
      })]
    }), clock);
    expect(result.today?.eligibilityCode).toBe("new_relationship");
  });

  it.each([
    { elapsed: 29, eligible: false },
    { elapsed: 30, eligible: true },
    { elapsed: 31, eligible: true }
  ])("applies cadence at N-1/N/N+1: $elapsed days", ({ elapsed, eligible }) => {
    const candidate = person("person-one", { contactCadenceDays: 30 });
    const date = addDaysToLocalDate("2026-08-14", -elapsed);
    const result = assessRelationship(bundle({
      person: candidate,
      interactions: [
        interaction("first", "met", "2025-01-01"),
        interaction("latest", "email", date)
      ]
    }), clock);
    expect(result.today?.eligibilityCode === "cadence_due").toBe(eligible);
    if (eligible) expect(result.today?.relevantDate).toBe(addDaysToLocalDate(date, 30));
  });

  it("lets a future pending FollowUp suppress New and cadence", () => {
    const newResult = assessRelationship(bundle({
      interactions: [interaction("sole", "met", "2026-08-01")],
      followUps: [followUp("future", "2026-08-20", { createdAt: "2026-07-01T12:00:00.000Z" })]
    }), clock);
    expect(newResult.today).toBeUndefined();
    const cadenceResult = assessRelationship(bundle({
      person: person("person-one", { contactCadenceDays: 30 }),
      interactions: [interaction("first", "met", "2025-01-01"), interaction("latest", "email", "2026-07-01")],
      followUps: [followUp("future", "2026-08-20")]
    }), clock);
    expect(cadenceResult.today).toBeUndefined();
  });

  it("excludes archived and merged People while keeping provisional People eligible", () => {
    const due = [followUp("due", "2026-08-14")];
    expect(assessRelationship(bundle({ person: person("person-one", { archivedAt: clock.now }), followUps: due }), clock).today).toBeUndefined();
    expect(assessRelationship(bundle({ person: person("person-one", { identityStatus: "merged", mergedIntoPersonId: "other" }), followUps: due }), clock).today).toBeUndefined();
    expect(assessRelationship(bundle({ person: person("person-one", { identityStatus: "provisional" }), followUps: due }), clock).today).toBeDefined();
  });

  it("treats a Reach Out FollowUp as ordinary explicit work with optional explanation context", () => {
    const entry = reachOut("reach-out-one", { currentFollowUpId: "due" });
    const due = followUp("due", "2026-08-14", { reachOutEntryId: entry.id });
    const result = assessRelationship(bundle({ followUps: [due], reachOutEntries: [entry] }), clock);
    expect(result.today?.eligibilityCode).toBe("explicit_follow_up");
    expect(result.today?.explanation.facts).toContainEqual(expect.objectContaining({
      label: "reachOutReason",
      sourceId: entry.id
    }));
  });

  it("does not make Reach Out membership alone eligible for Today", () => {
    const entry = reachOut("reach-out-one");
    const result = assessRelationship(bundle({ reachOutEntries: [entry] }), clock);
    expect(result.today).toBeUndefined();
  });
});

describe("buildToday global order and suppression", () => {
  function explicitAssessment(
    id: string,
    displayName: string,
    date: string,
    importance: Person["importance"] = "normal"
  ) {
    return assessmentFor(person(id, { displayName, importance }), {
      followUps: [followUp(`follow-up-${id}`, date)]
    });
  }

  it("owns all four bands and their documented tie-breakers", () => {
    const overdueNormal = explicitAssessment("overdue-normal", "Zed", "2026-08-10");
    const overdueHigh = explicitAssessment("overdue-high", "Amy", "2026-08-10", "high");
    const overdueOlder = explicitAssessment("overdue-older", "Bea", "2026-08-09");
    const todayNormal = explicitAssessment("today-normal", "Amy", "2026-08-14");
    const todayHigh = explicitAssessment("today-high", "Zed", "2026-08-14", "high");
    const newNormal = assessmentFor(person("new-normal", { displayName: "Amy" }), {
      interactions: [interaction("new-contact", "met", "2026-08-01")]
    });
    const newHigh = assessmentFor(person("new-high", { displayName: "Zed", importance: "high" }), {
      interactions: [interaction("new-contact", "met", "2026-08-06")]
    });
    const cadence = assessmentFor(person("cadence", {
      displayName: "A Cadence",
      importance: "high",
      contactCadenceDays: 30
    }), {
      interactions: [
        interaction("first", "met", "2025-01-01"),
        interaction("latest", "email", "2026-07-01")
      ]
    });
    const assessments = [cadence, newNormal, todayNormal, overdueNormal, newHigh, overdueOlder, todayHigh, overdueHigh];
    const result = buildToday({ assessments, todaySkips: [], clock });
    expect(result.orderedItems.map((item) => item.personId)).toEqual([
      "overdue-older", "overdue-high", "overdue-normal",
      "today-high", "today-normal",
      "new-high", "new-normal",
      "cadence"
    ]);
    expect(result.totalCount).toBe(8);
    expect(result.orderedItems.slice(0, 5).map((item) => item.personId)).toEqual([
      "overdue-older", "overdue-high", "overdue-normal", "today-high", "today-normal"
    ]);
  });

  it("is byte-equivalent across fixed permutations", () => {
    const records = [
      explicitAssessment("a", "Zulu", "2026-08-13"),
      explicitAssessment("b", "Alpha", "2026-08-14", "high"),
      assessmentFor(person("c", { displayName: "Charlie" }), {
        interactions: [interaction("new", "met", "2026-08-01")]
      })
    ];
    const expected = JSON.stringify(buildToday({ assessments: records, todaySkips: [], clock }));
    for (const permutation of [
      [records[2], records[0], records[1]],
      [records[1], records[2], records[0]],
      [...records].reverse()
    ]) {
      expect(JSON.stringify(buildToday({ assessments: permutation, todaySkips: [], clock }))).toBe(expected);
    }
  });

  it("applies only a Person skip for the current local date", () => {
    const due = explicitAssessment("person-due", "Due", "2026-08-14");
    const skip = (date: string): TodaySkip => ({
      id: `person-due:${date}`,
      personId: "person-due",
      localDate: date,
      createdAt: clock.now
    });
    expect(buildToday({ assessments: [due], todaySkips: [skip("2026-08-13")], clock }).totalCount).toBe(1);
    expect(buildToday({ assessments: [due], todaySkips: [skip("2026-08-14")], clock }).totalCount).toBe(0);
    expect(buildToday({ assessments: [due], todaySkips: [skip("2026-08-15")], clock }).totalCount).toBe(1);
  });

  it("rejects duplicate or stale assessments instead of choosing by array order", () => {
    const due = explicitAssessment("person-due", "Due", "2026-08-14");
    expect(() => buildToday({ assessments: [due, due], todaySkips: [], clock })).toThrow(/Duplicate/);
    expect(() => buildToday({
      assessments: [{ ...due, evaluatedAt: "2026-08-14T11:00:00.000Z" }],
      todaySkips: [],
      clock
    })).toThrow(/same clock and policy/);
  });

  it("does not let importance create eligibility", () => {
    const high = assessRelationship(bundle({ person: person("person-one", { importance: "high" }) }), clock);
    expect(buildToday({ assessments: [high], todaySkips: [], clock }).orderedItems).toEqual([]);
  });

  it("does not give a linked Reach Out plan an ordering boost", () => {
    const plain = explicitAssessment("plain", "Alpha", "2026-08-14");
    const entry = reachOut("reach-out-linked", { personId: "linked", currentFollowUpId: "follow-up-linked" });
    const linked = assessmentFor(person("linked", { displayName: "Zulu" }), {
      followUps: [followUp("follow-up-linked", "2026-08-14", {
        personId: "linked",
        reachOutEntryId: entry.id
      })],
      reachOutEntries: [entry]
    });
    expect(buildToday({ assessments: [linked, plain], todaySkips: [], clock }).orderedItems.map((item) => item.personId))
      .toEqual(["plain", "linked"]);
  });
});

describe("stage, relationship age and last contact", () => {
  function contactsAcross(count: number, spanDays: number): Interaction[] {
    const firstDate = "2024-01-01";
    return Array.from({ length: count }, (_, index) => interaction(
      `contact-${String(index).padStart(2, "0")}`,
      index % 2 ? "email" : "met",
      index === count - 1 ? addDaysToLocalDate(firstDate, spanDays) : firstDate
    ));
  }

  it.each([
    { count: 1, span: 0, stage: "new" },
    { count: 2, span: 29, stage: "new" },
    { count: 2, span: 30, stage: "growing" },
    { count: 4, span: 730, stage: "growing" },
    { count: 5, span: 179, stage: "growing" },
    { count: 5, span: 180, stage: "established" },
    { count: 5, span: 729, stage: "established" },
    { count: 5, span: 730, stage: "long_term" }
  ])("derives $stage at $count contacts / $span days", ({ count, span, stage }) => {
    const result = assessRelationship(bundle({ interactions: contactsAcross(count, span) }), clock);
    expect(result.relationshipStage).toMatchObject({ value: stage, contactCount: count, contactSpanDays: span });
  });

  it("does not demote an established relationship because it is inactive", () => {
    const result = assessRelationship(bundle({ interactions: contactsAcross(5, 180) }), {
      ...clock,
      now: "2035-08-14T12:00:00.000Z"
    });
    expect(result.relationshipStage.value).toBe("established");
  });

  it("marks creation fallback as estimated and chooses a stable equal-time last contact", () => {
    const noContact = assessRelationship(bundle(), clock);
    expect(noContact.relationshipAge.estimated).toBe(true);
    expect(noContact.relationshipAge.sourceInteractionId).toBeUndefined();
    expect(formatExplanation(noContact.relationshipAge.explanation)).toContain("no contact recorded yet");

    const sameTime = [
      interaction("z-contact", "email", "2026-08-13"),
      interaction("a-contact", "phone_call", "2026-08-13")
    ];
    const result = assessRelationship(bundle({ interactions: sameTime }), clock);
    expect(result.lastContact?.interactionId).toBe("a-contact");
    expect(result.relationshipAge).toMatchObject({ estimated: false, sourceInteractionId: "a-contact" });
  });

  it("recalculates after an Interaction is removed", () => {
    const records = [interaction("first", "met", "2026-01-01"), interaction("latest", "email", "2026-08-01")];
    expect(assessRelationship(bundle({ interactions: records }), clock).lastContact?.interactionId).toBe("latest");
    expect(assessRelationship(bundle({ interactions: records.slice(0, 1) }), clock).lastContact?.interactionId).toBe("first");
  });
});

describe("memory cues and intended-action context", () => {
  it("uses a due commitment before every other cue and excludes it from search context", () => {
    const result = assessRelationship(bundle({
      followUps: [followUp("commitment", "2026-08-14", { reason: "Introduce them to Sarah" })],
      facts: [fact("seeking", "seeking", "Looking for pilot sites")]
    }), clock);
    expect(result.memoryCue).toMatchObject({ source: "follow_up", sourceId: "commitment", text: "Introduce them to Sarah" });
    expect(result.searchContextCue).toMatchObject({ source: "memory_fact", sourceId: "seeking" });
  });

  it("uses the complete safe Fact order including explicitly enabled Family and Other", () => {
    const candidates = [
      fact("preference", "communication_preference", "email"),
      fact("seeking", "seeking", "Looking for pilot sites"),
      fact("interest", "interest", "Interested in simulation"),
      fact("introduced", "introduced_by", "Introduced by James"),
      fact("location", "location", "Based in Bristol"),
      fact("family", "family", "Has three children"),
      fact("other", "other", "Other context")
    ];
    const expected = ["preference", "seeking", "interest", "introduced", "location", "family", "other"];
    for (let index = 0; index < candidates.length; index += 1) {
      const result = assessRelationship(bundle({ facts: candidates.slice(index) }), clock);
      expect(result.memoryCue?.sourceId).toBe(expected[index]);
    }
  });

  it("ignores archived and cue-disabled Facts and uses updatedAt then ID ties", () => {
    const result = assessRelationship(bundle({ facts: [
      fact("archived", "interest", "Archived", { archivedAt: clock.now, updatedAt: instant("2026-08-10") }),
      fact("hidden", "interest", "Hidden", { showAsMemoryCue: false, updatedAt: instant("2026-08-11") }),
      fact("z-new", "interest", "Zed", { updatedAt: instant("2026-08-09") }),
      fact("a-new", "interest", "Alpha", { updatedAt: instant("2026-08-09") })
    ] }), clock);
    expect(result.memoryCue?.sourceId).toBe("a-new");
    expect(formatExplanation(result.memoryCue!.explanation)).toBe("From a memory fact you added on 1 July 2026.");
  });

  it("falls back to earliest Event-linked meeting, then deterministic current affiliation", () => {
    const earlyEvent = event("event-early", { name: "Early Fellowship" });
    const lateEvent = event("event-late", { name: "Late Conference" });
    const eventResult = assessRelationship(bundle({
      interactions: [
        interaction("late", "conference", "2026-07-10", { eventId: lateEvent.id }),
        interaction("early", "met", "2026-07-01", { eventId: earlyEvent.id })
      ],
      events: [lateEvent, earlyEvent],
      affiliations: [affiliation("affiliation")]
    }), clock);
    expect(eventResult.memoryCue).toMatchObject({ source: "event", sourceId: "event-early", text: "Met at Early Fellowship" });
    expect(formatExplanation(eventResult.memoryCue!.explanation)).toBe("From your first recorded meeting.");

    const affiliationResult = assessRelationship(bundle({ affiliations: [
      affiliation("older", { organisationName: "Older", startedOn: "2025-01-01" }),
      affiliation("z-current", { organisationName: "Zed", startedOn: "2026-01-01", createdAt: instant("2026-01-02") }),
      affiliation("a-current", { organisationName: "Alpha", startedOn: "2026-01-01", createdAt: instant("2026-01-02") })
    ] }), clock);
    expect(affiliationResult.memoryCue?.sourceId).toBe("a-current");
  });

  it("never derives a cue from free-form Note prose", () => {
    const result = assessRelationship(bundle({
      interactions: [interaction("private-note", "note_added", "2026-08-10", {
        summary: "Secret pilot sites and investor priority"
      })]
    }), clock);
    expect(result.memoryCue).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("Secret pilot sites");
  });

  it.each([
    "message", "email", "call", "arrange_meeting", "make_introduction",
    "send_update", "research_contact_route", "other"
  ] as const)("maps explicit FollowUp action %s as context", (actionType) => {
    const result = assessRelationship(bundle({
      followUps: [followUp("due", "2026-08-14", { actionType })],
      facts: [fact("preference", "communication_preference", "email")],
      contactMethods: [contactMethod("email", "email")]
    }), clock);
    expect(result.today?.intendedActionContext).toMatchObject({
      code: actionType,
      source: "follow_up",
      sourceId: "due"
    });
  });

  it.each([
    { preference: "whatsapp", method: "phone", code: "message" },
    { preference: "email", method: "email", code: "email" },
    { preference: "phone", method: "phone", code: "call" }
  ] as const)("uses available $preference preference as $code context", ({ preference, method, code }) => {
    const result = assessRelationship(bundle({
      person: person("person-one", { contactCadenceDays: 1 }),
      interactions: [interaction("first", "met", "2026-08-01"), interaction("latest", "email", "2026-08-10")],
      facts: [fact("preference", "communication_preference", preference)],
      contactMethods: [contactMethod("method", method)]
    }), clock);
    expect(result.today?.intendedActionContext).toMatchObject({ code, source: "communication_preference" });
  });

  it("falls through from an unavailable preference using preferred/created/ID method order", () => {
    const result = assessRelationship(bundle({
      person: person("person-one", { contactCadenceDays: 1 }),
      interactions: [interaction("first", "met", "2026-08-01"), interaction("latest", "phone_call", "2026-08-10")],
      facts: [fact("preference", "communication_preference", "email")],
      contactMethods: [
        contactMethod("older", "phone", { createdAt: instant("2025-01-01") }),
        contactMethod("preferred", "phone", { isPreferred: true, createdAt: instant("2026-01-01") }),
        contactMethod("archived-email", "email", { archivedAt: clock.now })
      ]
    }), clock);
    expect(result.today?.intendedActionContext).toMatchObject({
      code: "call",
      source: "contact_method",
      sourceId: "preferred"
    });
    expect(result.today?.intendedActionContext.explanation.code).toBe("intended_action.preference_unavailable_fallback");
  });

  it("returns Add contact details when no active method exists", () => {
    const result = assessRelationship(bundle({
      person: person("person-one", { contactCadenceDays: 1 }),
      interactions: [interaction("first", "met", "2026-08-01"), interaction("latest", "phone_call", "2026-08-10")]
    }), clock);
    expect(result.today?.intendedActionContext).toMatchObject({ code: "add_contact_details", source: "none" });
  });
});

describe("suggested reminders", () => {
  it("suggests seven days after the latest Event contact", () => {
    const fellowship = event();
    const result = assessRelationship(bundle({
      interactions: [interaction("met", "met", "2026-08-10", { eventId: fellowship.id })],
      events: [fellowship]
    }), clock);
    expect(result.suggestedReminder).toMatchObject({
      dueDate: "2026-08-17",
      rule: "event_contact",
      sourceInteractionId: "met"
    });
    expect(formatExplanation(result.suggestedReminder!.explanation)).toContain("7 days after you met at HealthTech Fellowship");
  });

  it("suggests thirty days after an introduction received", () => {
    const result = assessRelationship(bundle({
      interactions: [interaction("intro", "introduction_received", "2026-08-10")]
    }), clock);
    expect(result.suggestedReminder).toMatchObject({ dueDate: "2026-09-09", rule: "introduction_received" });
  });

  it("uses the latest contact plus cadence and permits an explicit trigger override", () => {
    const records = [
      interaction("earlier", "email", "2026-08-01"),
      interaction("later", "phone_call", "2026-08-10")
    ];
    const result = assessRelationship(bundle({
      person: person("person-one", { contactCadenceDays: 30 }),
      interactions: records
    }), clock);
    expect(result.suggestedReminder).toMatchObject({ dueDate: "2026-09-09", sourceInteractionId: "later" });
    const explicit = assessRelationship(bundle({
      person: person("person-one", { contactCadenceDays: 30 }),
      interactions: records,
      triggeringInteractionId: "earlier"
    }), clock);
    expect(explicit.suggestedReminder).toMatchObject({ dueDate: "2026-08-31", sourceInteractionId: "earlier" });
  });

  it("rejects an explicit trigger that is missing or not contact-counting", () => {
    expect(() => assessRelationship(bundle({
      interactions: [interaction("note", "note_added", "2026-08-10")],
      triggeringInteractionId: "note"
    }), clock)).toThrow(/triggering interaction must be a contact Interaction/);
  });

  it("returns no suggestion for no rule, tags alone, or a future pending plan", () => {
    const plain = assessRelationship(bundle({
      person: person("person-one", { tags: ["mentor", "investor"] }),
      interactions: [interaction("email", "email", "2026-08-10")]
    }), clock);
    expect(plain.suggestedReminder).toBeUndefined();
    const planned = assessRelationship(bundle({
      interactions: [interaction("intro", "introduction_received", "2026-08-10")],
      followUps: [followUp("future", "2026-08-20")]
    }), clock);
    expect(planned.suggestedReminder).toBeUndefined();
  });
});

describe("Reach Out state projection", () => {
  it.each([
    { entry: reachOut("completed", { intentStatus: "completed", lastCompletedAt: clock.now }), followUp: undefined, state: "completed" },
    { entry: reachOut("dormant", { intentStatus: "dormant" }), followUp: undefined, state: "dormant" },
    { entry: reachOut("active"), followUp: undefined, state: "active" },
    { entry: reachOut("overdue", { currentFollowUpId: "overdue-plan" }), followUp: followUp("overdue-plan", "2026-08-13", { reachOutEntryId: "overdue" }), state: "overdue" },
    { entry: reachOut("due", { currentFollowUpId: "due-plan" }), followUp: followUp("due-plan", "2026-08-14", { reachOutEntryId: "due" }), state: "active" },
    { entry: reachOut("waiting", { currentFollowUpId: "waiting-plan" }), followUp: followUp("waiting-plan", "2026-08-20", { reachOutEntryId: "waiting" }), state: "waiting" },
    { entry: reachOut("snoozed", { currentFollowUpId: "snoozed-plan" }), followUp: followUp("snoozed-plan", "2026-08-10", { reachOutEntryId: "snoozed", snoozedUntilDate: "2026-08-20" }), state: "snoozed" }
  ])("derives $state", ({ entry, followUp: plan, state }) => {
    expect(deriveReachOutDisplayState(entry, plan, "2026-08-14")).toBe(state);
  });

  it("returns Due and Upcoming as predicates and excludes removed history", () => {
    const dueEntry = reachOut("due", { currentFollowUpId: "due-plan" });
    const waitingEntry = reachOut("waiting", { currentFollowUpId: "waiting-plan" });
    const result = assessRelationship(bundle({
      followUps: [
        followUp("due-plan", "2026-08-14", { reachOutEntryId: dueEntry.id }),
        followUp("waiting-plan", "2026-08-20", { reachOutEntryId: waitingEntry.id })
      ],
      reachOutEntries: [dueEntry, waitingEntry, reachOut("removed", { removedAt: clock.now })]
    }), clock);
    expect(result.reachOutStates).toEqual([
      expect.objectContaining({ reachOutEntryId: "due", state: "active", due: true, upcoming: false }),
      expect.objectContaining({ reachOutEntryId: "waiting", state: "waiting", due: false, upcoming: true })
    ]);
  });

  it("keeps completed outreach without a replacement Completed and an active replacement Waiting", () => {
    const completed = reachOut("completed", { intentStatus: "completed", lastCompletedAt: clock.now });
    const active = reachOut("active-next", { currentFollowUpId: "next", lastCompletedAt: clock.now });
    const result = assessRelationship(bundle({
      reachOutEntries: [completed, active],
      followUps: [followUp("next", "2026-08-20", { reachOutEntryId: active.id })],
      interactions: [interaction("lifecycle", "follow_up_completed", "2026-08-14")]
    }), clock);
    expect(result.reachOutStates.map(({ reachOutEntryId, state }) => ({ reachOutEntryId, state }))).toEqual([
      { reachOutEntryId: "active-next", state: "waiting" },
      { reachOutEntryId: "completed", state: "completed" }
    ]);
    expect(result.lastContact).toBeUndefined();
    expect(result.relationshipStage.contactCount).toBe(0);
  });
});

describe("determinism and purity", () => {
  it("does not mutate frozen input and ignores every input-array order", () => {
    const fellowship = event();
    const source = bundle({
      interactions: [
        interaction("b", "email", "2026-08-02"),
        interaction("a", "met", "2026-08-01", { eventId: fellowship.id })
      ],
      followUps: [followUp("b-plan", "2026-08-14"), followUp("a-plan", "2026-08-14")],
      facts: [fact("b-fact", "interest", "B"), fact("a-fact", "interest", "A")],
      affiliations: [affiliation("b-affiliation"), affiliation("a-affiliation")],
      events: [fellowship]
    });
    const before = JSON.stringify(source);
    deepFreeze(source);
    const first = assessRelationship(source, clock);
    const shuffled = assessRelationship({
      ...source,
      interactions: [...source.interactions].reverse(),
      followUps: [...source.followUps].reverse(),
      facts: [...source.facts].reverse(),
      affiliations: [...source.affiliations].reverse(),
      events: [...source.events].reverse()
    }, clock);
    expect(JSON.stringify(source)).toBe(before);
    expect(shuffled).toEqual(first);
  });

  it("returns identical results on repeat and contains no score or private Note inference", () => {
    const source = bundle({
      interactions: [interaction("note", "note_added", "2026-08-01", { summary: "TOP SECRET LEAD SCORE 99" })],
      followUps: [followUp("due", "2026-08-14")]
    });
    const first = assessRelationship(source, clock);
    expect(assessRelationship(source, clock)).toEqual(first);
    const serialized = JSON.stringify(first).toLocaleLowerCase("en-US");
    expect(serialized).not.toContain("score");
    expect(serialized).not.toContain("top secret");
  });
});
