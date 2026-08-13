import { getAppSettings } from "../application/peopleQueries";
import { updateTodaySummaryNotificationSettings } from "../application/settings";
import { getDatabase } from "../data/client";
import { readAllData, type PeopleOsDatabase } from "../data/database";
import { StaleRevisionError } from "../data/repositories";
import type { AppSettings } from "../domain/schema";
import { readActiveRelationshipMode } from "../relationshipModePreference";
import {
  createCapacitorTodayNotificationAdapter,
  type TodayNotificationAdapter,
  type TodayNotificationPermission
} from "./capacitorAdapter";
import {
  buildTodayNotificationPlanningResult,
  type TodayNotificationPlanEntry
} from "./policy";

export const OPEN_TODAY_FROM_NOTIFICATION_EVENT = "peopleos:open-today-from-notification";

export type TodayNotificationRuntimeState = {
  supported: boolean;
  permission: TodayNotificationPermission;
  scheduledCount: number;
  incompleteRegularScheduleCount: number;
  error?: string;
};

type RuntimeListener = (state: TodayNotificationRuntimeState) => void;

const listeners = new Set<RuntimeListener>();
let runtimeState: TodayNotificationRuntimeState = {
  supported: false,
  permission: "prompt",
  scheduledCount: 0,
  incompleteRegularScheduleCount: 0
};
let started = false;
let reconcileTimer: number | undefined;
let pollTimer: number | undefined;
let observedSignature = "";
let running: Promise<void> | undefined;
let rerunRequested = false;
let removeTapListener: (() => void) | undefined;
let tapListenerRetryTimer: number | undefined;
let serviceGeneration = 0;

function publish(next: TodayNotificationRuntimeState): TodayNotificationRuntimeState {
  runtimeState = next;
  listeners.forEach((listener) => listener(runtimeState));
  return runtimeState;
}

export function subscribeToTodayNotificationState(listener: RuntimeListener): () => void {
  listeners.add(listener);
  listener(runtimeState);
  return () => listeners.delete(listener);
}

export function getTodayNotificationRuntimeState(): TodayNotificationRuntimeState {
  return runtimeState;
}

export async function loadTodayNotificationSettings(): Promise<AppSettings> {
  return getAppSettings(await getDatabase());
}

export async function recoverTodayNotificationSettings(
  caught: unknown
): Promise<AppSettings | undefined> {
  return caught instanceof StaleRevisionError
    ? loadTodayNotificationSettings()
    : undefined;
}

function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function difference(left: Iterable<number>, right: ReadonlySet<number>): number[] {
  return [...left].filter((id) => !right.has(id));
}

async function cancelAndVerify(
  adapter: TodayNotificationAdapter,
  ids: number[]
): Promise<number[]> {
  let remaining = [...new Set(ids)];
  for (let attempt = 0; remaining.length > 0 && attempt < 3; attempt += 1) {
    await adapter.cancel(remaining);
    const pending = new Set(await adapter.pendingIds());
    remaining = remaining.filter((id) => pending.has(id));
  }
  if (remaining.length > 0) throw new Error("Pending Today reminders could not be cancelled.");
  return adapter.pendingIds();
}

async function installAndVerifyPlan(
  adapter: TodayNotificationAdapter,
  plan: TodayNotificationPlanEntry[],
  existingIds: number[]
): Promise<number> {
  const desiredIds = new Set(plan.map((entry) => entry.id));
  if (plan.length === 0) {
    await cancelAndVerify(adapter, existingIds);
    return 0;
  }

  // At 30 requests, both the old and replacement plans fit below iOS's
  // 64-request ceiling. Install and verify the replacement first so a native
  // scheduling failure never erases the last known-good plan.
  let missing = [...desiredIds];
  for (let attempt = 0; missing.length > 0 && attempt < 3; attempt += 1) {
    const missingSet = new Set(missing);
    await adapter.schedule(plan.filter((entry) => missingSet.has(entry.id)));
    const pending = new Set(await adapter.pendingIds());
    missing = difference(desiredIds, pending);
  }
  if (missing.length > 0) throw new Error("Not every Today reminder was retained by iOS.");

  const pendingAfterInstall = await adapter.pendingIds();
  const stale = difference(pendingAfterInstall, desiredIds);
  if (stale.length > 0) await cancelAndVerify(adapter, stale);
  const finalPending = new Set(await adapter.pendingIds());
  const finalMissing = difference(desiredIds, finalPending);
  const finalStale = difference(finalPending, desiredIds);
  if (finalMissing.length > 0 || finalStale.length > 0) {
    throw new Error("The Today reminder plan could not be verified.");
  }
  return desiredIds.size;
}

