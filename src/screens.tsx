import { useEffect, useRef, useState } from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import { getAppSettings } from "./application/peopleQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import AlreadyContactedDefaultSheet from "./AlreadyContactedDefaultSheet";
import type { AppSettings } from "./domain/schema";
import { enableCloudSync, isCloudSyncSupported, pauseCloudSync, subscribeToSync, syncNow } from "./sync/service";
import type { SyncState } from "./sync/types";
import NotificationSettingsSection from "./notifications/NotificationSettingsSection";
import packageMetadata from "../package.json";

function PlannedAction({ children }: { children: string }) {
  return (
    <button className="primary-action" type="button" aria-disabled="true" title="Available in a later implementation package">
      <Icon name="plus" />
      {children}
    </button>
  );
}

export function PeopleScreen() {
  return (
    <main className="screen" id="main-content" tabIndex={-1}>
      <EmptyState
        eyebrow="People"
        title="Your people will live here"
        description="Add someone manually or import a contact when you are ready."
        action={<PlannedAction>Add person</PlannedAction>}
      />
    </main>
  );
}

type SettingsSection = {
  title: string;
  description: string;
  rows: {
    label: string;
    value: string;
    href?: string;
    action?: "already-contacted-default";
  }[];
};

const settingsSections: SettingsSection[] = [
  { title: "General", description: "Global parsing and device conventions.", rows: [
    { label: "Default phone region", value: "Device region" },
    { label: "Timezone and formats", value: "Follows device" }
  ]},
  { title: "Modes", description: "Choose which capture experience opens by default.", rows: [
    { label: "Capture mode", value: "Standard" }
  ]},
  { title: "Today", description: "PeopleOS uses one fixed, explainable ordering.", rows: [
    { label: "How Today works", value: "Deterministic policy" },
    { label: "Default “Already contacted” interval", value: "Loading…", action: "already-contacted-default" }
  ]},
  { title: "Reach Out", description: "Set a lightweight default for new outreach drafts.", rows: [
    { label: "Default reminder", value: "No reminder" }
  ]},
  { title: "Interactions", description: "Contact is recorded only after you confirm it happened.", rows: [
    { label: "Contact confirmation", value: "Always required" }
  ]},
  { title: "Notifications", description: "Private, device-local Today reminders.", rows: [] },
  { title: "Privacy & Security", description: "PeopleOS is local-first and uses your device's protection.", rows: [
    { label: "Data location", value: "This device" },
    { label: "Accounts and analytics", value: "None" },
    { label: "Privacy", value: "How PeopleOS handles data", href: "/settings/privacy" }
  ]},
  { title: "Data", description: "Import, preserve, or restore your PeopleOS data.", rows: [
    { label: "Import contacts", value: "vCard file", href: "/people/import" },
    { label: "Export backup", value: "Create local file", href: "/settings/export" },
    { label: "Restore backup", value: "Preview required", href: "/settings/restore" }
  ]},
  { title: "About", description: "Product and technical information.", rows: [
    { label: "PeopleOS version", value: packageMetadata.version },
    { label: "Data schema", value: "Not initialised" }
  ]}
];

