import { describe, expect, it } from "vitest";
import type { ContactCadence, FollowUp, Interaction, Person } from "../domain/schema";
import {
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  assessRelationship,
  nextTodayEligibleLocalDate,
  resolveRelationshipScheduleState,
  type RelationshipClock,
  type RelationshipPersonBundle
} from ".";

const clock: RelationshipClock = {
  now: "2026-08-14T12:00:00.000Z",
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
};

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-one",
    revision: 1,
    displayName: "Sarah",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides
  };
}

function interaction(date: string): Interaction {
  return {
    id: `contact-${date}`,
    revision: 1,
    personId: "person-one",
    kind: "contacted",
    occurredAt: `${date}T12:00:00.000Z`,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`
  };
}

function followUp(date: string): FollowUp {
  return {
    id: `follow-up-${date}`,
    revision: 1,
    personId: "person-one",
    dueDate: date,
    reason: "Keep in touch",
    actionType: "message",
    suggestedByRule: "initial_schedule",
    status: "pending",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z"
  };
}

function bundle(overrides: Partial<RelationshipPersonBundle> = {}): RelationshipPersonBundle {
  return {
    person: person({ contactCadence: { value: 1, unit: "days" } }),
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

describe("Regular contact scheduling invariant", () => {
  it("explicitly detects a valid frequency with no real or scheduled anchor as incomplete", () => {
    const candidate = bundle();

    expect(resolveRelationshipScheduleState(candidate, clock)).toEqual({
      kind: "incomplete_regular_schedule"
    });
    const assessment = assessRelationship(candidate, clock);
    expect(assessment.scheduleState).toEqual({ kind: "incomplete_regular_schedule" });
    expect(assessment.today).toBeUndefined();
    expect(nextTodayEligibleLocalDate(candidate, clock)).toBeUndefined();
  });

  it("does not let a stray Pause date mask an incomplete Regular contact setup", () => {
    const candidate = bundle({
      person: person({
        contactCadence: { value: 1, unit: "days" },
        todayPausedUntilDate: "2026-08-21"
      })
    });
    expect(resolveRelationshipScheduleState(candidate, clock)).toEqual({
      kind: "incomplete_regular_schedule"
    });
  });

  const initialScheduleCases = [
    [{ value: 1, unit: "days" }, "2026-08-14", "2026-08-14"],
    [{ value: 1, unit: "days" }, "2026-08-15", "2026-08-15"],
    [{ value: 1, unit: "weeks" }, "2026-08-14", "2026-08-14"],
    [{ value: 1, unit: "weeks" }, "2026-08-15", "2026-08-15"]
  ] satisfies Array<[ContactCadence, string, string]>;

  it.each(initialScheduleCases)("uses a %j frequency with private initial schedule %s as the shared date", (cadence, startDate, expected) => {
    const candidate = bundle({
      person: person({ contactCadence: cadence }),
      followUps: [followUp(startDate)]
    });
    expect(resolveRelationshipScheduleState(candidate, clock)).toEqual({
      kind: "scheduled",
      localDate: expected
    });
    expect(nextTodayEligibleLocalDate(candidate, clock)).toBe(expected);
  });

  const recurrenceCases = [
    [{ value: 1, unit: "weeks" }, "2026-08-07", "2026-08-14"],
    [{ value: 1, unit: "months" }, "2026-07-15", "2026-08-14"],
    [{ value: 5, unit: "days" }, "2026-08-09", "2026-08-14"]
  ] satisfies Array<[ContactCadence, string, string]>;

  it.each(recurrenceCases)("continues %j recurrence from a real contact", (cadence, contactDate, expected) => {
    const candidate = bundle({
      person: person({ contactCadence: cadence }),
      interactions: [interaction(contactDate)]
    });
    expect(resolveRelationshipScheduleState(candidate, clock)).toEqual({
      kind: "scheduled",
      localDate: expected
    });
  });

  it.each([
    ["2026-08-14", "2026-08-15"],
    ["2026-08-13", "2026-08-14"],
    ["2026-08-10", "2026-08-14"]
  ])("continues daily recurrence from real contact on %s", (contactDate, expected) => {
    const candidate = bundle({ interactions: [interaction(contactDate)] });
    expect(resolveRelationshipScheduleState(candidate, clock)).toEqual({
      kind: "scheduled",
      localDate: expected
    });
  });

  it("does not classify people without Regular contact, or inactive people, as incomplete", () => {
    expect(resolveRelationshipScheduleState(bundle({ person: person() }), clock)).toEqual({
      kind: "not_scheduled"
    });
    expect(resolveRelationshipScheduleState(bundle({
      person: person({
        contactCadence: { value: 1, unit: "days" },
        archivedAt: "2026-08-10T12:00:00.000Z"
      })
    }), clock)).toEqual({ kind: "not_scheduled" });
    expect(resolveRelationshipScheduleState(bundle({
      person: person({ todayPausedUntilDate: "2026-08-21" })
    }), clock)).toEqual({ kind: "not_scheduled" });
  });

  it("uses Europe/London calendar boundaries rather than the host date", () => {
    const candidate = bundle({ interactions: [interaction("2026-08-13")] });
    const beforeMidnight = { ...clock, now: "2026-08-14T22:59:59.000Z" };
    const afterMidnight = { ...clock, now: "2026-08-14T23:00:00.000Z" };

    expect(resolveRelationshipScheduleState(candidate, beforeMidnight)).toEqual({
      kind: "scheduled",
      localDate: "2026-08-14"
    });
    expect(resolveRelationshipScheduleState(candidate, afterMidnight)).toEqual({
      kind: "scheduled",
      localDate: "2026-08-15"
    });
  });

  it("treats a future Today pause as the shared schedule date without changing recurrence", () => {
    const candidate = bundle({
      person: person({
        contactCadence: { value: 1, unit: "days" },
        todayPausedUntilDate: "2026-08-21"
      }),
      interactions: [interaction("2026-08-10")],
      followUps: [followUp("2026-08-12")]
    });

    expect(resolveRelationshipScheduleState(candidate, clock)).toEqual({
      kind: "scheduled",
      localDate: "2026-08-21"
    });
    expect(nextTodayEligibleLocalDate(candidate, clock)).toBe("2026-08-21");
    expect(assessRelationship(candidate, clock).today).toBeUndefined();
    expect(candidate.person.contactCadence).toEqual({ value: 1, unit: "days" });
    expect(candidate.interactions).toHaveLength(1);

    const returnDateClock = { ...clock, now: "2026-08-21T12:00:00.000Z" };
    expect(resolveRelationshipScheduleState(candidate, returnDateClock)).toEqual({
      kind: "scheduled",
      localDate: "2026-08-21"
    });
    expect(assessRelationship(candidate, returnDateClock).today).toBeDefined();
  });

  it("never lets a Pause bring an already-later schedule forward", () => {
    const candidate = bundle({
      person: person({
        contactCadence: { value: 1, unit: "days" },
        todayPausedUntilDate: "2026-08-21"
      }),
      followUps: [followUp("2026-08-30")]
    });
    expect(resolveRelationshipScheduleState(candidate, clock)).toEqual({
      kind: "scheduled",
      localDate: "2026-08-30"
    });
  });

  it("places every completed Regular contact setup in exactly Today or future Upcoming", () => {
    const completedSetups = [
      bundle({ followUps: [followUp("2026-08-14")] }),
      bundle({ followUps: [followUp("2026-08-15")] }),
      bundle({ interactions: [interaction("2026-08-14")] }),
      bundle({ interactions: [interaction("2026-08-13")] }),
      bundle({ interactions: [interaction("2026-08-01")] }),
      bundle({
        person: person({ contactCadence: { value: 1, unit: "weeks" } }),
        interactions: [interaction("2026-08-08")]
      }),
      bundle({
        person: person({ contactCadence: { value: 1, unit: "months" } }),
        interactions: [interaction("2026-07-16")]
      }),
      bundle({
        person: person({
          contactCadence: { value: 1, unit: "days" },
          todayPausedUntilDate: "2026-08-21"
        }),
        interactions: [interaction("2026-08-10")]
      })
    ];

    for (const candidate of completedSetups) {
      const state = resolveRelationshipScheduleState(candidate, clock);
      const assessment = assessRelationship(candidate, clock);
      expect(state.kind).toBe("scheduled");
      if (state.kind !== "scheduled") continue;
      const inToday = assessment.today !== undefined;
      const inFutureUpcoming = state.localDate > assessment.localDate;
      expect(Number(inToday) + Number(inFutureUpcoming)).toBe(1);
    }
  });
});
