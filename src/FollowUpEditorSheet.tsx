import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  createFollowUp,
  createFollowUpDraft,
  createRescheduleFollowUpCommand,
  createSnoozeFollowUpCommand,
  rescheduleFollowUp,
  snoozeFollowUp
} from "./application/followUps";
import { hasExistingFutureFollowUp } from "./application/followUpQueries";
import { getDatabase } from "./data/client";
import {
  FOLLOW_UP_ACTION_OPTIONS,
  addDaysToLocalDate,
  effectiveFollowUpDate
} from "./domain/followUpPolicy";
import type { FollowUp, FollowUpActionType, LocalDate } from "./domain/schema";
import { ValidationError } from "./domain/validation";

export type FollowUpEditorMode = "create" | "reschedule" | "snooze";

export type FollowUpEditorSheetProps = {
  mode: FollowUpEditorMode;
  personId: string;
  personName: string;
  followUp?: FollowUp;
  suggestedDate?: LocalDate;
  suggestionExplanation?: string;
  existingFutureWarning?: string;
  onClose: () => void;
  onSaved: (followUp: FollowUp) => void;
};

type FieldErrors = {
  reason?: string;
  date?: string;
  form?: string;
};

function localDateToday(): LocalDate {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not save this follow-up.";
}

function validLocalDate(value: string): value is LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function titleForMode(mode: FollowUpEditorMode): string {
  if (mode === "snooze") return "Snooze follow-up";
  if (mode === "reschedule") return "Reschedule follow-up";
  return "Plan a follow-up";
}

function submitLabel(mode: FollowUpEditorMode, saving: boolean): string {
  if (saving) return mode === "create" ? "Saving…" : "Updating…";
  if (mode === "snooze") return "Confirm snooze";
  if (mode === "reschedule") return "Save reschedule";
  return "Save follow-up";
}

