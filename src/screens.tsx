import { useEffect, useState } from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import { getAppSettings } from "./application/peopleQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { updateRelationshipContexts } from "./application/settings";
import { DEFAULT_CONVERSATION_STARTERS, type AppSettings } from "./domain/schema";

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
  rows: {
    label: string;
    value: string;
    href?: string;
  }[];
};

const settingsSections: SettingsSection[] = [
  { title: "Preferences", rows: [
    { label: "Default phone region", value: "Device region" },
    { label: "Dates and times", value: "Follows device" }
  ]},
  { title: "Your data", rows: [
    { label: "Import Contacts", value: "›", href: "/people/import" },
    { label: "Export backup", value: "›", href: "/settings/export" },
    { label: "Restore backup", value: "›", href: "/settings/restore" }
  ]},
  { title: "Privacy", rows: [
    { label: "Stored on", value: "This device" },
    { label: "Accounts and analytics", value: "None" }
  ]}
];

export function SettingsScreen({ navigate }: { navigate: (path: string) => void }) {
  const [settings, setSettings] = useState<AppSettings>();
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const [relationshipError, setRelationshipError] = useState("");
  useEffect(() => {
    let active = true;
    getDatabase().then(getAppSettings).then((settings) => {
      if (!active) return;
      setSettings(settings);
    }).catch(() => {
      if (!active) return;
      setSettingsLoadFailed(true);
    });
    return () => { active = false; };
  }, []);
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
        <h2>Settings</h2>
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
            {settingsLoadFailed && <p className="field-error" role="alert">PeopleOS could not load these settings.</p>}
            {relationshipError && <p className="field-error" role="alert">{relationshipError}</p>}
          </div>
        </section>
        <section className="settings-section" aria-label="Conversation settings">
          <dl>
            <div className="settings-row">
              <dt>
                <a
                  href="/settings/conversation-starters"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate("/settings/conversation-starters");
                  }}
                >Conversation starters ({settings?.conversationStarters?.length ?? DEFAULT_CONVERSATION_STARTERS.length})</a>
              </dt>
              <dd aria-hidden="true">›</dd>
            </div>
          </dl>
        </section>
        {settingsSections.map((section) => (
          <section className="settings-section" key={section.title} aria-labelledby={`settings-${section.title.replaceAll(" ", "-").toLowerCase()}`}>
            <div className="settings-section-heading">
              <h3 id={`settings-${section.title.replaceAll(" ", "-").toLowerCase()}`}>{section.title}</h3>
            </div>
            <dl>
              {section.rows.map((row) => (
                <div className="settings-row" key={row.label}>
                  <dt>{row.href
                    ? <a href={row.href} onClick={(event) => { event.preventDefault(); navigate(row.href!); }}>{row.label}</a>
                    : row.label}</dt>
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
