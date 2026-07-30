import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent
} from "react";
import { updateContactCadence } from "./application/followUps";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { addDaysToLocalDate, CADENCE_PRESET_OPTIONS } from "./domain/followUpPolicy";
import type { Person } from "./domain/schema";
import { ValidationError } from "./domain/validation";

type CadenceChoice = "1" | "3" | "7" | "14" | "30" | "90" | "custom";

export type CadenceEditorSheetProps = {
  person: Person;
  onClose: () => void;
  onSaved: (person: Person) => void;
};

function initialChoice(days: number | undefined): CadenceChoice {
  if (days === undefined) return "30";
  if (days === 1 || days === 3 || days === 7 || days === 14 || days === 30 || days === 90) return String(days) as CadenceChoice;
  return "custom";
}

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not update this reminder.";
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("/", "-");
}

export default function CadenceEditorSheet({ person, onClose, onSaved }: CadenceEditorSheetProps) {
  const modalId = useId();
  const fieldId = useId();
  const [enabled, setEnabled] = useState(Boolean(person.contactCadenceDays));
  const [choice, setChoice] = useState<CadenceChoice>(() => initialChoice(person.contactCadenceDays));
  const [customDays, setCustomDays] = useState(() =>
    person.contactCadenceDays !== undefined && initialChoice(person.contactCadenceDays) === "custom" ? String(person.contactCadenceDays) : ""
  );
  const [startChoice, setStartChoice] = useState<"today" | "tomorrow" | "week" | "date">("date");
  const [startDate, setStartDate] = useState(person.contactCadenceFirstDueDate ?? today());
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const enabledRef = useRef<HTMLInputElement>(null);
  const choiceRef = useRef<HTMLSelectElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const mutationRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  dirtyRef.current = dirty;
  savingRef.current = saving;
  closeRef.current = onClose;

  useEffect(() => {
    const id = `cadence-editor-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: {
        id,
        dismiss: () => {
          if (savingRef.current) return;
          if (dirtyRef.current && !window.confirm("Discard changes?")) return;
          closeRef.current();
        }
      }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!sheetRef.current?.contains(document.activeElement)) enabledRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (enabled && choice === "custom") requestAnimationFrame(() => customRef.current?.focus());
  }, [choice, enabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  });

  function closeEditor() {
    if (savingRef.current) return;
    if (dirtyRef.current && !window.confirm("Discard changes?")) return;
    onClose();
  }

  function selectChoice(next: CadenceChoice) {
    setChoice(next);
    setDirty(true);
    setError("");
  }

  function selectedDays(): number | undefined {
    if (!enabled) return undefined;
    if (choice === "custom") return Number(customDays);
    return Number(choice);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current) return;
    const cadenceDays = selectedDays();
    if (choice === "custom" && (!Number.isInteger(cadenceDays) || cadenceDays! < 1 || cadenceDays! > 3650)) {
      setError("Enter a whole number from 1 to 3650 days.");
      requestAnimationFrame(() => customRef.current?.focus());
      return;
    }
    const firstDueDate = !cadenceDays ? undefined
      : startChoice === "today" ? today()
        : startChoice === "tomorrow" ? addDaysToLocalDate(today(), 1)
          : startChoice === "week" ? addDaysToLocalDate(today(), 7)
            : startDate;
    if (cadenceDays && !firstDueDate) {
      setError("Pick a start date.");
      return;
    }
    if (cadenceDays === person.contactCadenceDays && firstDueDate === person.contactCadenceFirstDueDate) {
      setDirty(false);
      onSaved(person);
      return;
    }

    mutationRef.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await updateContactCadence(await getDatabase(), {
        personId: person.id,
        expectedRevision: person.revision,
        ...(cadenceDays === undefined ? {} : { cadenceDays }),
        ...(firstDueDate === undefined ? {} : { firstDueDate }),
        occurredAt: new Date().toISOString()
      });
      setDirty(false);
      onSaved(saved);
    } catch (caught) {
      setError(firstIssue(caught));
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <section
        ref={sheetRef}
        className="contact-sheet interaction-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-title`}
      >
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">{person.displayName}</p>
            <h3 id={`${fieldId}-title`}>Keep in touch</h3>
          </div>
          <button type="button" aria-label="Close Keep in touch" onClick={closeEditor} disabled={saving}>×</button>
        </div>

        <form className="contact-editor" onSubmit={save} noValidate>
          <label className="checkbox-row">
            <input ref={enabledRef} type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setDirty(true); }} />
            <span>Remind me to stay in touch</span>
          </label>

          {enabled && <div className="form-field">
            <label htmlFor={`${fieldId}-choice`}>How often?</label>
            <select
              ref={choiceRef}
              id={`${fieldId}-choice`}
              value={choice}
              onChange={(event) => selectChoice(event.target.value as CadenceChoice)}
            >
              {CADENCE_PRESET_OPTIONS.filter((option) => option.value !== undefined).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>}

          {enabled && choice === "custom" && (
            <div className="form-field">
              <label htmlFor={`${fieldId}-custom`}>Days between reminders</label>
              <input
                ref={customRef}
                id={`${fieldId}-custom`}
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                step={1}
                required
                value={customDays}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? `${fieldId}-error` : `${fieldId}-custom-hint`}
                onChange={(event) => { setCustomDays(event.target.value); setDirty(true); setError(""); }}
              />
              <p className="field-hint" id={`${fieldId}-custom-hint`}>Use a whole number from 1 to 3650.</p>
            </div>
          )}

          {enabled && <div className="form-field first-appearance-fieldset">
            <label htmlFor={`${fieldId}-start`}>Start</label>
            <select id={`${fieldId}-start`} value={startChoice} onChange={(event) => { setStartChoice(event.target.value as typeof startChoice); setDirty(true); }}>
              <option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="week">In 1 week</option><option value="date">Pick a date</option>
            </select>
            {startChoice === "date" && <input aria-label="Start date" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setDirty(true); }} />}
          </div>}

          {error && <p className="field-error" id={`${fieldId}-error`} role="alert">{error}</p>}

          <div className="button-row sheet-actions">
            <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
            <button className="primary-action" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
