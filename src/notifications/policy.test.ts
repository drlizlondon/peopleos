import { describe, expect, it } from "vitest";
import { buildTodayFromData } from "../application/relationshipEngineQueries";
import { addDaysToLocalDate } from "../domain/followUpPolicy";
import { RELATIONSHIP_ENGINE_POLICY_VERSION } from "../relationship-engine";
import { completeData } from "../test/fixtures";
import {
  buildTodayNotificationPlan,
  buildTodayNotificationPlanningResult,
  isTodayNotificationId,
  todayNotificationId,
  TODAY_NOTIFICATION_LIMIT
} from "./policy";

const timeZone = "Europe/London";
const now = new Date("2026-08-01T09:00:00.000Z");

function plan(data = completeData()) {
  return buildTodayNotificationPlan(data, {
    now,
    timeZone,
    time: "12:00",
    activeMode: "all"
  });
}

function incompleteRegularScheduleData() {
  const data = completeData();
  data.people[0] = {
    ...data.people[0]!,
    contactCadence: { value: 1, unit: "days" },
    contactCadenceDays: undefined
  };
  data.interactions = [];
  data.followUps = [];
  data.followUpEvents = [];
  data.todaySkips = [];
  return data;
}

function engineCount(data: ReturnType<typeof completeData>, localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  const at = new Date(year, month - 1, day, 12, 0, 0, 0);
  return buildTodayFromData(data, {
    now: at.toISOString(),
    timeZone,
    policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
  }).totalCount;
}

function firstEngineDate(data: ReturnType<typeof completeData>, start = "2026-08-01"): string | undefined {
  let localDate = start;
  for (let day = 0; day < 500; day += 1) {
    if (engineCount(data, localDate) > 0) return localDate;
    localDate = addDaysToLocalDate(localDate, 1);
  }
  return undefined;
}

