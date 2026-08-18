import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewBackup, restoreBackup } from "../data/backup";
import { closeDatabase } from "../data/client";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { BACKUP_SCHEMA_VERSION, DATABASE_NAME } from "../domain/schema";
import { completeData, fixedNow } from "../test/fixtures";
import type { TodayNotificationAdapter, TodayNotificationPermission } from "./capacitorAdapter";
import { todayNotificationId, type TodayNotificationPlanEntry } from "./policy";
import {
  reconcileTodayNotifications,
  type ReminderCycleStorage,
  type TodayNotificationReconcileContext,
  type TodayReminderCycle
} from "./service";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

/**
 * London local time. The fixture Person is due on 2026-08-01, so a reminder
 * time of 09:00 gives the ladder 09:00, 12:00, 15:00, 18:00, 21:00.
 */
const REMINDER_TIME = "09:00";
const DUE_DATE = "2026-08-01";

function at(clock: string): Date {
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(2026, 7, 1, hour, minute, 0, 0);
}

function nextDayAt(clock: string): Date {
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(2026, 7, 2, hour, minute, 0, 0);
}

function fakeAdapter(initialPermission: TodayNotificationPermission = "granted") {
  let permission = initialPermission;
  const pending = new Set<number>();
  const scheduled: TodayNotificationPlanEntry[][] = [];
  const cancelled: number[][] = [];
  const adapter: TodayNotificationAdapter = {
    checkPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    pendingIds: vi.fn(async () => [...pending]),
    cancel: vi.fn(async (ids: number[]) => {
      cancelled.push(ids);
      ids.forEach((id) => pending.delete(id));
    }),
    schedule: vi.fn(async (entries: TodayNotificationPlanEntry[]) => {
      scheduled.push(entries);
      entries.forEach((entry) => pending.add(entry.id));
    }),
    addTodayActionListener: vi.fn(async () => () => undefined)
  };
  return {
    adapter,
    scheduled,
    cancelled,
    pending,
    setPermission(value: TodayNotificationPermission) { permission = value; }
  };
}