export default function FollowUpEditorSheet({
  mode,
  personId,
  personName,
  followUp,
  suggestedDate,
  suggestionExplanation,
  existingFutureWarning,
  onClose,
  onSaved
}: FollowUpEditorSheetProps) {
  const modalId = useId();
  const fieldId = useId();
  const today = useMemo(localDateToday, []);
  const initialDraft = useMemo(() => createFollowUpDraft(personId, {
    dueDate: suggestedDate ?? today
  }), [personId, suggestedDate, today]);
  const initialDate = mode === "create"
    ? initialDraft.dueDate
    : followUp ? effectiveFollowUpDate(followUp) : "";
  const [reason, setReason] = useState(mode === "create" ? initialDraft.reason : followUp?.reason ?? "");
  const [actionType, setActionType] = useState<FollowUpActionType>(
    mode === "create" ? initialDraft.actionType : followUp?.actionType ?? "other"
  );
  const [date, setDate] = useState<LocalDate | "">(mode === "snooze" ? "" : initialDate);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [detectedFutureWarning, setDetectedFutureWarning] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const firstSnoozeRef = useRef<HTMLButtonElement>(null);
  const mutationRef = useRef(false);
  const preparedRef = useRef<{ signature: string; command: unknown } | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  dirtyRef.current = dirty;
  savingRef.current = saving;
  closeRef.current = onClose;

  useEffect(() => {
    if (mode !== "create" || existingFutureWarning !== undefined) return;
    let active = true;
    getDatabase()
      .then((db) => hasExistingFutureFollowUp(db, personId, today))
      .then((exists) => {
        if (active && exists) {
          setDetectedFutureWarning(
            "A future follow-up already exists for this person. You can still add another for a different plan."
          );
        }
      })
      .catch(() => {
        // A warning query must not block a valid follow-up form.
      });
    return () => { active = false; };
  }, [existingFutureWarning, mode, personId, today]);

  useEffect(() => {
    const id = `follow-up-editor-${modalId}`;
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
      if (sheetRef.current?.contains(document.activeElement)) return;
      if (mode === "snooze") firstSnoozeRef.current?.focus();
      else reasonRef.current?.focus();
    });
  }, [mode]);

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

  function changeReason(value: string) {
    setReason(value);
    setDirty(true);
    preparedRef.current = null;
    setErrors((current) => ({ ...current, reason: undefined, form: undefined }));
  }

  function changeActionType(value: FollowUpActionType) {
    setActionType(value);
    setDirty(true);
    preparedRef.current = null;
    setErrors((current) => ({ ...current, form: undefined }));
  }

  function changeDate(value: string) {
    setDate(value);
    setDirty(true);
    preparedRef.current = null;
    setErrors((current) => ({ ...current, date: undefined, form: undefined }));
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (mode !== "snooze") {
      if (!reason.trim()) next.reason = "Add a reason for this follow-up.";
      else if (reason.trim().length > 240) next.reason = "Reason must be 240 characters or fewer.";
    }
    if (!date) next.date = mode === "snooze" ? "Choose when to show this follow-up again." : "Choose a follow-up date.";
    else if (!validLocalDate(date)) next.date = "Choose a valid date.";
    else if (mode === "snooze") {
      const effectiveDate = followUp ? effectiveFollowUpDate(followUp) : today;
      const earliestBase = effectiveDate > today ? effectiveDate : today;
      if (date <= earliestBase) next.date = "Snooze must be later than the current follow-up date and today.";
    } else if (date < today) {
      next.date = "Follow-up date must be today or later.";
    }
    return next;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current) return;
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        if (nextErrors.reason) reasonRef.current?.focus();
        else dateRef.current?.focus();
      });
      return;
    }
    if (!date || !validLocalDate(date)) return;
    if (mode !== "create" && !followUp) {
      setErrors({ form: "This follow-up is no longer available. Close and try again." });
      return;
    }

    mutationRef.current = true;
    setSaving(true);
    setErrors({});
    try {
      const db = await getDatabase();
      let saved: FollowUp;
      if (mode === "create") {
        saved = await createFollowUp(db, {
          ...initialDraft,
          reason: reason.trim(),
          actionType,
          dueDate: date
        }, { localDate: today });
      } else if (mode === "reschedule" && followUp) {
        const signature = JSON.stringify([followUp.id, followUp.revision, date, reason.trim(), actionType]);
        if (preparedRef.current?.signature !== signature) {
          preparedRef.current = {
            signature,
            command: createRescheduleFollowUpCommand(followUp, {
              dueDate: date,
              reason: reason.trim(),
              actionType
            })
          };
        }
        const result = await rescheduleFollowUp(
          db,
          preparedRef.current.command as ReturnType<typeof createRescheduleFollowUpCommand>,
          { localDate: today }
        );
        saved = result.replacement;
      } else if (followUp) {
        const signature = JSON.stringify([followUp.id, followUp.revision, date]);
        if (preparedRef.current?.signature !== signature) {
          preparedRef.current = {
            signature,
            command: createSnoozeFollowUpCommand(followUp, date)
          };
        }
        saved = await snoozeFollowUp(
          db,
          preparedRef.current.command as ReturnType<typeof createSnoozeFollowUpCommand>
        );
      } else {
        return;
      }
      setDirty(false);
      onSaved(saved);
    } catch (caught) {
      setErrors({ form: firstIssue(caught) });
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  const currentEffectiveDate = followUp ? effectiveFollowUpDate(followUp) : undefined;
  const snoozeBase = currentEffectiveDate && currentEffectiveDate > today ? currentEffectiveDate : today;
  const tomorrow = addDaysToLocalDate(snoozeBase, 1);
  const dateErrorId = `${fieldId}-date-error`;
  const reasonErrorId = `${fieldId}-reason-error`;

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
            <p className="eyebrow">{personName}</p>
            <h3 id={`${fieldId}-title`}>{titleForMode(mode)}</h3>
          </div>
          <button type="button" aria-label="Close follow-up editor" onClick={closeEditor} disabled={saving}>×</button>
        </div>

        <form className="contact-editor" onSubmit={save} noValidate>
          {mode === "snooze" && followUp ? (
            <>
              <p className="interaction-kind-readout"><strong>{followUp.reason}</strong></p>
              <p className="field-hint">
                Original date: <time dateTime={followUp.dueDate}>{followUp.dueDate}</time>. The original date remains in follow-up history.
              </p>
              <fieldset className="choice-fieldset">
                <legend>Choose a later date</legend>
                <div className="button-row">
                  <button ref={firstSnoozeRef} type="button" onClick={() => changeDate(tomorrow)}>Tomorrow</button>
                  <button type="button" onClick={() => changeDate(addDaysToLocalDate(snoozeBase, 7))}>Next week</button>
                  <button type="button" onClick={() => changeDate(addDaysToLocalDate(snoozeBase, 30))}>In one month</button>
                </div>
              </fieldset>
            </>
          ) : (
            <>
              {(existingFutureWarning || detectedFutureWarning) && (
                <p className="interaction-kind-readout" role="status">
                  {existingFutureWarning || detectedFutureWarning}
                </p>
              )}
              <div className="form-field">
                <div className="field-label-row">
                  <label htmlFor={`${fieldId}-reason`}>Reason <span>Required</span></label>
                  <span>{reason.length}/240</span>
                </div>
                <textarea
                  ref={reasonRef}
                  id={`${fieldId}-reason`}
                  rows={3}
                  maxLength={240}
                  required
                  value={reason}
                  aria-invalid={Boolean(errors.reason) || undefined}
                  aria-describedby={errors.reason ? reasonErrorId : `${fieldId}-reason-hint`}
                  onChange={(event) => changeReason(event.target.value)}
                  placeholder="Send the fellowship notes I promised"
                />
                <p className="field-hint" id={`${fieldId}-reason-hint`}>What will make this plan recognisable later?</p>
                {errors.reason && <p className="field-error" id={reasonErrorId} role="alert">{errors.reason}</p>}
              </div>

              <div className="form-field">
                <label htmlFor={`${fieldId}-action`}>Action type <span>Required</span></label>
                <select
                  id={`${fieldId}-action`}
                  value={actionType}
                  onChange={(event) => changeActionType(event.target.value as FollowUpActionType)}
                >
                  {FOLLOW_UP_ACTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {suggestedDate && mode === "create" && (
            <section className="interaction-kind-readout" aria-label="Suggested follow-up date">
              <strong>Suggested: {suggestedDate}</strong>
              {suggestionExplanation && <p>{suggestionExplanation}</p>}
              <button type="button" onClick={() => changeDate(suggestedDate)}>Use suggested date</button>
            </section>
          )}

          <div className="form-field">
            <label htmlFor={`${fieldId}-date`}>{mode === "snooze" ? "Snooze until" : "Date"} <span>Required</span></label>
            <input
              ref={dateRef}
              id={`${fieldId}-date`}
              type="date"
              required
              min={mode === "snooze"
                ? addDaysToLocalDate(snoozeBase, 1)
                : today}
              value={date}
              aria-invalid={Boolean(errors.date) || undefined}
              aria-describedby={errors.date ? dateErrorId : mode === "snooze" ? `${fieldId}-date-hint` : undefined}
              onChange={(event) => changeDate(event.target.value)}
            />
            {mode === "snooze" && <p className="field-hint" id={`${fieldId}-date-hint`}>Pick any date after the current effective date.</p>}
            {errors.date && <p className="field-error" id={dateErrorId} role="alert">{errors.date}</p>}
          </div>

          {errors.form && <p className="field-error" role="alert">{errors.form}</p>}

          <div className="button-row sheet-actions">
            <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
            <button className="primary-action" type="submit" disabled={saving}>
              {submitLabel(mode, saving)}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