describe("Today notification planning", () => {
  it("reports an incomplete regular schedule without sending it to the native scheduler", () => {
    const data = incompleteRegularScheduleData();
    const planning = buildTodayNotificationPlanningResult(data, {
      now,
      timeZone,
      time: "12:00",
      activeMode: "all"
    });

    expect(planning).toEqual({
      entries: [],
      incompleteRegularSchedulePersonIds: ["person-sarah"]
    });
    expect(buildTodayNotificationPlan(data, {
      now,
      timeZone,
      time: "12:00",
      activeMode: "all"
    })).toEqual([]);
  });

  it("keeps incomplete regular schedules out of notifications across a London date boundary", () => {
    const data = incompleteRegularScheduleData();
    for (const instant of ["2026-03-28T23:59:00.000Z", "2026-03-29T00:01:00.000Z"]) {
      const planning = buildTodayNotificationPlanningResult(data, {
        now: new Date(instant),
        timeZone,
        time: "12:00",
        activeMode: "all"
      });
      expect(planning.entries).toEqual([]);
      expect(planning.incompleteRegularSchedulePersonIds).toEqual(["person-sarah"]);
    }
  });

  it("begins notification planning only after the regular schedule has a start date", () => {
    const data = incompleteRegularScheduleData();
    data.followUps = [{
      id: "initial-schedule-sarah",
      revision: 1,
      personId: "person-sarah",
      dueDate: "2026-08-02",
      reason: "Keep in touch",
      actionType: "message",
      status: "pending",
      suggestedByRule: "initial_schedule",
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z"
    }];

    const planning = buildTodayNotificationPlanningResult(data, {
      now,
      timeZone,
      time: "12:00",
      activeMode: "all"
    });
    expect(planning.incompleteRegularSchedulePersonIds).toEqual([]);
    expect(planning.entries[0]).toMatchObject({
      localDate: "2026-08-02",
      body: "People are waiting on your list today."
    });
    expect(JSON.stringify(planning.entries)).not.toContain("person-sarah");
  });

  it("precomputes a private rolling schedule from the authoritative Today rules", () => {
    const entries = plan();
    expect(entries).toHaveLength(TODAY_NOTIFICATION_LIMIT);
    expect(entries[0]).toMatchObject({
      localDate: "2026-08-08",
      title: "PeopleOS",
      body: "People are waiting on your list today.",
      extra: { kind: "today-summary", destination: "today" }
    });
    expect(entries[0]?.at.getHours()).toBe(12);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("Sarah");
    expect(serialized).not.toContain("pilot");
    expect(serialized).not.toContain("person-sarah");
    expect(serialized).not.toContain("follow-up-sarah");
  });

  it("uses the actual count only for a same-day reminder scheduled ahead of time", () => {
    const data = completeData();
    data.followUps[0]!.dueDate = "2026-08-01";
    data.todaySkips = [];
    expect(plan(data)[0]).toMatchObject({
      localDate: "2026-08-01",
      body: "1 person is on your list today."
    });

    const afterReminder = buildTodayNotificationPlan(data, {
      now: new Date("2026-08-01T12:30:00.000Z"),
      timeZone,
      time: "12:00",
      activeMode: "all"
    });
    expect(afterReminder[0]).toMatchObject({
      localDate: "2026-08-02",
      body: "People are waiting on your list today."
    });
  });

  it("honours the active relationship mode and date-specific Today skips", () => {
    expect(buildTodayNotificationPlan(completeData(), {
      now,
      timeZone,
      time: "12:00",
      activeMode: "professional"
    })).toEqual([]);

    const skipped = completeData();
    skipped.todaySkips.push({
      id: "person-sarah:2026-08-08",
      personId: "person-sarah",
      localDate: "2026-08-08",
      createdAt: "2026-08-01T10:00:00.000Z"
    });
    expect(plan(skipped)[0]?.localDate).toBe("2026-08-09");
  });

  it("moves notification forecasting to a Person’s chosen Today return date", () => {
    const paused = completeData();
    paused.people[0] = {
      ...paused.people[0]!,
      todayPausedUntilDate: "2026-08-20"
    };

    const entries = plan(paused);
    expect(entries[0]?.localDate).toBe("2026-08-20");
    expect(entries[0]?.localDate).toBe(firstEngineDate(paused));
    expect(JSON.stringify(entries)).not.toContain("person-sarah");
  });

  it("matches the first non-empty engine date for FollowUp, new-relationship and cadence rules", () => {
    const dueFollowUp = completeData();
    expect(plan(dueFollowUp)[0]?.localDate).toBe(firstEngineDate(dueFollowUp));

    const cadenceBeforeNewRelationship = completeData();
    cadenceBeforeNewRelationship.followUps = [];
    cadenceBeforeNewRelationship.followUpEvents = [];
    cadenceBeforeNewRelationship.reachOutEntries = [];
    cadenceBeforeNewRelationship.reachOutEvents = [];
    cadenceBeforeNewRelationship.people[0] = {
      ...cadenceBeforeNewRelationship.people[0]!,
      contactCadence: { value: 3, unit: "days" },
      contactCadenceDays: undefined
    };
    expect(plan(cadenceBeforeNewRelationship)[0]?.localDate).toBe("2026-08-04");
    expect(plan(cadenceBeforeNewRelationship)[0]?.localDate)
      .toBe(firstEngineDate(cadenceBeforeNewRelationship));

    const cadenceAfterCompletedPlan = completeData();
    cadenceAfterCompletedPlan.followUps[0] = {
      ...cadenceAfterCompletedPlan.followUps[0]!,
      status: "completed",
      completedAt: "2026-08-08T12:00:00.000Z",
      createdAt: "2026-08-02T12:00:00.000Z"
    };
    expect(plan(cadenceAfterCompletedPlan)[0]?.localDate)
      .toBe(firstEngineDate(cadenceAfterCompletedPlan));
  });

  it("rejects invalid times and limits before scheduling", () => {
    expect(() => buildTodayNotificationPlan(completeData(), {
      now,
      timeZone,
      time: "25:00",
      activeMode: "all"
    })).toThrow(/valid reminder time/);
    expect(() => buildTodayNotificationPlan(completeData(), {
      now,
      timeZone,
      time: "12:00",
      activeMode: "all",
      limit: TODAY_NOTIFICATION_LIMIT + 1
    })).toThrow(/Notification limit/);
    expect(isTodayNotificationId(todayNotificationId("2026-08-11"))).toBe(true);
    expect(isTodayNotificationId(1_520_261_332)).toBe(false);
    expect(isTodayNotificationId(42)).toBe(false);
  });
});
