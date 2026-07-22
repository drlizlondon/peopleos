import EmptyState from "./EmptyState";
import { Icon } from "./icons";

function PlannedAction({ children }: { children: string }) {
  return (
    <button className="primary-action" type="button" aria-disabled="true" title="Available in a later implementation package">
      <Icon name="plus" />
      {children}
    </button>
  );
}

export function TodayScreen() {
  return (
    <main className="screen" id="main-content" tabIndex={-1}>
      <EmptyState
        eyebrow="Today"
        title="No one needs your attention yet"
        description="PeopleOS helps you remember who to contact and why. Add your first person to begin."
        note="Your data stays on this device unless you export it."
        action={<PlannedAction>Add your first person</PlannedAction>}
      />
    </main>
  );
}

export function ReachOutScreen() {
  return (
    <main className="screen" id="main-content" tabIndex={-1}>
      <EmptyState
        eyebrow="Reach Out"
        title="People you mean to contact"
        description="Keep a deliberate list of people you want to contact, reconnect with or build a relationship with."
        note="You can even add someone if all you remember is where you met them."
        action={<PlannedAction>Add someone</PlannedAction>}
      />
    </main>
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

export function UpcomingScreen() {
  return (
    <main className="screen" id="main-content" tabIndex={-1}>
      <EmptyState
        eyebrow="Upcoming"
        title="No follow-ups planned"
        description="Future plans will appear here after you choose when to reconnect."
      />
    </main>
  );
}

type SettingsSection = { title: string; description: string; rows: { label: string; value: string }[] };

const settingsSections: SettingsSection[] = [
  { title: "General", description: "Global parsing and device conventions.", rows: [
    { label: "Default phone region", value: "Device region" },
    { label: "Timezone and formats", value: "Follows device" }
  ]},
  { title: "Modes", description: "Choose which capture experience opens by default.", rows: [
    { label: "Capture mode", value: "Standard" }
  ]},
  { title: "Today", description: "PeopleOS uses one fixed, explainable ordering.", rows: [
    { label: "How Today works", value: "Deterministic policy" }
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
    { label: "Import contacts", value: "vCard file" },
    { label: "Export backup", value: "Not created" },
    { label: "Restore backup", value: "Preview required" }
  ]},
  { title: "About", description: "Product and technical information.", rows: [
    { label: "PeopleOS version", value: "0.1.0" },
    { label: "Data schema", value: "Not initialised" }
  ]}
];

export function SettingsScreen() {
  return (
    <main className="screen settings-screen" id="main-content" tabIndex={-1}>
      <header className="page-heading">
        <p className="eyebrow">Settings</p>
        <h2>Global application preferences</h2>
        <p>Only settings that affect PeopleOS as a whole belong here.</p>
      </header>
      <div className="settings-list">
        {settingsSections.map((section) => (
          <section className="settings-section" key={section.title} aria-labelledby={`settings-${section.title.replaceAll(" ", "-").toLowerCase()}`}>
            <div className="settings-section-heading">
              <h3 id={`settings-${section.title.replaceAll(" ", "-").toLowerCase()}`}>{section.title}</h3>
              <p>{section.description}</p>
            </div>
            <dl>
              {section.rows.map((row) => (
                <div className="settings-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </main>
  );
}
