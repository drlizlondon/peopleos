import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  LocalNotifications,
  type PermissionStatus
} from "@capacitor/local-notifications";
import { isTodayNotificationId, type TodayNotificationPlanEntry } from "./policy";

export type TodayNotificationPermission = "prompt" | "granted" | "denied";

/**
 * `open` covers both tapping the notification body and its View Today action.
 * `not-now` is deliberately inert: the rest of the day's ladder is already
 * scheduled, and Not Now must not open Today, end the cycle, or touch data.
 */
export type TodayNotificationAction = "open" | "not-now";

export type TodayNotificationAdapter = {
  checkPermission: () => Promise<TodayNotificationPermission>;
  requestPermission: () => Promise<TodayNotificationPermission>;
  pendingIds: () => Promise<number[]>;
  cancel: (ids: number[]) => Promise<void>;
  schedule: (entries: TodayNotificationPlanEntry[]) => Promise<void>;
  addTodayActionListener: (
    listener: (action: TodayNotificationAction) => void
  ) => Promise<() => void>;
};

export const TODAY_ACTION_TYPE_ID = "peopleos-today";
export const VIEW_TODAY_ACTION_ID = "peopleos-view-today";
export const NOT_NOW_ACTION_ID = "peopleos-not-now";

let registeredActionTypes: Promise<void> | undefined;

/**
 * iOS only shows action buttons for a category registered before the
 * notification is scheduled, and re-registering the same category is a no-op.
 */
function ensureTodayActionTypes(): Promise<void> {
  registeredActionTypes ??= LocalNotifications.registerActionTypes({
    types: [{
      id: TODAY_ACTION_TYPE_ID,
      actions: [
        { id: VIEW_TODAY_ACTION_ID, title: "View Today", foreground: true },
        { id: NOT_NOW_ACTION_ID, title: "Not Now" }
      ]
    }]
  }).catch((error: unknown) => {
    registeredActionTypes = undefined;
    throw error;
  });
  return registeredActionTypes;
}

function normalizedPermission(status: PermissionStatus): TodayNotificationPermission {
  if (status.display === "granted") return "granted";
  if (status.display === "denied") return "denied";
  return "prompt";
}

export function isTodayNotificationsSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function createCapacitorTodayNotificationAdapter(): TodayNotificationAdapter | undefined {
  if (!isTodayNotificationsSupported()) return undefined;
  return {
    async checkPermission() {
      return normalizedPermission(await LocalNotifications.checkPermissions());
    },
    async requestPermission() {
      return normalizedPermission(await LocalNotifications.requestPermissions());
    },
    async pendingIds() {
      const pending = await LocalNotifications.getPending();
      return pending.notifications
        .map((notification) => notification.id)
        .filter(isTodayNotificationId);
    },
    async cancel(ids) {
      if (ids.length === 0) return;
      await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
      // Capacitor resolves before every UNUserNotificationCenter completion
      // callback has necessarily returned. Give the native queue a moment;
      // the service then verifies the resulting pending identifiers.
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 150));
    },
    async schedule(entries) {
      if (entries.length === 0) return;
      await ensureTodayActionTypes();
      await LocalNotifications.schedule({
        notifications: entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          body: entry.body,
          schedule: { at: entry.at },
          sound: "default",
          threadIdentifier: "peopleos-today",
          actionTypeId: TODAY_ACTION_TYPE_ID,
          extra: entry.extra
        }))
      });
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 150));
    },
    async addTodayActionListener(listener) {
      await ensureTodayActionTypes();
      const handle: PluginListenerHandle = await LocalNotifications.addListener(
        "localNotificationActionPerformed",
        ({ actionId, notification }) => {
          if (!isTodayNotificationId(notification.id)
            || notification.extra?.kind !== "today-summary"
            || notification.extra?.destination !== "today") return;
          if (actionId === NOT_NOW_ACTION_ID) listener("not-now");
          else if (actionId === "tap" || actionId === VIEW_TODAY_ACTION_ID) listener("open");
        }
      );
      return () => { void handle.remove(); };
    }
  };
}
