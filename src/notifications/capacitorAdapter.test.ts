import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ isNative: true, platform: "ios" }));

type ScheduleRequest = {
  notifications: Array<{ id: number; actionTypeId?: string; sound?: string; title: string; body: string }>;
};

const scheduleRequests = vi.hoisted(() => [] as ScheduleRequest[]);

const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ display: "granted" })),
  requestPermissions: vi.fn(async () => ({ display: "granted" })),
  getPending: vi.fn(async () => ({ notifications: [] as Array<{ id: number }> })),
  cancel: vi.fn(async () => undefined),
  schedule: vi.fn(async (request: ScheduleRequest) => { scheduleRequests.push(request); }),
  registerActionTypes: vi.fn(async () => undefined),
  addListener: vi.fn(async (
    _event: string,
    handler: (payload: { actionId: string; notification: { id: number; extra?: Record<string, unknown> } }) => void
  ) => {
    plugin.handler = handler;
    return { remove: vi.fn(async () => undefined) };
  }),
  handler: undefined as
    | ((payload: { actionId: string; notification: { id: number; extra?: Record<string, unknown> } }) => void)
    | undefined
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => native.platform
  }
}));

vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: plugin }));

import {
  createCapacitorTodayNotificationAdapter,
  isTodayNotificationsSupported,
  NOT_NOW_ACTION_ID,
  TODAY_ACTION_TYPE_ID,
  TODAY_NOTIFICATION_SOUND,
  VIEW_TODAY_ACTION_ID,
  type TodayNotificationAction
} from "./capacitorAdapter";
import { todayNotificationId, type TodayNotificationPlanEntry } from "./policy";

function entry(occurrence: number): TodayNotificationPlanEntry {
  return {
    id: todayNotificationId("2026-08-01", occurrence),
    localDate: "2026-08-01",
    occurrence,
    at: new Date(2026, 7, 1, 9 + occurrence * 3, 0, 0, 0),
    title: "PeopleOS",
    body: "1 person is on your list today.",
    extra: { kind: "today-summary", destination: "today" }
  };
}

function todaySummary(id: number) {
  return { id, extra: { kind: "today-summary", destination: "today" } };
}

beforeEach(() => {
  native.isNative = true;
  native.platform = "ios";
  plugin.handler = undefined;
  scheduleRequests.length = 0;
  Object.values(plugin).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  });
});

describe("Today notification Capacitor adapter", () => {
  it("stays unavailable outside the native iPhone app", () => {
    native.isNative = false;
    expect(isTodayNotificationsSupported()).toBe(false);
    expect(createCapacitorTodayNotificationAdapter()).toBeUndefined();
  });

  it("registers View Today and Not Now, and attaches the category to every occurrence", async () => {
    const adapter = createCapacitorTodayNotificationAdapter()!;
    await adapter.schedule([entry(0), entry(1)]);

    expect(plugin.registerActionTypes).toHaveBeenCalledWith({
      types: [{
        id: TODAY_ACTION_TYPE_ID,
        actions: [
          { id: VIEW_TODAY_ACTION_ID, title: "View Today", foreground: true },
          { id: NOT_NOW_ACTION_ID, title: "Not Now" }
        ]
      }]
    });
    const scheduled = scheduleRequests.at(-1)!;
    expect(scheduled.notifications).toHaveLength(2);
    expect(scheduled.notifications.every((item) => item.actionTypeId === TODAY_ACTION_TYPE_ID)).toBe(true);
    expect(JSON.stringify(scheduled.notifications)).not.toContain("Sarah");
  });

  it("plays the bundled reminder sound rather than relying on a missing-file fallback", async () => {
    const adapter = createCapacitorTodayNotificationAdapter()!;
    await adapter.schedule([entry(0)]);

    // The plugin turns `sound` into UNNotificationSound(named:), so the value
    // must name a file that is actually in the app bundle.
    expect(scheduleRequests.at(-1)!.notifications[0]!.sound).toBe(TODAY_NOTIFICATION_SOUND);
    expect(TODAY_NOTIFICATION_SOUND).toMatch(/\.(wav|aiff|caf)$/);
    expect(existsSync(resolve(process.cwd(), "ios/App/App", TODAY_NOTIFICATION_SOUND))).toBe(true);
  });

  it("reports opening for a tap and View Today, and Not Now as its own action", async () => {
    const adapter = createCapacitorTodayNotificationAdapter()!;
    const actions: TodayNotificationAction[] = [];
    await adapter.addTodayActionListener((action) => actions.push(action));

    plugin.handler?.({ actionId: "tap", notification: todaySummary(todayNotificationId("2026-08-01", 0)) });
    plugin.handler?.({ actionId: VIEW_TODAY_ACTION_ID, notification: todaySummary(todayNotificationId("2026-08-01", 1)) });
    plugin.handler?.({ actionId: NOT_NOW_ACTION_ID, notification: todaySummary(todayNotificationId("2026-08-01", 2)) });

    expect(actions).toEqual(["open", "open", "not-now"]);
  });

  it("ignores actions on notifications PeopleOS did not schedule", async () => {
    const adapter = createCapacitorTodayNotificationAdapter()!;
    const actions: TodayNotificationAction[] = [];
    await adapter.addTodayActionListener((action) => actions.push(action));

    plugin.handler?.({ actionId: "tap", notification: { id: 42, extra: { kind: "today-summary", destination: "today" } } });
    plugin.handler?.({ actionId: "tap", notification: { id: todayNotificationId("2026-08-01", 0), extra: { kind: "other" } } });
    plugin.handler?.({ actionId: "unknown", notification: todaySummary(todayNotificationId("2026-08-01", 0)) });

    expect(actions).toEqual([]);
  });

  it("reports only PeopleOS reminders as pending, including single-notification identifiers", async () => {
    plugin.getPending.mockResolvedValueOnce({
      notifications: [
        { id: todayNotificationId("2026-08-01", 3) },
        { id: 1_500_000_000 + 20_260_731 },
        { id: 99 }
      ]
    });
    const adapter = createCapacitorTodayNotificationAdapter()!;
    expect(await adapter.pendingIds()).toEqual([
      todayNotificationId("2026-08-01", 3),
      1_500_000_000 + 20_260_731
    ]);
  });
});
