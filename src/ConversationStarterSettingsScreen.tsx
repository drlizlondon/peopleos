import { useEffect, useState } from "react";
import { getAppSettings } from "./application/peopleQueries";
import { updateConversationStarters } from "./application/settings";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { DEFAULT_CONVERSATION_STARTERS, type ConversationStarter } from "./domain/schema";

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

export function ConversationStarterSettingsScreen({ navigate }: { navigate: Navigate }) {
  const [starters, setStarters] = useState<ConversationStarter[]>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    getDatabase()
      .then(getAppSettings)
      .then((settings) => {
        if (!active) return;
        setStarters((settings.conversationStarters ?? DEFAULT_CONVERSATION_STARTERS).map((starter) => ({
          ...starter,
          template: forEditing(starter.template)
        })));
      })
      .catch(() => {
        if (active) setError("PeopleOS could not load the conversation starters.");
      });
    return () => { active = false; };
  }, []);

  async function persist(next: ConversationStarter[]) {
    if (next.some((starter) => starter.template.trim().length === 0)) {
      setError("Write something for each conversation starter.");
      setSaved(false);
      return;
    }
    if (!next.some((starter) => starter.relationshipMode !== "professional")
      || !next.some((starter) => starter.relationshipMode !== "personal")) {
      setError("Keep at least one starter for Personal and Professional relationships.");
      setSaved(false);
      return;
    }

    const normalised = next.map((starter) => ({ ...starter, template: forStorage(starter.template) }));
    try {
      const updated = await updateConversationStarters(await getDatabase(), normalised);
      setStarters((updated.conversationStarters ?? normalised).map((starter) => ({
        ...starter,
        template: forEditing(starter.template)
      })));
      setError("");
      setSaved(true);
    } catch {
      setError("PeopleOS could not save the conversation starters.");
      setSaved(false);
    }
  }

  function addStarter() {
    setStarters((current) => [
      ...(current ?? []),
      {
        id: `starter-${crypto.randomUUID()}`,
        template: "Hope you’re doing well.",
        relationshipMode: "both"
      }
    ]);
    setSaved(false);
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
    <main className="screen settings-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => navigate("/settings")}>← Settings</button>
      <header className="page-heading compact-heading">
        <p className="eyebrow">Settings</p>
        <h2>Conversation starters</h2>
        <p>Write naturally. Use NAME only when you want to place the person’s name yourself.</p>
      </header>
      {!starters && error && <p className="field-error" role="alert">{error}</p>}
      {starters && (
        <section className="settings-section starter-admin" aria-label="Conversation starters">
          <div className="starter-admin-list">
            {starters.map((starter, index) => (
              <div className="starter-admin-row" key={starter.id}>
                <input
                  aria-label={`Conversation starter ${index + 1}`}
                  placeholder="Hope you’re doing well."
                  value={starter.template}
                  onChange={(event) => {
                    setStarters((current) => current?.map((item) => item.id === starter.id
                      ? { ...item, template: event.target.value }
                      : item));
                    setSaved(false);
                  }}
                />
                <select
                  aria-label={`Relationships for conversation starter ${index + 1}`}
                  value={starter.relationshipMode}
                  onChange={(event) => {
                    setStarters((current) => current?.map((item) => item.id === starter.id
                      ? { ...item, relationshipMode: event.target.value as ConversationStarter["relationshipMode"] }
                      : item));
                    setSaved(false);
                  }}
                >
                  <option value="personal">Personal</option>
                  <option value="professional">Professional</option>
                  <option value="both">Both</option>
                </select>
                <button
                  type="button"
                  aria-label={`Delete conversation starter ${index + 1}`}
                  onClick={() => {
                    setStarters((current) => current?.filter((item) => item.id !== starter.id));
                    setSaved(false);
                  }}
                >Delete</button>
              </div>
            ))}
          </div>
          <div className="button-row compact-buttons">
            <button type="button" onClick={addStarter}>Add starter</button>
            <button className="primary-action" type="button" onClick={() => void persist(starters)}>Save starters</button>
          </div>
          {saved && <p className="success-message" role="status">Conversation starters saved.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
        </section>
      )}
    </main>
  );
}

export default ConversationStarterSettingsScreen;
