import { getAppSettings } from "../application/peopleQueries";
import { updateTodaySummaryNotificationSettings } from "../application/settings";
import { getDatabase } from "../data/client";
import { readAllData, type PeopleOsDatabase } from "../data/database";
import { StaleRevisionError } from "../data/repositories";
import { localDateForInstant } from "../domain/followUpPolicy";
import type { AppSettings } from "../domain/schema";
import { readActiveRelationshipMode } from "../relationshipModePreference";
import {
  createCapacitorTodayNotificationAdapter,
  type TodayNotificationAdapter,
  type TodayNotificationPermission
} from "./capacitorAdapter";
import {
  buildTodayNotificationPlanningResult,
  deliveredTodayOccurrenceCount,
  elapsedTodayOccurrenceCount,
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

/**
 * The whole reminder state model: which local day's cycle the user has already
 * ended by opening PeopleOS after a notification was sent. Nothing else is
 * remembered — dismissing, ignoring and Not Now leave the installed ladder
 * alone, and the next calendar day starts a fresh cycle. It is device-session
 * state, never written to the database, backup or sync.
 */
export type TodayReminderCycle = {
  endedLocalDate?: string;
  /**
   * When the current plan was armed. Occurrences earlier than this were never
   * installed, so they were never delivered.
   */
  armedFrom?: string;
};

export const TODAY_REMINDER_CYCLE_KEY = "peopleos.todayReminderCycle.v1";

export type ReminderCycleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type TodayNotificationReconcileContext = {
  appIsOpen: boolean;
  cycle: TodayReminderCycle;
  storage?: ReminderCycleStorage;
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
let removeActionListener: (() => void) | undefined;
let actionListenerRetryTimer: number | undefined;
let serviceGeneration = 0;
const serviceReminderCycle: TodayReminderCycle = {};

function cycleStorage(provided?: ReminderCycleStorage): ReminderCycleStorage | undefined {
  if (provided) return provided;
  return typeof localStorage !== "undefined"
    && typeof localStorage.getItem === "function"
    && typeof localStorage.setItem === "function"
    ? localStorage
    : undefined;
}

/**
 * The cycle survives a cold launch — tapping View Today relaunches the app, and
 * that must still count as opening it. It lives in device-local storage only:
 * never in the database, a backup, or iCloud.
 */
function loadReminderCycle(
  cycle: TodayReminderCycle,
  storage?: ReminderCycleStorage
): TodayReminderCycle {
  if (cycle.armedFrom !== undefined || cycle.endedLocalDate !== undefined) return cycle;
  try {
    const stored: unknown = JSON.parse(cycleStorage(storage)?.getItem(TODAY_REMINDER_CYCLE_KEY) ?? "null");
    if (stored && typeof stored === "object") {
      const { endedLocalDate, armedFrom } = stored as TodayReminderCycle;
      if (typeof endedLocalDate === "string") cycle.endedLocalDate = endedLocalDate;
      if (typeof armedFrom === "string") cycle.armedFrom = armedFrom;
    }
  } catch {
    // A corrupt value simply re-arms the cycle.
  }
  return cycle;
}

function saveReminderCycle(cycle: TodayReminderCycle, storage?: ReminderCycleStorage): void {
  try {
    cycleStorage(storage)?.setItem(TODAY_REMINDER_CYCLE_KEY, JSON.stringify(cycle));
  } catch {
    // Storage being unavailable costs cold-launch accuracy, nothing more.
  }
}

/**
 * Re-arm from now. Turning reminders on, turning them off, and choosing a new
 * time are all explicit instructions to use the schedule as it stands from this
 * moment — not to honour a cycle the previous settings ended.
 */
export function resetTodayReminderCycle(
  cycle: TodayReminderCycle = serviceReminderCycle,
  storage?: ReminderCycleStorage
): void {
  cycle.endedLocalDate = undefined;
  cycle.armedFrom = undefined;
  try {
    cycleStorage(storage)?.removeItem(TODAY_REMINDER_CYCLE_KEY);
  } catch {
    // Nothing to recover: the in-memory cycle is already reset.
  }
}

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

function liveReconcileContext(): TodayNotificationReconcileContext {
  return {
    // Reconciliation also runs as the app goes to the background; only a visible
    // document proves the user actually has PeopleOS open.
    appIsOpen: typeof document === "undefined" || document.visibilityState === "visible",
    cycle: serviceReminderCycle
  };
}

/**
 * Opening PeopleOS after a notification has been sent ends that day's cycle,
 * whether the user tapped View Today or opened the app themselves. Reaching a
 * new local date starts a fresh one.
 */
export function advanceTodayReminderCycle(
  cycle: TodayReminderCycle,
  input: {
    localDate: string;
    time: string;
    now: Date;
    appIsOpen: boolean;
    storage?: ReminderCycleStorage;
  }
): TodayReminderCycle {
  loadReminderCycle(cycle, input.storage);
  if (cycle.endedLocalDate && cycle.endedLocalDate !== input.localDate) {
    cycle.endedLocalDate = undefined;
  }
  const armedFrom = cycle.armedFrom ? new Date(cycle.armedFrom) : input.now;
  cycle.armedFrom ??= input.now.toISOString();
  if (input.appIsOpen
    && deliveredTodayOccurrenceCount(input.localDate, input.time, input.now, armedFrom) > 0) {
    cycle.endedLocalDate = input.localDate;
  }
  saveReminderCycle(cycle, input.storage);
  return cycle;
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
  now = new Date(),
  context: TodayNotificationReconcileContext = liveReconcileContext()
): Promise<TodayNotificationRuntimeState> {
  const settings = await getAppSettings(db);
  const permission = await adapter.checkPermission();
  const pendingIds = await adapter.pendingIds();
  if (!settings.todaySummaryNotificationsEnabled || permission !== "granted") {
    await cancelAndVerify(adapter, pendingIds);
    resetTodayReminderCycle(context.cycle, context.storage);
    return {
      supported: true,
      permission,
      scheduledCount: 0,
      incompleteRegularScheduleCount: 0
    };
  }

  const timeZone = currentTimeZone();
  const cycle = advanceTodayReminderCycle(context.cycle, {
    localDate: localDateForInstant(now.toISOString(), timeZone),
    time: settings.todaySummaryNotificationTime,
    now,
    appIsOpen: context.appIsOpen,
    storage: context.storage
  });
  const planning = buildTodayNotificationPlanningResult(await readAllData(db), {
    now,
    timeZone,
    time: settings.todaySummaryNotificationTime,
    activeMode: readActiveRelationshipMode(),
    cycleEndedLocalDate: cycle.endedLocalDate
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
  const now = new Date();
  const localDate = now.toLocaleDateString("en-CA");
  // The elapsed-occurrence count changes at most a handful of times a day. It
  // makes the app notice, while open, that a reminder has just been delivered,
  // so the rest of that day's ladder is cancelled without polling the engine.
  let elapsedOccurrences = 0;
  try {
    if (settings?.todaySummaryNotificationTime) {
      elapsedOccurrences = elapsedTodayOccurrenceCount(
        localDate,
        settings.todaySummaryNotificationTime,
        now
      );
    }
  } catch {
    elapsedOccurrences = 0;
  }
  return JSON.stringify([
    settings?.revision,
    metadata?.datasetRevision,
    readActiveRelationshipMode(),
    localDate,
    elapsedOccurrences
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
  const installActionListener = () => {
    void adapter.addTodayActionListener((action) => {
      // Not Now needs no work: the rest of the day's ladder is already
      // installed, and the cycle only ends when PeopleOS is opened.
      if (action === "open") window.dispatchEvent(new Event(OPEN_TODAY_FROM_NOTIFICATION_EVENT));
    }).then((remove) => {
      if (started && serviceGeneration === generation) {
        removeActionListener?.();
        removeActionListener = remove;
      } else remove();
    }).catch(() => {
      if (!started || serviceGeneration !== generation) return;
      publish({
        ...runtimeState,
        supported: true,
        error: "PeopleOS could not listen for reminder taps yet."
      });
      actionListenerRetryTimer = window.setTimeout(installActionListener, 1_000);
    });
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  installActionListener();
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
    window.clearTimeout(actionListenerRetryTimer);
    removeActionListener?.();
    removeActionListener = undefined;
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
  resetTodayReminderCycle();
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
  resetTodayReminderCycle();
  requestTodayNotificationReconcile(0);
  return saved;
}
