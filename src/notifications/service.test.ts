import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewBackup, restoreBackup } from "../data/backup";
import { closeDatabase, getDatabase } from "../data/client";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import { BACKUP_SCHEMA_VERSION, DATABASE_NAME } from "../domain/schema";
import { StaleRevisionError } from "../data/repositories";
import { completeData, fixedNow } from "../test/fixtures";
import type { TodayNotificationAdapter, TodayNotificationPermission } from "./capacitorAdapter";
import { todayNotificationId, type TodayNotificationPlanEntry } from "./policy";
import {
  disableTodayNotifications,
  enableTodayNotifications,
  reconcileTodayNotifications,
  recoverTodayNotificationSettings
} from "./service";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function fakeAdapter(initialPermission: TodayNotificationPermission = "granted") {
  let permission = initialPermission;
  let requestedPermission: TodayNotificationPermission = initialPermission;
  const pending = new Set([1_520_260_731]);
  const droppedScheduleIds = new Set<number>();
  const scheduled: TodayNotificationPlanEntry[][] = [];
  const cancelled: number[][] = [];
  const adapter: TodayNotificationAdapter = {
    checkPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => {
      permission = requestedPermission;
      return permission;
    }),
    pendingIds: vi.fn(async () => [...pending]),
    cancel: vi.fn(async (ids: number[]) => {
      cancelled.push(ids);
      ids.forEach((id) => pending.delete(id));
    }),
    schedule: vi.fn(async (entries: TodayNotificationPlanEntry[]) => {
      scheduled.push(entries);
      entries.forEach((entry) => {
        if (!droppedScheduleIds.has(entry.id)) pending.add(entry.id);
      });
    }),
    addTodayActionListener: vi.fn(async () => () => undefined)
  };
  return {
    adapter,
    scheduled,
    cancelled,
    pending,
    droppedScheduleIds,
    setPermission(value: TodayNotificationPermission) { permission = value; },
    setRequestedPermission(value: TodayNotificationPermission) { requestedPermission = value; }
  };
}

