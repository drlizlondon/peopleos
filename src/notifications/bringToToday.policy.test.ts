import { describe, expect, it } from "vitest";
import { completeData } from "../test/fixtures";
import { buildTodayNotificationPlan } from "./policy";

function broughtToTodayData() {
  const data = completeData();
  data.people[0] = {
    ...data.people[0]!,
    broughtToTodayDate: "2026-08-14"
  };
  data.followUps[0] = {
    ...data.followUps[0]!,
    dueDate: "2026-08-20"
  };
  return data;
}

describe("Bring to Today notification planning", () => {
  it.each([
    ["before today's first notification", "2026-08-14T09:00:00.000Z", 4],
    ["after today's first notification", "2026-08-14T12:30:00.000Z", 3]
  ])("does not fill the gap before the original schedule %s", (_label, instant, remainingToday) => {
    const plan = buildTodayNotificationPlan(broughtToTodayData(), {
      now: new Date(instant),
      timeZone: "Europe/London",
      time: "12:00",
      activeMode: "all",
      limit: 12
    });

    expect(plan.filter((entry) => entry.localDate === "2026-08-14")).toHaveLength(remainingToday);
    expect([...new Set(plan.map((entry) => entry.localDate))].slice(0, 3))
      .toEqual(["2026-08-14", "2026-08-20", "2026-08-21"]);
    expect(plan.some((entry) => entry.localDate > "2026-08-14" && entry.localDate < "2026-08-20"))
      .toBe(false);
  });

  it("does not jump over another person's earlier ordinary schedule while waiting to resume", () => {
    const data = broughtToTodayData();
    data.people.push({
      ...data.people[0]!,
      id: "person-earlier",
      displayName: "Earlier Person",
      broughtToTodayDate: undefined
    });
    data.followUps.push({
      ...data.followUps[0]!,
      id: "follow-up-earlier",
      personId: "person-earlier",
      reachOutEntryId: undefined,
      dueDate: "2026-08-17"
    });

    const plan = buildTodayNotificationPlan(data, {
      now: new Date("2026-08-14T12:30:00.000Z"),
      timeZone: "Europe/London",
      time: "12:00",
      activeMode: "all",
      limit: 12
    });

    expect([...new Set(plan.map((entry) => entry.localDate))]).toEqual([
      "2026-08-14",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19"
    ]);
  });

  it("resumes the day after a date-specific skip before jumping to a later Person", () => {
    const data = broughtToTodayData();
    data.people[0] = { ...data.people[0]!, broughtToTodayDate: undefined };
    data.followUps[0] = { ...data.followUps[0]!, dueDate: "2026-08-20" };
    data.todaySkips.push({
      id: `${data.people[0]!.id}:2026-08-20`,
      personId: data.people[0]!.id,
      localDate: "2026-08-20",
      createdAt: "2026-08-20T08:00:00.000Z"
    });
    data.people.push({ ...data.people[0]!, id: "person-later", displayName: "Later Person" });
    data.followUps.push({
      ...data.followUps[0]!,
      id: "follow-up-later",
      personId: "person-later",
      dueDate: "2026-08-25"
    });

    const plan = buildTodayNotificationPlan(data, {
      now: new Date("2026-08-20T09:00:00.000Z"),
      timeZone: "Europe/London",
      time: "12:00",
      activeMode: "all",
      limit: 8
    });

    expect([...new Set(plan.map((entry) => entry.localDate))]).toEqual(["2026-08-21", "2026-08-22"]);
  });
});
