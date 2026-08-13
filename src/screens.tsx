import { useEffect, useState } from "react";
import { getAppSettings } from "./application/peopleQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { AppSettings } from "./domain/schema";
import { enableCloudSync, isCloudSyncSupported, pauseCloudSync, subscribeToSync, syncNow } from "./sync/service";
import type { SyncState } from "./sync/types";
import NotificationSettingsSection from "./notifications/NotificationSettingsSection";
import { PEOPLEOS_BUILD_COMMIT } from "./buildMetadata";
import { browserPathForLogicalPath, isNativeApplication } from "./platformRouting";

export function SettingsScreen({ navigate }: { navigate: (path: string) => void }) {
  const [settings, setSettings] = useState<AppSettings>();
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const [settingsRetryVersion, setSettingsRetryVersion] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>();
  const [syncStateLoadFailed, setSyncStateLoadFailed] = useState(false);
  const [syncRetryVersion, setSyncRetryVersion] = useState(0);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncActionError, setSyncActionError] = useState("");
  const cloudSupported = isCloudSyncSupported();
  const nativeApplication = isNativeApplication();
  const localOnlyLabel = nativeApplication ? "Stored on this iPhone only" : "Stored in this browser only";

  useEffect(() => {
    let active = true;
    setSettingsLoadFailed(false);
    getDatabase().then(getAppSettings).then((stored) => {
      if (!active) return;
      setSettings(stored);
    }).catch(() => {
      if (active) setSettingsLoadFailed(true);
    });
    return () => { active = false; };
  }, [settingsRetryVersion]);
  useEffect(() => subscribeToSync((state, running) => {
    setSyncState(state);
    setSyncRunning(running);
    setSyncStateLoadFailed(false);
  }, () => setSyncStateLoadFailed(true)), [syncRetryVersion]);

  const syncLabel = !cloudSupported
    ? localOnlyLabel
    : syncStateLoadFailed ? "Status unavailable"
      : !syncState ? "Checking…"
        : !syncState.enabled ? localOnlyLabel
          : syncRunning ? "Syncing"
            : syncState.lastErrorCategory ? "Sync needs attention"
              : syncState.accountStatus !== "available" ? "Sync paused" : "Up to date";

  async function performSyncAction(action: "enable" | "sync" | "pause") {
    setSyncActionError("");
    try {
      if (action === "enable") await enableCloudSync();
      else if (action === "pause") await pauseCloudSync();
      else await syncNow();
    } catch {
      setSyncActionError(action === "pause"
        ? "PeopleOS could not turn off iCloud Sync right now. Your data remains safely stored; try again."
        : "PeopleOS could not sync right now. Your data remains safely stored on this iPhone.");
    }
  }

  const linkRow = (label: string, value: string, href: string) => (
    <div className="settings-row" key={href}>
      <dt><a href={browserPathForLogicalPath(href)} onClick={(event) => { event.preventDefault(); navigate(href); }}>{label}</a></dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <main className="screen settings-screen simple-settings" id="main-content" tabIndex={-1}>
      <header className="page-heading compact-heading">
        <p className="eyebrow">PeopleOS</p>
        <h2>Settings</h2>
      </header>
      <div className="settings-list">
        {settingsLoadFailed ? (
          <section className="settings-section notification-settings-section" aria-labelledby="settings-notifications">
            <div className="settings-section-heading"><h3 id="settings-notifications">Notifications</h3></div>
            <p className="error-message" role="alert">PeopleOS could not load reminder settings.</p>
            <button className="settings-action" type="button" onClick={() => setSettingsRetryVersion((value) => value + 1)}>Try again</button>
          </section>
        ) : settings ? (
          <NotificationSettingsSection settings={settings} onSettingsChanged={setSettings} />
        ) : (
          <section className="settings-section notification-settings-section" aria-labelledby="settings-notifications">
            <div className="settings-section-heading"><h3 id="settings-notifications">Notifications</h3></div>
            <p className="muted-copy">Loading reminder settings…</p>
          </section>
        )}
        <section className="settings-section icloud-sync-section" aria-labelledby="settings-icloud-sync">
          <div className="settings-section-heading"><h3 id="settings-icloud-sync">iCloud Sync</h3></div>
          <dl><div className="settings-row"><dt>Status</dt><dd>{syncLabel}</dd></div></dl>
          <div className="icloud-sync-actions">
            {cloudSupported && syncStateLoadFailed ? (
              <div>
                <p className="error-message" role="alert">PeopleOS could not read iCloud Sync status.</p>
                <button className="settings-action" type="button" onClick={() => setSyncRetryVersion((value) => value + 1)}>Try again</button>
              </div>
            ) : cloudSupported && !syncState ? (
              <p className="muted-copy">Checking iCloud Sync status…</p>
            ) : cloudSupported ? syncState?.enabled ? (
              <div className="icloud-sync-button-row">
                <button className="settings-action" type="button" disabled={syncRunning} onClick={() => void performSyncAction("sync")}>Sync Now</button>
                <button className="settings-action" type="button" disabled={syncRunning} onClick={() => void performSyncAction("pause")}>Turn off iCloud Sync</button>
                <p className="muted-copy">Turning off sync does not delete copies already held in your private iCloud storage.</p>
              </div>
            ) : (
              <button className="settings-action" type="button" disabled={syncRunning} onClick={() => void performSyncAction("enable")}>Turn on iCloud Sync</button>
            ) : <p className="muted-copy">{nativeApplication
              ? "This version continues to store data locally. iCloud Sync remains available in the production iPhone app."
              : "PeopleOS stores this web app's data in this browser. iCloud Sync is available in the production iPhone app."}</p>}
            {syncActionError && <p className="error-message" role="alert">{syncActionError}</p>}
          </div>
        </section>
        <section className="settings-section" aria-labelledby="settings-peopleos">
          <div className="settings-section-heading"><h3 id="settings-peopleos">PeopleOS</h3></div>
          <dl>
            {linkRow("Conversation starters", "Edit", "/settings/conversation-starters")}
            <div className="settings-row"><dt>Build</dt><dd><code>{PEOPLEOS_BUILD_COMMIT}</code></dd></div>
          </dl>
        </section>
        <section className="settings-section" aria-labelledby="settings-privacy-data">
          <div className="settings-section-heading"><h3 id="settings-privacy-data">Privacy &amp; Data</h3></div>
          <dl>
            {linkRow("Privacy", "View", "/settings/privacy")}
            {linkRow("Import contacts", "vCard file", "/people/import")}
            {linkRow("Export backup", "Create file", "/settings/export")}
            {linkRow("Restore backup", "Preview first", "/settings/restore")}
          </dl>
        </section>
      </div>
    </main>
  );
}
