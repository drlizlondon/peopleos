import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import EmptyState from "./EmptyState";
import { updateContactCadence } from "./application/followUps";
import { updatePersonRelationshipMode } from "./application/personLifecycle";
import { getCurrentReachOutForPerson } from "./application/reachOutQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import { relationshipModeOf, type RelationshipMode } from "./domain/relationshipMode";
import type { Person, ReachOutEntry } from "./domain/schema";
import { personFollowUpsPath, reachOutDetailPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;
type CadenceChoice = "1" | "3" | "7" | "14" | "30" | "90" | "custom";
type StartChoice = "today" | "tomorrow" | "week" | "date";

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function cadenceChoice(days: number | undefined): CadenceChoice {
  if (days === 1 || days === 3 || days === 7 || days === 14 || days === 30 || days === 90) return String(days) as CadenceChoice;
  return days ? "custom" : "30";
}

function initialStart(firstDueDate: string | undefined): StartChoice {
  if (!firstDueDate) return "today";
  const today = localToday();
  if (firstDueDate === today) return "today";
  if (firstDueDate === addDaysToLocalDate(today, 1)) return "tomorrow";
  if (firstDueDate === addDaysToLocalDate(today, 7)) return "week";
  return "date";
}

function issue(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "PeopleOS could not save these relationship settings.";
}

export default function RelationshipSettingsScreen({
  personId,
  navigate,
  onBack,
  onAddToReachOut,
  onDirtyChange,
  onSavingChange
}: {
  personId: string;
  navigate: Navigate;
  onBack: () => void;
  onAddToReachOut: (person: Person, opener: HTMLElement) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const prefix = useId();
  const [person, setPerson] = useState<Person | null>();
  const [reachOut, setReachOut] = useState<ReachOutEntry | null>();
  const [mode, setMode] = useState<RelationshipMode>("personal");
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<CadenceChoice>("30");
  const [customDays, setCustomDays] = useState("");
  const [start, setStart] = useState<StartChoice>("today");
  const [startDate, setStartDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const attemptTimeRef = useRef<string>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDatabase().then(async (db) => {
      const [loaded, currentReachOut] = await Promise.all([
        db.get("people", personId),
        getCurrentReachOutForPerson(db, personId)
      ]);
      if (!active) return;
      setPerson(loaded ?? null);
      setReachOut(currentReachOut ?? null);
      if (loaded) {
        setMode(relationshipModeOf(loaded));
        setEnabled(Boolean(loaded.contactCadenceDays));
        setFrequency(cadenceChoice(loaded.contactCadenceDays));
        setCustomDays(loaded.contactCadenceDays && cadenceChoice(loaded.contactCadenceDays) === "custom" ? String(loaded.contactCadenceDays) : "");
        setStart(initialStart(loaded.contactCadenceFirstDueDate));
        setStartDate(loaded.contactCadenceFirstDueDate ?? localToday());
      }
    }).catch(() => {
      if (active) setError("PeopleOS could not load these relationship settings.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [personId]);

  useEffect(() => () => {
    onDirtyChange(false);
    onSavingChange(false);
  }, [onDirtyChange, onSavingChange]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function changed() {
    setDirty(true);
    setError("");
    attemptTimeRef.current = undefined;
    onDirtyChange(true);
  }

  function setContext(context: "personal" | "professional", checked: boolean) {
    const personal = mode === "personal" || mode === "both";
    const professional = mode === "professional" || mode === "both";
    const nextPersonal = context === "personal" ? checked : personal;
    const nextProfessional = context === "professional" ? checked : professional;
    if (!nextPersonal && !nextProfessional) {
      setError("Keep at least one relationship type selected.");
      return;
    }
    setMode(nextPersonal && nextProfessional ? "both" : nextPersonal ? "personal" : "professional");
    changed();
  }

  function close() {
    if (dirty && !window.confirm("Discard changes?")) return;
    onDirtyChange(false);
    onBack();
  }

  function selectedDays(): number | undefined {
    if (!enabled) return undefined;
    return frequency === "custom" ? Number(customDays) : Number(frequency);
  }

  function selectedStartDate(): string | undefined {
    if (!enabled) return undefined;
    const today = localToday();
    if (start === "today") return today;
    if (start === "tomorrow") return addDaysToLocalDate(today, 1);
    if (start === "week") return addDaysToLocalDate(today, 7);
    return startDate || undefined;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person || saving) return;
    const days = selectedDays();
    const firstDueDate = selectedStartDate();
    if (enabled && (!Number.isInteger(days) || days! < 1 || days! > 3650)) {
      setError("Enter a whole number from 1 to 3650 days.");
      return;
    }
    if (enabled && !firstDueDate) {
      setError("Pick a start date.");
      return;
    }

    const occurredAt = attemptTimeRef.current ?? new Date().toISOString();
    attemptTimeRef.current = occurredAt;
    setSaving(true);
    setError("");
    onSavingChange(true);
    try {
      const db = await getDatabase();
      const withMode = await updatePersonRelationshipMode(db, {
        personId: person.id,
        expectedRevision: person.revision,
        relationshipMode: mode,
        occurredAt
      });
      await updateContactCadence(db, {
        personId: person.id,
        expectedRevision: withMode.revision,
        ...(days === undefined ? {} : { cadenceDays: days, firstDueDate }),
        occurredAt
      });
      attemptTimeRef.current = undefined;
      setDirty(false);
      onDirtyChange(false);
      setSaving(false);
      onSavingChange(false);
      onBack();
    } catch (caught) {
      setError(issue(caught));
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  if (loading) {
    return <main className="screen relationship-settings-screen" id="main-content" tabIndex={-1}><p role="status">Loading relationship settings…</p></main>;
  }

  if (!person) {
    return (
      <main className="screen relationship-settings-screen" id="main-content" tabIndex={-1}>
        <EmptyState
          eyebrow="People"
          title="Person not found"
          description="This person may have been removed or the link may be out of date."
          action={<button className="primary-action" type="button" onClick={() => navigate("/people")}>Return to People</button>}
        />
      </main>
    );
  }

  return (
    <main className="screen relationship-settings-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={close} disabled={saving}>← Person</button>
      <header className="page-heading compact-heading">
        <p className="eyebrow">{person.displayName}</p>
        <h2>Relationship settings</h2>
      </header>
      <form className="person-edit-form relationship-settings-form" onSubmit={save} noValidate>
        <fieldset className="choice-fieldset relationship-mode-fieldset">
          <legend>Appears in</legend>
          <label><input type="checkbox" checked={mode === "personal" || mode === "both"} onChange={(event) => setContext("personal", event.target.checked)} /> Personal</label>
          <label><input type="checkbox" checked={mode === "professional" || mode === "both"} onChange={(event) => setContext("professional", event.target.checked)} /> Professional</label>
        </fieldset>

        <fieldset className="keep-in-touch-fieldset">
          <legend>Keep in touch</legend>
          <label className="checkbox-row">
            <input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); changed(); }} />
            Remind me to stay in touch
          </label>
        </fieldset>

        {enabled && (
          <div className="relationship-reminder-grid">
            <div className="form-field">
              <label htmlFor={`${prefix}-frequency`}>How often?</label>
              <select id={`${prefix}-frequency`} value={frequency} onChange={(event) => { setFrequency(event.target.value as CadenceChoice); changed(); }}>
                <option value="1">Every day</option>
                <option value="3">Every few days</option>
                <option value="7">Every week</option>
                <option value="14">Every 2 weeks</option>
                <option value="30">Every month</option>
                <option value="90">Every few months</option>
                <option value="custom">Custom</option>
              </select>
              {frequency === "custom" && (
                <input aria-label="Days between reminders" type="number" inputMode="numeric" min="1" max="3650" value={customDays} onChange={(event) => { setCustomDays(event.target.value); changed(); }} />
              )}
            </div>
            <div className="form-field">
              <label htmlFor={`${prefix}-start`}>Start</label>
              <select id={`${prefix}-start`} value={start} onChange={(event) => { setStart(event.target.value as StartChoice); changed(); }}>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="week">In 1 week</option>
                <option value="date">Pick a date</option>
              </select>
              {start === "date" && <input aria-label="Start date" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); changed(); }} />}
            </div>
          </div>
        )}

        <section className="relationship-reach-out-setting" aria-labelledby={`${prefix}-reach-out`}>
          <div>
            <h3 id={`${prefix}-reach-out`}>Reach Out</h3>
            <p>{reachOut ? "Included" : "Not included"}</p>
          </div>
          {reachOut
            ? <button type="button" onClick={() => navigate(reachOutDetailPath(reachOut.id))}>View</button>
            : <button type="button" onClick={(event) => onAddToReachOut(person, event.currentTarget)}>Add</button>}
        </section>

        <section className="relationship-reach-out-setting" aria-labelledby={`${prefix}-one-off-reminders`}>
          <div>
            <h3 id={`${prefix}-one-off-reminders`}>One-off reminders</h3>
          </div>
          <button type="button" onClick={() => navigate(personFollowUpsPath(person.id))}>View or add</button>
        </section>

        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="button-row form-actions">
          <button className="primary-action" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={close} disabled={saving}>Cancel</button>
        </div>
      </form>
    </main>
  );
}