async function openSeededDatabase(
  label: string,
  overrides: { enabled?: boolean; time?: string; empty?: boolean } = {}
): Promise<PeopleOsDatabase> {
  const name = `peopleos-reminder-cycle-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  const data = completeData();
  data.appSettings[0] = {
    ...data.appSettings[0]!,
    todaySummaryNotificationsEnabled: overrides.enabled ?? true,
    todaySummaryNotificationTime: overrides.time ?? REMINDER_TIME
  };
  data.followUps[0] = { ...data.followUps[0]!, dueDate: DUE_DATE };
  data.followUpEvents[0] = { ...data.followUpEvents[0]!, toDate: DUE_DATE };
  data.todaySkips = [];
  if (overrides.empty) {
    data.people = [];
    data.contactMethods = [];
    data.affiliations = [];
    data.memoryFacts = [];
    data.followUps = [];
    data.followUpEvents = [];
    data.interactions = [];
    data.todaySkips = [];
    data.reachOutEntries = [];
    data.reachOutEvents = [];
  }
  await restoreBackup(db, previewBackup({
    product: "peopleos",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: fixedNow,
    data
  }), fixedNow);
  return db;
}

/** jsdom here exposes a localStorage object with no methods, so tests inject. */
function memoryStorage(): ReminderCycleStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }
  };
}

let storage = memoryStorage();

function context(
  appIsOpen: boolean,
  cycle: TodayReminderCycle = {}
): TodayNotificationReconcileContext {
  return { appIsOpen, cycle, storage };
}

/** The occurrences iOS is currently holding, oldest first. */
function scheduledClockTimes(pending: Set<number>, entries: TodayNotificationPlanEntry[][]): string[] {
  return [...new Map(entries.flat().map((entry) => [entry.id, entry])).values()]
    .filter((entry) => pending.has(entry.id))
    .sort((left, right) => left.at.getTime() - right.at.getTime())
    .map((entry) => `${entry.localDate} ${String(entry.at.getHours()).padStart(2, "0")}:${String(entry.at.getMinutes()).padStart(2, "0")}`);
}

beforeEach(async () => {
  storage = memoryStorage();
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

describe("Today reminder cycle", () => {
  it("schedules the configured time and a reminder every three hours until 22:00", async () => {
    const db = await openSeededDatabase("ladder");
    const native = fakeAdapter();

    await reconcileTodayNotifications(db, native.adapter, at("08:00"), context(true));

    expect(scheduledClockTimes(native.pending, native.scheduled).slice(0, 5)).toEqual([
      "2026-08-01 09:00",
      "2026-08-01 12:00",
      "2026-08-01 15:00",
      "2026-08-01 18:00",
      "2026-08-01 21:00"
    ]);
    expect(native.scheduled.flat().every((entry) => entry.at.getHours() < 22)).toBe(true);
  });

  it("uses the configured time rather than a fixed one, and reschedules when it changes", async () => {
    const db = await openSeededDatabase("configured-time", { time: "07:15" });
    const native = fakeAdapter();
    await reconcileTodayNotifications(db, native.adapter, at("06:00"), context(true));
    expect(scheduledClockTimes(native.pending, native.scheduled).slice(0, 3)).toEqual([
      "2026-08-01 07:15",
      "2026-08-01 10:15",
      "2026-08-01 13:15"
    ]);

    const settings = (await db.get("appSettings", "app"))!;
    await db.put("appSettings", {
      ...settings,
      todaySummaryNotificationTime: "20:30",
      revision: settings.revision + 1,
      updatedAt: "2026-08-01T05:00:00.000Z"
    });
    const after = fakeAdapter();
    after.pending.add(todayNotificationId(DUE_DATE, 0));
    await reconcileTodayNotifications(db, after.adapter, at("06:00"), context(true));

    // 20:30 + 3h is 23:30, so the cut-off leaves the chosen time alone for that day.
    expect(scheduledClockTimes(after.pending, after.scheduled).slice(0, 2)).toEqual([
      "2026-08-01 20:30",
      "2026-08-02 20:30"
    ]);
  });

  it("sends nothing while Today is empty and nothing while reminders are off", async () => {
    const empty = await openSeededDatabase("empty", { empty: true });
    const emptyNative = fakeAdapter();
    const emptyState = await reconcileTodayNotifications(
      empty,
      emptyNative.adapter,
      at("08:00"),
      context(true)
    );
    expect(emptyState.scheduledCount).toBe(0);
    expect(emptyNative.scheduled).toEqual([]);

    const off = await openSeededDatabase("off", { enabled: false });
    const offNative = fakeAdapter();
    offNative.pending.add(todayNotificationId(DUE_DATE, 2));
    const offState = await reconcileTodayNotifications(
      off,
      offNative.adapter,
      at("08:00"),
      context(true)
    );
    expect(offState.scheduledCount).toBe(0);
    expect(offNative.scheduled).toEqual([]);
    expect(offNative.pending).toEqual(new Set());
  });

  it("keeps the day's remaining reminders when a notification is dismissed or ignored", async () => {
    const db = await openSeededDatabase("ignored");
    const native = fakeAdapter();
    const cycle: TodayReminderCycle = {};
    await reconcileTodayNotifications(db, native.adapter, at("08:00"), context(true, cycle));

    // 12:20: the 09:00 and 12:00 notifications went unanswered and PeopleOS was
    // never opened, so the ladder must survive untouched.
    await reconcileTodayNotifications(db, native.adapter, at("12:20"), context(false, cycle));

    expect(cycle.endedLocalDate).toBeUndefined();
    expect(scheduledClockTimes(native.pending, native.scheduled).slice(0, 3)).toEqual([
      "2026-08-01 15:00",
      "2026-08-01 18:00",
      "2026-08-01 21:00"
    ]);
  });

  it("ends the day's cycle once PeopleOS is opened after a notification was sent", async () => {
    const db = await openSeededDatabase("opened");
    const native = fakeAdapter();
    const cycle: TodayReminderCycle = {};
    await reconcileTodayNotifications(db, native.adapter, at("08:00"), context(true, cycle));

    // Opening the app before the first notification leaves the cycle intact.
    await reconcileTodayNotifications(db, native.adapter, at("08:45"), context(true, cycle));
    expect(cycle.endedLocalDate).toBeUndefined();
    expect(scheduledClockTimes(native.pending, native.scheduled)[0]).toBe("2026-08-01 09:00");

    // Opening it after the 09:00 notification cancels the rest of that day.
    await reconcileTodayNotifications(db, native.adapter, at("09:30"), context(true, cycle));
    expect(cycle.endedLocalDate).toBe(DUE_DATE);
    expect(scheduledClockTimes(native.pending, native.scheduled)
      .some((entry) => entry.startsWith(DUE_DATE))).toBe(false);
  });

  it("still schedules the rest of today when reminders are turned on after the chosen time", async () => {
    const db = await openSeededDatabase("armed-late");
    const native = fakeAdapter();
    const cycle: TodayReminderCycle = {};

    // 14:00, with a 09:00 reminder time: the 09:00 and 12:00 rungs have passed,
    // but PeopleOS never scheduled them, so they were never delivered and must
    // not silence the rest of the day.
    await reconcileTodayNotifications(db, native.adapter, at("14:00"), context(true, cycle));

    expect(cycle.endedLocalDate).toBeUndefined();
    expect(scheduledClockTimes(native.pending, native.scheduled).slice(0, 3)).toEqual([
      "2026-08-01 15:00",
      "2026-08-01 18:00",
      "2026-08-01 21:00"
    ]);
  });

  it("remembers an ended cycle across a cold launch", async () => {
    const db = await openSeededDatabase("cold-launch");
    const native = fakeAdapter();
    const cycle: TodayReminderCycle = {};
    await reconcileTodayNotifications(db, native.adapter, at("08:00"), context(true, cycle));
    await reconcileTodayNotifications(db, native.adapter, at("09:30"), context(true, cycle));
    expect(cycle.endedLocalDate).toBe(DUE_DATE);

    // Tapping View Today relaunches the app, so the service starts from an
    // empty cycle. It must still know the user has already opened PeopleOS.
    const relaunched = fakeAdapter();
    const afterRelaunch: TodayReminderCycle = {};
    await reconcileTodayNotifications(db, relaunched.adapter, at("09:35"), context(true, afterRelaunch));

    expect(afterRelaunch.endedLocalDate).toBe(DUE_DATE);
    expect(scheduledClockTimes(relaunched.pending, relaunched.scheduled)
      .some((entry) => entry.startsWith(DUE_DATE))).toBe(false);
  });

  it("starts a fresh cycle on the next calendar day", async () => {
    const db = await openSeededDatabase("next-day");
    const native = fakeAdapter();
    const cycle: TodayReminderCycle = { endedLocalDate: DUE_DATE };

    await reconcileTodayNotifications(db, native.adapter, nextDayAt("07:00"), context(true, cycle));

    expect(cycle.endedLocalDate).toBeUndefined();
    expect(scheduledClockTimes(native.pending, native.scheduled).slice(0, 2)).toEqual([
      "2026-08-02 09:00",
      "2026-08-02 12:00"
    ]);
  });

  it("never changes Today, and installs no duplicate when it runs again", async () => {
    const db = await openSeededDatabase("idempotent");
    const before = await readAllData(db);
    const native = fakeAdapter();
    const cycle: TodayReminderCycle = {};

    await reconcileTodayNotifications(db, native.adapter, at("08:00"), context(true, cycle));
    const installed = [...native.pending].sort();
    native.scheduled.length = 0;
    native.cancelled.length = 0;

    await reconcileTodayNotifications(db, native.adapter, at("08:00"), context(true, cycle));

    // Re-running replaces the same identifiers rather than adding a second
    // occurrence beside them, so iOS still holds exactly one request each.
    expect([...native.pending].sort()).toEqual(installed);
    expect(native.scheduled.flat().every((entry) => installed.includes(entry.id))).toBe(true);
    expect(native.cancelled).toEqual([]);
    expect(await readAllData(db)).toEqual(before);
  });

  it("cancels identifiers written by the single-notification release", async () => {
    const db = await openSeededDatabase("legacy-ids");
    const native = fakeAdapter();
    const legacyId = 1_500_000_000 + 20_260_731;
    native.pending.add(legacyId);

    await reconcileTodayNotifications(db, native.adapter, at("08:00"), context(true));

    expect(native.cancelled.flat()).toContain(legacyId);
    expect(native.pending.has(legacyId)).toBe(false);
  });
});
