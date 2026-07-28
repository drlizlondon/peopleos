import { useEffect, useRef, useState } from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import { getAppSettings } from "./application/peopleQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import AlreadyContactedDefaultSheet from "./AlreadyContactedDefaultSheet";
import { updateConversationStarters, updateRelationshipContexts } from "./application/settings";
import { DEFAULT_CONVERSATION_STARTERS, type AppSettings, type ConversationStarter } from "./domain/schema";

function ConversationStarterSettings({ settings, onSaved }: { settings: AppSettings; onSaved: (settings: AppSettings) => void }) {
  const [starters, setStarters] = useState<ConversationStarter[]>(() => (settings.conversationStarters ?? DEFAULT_CONVERSATION_STARTERS).map((item) => ({ ...item })));
  const [error, setError] = useState("");
  async function persist(next: ConversationStarter[]) {
    if (!next.some((starter) => starter.relationshipMode !== "professional") || !next.some((starter) => starter.relationshipMode !== "personal")) {
      setError("Keep at least one starter available for Personal and Professional relationships.");
      return;
    }
    if (next.some((starter) => !starter.template.includes("{name}"))) {
      setError("Every starter must include {name} so it is clear who the message is for.");
      return;
    }
    try {
      const saved = await updateConversationStarters(await getDatabase(), next);
      setStarters(next);
      onSaved(saved);
      setError("");
    } catch {
      setError("PeopleOS could not save the conversation starters.");
    }
  }
  return (
    <section className="settings-section starter-admin" aria-labelledby="settings-conversation-starters">
      <div className="settings-section-heading">
        <h3 id="settings-conversation-starters">Conversation starters</h3>
        <p>Use <code>{"{name}"}</code> wherever the person’s name should appear. Today chooses one automatically.</p>
      </div>
      <div className="starter-admin-list">
        {starters.map((starter) => (
          <div className="starter-admin-row" key={starter.id}>
            <input aria-label={`Starter text ${starter.id}`} value={starter.template} onChange={(event) => setStarters((current) => current.map((item) => item.id === starter.id ? { ...item, template: event.target.value } : item))} />
            <select aria-label={`Relationship for ${starter.id}`} value={starter.relationshipMode} onChange={(event) => setStarters((current) => current.map((item) => item.id === starter.id ? { ...item, relationshipMode: event.target.value as ConversationStarter["relationshipMode"] } : item))}>
              <option value="personal">Personal</option><option value="professional">Professional</option><option value="both">Both</option>
            </select>
            <button type="button" onClick={() => void persist(starters.filter((item) => item.id !== starter.id))}>Delete</button>
          </div>
        ))}
      </div>
      <div className="button-row compact-buttons">
        <button type="button" onClick={() => setStarters((current) => [...current, { id: `starter-${crypto.randomUUID()}`, template: "Hi {name}, ", relationshipMode: "both" }])}>Add starter</button>
        <button className="primary-action" type="button" onClick={() => void persist(starters)}>Save starters</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}

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
  const [relationshipError, setRelationshipError] = useState("");
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

  async function toggleRelationshipContext(mode: "personal" | "professional", checked: boolean) {
    if (!settings) return;
    const current = settings.relationshipContexts ?? ["personal", "professional"];
    const next = checked ? [...new Set([...current, mode])] : current.filter((item) => item !== mode);
    if (next.length === 0) {
      setRelationshipError("Keep at least one relationship type enabled.");
      return;
    }
    setRelationshipError("");
    try {
      const updated = await updateRelationshipContexts(await getDatabase(), next);
      setSettings(updated);
      window.dispatchEvent(new CustomEvent("peopleos:relationship-contexts", { detail: next }));
    } catch {
      setRelationshipError("PeopleOS could not update this setting.");
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
        <section className="settings-section relationship-settings" aria-labelledby="settings-relationships-included">
          <div className="settings-section-heading">
            <h3 id="settings-relationships-included">Relationships included</h3>
            <p>Choose which types of relationships you use PeopleOS for.</p>
          </div>
          <div className="relationship-settings-options">
            {(["personal", "professional"] as const).map((mode) => (
              <label key={mode}>
                <input
                  type="checkbox"
                  checked={(settings?.relationshipContexts ?? ["personal", "professional"]).includes(mode)}
                  onChange={(event) => void toggleRelationshipContext(mode, event.target.checked)}
                />
                <span>{mode === "personal" ? "Personal" : "Professional"}</span>
              </label>
            ))}
            <p>When both are enabled, you can view everyone together or filter the app.</p>
            {relationshipError && <p className="field-error" role="alert">{relationshipError}</p>}
          </div>
        </section>
        {settings && <ConversationStarterSettings settings={settings} onSaved={setSettings} />}
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
