import { useEffect, useState } from "react";
import type { AppSettings } from "../domain/schema";
import {
  changeTodayNotificationTime,
  disableTodayNotifications,
  enableTodayNotifications,
  getTodayNotificationRuntimeState,
  recoverTodayNotificationSettings,
  subscribeToTodayNotificationState,
  type TodayNotificationRuntimeState
} from "./service";

type Props = {
  settings?: AppSettings;
  onSettingsChanged: (settings: AppSettings) => void;
};

function statusText(settings: AppSettings | undefined, runtime: TodayNotificationRuntimeState): string {
  if (!runtime.supported) return "Available in the iPhone app";
  if (!settings?.todaySummaryNotificationsEnabled) {
    return runtime.permission === "denied" ? "Off · Permission denied" : "Off";
  }
  if (runtime.permission === "denied") return "Blocked in iPhone Settings";
  if (runtime.permission !== "granted") return "Permission needed";
  if (runtime.incompleteRegularScheduleCount > 0) {
    return runtime.incompleteRegularScheduleCount === 1
      ? "On · Regular contact needs a start date"
      : `On · ${runtime.incompleteRegularScheduleCount} regular contacts need a start date`;
  }
  return runtime.scheduledCount > 0
    ? `On · ${runtime.scheduledCount} private reminders scheduled`
    : "On · Nothing is waiting in Today";
}

/**
 * iOS decides on its own whether a notification makes a sound, buzzes, or stays
 * on screen, and offers no API to read any of it. So this is guidance, never a
 * status claim — PeopleOS must not tell the user something is on when it cannot
 * know. Only the app's own Settings page can be opened: `prefs:root=` deep links
 * into other panes are private API and get apps rejected, so the rest is written
 * directions.
 */
const IPHONE_SETUP_STEPS = [
  {
    id: "haptics",
    where: "Settings → Sounds & Haptics → Haptics",
    action: "Always Play",
    why: "Out of the box an iPhone only buzzes in Silent mode. This makes reminders buzz either way."
  },
  {
    id: "banner-style",
    where: "Settings → Notifications → PeopleOS → Banner Style",
    action: "Persistent",
    why: "A reminder then stays on screen until you deal with it, instead of vanishing after a few seconds."
  },
  {
    id: "focus",
    where: "Settings → Focus",
    action: "Allow PeopleOS, or turn Focus off",
    why: "A Focus silences reminders completely — no sound, no buzz, no banner."
  },
  {
    id: "vibration",
    where: "Settings → Accessibility → Touch → Vibration",
    action: "On",
    why: "A master switch. Nothing on the phone vibrates while it is off."
  }
] as const;

function IPhoneReminderSetup() {
  return (
    <div className="notification-setup">
      <h4 id="settings-notification-setup">Make reminders harder to miss</h4>
      <p className="muted-copy">
        Your iPhone, not PeopleOS, decides whether a reminder makes a sound, buzzes or stays on
        screen. PeopleOS cannot check these for you — iOS does not allow it — so here is exactly
        what to change.
      </p>
      <ol className="notification-setup-steps" aria-labelledby="settings-notification-setup">
        {IPHONE_SETUP_STEPS.map((step) => (
          <li key={step.id}>
            <span className="notification-setup-where">{step.where}</span>
            <strong className="notification-setup-action">{step.action}</strong>
            <span className="muted-copy">{step.why}</span>
          </li>
        ))}
      </ol>
      {/* Capacitor hands unknown schemes to iOS, which opens the app's own page. */}
      <a className="settings-action" href="app-settings:">Open iPhone Settings</a>
    </div>
  );
}

export default function NotificationSettingsSection({ settings, onSettingsChanged }: Props) {
  const [runtime, setRuntime] = useState(getTodayNotificationRuntimeState);
  const [timeDraft, setTimeDraft] = useState(settings?.todaySummaryNotificationTime ?? "12:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeToTodayNotificationState(setRuntime), []);
  useEffect(() => {
    if (settings) setTimeDraft(settings.todaySummaryNotificationTime);
  }, [settings]);

  async function recoverStaleSettings(caught: unknown): Promise<boolean> {
    try {
      const latest = await recoverTodayNotificationSettings(caught);
      if (!latest) return false;
      onSettingsChanged(latest);
      setTimeDraft(latest.todaySummaryNotificationTime);
      setError("Reminder settings changed on another device. Review them and try again.");
      return true;
    } catch {
      return false;
    }
  }

  async function changeEnabled(enabled: boolean) {
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      onSettingsChanged(enabled
        ? await enableTodayNotifications(settings)
        : await disableTodayNotifications(settings));
    } catch (caught) {
      if (!await recoverStaleSettings(caught)) {
        setError("PeopleOS could not update reminders. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveTime(time: string) {
    if (!settings || time === settings.todaySummaryNotificationTime) return;
    setBusy(true);
    setError("");
    try {
      onSettingsChanged(await changeTodayNotificationTime(settings, time));
    } catch (caught) {
      if (!await recoverStaleSettings(caught)) {
        setTimeDraft(settings.todaySummaryNotificationTime);
        setError("PeopleOS could not change the reminder time. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section notification-settings-section" aria-labelledby="settings-notifications">
      <div className="settings-section-heading">
        <h3 id="settings-notifications">Notifications</h3>
        <p>
          Get one private summary when people are waiting in Today, then a reminder every
          3 hours until you open PeopleOS. Reminders stop at 22:00 and start again tomorrow.
        </p>
      </div>
      {runtime.supported ? (
        <>
          <dl>
            <div className="settings-row notification-toggle-row">
              <dt>
                <label htmlFor="today-summary-notifications">Today reminders</label>
              </dt>
              <dd>
                <input
                  id="today-summary-notifications"
                  type="checkbox"
                  role="switch"
                  checked={settings?.todaySummaryNotificationsEnabled ?? false}
                  disabled={!settings || busy}
                  onChange={(event) => void changeEnabled(event.currentTarget.checked)}
                />
              </dd>
            </div>
            <div className="settings-row notification-time-row">
              <dt><label htmlFor="today-summary-notification-time">Reminder time</label></dt>
              <dd>
                <input
                  id="today-summary-notification-time"
                  type="time"
                  value={timeDraft}
                  disabled={!settings?.todaySummaryNotificationsEnabled || busy}
                  onChange={(event) => setTimeDraft(event.currentTarget.value)}
                  onBlur={(event) => void saveTime(event.currentTarget.value)}
                />
              </dd>
            </div>
            <div className="settings-row"><dt>Status</dt><dd>{statusText(settings, runtime)}</dd></div>
          </dl>
          {settings?.todaySummaryNotificationsEnabled && runtime.permission === "prompt" && (
            <button className="settings-action" type="button" disabled={busy} onClick={() => void changeEnabled(true)}>
              Allow notifications on this iPhone
            </button>
          )}
          {runtime.permission === "denied" && (
            <p className="muted-copy">Notifications are denied for PeopleOS. You can allow them in iPhone Settings.</p>
          )}
          <IPhoneReminderSetup />
        </>
      ) : (
        <p className="muted-copy">Local reminders are available in the iPhone app. The web app does not request notification permission.</p>
      )}
      <p className="muted-copy">Notification previews never include names, notes, reasons or relationship details.</p>
      {(error || runtime.error) && <p className="error-message" role="alert">{error || runtime.error}</p>}
    </section>
  );
}
