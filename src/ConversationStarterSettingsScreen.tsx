import { useEffect, useRef, useState } from "react";
import { getAppSettings } from "./application/peopleQueries";
import { updateConversationStarters } from "./application/settings";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI maps the established stale-write boundary to recovery copy.
import { StaleRevisionError } from "./data/repositories";
import {
  DEFAULT_CONVERSATION_STARTERS,
  type AppSettings,
  type ConversationStarter
} from "./domain/schema";

type Navigate = (path: string) => void;

function forEditing(template: string): string {
  const automaticGreeting = "Hi {name},\n\n";
  if (template.startsWith(automaticGreeting)) return template.slice(automaticGreeting.length);
  return template.replaceAll("{name}", "NAME");
}

function forStorage(template: string): string {
  const trimmed = template.trim();
  const withName = trimmed.replaceAll(/\bNAME\b/g, "{name}");
  return withName.includes("{name}") ? withName : `Hi {name},\n\n${withName}`;
}

function editableStarters(settings: AppSettings): ConversationStarter[] {
  return (settings.conversationStarters ?? DEFAULT_CONVERSATION_STARTERS).map((starter) => ({
    ...starter,
    template: forEditing(starter.template)
  }));
}

export default function ConversationStarterSettingsScreen({
  navigate,
  onDirtyChange,
  onSavingChange
}: {
  navigate: Navigate;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const [settings, setSettings] = useState<AppSettings>();
  const [starters, setStarters] = useState<ConversationStarter[]>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const preparedRef = useRef<{ signature: string; occurredAt: string }>();

  useEffect(() => {
    let active = true;
    getDatabase()
      .then(getAppSettings)
      .then((loaded) => {
        if (!active) return;
        setSettings(loaded);
        setStarters(editableStarters(loaded));
      })
      .catch(() => {
        if (active) setError("PeopleOS could not load the conversation starters.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    onDirtyChange(false);
    onSavingChange(false);
  }, [onDirtyChange, onSavingChange]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function changed(update: (current: ConversationStarter[]) => ConversationStarter[]) {
    dirtyRef.current = true;
    preparedRef.current = undefined;
    setStarters((current) => update(current ?? []));
    setError("");
    setSaved(false);
    onDirtyChange(true);
  }

  async function persist() {
    if (!settings || !starters || savingRef.current) return;
    if (starters.length === 0 || starters.some((starter) => starter.template.trim().length === 0)) {
      setError("Write something for each conversation starter.");
      setSaved(false);
      return;
    }
    if (!starters.some((starter) => starter.relationshipMode !== "professional")
      || !starters.some((starter) => starter.relationshipMode !== "personal")) {
      setError("Keep at least one starter for Personal and Professional relationships.");
      setSaved(false);
      return;
    }

    const normalised = starters.map((starter) => ({ ...starter, template: forStorage(starter.template) }));
    const signature = JSON.stringify([settings.revision, normalised]);
    if (preparedRef.current?.signature !== signature) {
      preparedRef.current = { signature, occurredAt: new Date().toISOString() };
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    onSavingChange(true);
    try {
      const updated = await updateConversationStarters(await getDatabase(), {
        expectedRevision: settings.revision,
        starters: normalised,
        occurredAt: preparedRef.current.occurredAt
      });
      setSettings(updated);
      setStarters(editableStarters(updated));
      preparedRef.current = undefined;
      dirtyRef.current = false;
      onDirtyChange(false);
      setSaved(true);
    } catch (caught) {
      if (caught instanceof StaleRevisionError) {
        try {
          const current = await getAppSettings(await getDatabase());
          setSettings(current);
          preparedRef.current = undefined;
          setError("Conversation starters changed elsewhere. Your edits are still here; review them and try again.");
        } catch {
          setError("PeopleOS could not reload the latest conversation starters. Your edits are still here.");
        }
      } else {
        setError("PeopleOS could not save the conversation starters. Try again.");
      }
      setSaved(false);
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  function addStarter() {
    changed((current) => [
      ...current,
      {
        id: `starter-${crypto.randomUUID()}`,
        template: "Hope you’re doing well.",
        relationshipMode: "both"
      }
    ]);
  }

  if (!starters && !error) {
    return (
      <main className="screen settings-screen" id="main-content" tabIndex={-1}>
        <button className="back-button" type="button" onClick={() => navigate("/settings")}>← Settings</button>
        <p role="status">Loading conversation starters…</p>
      </main>
    );
  }

  return (
    <main className="screen settings-screen conversation-starter-settings-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => navigate("/settings")}>← Settings</button>
      <header className="page-heading compact-heading">
        <p className="eyebrow">Settings</p>
        <h2>Conversation starters</h2>
        <p>Keep a few messages that sound like you. PeopleOS opens a draft; it never sends one.</p>
      </header>
      {!starters && error && <p className="field-error" role="alert">{error}</p>}
      {starters && (
        <section className="settings-section starter-admin" aria-label="Conversation starters">
          <p className="muted-copy">Use NAME only when you want to place the person’s name yourself.</p>
          <div className="starter-admin-list">
            {starters.map((starter, index) => (
              <div className="starter-admin-row" key={starter.id}>
                <textarea
                  aria-label={`Conversation starter ${index + 1}`}
                  rows={2}
                  maxLength={228}
                  placeholder="Hope you’re doing well."
                  value={starter.template}
                  onChange={(event) => changed((current) => current.map((item) => item.id === starter.id
                    ? { ...item, template: event.target.value }
                    : item))}
                />
                <select
                  aria-label={`Relationships for conversation starter ${index + 1}`}
                  value={starter.relationshipMode}
                  onChange={(event) => changed((current) => current.map((item) => item.id === starter.id
                    ? { ...item, relationshipMode: event.target.value as ConversationStarter["relationshipMode"] }
                    : item))}
                >
                  <option value="personal">Personal</option>
                  <option value="professional">Professional</option>
                  <option value="both">Both</option>
                </select>
                <button
                  type="button"
                  aria-label={`Delete conversation starter ${index + 1}`}
                  onClick={() => changed((current) => current.filter((item) => item.id !== starter.id))}
                >Delete</button>
              </div>
            ))}
          </div>
          <div className="button-row compact-buttons starter-admin-actions">
            <button type="button" disabled={saving || starters.length >= 100} onClick={addStarter}>Add starter</button>
            <button className="primary-action" type="button" disabled={saving} onClick={() => void persist()}>{saving ? "Saving…" : "Save"}</button>
          </div>
          {saved && <p className="success-message" role="status">Conversation starters saved.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
        </section>
      )}
    </main>
  );
}
