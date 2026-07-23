import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  updateAlreadyContactedDefault,
  type UpdateAlreadyContactedDefaultCommand
} from "./application/settings";
import { getAppSettings } from "./application/peopleQueries";
import { getDatabase } from "./data/client";
import { StaleRevisionError } from "./data/repositories";
import { addDaysToLocalDate, localDateForInstant } from "./domain/followUpPolicy";
import type { AppSettings } from "./domain/schema";
import { ValidationError } from "./domain/validation";
import { formatEngineLocalDate } from "./relationship-engine";

type IntervalChoice = "2" | "7" | "14" | "30" | "custom";

type Props = {
  settings: AppSettings;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
};

const presets = [2, 7, 14, 30] as const;

function choiceFor(days: number): IntervalChoice {
  return presets.includes(days as (typeof presets)[number])
    ? String(days) as IntervalChoice
    : "custom";
}

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  if (error instanceof Error) return error.message;
  return "PeopleOS could not save this preference yet.";
}

export default function AlreadyContactedDefaultSheet({ settings: initialSettings, onClose, onSaved }: Props) {
  const modalId = useId();
  const fieldId = useId();
  const [baseSettings, setBaseSettings] = useState(initialSettings);
  const [choice, setChoice] = useState<IntervalChoice>(() => choiceFor(initialSettings.alreadyContactedDefaultReminderDays));
  const [customDays, setCustomDays] = useState(() => String(initialSettings.alreadyContactedDefaultReminderDays));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sheetRef = useRef<HTMLElement>(null);
  const firstChoiceRef = useRef<HTMLInputElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const preparedRef = useRef<{ signature: string; command: UpdateAlreadyContactedDefaultCommand }>();
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  savingRef.current = saving;
  closeRef.current = onClose;

  useEffect(() => {
    const id = `already-contacted-default-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: { id, dismiss: () => { if (!savingRef.current) closeRef.current(); } }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => {
    requestAnimationFrame(() => firstChoiceRef.current?.focus());
  }, []);

  useEffect(() => {
    if (choice === "custom") requestAnimationFrame(() => customRef.current?.focus());
  }, [choice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!savingRef.current) onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])"
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function select(next: IntervalChoice) {
    setChoice(next);
    setError("");
    preparedRef.current = undefined;
  }

  function selectedDays(): number {
    return choice === "custom" ? Number(customDays) : Number(choice);
  }

  const customDaysValue = Number(customDays);
  const customResultDate = choice === "custom"
    && Number.isInteger(customDaysValue)
    && customDaysValue >= 1
    && customDaysValue <= 3_650
    ? formatEngineLocalDate(addDaysToLocalDate(
      localDateForInstant(
        new Date().toISOString(),
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      ),
      customDaysValue
    ))
    : undefined;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const days = selectedDays();
    if (!Number.isInteger(days) || days < 1 || days > 3_650) {
      setError("Enter a whole number from 1 to 3650 days.");
      requestAnimationFrame(() => customRef.current?.focus());
      return;
    }
    if (days === baseSettings.alreadyContactedDefaultReminderDays) {
      onSaved(baseSettings);
      return;
    }

    const signature = JSON.stringify([baseSettings.revision, days]);
    if (preparedRef.current?.signature !== signature) {
      preparedRef.current = {
        signature,
        command: {
          expectedRevision: baseSettings.revision,
          days,
          occurredAt: new Date().toISOString()
        }
      };
    }
    setSaving(true);
    savingRef.current = true;
    setError("");
    try {
      const saved = await updateAlreadyContactedDefault(await getDatabase(), preparedRef.current.command);
      onSaved(saved);
    } catch (caught) {
      if (caught instanceof StaleRevisionError) {
        try {
          const current = await getAppSettings(await getDatabase());
          setBaseSettings(current);
          preparedRef.current = undefined;
          setError("This preference changed elsewhere. Review your choice and try again.");
        } catch {
          setError(firstIssue(caught));
        }
      } else {
        setError(firstIssue(caught));
      }
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !savingRef.current) onClose();
    }}>
      <section
        ref={sheetRef}
        className="contact-sheet settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-title`}
      >
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">Today</p>
            <h3 id={`${fieldId}-title`}>Default “Already contacted” interval</h3>
          </div>
          <button type="button" aria-label="Close interval setting" onClick={onClose} disabled={saving}>×</button>
        </div>
        <p className="muted-copy">This preselects a choice for future reminders. Nothing is scheduled until you confirm Already contacted.</p>
        <form className="contact-editor" onSubmit={save} noValidate>
          <fieldset className="choice-fieldset" aria-describedby={`${fieldId}-hint`}>
            <legend>Reminder interval</legend>
            {presets.map((days, index) => (
              <label key={days}>
                <input
                  ref={index === 0 ? firstChoiceRef : undefined}
                  type="radio"
                  name={`${fieldId}-interval`}
                  value={days}
                  checked={choice === String(days)}
                  onChange={() => select(String(days) as IntervalChoice)}
                />
                {days} days
              </label>
            ))}
            <label>
              <input
                type="radio"
                name={`${fieldId}-interval`}
                value="custom"
                checked={choice === "custom"}
                onChange={() => select("custom")}
              />
              Custom
            </label>
          </fieldset>
          <p className="field-hint" id={`${fieldId}-hint`}>The choice is global and never changes an existing reminder.</p>
          {choice === "custom" && (
            <div className="form-field">
              <label htmlFor={`${fieldId}-custom`}>Custom days <span>Required</span></label>
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
                onChange={(event) => {
                  setCustomDays(event.target.value);
                  setError("");
                  preparedRef.current = undefined;
                }}
              />
              <p className="field-hint" id={`${fieldId}-custom-hint`}>
                {customResultDate
                  ? `In ${customDaysValue} days · ${customResultDate}.`
                  : "Use a whole number from 1 to 3650."}
              </p>
            </div>
          )}
          {error && <p className="field-error" id={`${fieldId}-error`} role="alert">{error}</p>}
          <div className="button-row sheet-actions">
            <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-action" type="submit" disabled={saving}>
              {saving ? "Saving…" : error ? "Retry" : "Apply"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