export function SettingsScreen({ navigate }: { navigate: (path: string) => void }) {
  const [settings, setSettings] = useState<AppSettings>();
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const [reachOutDefault, setReachOutDefault] = useState("Loading…");
  const [editingAlreadyContacted, setEditingAlreadyContacted] = useState(false);
  const alreadyContactedOpenerRef = useRef<HTMLButtonElement>(null);
  const [syncState, setSyncState] = useState<SyncState>();
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncActionError, setSyncActionError] = useState("");
  const cloudSupported = isCloudSyncSupported();
  useEffect(() => {
    let active = true;
    getDatabase().then(getAppSettings).then((settings) => {
      if (!active) return;
      setSettings(settings);
      const days = settings.reachOutDefaultReminderDays;
      setReachOutDefault(days === undefined ? "No reminder" : days === 1 ? "Tomorrow" : `In ${days} days`);
    }).catch(() => {
      if (!active) return;
      setSettingsLoadFailed(true);
      setReachOutDefault("Unavailable");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => subscribeToSync((state, running) => { setSyncState(state); setSyncRunning(running); }), []);
  const visibleSections = settingsSections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => {
      if (section.title === "Reach Out" && row.label === "Default reminder") {
        return { ...row, value: reachOutDefault };
      }
      if (row.action === "already-contacted-default") {
        const days = settings?.alreadyContactedDefaultReminderDays;
        return { ...row, value: settingsLoadFailed ? "Unavailable" : days === undefined ? "Loading…" : `${days} days` };
      }
      if (section.title === "Privacy & Security" && row.label === "Data location") {
        return { ...row, value: syncState?.enabled ? "This iPhone and private iCloud" : "This device" };
      }
      return row;
    })
  }));

  function closeAlreadyContactedEditor() {
    setEditingAlreadyContacted(false);
    requestAnimationFrame(() => alreadyContactedOpenerRef.current?.focus());
  }

  const syncLabel = !cloudSupported || !syncState?.enabled
    ? "Stored on this iPhone only"
    : syncRunning && syncState.initialMigrationPhase !== "complete" ? "Setting up iCloud Sync"
      : syncRunning ? "Syncing"
        : syncState.lastErrorCategory ? "Sync needs attention"
          : syncState.accountStatus !== "available" ? "Sync paused"
            : "Up to date";
  const lastSync = syncState?.lastSuccessfulSyncAt
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(syncState.lastSuccessfulSyncAt))
    : "Not yet synced";

  async function performSyncAction(action: "enable" | "sync" | "pause") {
    setSyncActionError("");
    try {
      if (action === "enable") await enableCloudSync();
      else if (action === "pause") await pauseCloudSync();
      else await syncNow();
    } catch {
      setSyncActionError(action === "pause"
        ? "PeopleOS could not turn off iCloud Sync right now. Your data remains safely stored; check the status and try again."
        : "PeopleOS could not sync right now. Your data remains safely stored on this iPhone.");
    }
  }

  return (
    <main className="screen settings-screen" id="main-content" tabIndex={-1}>
      <header className="page-heading">
        <p className="eyebrow">Settings</p>
        <h2>Global application preferences</h2>
        <p>Only settings that affect PeopleOS as a whole belong here.</p>
      </header>
      <div className="settings-list">
        <section className="settings-section icloud-sync-section" aria-labelledby="settings-icloud-sync">
          <div className="settings-section-heading">
            <h3 id="settings-icloud-sync">iCloud Sync</h3>
            <p>Keep a private iCloud copy of your PeopleOS data.</p>
          </div>
          <dl>
            <div className="settings-row"><dt>Status</dt><dd>{syncLabel}</dd></div>
            {syncState?.enabled && <div className="settings-row"><dt>Last successful sync</dt><dd>{lastSync}</dd></div>}
          </dl>
          <div className="icloud-sync-actions">
            {cloudSupported ? (
              syncState?.enabled ? (
                <>
                  <div className="icloud-sync-button-row">
                    <button className="settings-action" type="button" disabled={syncRunning} onClick={() => void performSyncAction("sync")}>Sync Now</button>
                    <button className="settings-action" type="button" disabled={syncRunning} onClick={() => void performSyncAction("pause")}>Turn off iCloud Sync</button>
                  </div>
                  <p className="muted-copy">Turning off iCloud Sync stops future syncing on this iPhone. It does not delete copies already held in your private iCloud storage.</p>
                </>
              ) : (
                <button className="settings-action" type="button" disabled={syncRunning} onClick={() => void performSyncAction("enable")}>Turn on iCloud Sync</button>
              )
            ) : <p className="muted-copy">iCloud Sync is available in the iPhone app. This version continues to store data locally.</p>}
            {syncState?.enabled && syncState.accountStatus !== "available" && <p className="muted-copy">Sign in to iCloud in iPhone Settings, then try again. PeopleOS does not receive your Apple account details.</p>}
            {syncActionError && <p className="error-message" role="alert">{syncActionError}</p>}
          </div>
        </section>
        {visibleSections.map((section) => (
          section.title === "Notifications"
            ? <NotificationSettingsSection
              key={section.title}
              settings={settings}
              onSettingsChanged={setSettings}
            />
            :
          <section className="settings-section" key={section.title} aria-labelledby={`settings-${section.title.replaceAll(" ", "-").toLowerCase()}`}>
            <div className="settings-section-heading">
              <h3 id={`settings-${section.title.replaceAll(" ", "-").toLowerCase()}`}>{section.title}</h3>
              <p>{section.description}</p>
            </div>
            <dl>
              {section.rows.map((row) => (
                <div className="settings-row" key={row.label}>
                  <dt>{row.href
                    ? <a href={row.href} onClick={(event) => { event.preventDefault(); navigate(row.href!); }}>{row.label}</a>
                    : row.action === "already-contacted-default"
                      ? (
                        <button
                          ref={alreadyContactedOpenerRef}
                          className="settings-action"
                          type="button"
                          disabled={!settings}
                          onClick={() => setEditingAlreadyContacted(true)}
                        >{row.label}</button>
                      )
                      : row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {editingAlreadyContacted && settings && (
        <AlreadyContactedDefaultSheet
          settings={settings}
          onClose={closeAlreadyContactedEditor}
          onSaved={(saved) => {
            setSettings(saved);
            closeAlreadyContactedEditor();
          }}
        />
      )}
    </main>
  );
}