export async function reconcileTodayNotifications(
  db: PeopleOsDatabase,
  adapter: TodayNotificationAdapter,
  now = new Date()
): Promise<TodayNotificationRuntimeState> {
  const settings = await getAppSettings(db);
  const permission = await adapter.checkPermission();
  const pendingIds = await adapter.pendingIds();
  if (!settings.todaySummaryNotificationsEnabled || permission !== "granted") {
    await cancelAndVerify(adapter, pendingIds);
    return {
      supported: true,
      permission,
      scheduledCount: 0,
      incompleteRegularScheduleCount: 0
    };
  }

  const planning = buildTodayNotificationPlanningResult(await readAllData(db), {
    now,
    timeZone: currentTimeZone(),
    time: settings.todaySummaryNotificationTime,
    activeMode: readActiveRelationshipMode()
  });
  const scheduledCount = await installAndVerifyPlan(adapter, planning.entries, pendingIds);
  return {
    supported: true,
    permission,
    scheduledCount,
    incompleteRegularScheduleCount: planning.incompleteRegularSchedulePersonIds.length
  };
}

async function runReconcile(): Promise<void> {
  if (running) {
    rerunRequested = true;
    return running;
  }
  const adapter = createCapacitorTodayNotificationAdapter();
  if (!adapter) {
    publish({
      supported: false,
      permission: "prompt",
      scheduledCount: 0,
      incompleteRegularScheduleCount: 0
    });
    return;
  }
  running = (async () => {
    try {
      publish(await reconcileTodayNotifications(await getDatabase(), adapter));
    } catch {
      publish({
        ...runtimeState,
        supported: true,
        scheduledCount: 0,
        error: "PeopleOS could not update reminders right now."
      });
    }
  })();
  try {
    await running;
  } finally {
    running = undefined;
    if (rerunRequested) {
      rerunRequested = false;
      await runReconcile();
    }
  }
}

export function requestTodayNotificationReconcile(delay = 250): void {
  window.clearTimeout(reconcileTimer);
  reconcileTimer = window.setTimeout(() => { void runReconcile(); }, delay);
}

async function settingsSignature(): Promise<string> {
  const db = await getDatabase();
  const [settings, metadata] = await Promise.all([
    db.get("appSettings", "app"),
    db.get("metadata", "app")
  ]);
  return JSON.stringify([
    settings?.revision,
    metadata?.datasetRevision,
    readActiveRelationshipMode(),
    new Date().toLocaleDateString("en-CA")
  ]);
}

