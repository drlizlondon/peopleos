import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  LocalNotifications,
  type PermissionStatus
} from "@capacitor/local-notifications";
import { isTodayNotificationId, type TodayNotificationPlanEntry } from "./policy";

export type TodayNotificationPermission = "prompt" | "granted" | "denied";

export type TodayNotificationAdapter = {
  checkPermission: () => Promise<TodayNotificationPermission>;
  requestPermission: () => Promise<TodayNotificationPermission>;
  pendingIds: () => Promise<number[]>;
  cancel: (ids: number[]) => Promise<void>;
  schedule: (entries: TodayNotificationPlanEntry[]) => Promise<void>;
  addTodayTapListener: (listener: () => void) => Promise<() => void>;
};

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
      await LocalNotifications.schedule({
        notifications: entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          body: entry.body,
          schedule: { at: entry.at },
          sound: "default",
          threadIdentifier: "peopleos-today",
          extra: entry.extra
        }))
      });
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 150));
    },
    async addTodayTapListener(listener) {
      const handle: PluginListenerHandle = await LocalNotifications.addListener(
        "localNotificationActionPerformed",
        ({ notification }) => {
          if (isTodayNotificationId(notification.id)
            && notification.extra?.kind === "today-summary"
            && notification.extra?.destination === "today") listener();
        }
      );
      return () => { void handle.remove(); };
    }
  };
}