async function openSeededDatabase(label: string, enabled: boolean): Promise<PeopleOsDatabase> {
  const name = `peopleos-notifications-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  const data = completeData();
  data.appSettings[0] = {
    ...data.appSettings[0]!,
    todaySummaryNotificationsEnabled: enabled,
    todaySummaryNotificationTime: "12:00"
  };
  await restoreBackup(db, previewBackup({
    product: "peopleos",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: fixedNow,
    data
  }), fixedNow);
  return db;
}

beforeEach(async () => {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
});

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("native Today notification reconciliation", () => {
  it("cancels and replaces PeopleOS requests with a bounded private schedule", async () => {
    const db = await openSeededDatabase("granted", true);
    const native = fakeAdapter("granted");
    const state = await reconcileTodayNotifications(
      db,
      native.adapter,
      new Date("2026-08-01T09:00:00.000Z")
    );
    expect(native.cancelled).toEqual([[1_520_260_731]]);
    expect(native.scheduled[0]).toHaveLength(30);
    expect(state).toEqual({
      supported: true,
      permission: "granted",
      scheduledCount: 30,
      incompleteRegularScheduleCount: 0
    });
  });

  it("reports an incomplete regular schedule and installs no private reminder for it", async () => {
    const db = await openSeededDatabase("incomplete-regular-schedule", true);
    const person = (await db.get("people", "person-sarah"))!;
    await db.put("people", {
      ...person,
      contactCadence: { value: 1, unit: "days" },
      contactCadenceDays: undefined,
      revision: person.revision + 1
    });
    await db.clear("interactions");
    await db.clear("followUps");
    await db.clear("followUpEvents");
    await db.clear("todaySkips");

    const native = fakeAdapter("granted");
    const state = await reconcileTodayNotifications(
      db,
      native.adapter,
      new Date("2026-08-01T09:00:00.000Z")
    );

    expect(state).toEqual({
      supported: true,
      permission: "granted",
      scheduledCount: 0,
      incompleteRegularScheduleCount: 1
    });
    expect(native.scheduled).toEqual([]);
    expect(native.cancelled).toEqual([[1_520_260_731]]);
    expect(native.pending).toEqual(new Set());
  });

  it.each(["prompt", "denied"] as const)("schedules nothing when permission is %s", async (permission) => {
    const db = await openSeededDatabase(permission, true);
    const native = fakeAdapter(permission);
    const state = await reconcileTodayNotifications(db, native.adapter);
    expect(native.cancelled).toEqual([[1_520_260_731]]);
    expect(native.scheduled).toEqual([]);
    expect(state.scheduledCount).toBe(0);
  });

  it("cancels pending requests while reminders are off", async () => {
    const db = await openSeededDatabase("off", false);
    const native = fakeAdapter("granted");
    await reconcileTodayNotifications(db, native.adapter);
    expect(native.cancelled).toEqual([[1_520_260_731]]);
    expect(native.scheduled).toEqual([]);
  });

  it("replaces the schedule after a time change and cancels everything when Today is empty", async () => {
    const db = await openSeededDatabase("time-change", true);
    const native = fakeAdapter("granted");
    const at = new Date("2026-08-01T09:00:00.000Z");
    await reconcileTodayNotifications(db, native.adapter, at);
    expect(native.scheduled.at(-1)?.[0]?.at.getHours()).toBe(12);

    const settings = (await db.get("appSettings", "app"))!;
    await db.put("appSettings", {
      ...settings,
      todaySummaryNotificationTime: "08:30",
      revision: settings.revision + 1,
      updatedAt: "2026-08-01T10:00:00.000Z"
    });
    await reconcileTodayNotifications(db, native.adapter, at);
    expect(native.scheduled.at(-1)?.[0]?.at.getHours()).toBe(8);
    expect(native.scheduled.at(-1)?.[0]?.at.getMinutes()).toBe(30);

    await db.clear("people");
    const empty = await reconcileTodayNotifications(db, native.adapter, at);
    expect(empty.scheduledCount).toBe(0);
    expect(native.pending).toEqual(new Set());
  });

  it("requests permission only from the explicit enable action", async () => {
    const db = await getDatabase();
    const settings = (await db.get("appSettings", "app"))!;
    const native = fakeAdapter("prompt");
    native.setRequestedPermission("granted");
    const saved = await enableTodayNotifications(settings, native.adapter);
    expect(native.adapter.requestPermission).toHaveBeenCalledOnce();
    expect(saved).toMatchObject({ todaySummaryNotificationsEnabled: true });
  });

  it("keeps reminders off after permission denial and cancels on disable", async () => {
    const db = await getDatabase();
    const settings = (await db.get("appSettings", "app"))!;
    const denied = fakeAdapter("prompt");
    denied.setRequestedPermission("denied");
    const unchanged = await enableTodayNotifications(settings, denied.adapter);
    expect(unchanged.todaySummaryNotificationsEnabled).toBe(false);
    expect((await db.get("appSettings", "app"))?.todaySummaryNotificationsEnabled).toBe(false);
    expect(denied.cancelled).toEqual([[1_520_260_731]]);

    const granted = fakeAdapter("granted");
    const enabled = await enableTodayNotifications(unchanged, granted.adapter);
    const disabled = await disableTodayNotifications(enabled, granted.adapter);
    expect(disabled.todaySummaryNotificationsEnabled).toBe(false);
    expect(granted.cancelled.at(-1)).toEqual([1_520_260_731]);
  });

  it("keeps the previous plan and reports failure when iOS does not retain a replacement", async () => {
    const db = await openSeededDatabase("partial-native-schedule", true);
    const native = fakeAdapter("granted");
    native.droppedScheduleIds.add(todayNotificationId("2026-08-08"));
    await expect(reconcileTodayNotifications(
      db,
      native.adapter,
      new Date("2026-08-01T09:00:00.000Z")
    )).rejects.toThrow(/retained by iOS/);
    expect(native.adapter.schedule).toHaveBeenCalledTimes(3);
    expect(native.pending.has(1_520_260_731)).toBe(true);
    expect(native.cancelled).toEqual([]);
  });

  it("reloads the current Settings record only for a stale-revision conflict", async () => {
    const current = await (await getDatabase()).get("appSettings", "app");
    await expect(recoverTodayNotificationSettings(new StaleRevisionError())).resolves.toEqual(current);
    await expect(recoverTodayNotificationSettings(new Error("offline"))).resolves.toBeUndefined();
  });
});
