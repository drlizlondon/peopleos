import { useEffect, useRef, useState } from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import { getAppSettings } from "./application/peopleQueries";
import { getDatabase } from "./data/client";
import AlreadyContactedDefaultSheet from "./AlreadyContactedDefaultSheet";
import type { AppSettings } from "./domain/schema";

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
  { title: "Notifications", description: "Due people appear when you open PeopleOS.", rows: [
    { label: "Notifications", value: "Unavailable in Version 1" }
  ]},
  { title: "Privacy & Security", description: "PeopleOS is local-first and uses your device's protection.", rows: [
    { label: "Data location", value: "This device" },
    { label: "Accounts and analytics", value: "None" }
  ]},
  { title: "Data", description: "Import, preserve, or restore your PeopleOS data.", rows: [
    { label: "Import contacts", value: "vCard file", href: "/people/import" },
    { label: "Export backup", value: "Create local file", href: "/settings/export" },
    { label: "Restore backup", value: "Preview required", href: "/settings/restore" }
  ]},
  { title: "About", description: "Product and technical information.", rows: [
    { label: "PeopleOS version", value: "0.1.0" },
    { label: "Data schema", value: "Not initialised" }
  ]}
];

export function SettingsScreen({ navigate }: { navigate: (path: string) => void }) {
  const [settings, setSettings] = useState<AppSettings>();
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const [reachOutDefault, setReachOutDefault] = useState("Loading…");
  const [editingAlreadyContacted, setEditingAlreadyContacted] = useState(false);
  const alreadyContactedOpenerRef = useRef<HTMLButtonElement>(null);
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
      return row;
    })
  }));

  function closeAlreadyContactedEditor() {
    setEditingAlreadyContacted(false);
    requestAnimationFrame(() => alreadyContactedOpenerRef.current?.focus());
  }

  return (
    <main className="screen settings-screen" id="main-content" tabIndex={-1}>
      <header className="page-heading">
        <p className="eyebrow">Settings</p>
        <h2>Global application preferences</h2>
        <p>Only settings that affect PeopleOS as a whole belong here.</p>
      </header>
      <div className="settings-list">
        {visibleSections.map((section) => (
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