export function startTodayNotificationService(): () => void {
  if (started) return () => undefined;
  const adapter = createCapacitorTodayNotificationAdapter();
  if (!adapter) {
    publish({
      supported: false,
      permission: "prompt",
      scheduledCount: 0,
      incompleteRegularScheduleCount: 0
    });
    return () => undefined;
  }
  started = true;
  const generation = ++serviceGeneration;
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") requestTodayNotificationReconcile(0);
    else void runReconcile();
  };
  const onPageHide = () => { void runReconcile(); };
  const installTapListener = () => {
    void adapter.addTodayTapListener(() => {
      window.dispatchEvent(new Event(OPEN_TODAY_FROM_NOTIFICATION_EVENT));
    }).then((remove) => {
      if (started && serviceGeneration === generation) {
        removeTapListener?.();
        removeTapListener = remove;
      } else remove();
    }).catch(() => {
      if (!started || serviceGeneration !== generation) return;
      publish({
        ...runtimeState,
        supported: true,
        error: "PeopleOS could not listen for reminder taps yet."
      });
      tapListenerRetryTimer = window.setTimeout(installTapListener, 1_000);
    });
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  installTapListener();
  pollTimer = window.setInterval(() => {
    void settingsSignature().then((signature) => {
      if (observedSignature && observedSignature !== signature) requestTodayNotificationReconcile();
      observedSignature = signature;
    });
  }, 2_000);
  void settingsSignature().then((signature) => { observedSignature = signature; });
  requestTodayNotificationReconcile(0);
  return () => {
    if (serviceGeneration !== generation) return;
    started = false;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
    window.clearInterval(pollTimer);
    window.clearTimeout(reconcileTimer);
    window.clearTimeout(tapListenerRetryTimer);
    removeTapListener?.();
    removeTapListener = undefined;
  };
}

async function saveSettings(
  settings: AppSettings,
  enabled: boolean,
  time: string
): Promise<AppSettings> {
  if (settings.todaySummaryNotificationsEnabled === enabled
    && settings.todaySummaryNotificationTime === time) return settings;
  return updateTodaySummaryNotificationSettings(await getDatabase(), {
    expectedRevision: settings.revision,
    enabled,
    time,
    occurredAt: new Date().toISOString()
  });
}

export async function enableTodayNotifications(
  settings: AppSettings,
  adapterOverride?: TodayNotificationAdapter
): Promise<AppSettings> {
  const adapter = adapterOverride ?? createCapacitorTodayNotificationAdapter();
  if (!adapter) throw new Error("Today notifications are unavailable on this device.");
  let permission = await adapter.checkPermission();
  if (permission === "prompt") permission = await adapter.requestPermission();
  if (permission !== "granted") {
    const saved = settings.todaySummaryNotificationsEnabled
      ? await saveSettings(settings, false, settings.todaySummaryNotificationTime)
      : settings;
    try {
      await adapter.cancel(await adapter.pendingIds());
      publish({
        supported: true,
        permission,
        scheduledCount: 0,
        incompleteRegularScheduleCount: 0
      });
    } catch {
      publish({
        supported: true,
        permission,
        scheduledCount: 0,
        incompleteRegularScheduleCount: 0,
        error: "PeopleOS could not cancel pending reminders yet."
      });
      requestTodayNotificationReconcile();
    }
    return saved;
  }
  const saved = await saveSettings(settings, true, settings.todaySummaryNotificationTime);
  requestTodayNotificationReconcile(0);
  return saved;
}

export async function disableTodayNotifications(
  settings: AppSettings,
  adapterOverride?: TodayNotificationAdapter
): Promise<AppSettings> {
  const saved = await saveSettings(settings, false, settings.todaySummaryNotificationTime);
  const adapter = adapterOverride ?? createCapacitorTodayNotificationAdapter();
  if (!adapter) {
    publish({
      supported: false,
      permission: "prompt",
      scheduledCount: 0,
      incompleteRegularScheduleCount: 0
    });
    return saved;
  }
  try {
    await adapter.cancel(await adapter.pendingIds());
    publish({
      supported: true,
      permission: await adapter.checkPermission(),
      scheduledCount: 0,
      incompleteRegularScheduleCount: 0
    });
  } catch {
    publish({
      ...runtimeState,
      supported: true,
      scheduledCount: 0,
      error: "PeopleOS could not cancel pending reminders yet."
    });
    requestTodayNotificationReconcile();
  }
  return saved;
}

export async function changeTodayNotificationTime(
  settings: AppSettings,
  time: string
): Promise<AppSettings> {
  const saved = await saveSettings(settings, settings.todaySummaryNotificationsEnabled, time);
  requestTodayNotificationReconcile(0);
  return saved;
}
