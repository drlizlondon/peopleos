import { useEffect, useId, useRef, useState } from "react";
import type { ContactNowTarget } from "./application/contactNow";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import type { LocalDate } from "./domain/schema";
import { formatEngineLocalDate } from "./relationship-engine";

type ModalProps = {
  personName: string;
  onClose: () => void;
};

type ContactMethodChoiceSheetProps = ModalProps & {
  targets: readonly ContactNowTarget[];
  hasPhone: boolean;
  error?: string;
  copyValue?: string;
  onChoose: (targetId: string) => void;
  onCopy?: () => void;
  onAddPhone: () => void;
  onManage: () => void;
  requestedChannel?: "call" | "message";
};

type ExplanationSheetProps = ModalProps & {
  reason: string;
  intendedAction?: string;
  memoryCue?: string;
  reachOutReason?: string;
};

type NextReminderSheetProps = ModalProps & {
  todayDate: LocalDate;
  defaultDays: number;
  attemptedDate?: LocalDate;
  additionalDueCount: number;
  saving: boolean;
  error?: string;
  onChooseDate: (date: string) => void;
  onRetry?: () => void;
};

function useModalSheet(
  prefix: string,
  onClose: () => void,
  firstFocusRef: React.RefObject<HTMLElement>,
  disabled = false
) {
  const modalId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  closeRef.current = onClose;
  disabledRef.current = disabled;

  useEffect(() => {
    const id = `${prefix}-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: { id, dismiss: () => { if (!disabledRef.current) closeRef.current(); } }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId, prefix]);

  useEffect(() => {
    requestAnimationFrame(() => firstFocusRef.current?.focus());
  }, [firstFocusRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!disabledRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
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
  }, []);

  return sheetRef;
}

export function ContactMethodChoiceSheet({
  personName,
  targets,
  hasPhone,
  error,
  copyValue,
  onChoose,
  onCopy,
  onAddPhone,
  onManage,
  requestedChannel,
  onClose
}: ContactMethodChoiceSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useModalSheet("today-contact-choice", onClose, closeButtonRef);
  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet today-sheet" role="dialog" aria-modal="true" aria-labelledby="today-contact-choice-title">
        <div className="sheet-heading">
          <div><p className="eyebrow">Contact now</p><h3 id="today-contact-choice-title">Contact {personName}</h3></div>
          <button ref={closeButtonRef} type="button" aria-label="Close contact method choice" onClick={onClose}>×</button>
        </div>
        {error && <p className="form-alert" role="alert">{error}</p>}
        {targets.length > 0 ? (
          <ul className="today-choice-list" aria-label="Contact methods">
            {targets.map((target) => (
              <li key={target.id}>
                <button type="button" onClick={() => onChoose(target.id)}>
                  <span>{target.channel === "phone_call" ? (requestedChannel === "message" ? "WhatsApp" : "Call") : "Email"} · {target.label}</span>
                  <strong>{target.familiarValue}</strong>
                  {target.isPreferred && <small>Preferred</small>}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="muted-copy">No contact details available.</p>}
        <div className="button-row sheet-actions">
          {copyValue && onCopy && <button type="button" onClick={onCopy}>Copy contact detail</button>}
          {!hasPhone && <button className="primary-action" type="button" onClick={onAddPhone}>Add phone number</button>}
          <button type="button" onClick={onManage}>Manage contact methods</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

export function ExplanationSheet({
  personName,
  reason,
  intendedAction,
  memoryCue,
  reachOutReason,
  onClose
}: ExplanationSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useModalSheet("today-explanation", onClose, closeButtonRef);
  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet today-sheet" role="dialog" aria-modal="true" aria-labelledby="today-explanation-title">
        <div className="sheet-heading">
          <div><p className="eyebrow">{personName}</p><h3 id="today-explanation-title">Why this person?</h3></div>
          <button ref={closeButtonRef} type="button" aria-label="Close explanation" onClick={onClose}>×</button>
        </div>
        <dl className="today-explanation-list">
          <div><dt>Reason</dt><dd>{reason}</dd></div>
          {intendedAction && <div><dt>Next action context</dt><dd>{intendedAction}</dd></div>}
          {memoryCue && <div><dt>Memory cue</dt><dd>{memoryCue}</dd></div>}
          {reachOutReason && <div><dt>Reach Out</dt><dd>{reachOutReason}</dd></div>}
        </dl>
        <div className="button-row sheet-actions"><button type="button" onClick={onClose}>Close</button></div>
      </section>
    </div>
  );
}

export function NextReminderSheet({
  personName,
  todayDate,
  defaultDays,
  attemptedDate,
  additionalDueCount,
  saving,
  error,
  onChooseDate,
  onRetry,
  onClose
}: NextReminderSheetProps) {
  const fixed = [2, 7, 14, 30] as const;
  const [pickingDate, setPickingDate] = useState(() => Boolean(attemptedDate));
  const [pickedDate, setPickedDate] = useState(attemptedDate ?? "");
  const [dateError, setDateError] = useState("");
  const defaultChoiceRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const options = fixed.includes(defaultDays as (typeof fixed)[number])
    ? [...fixed]
    : [...fixed, defaultDays];
  const selectedDays = options.find((days) => addDaysToLocalDate(todayDate, days) === attemptedDate)
    ?? (attemptedDate ? undefined : defaultDays);
  const sheetRef = useModalSheet("today-next-reminder", onClose, defaultChoiceRef, saving);

  function chooseDays(days: number) {
    setDateError("");
    onChooseDate(addDaysToLocalDate(todayDate, days));
  }

  function showDatePicker() {
    setPickingDate(true);
    setDateError("");
    requestAnimationFrame(() => dateRef.current?.focus());
  }

  function savePickedDate() {
    if (!pickedDate || pickedDate <= todayDate) {
      setDateError("Choose a date after today.");
      requestAnimationFrame(() => dateRef.current?.focus());
      return;
    }
    setDateError("");
    onChooseDate(pickedDate);
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet today-sheet" role="dialog" aria-modal="true" aria-labelledby="today-next-reminder-title">
        <div className="sheet-heading">
          <div><p className="eyebrow">{personName}</p><h3 id="today-next-reminder-title">When should I remind you again?</h3></div>
          <button type="button" aria-label="Close next reminder" onClick={onClose} disabled={saving}>×</button>
        </div>
        <div className="today-reminder-options" aria-label="Next reminder interval">
          {options.map((days) => (
            <button
              ref={days === selectedDays ? defaultChoiceRef : undefined}
              key={days}
              type="button"
              aria-pressed={days === selectedDays}
              className={days === selectedDays ? "selected" : undefined}
              disabled={saving}
              onClick={() => chooseDays(days)}
            >{fixed.includes(days as (typeof fixed)[number])
              ? `${days} days`
              : `In ${days} days · ${formatEngineLocalDate(addDaysToLocalDate(todayDate, days))}`}</button>
          ))}
          <button type="button" disabled={saving} onClick={showDatePicker}>Pick a date…</button>
        </div>
        {pickingDate && (
          <div className="today-date-picker form-field">
            <label htmlFor="today-next-reminder-date">Reminder date</label>
            <input
              ref={dateRef}
              id="today-next-reminder-date"
              type="date"
              min={addDaysToLocalDate(todayDate, 1)}
              value={pickedDate}
              aria-invalid={Boolean(dateError) || undefined}
              aria-describedby={dateError ? "today-next-reminder-date-error" : undefined}
              onChange={(event) => { setPickedDate(event.target.value); setDateError(""); }}
              disabled={saving}
            />
            {dateError && <p id="today-next-reminder-date-error" className="field-error" role="alert">{dateError}</p>}
            <button className="primary-action" type="button" onClick={savePickedDate} disabled={saving}>Choose date</button>
          </div>
        )}
        {additionalDueCount > 0 && (
          <p className="today-additional-disclosure">
            {additionalDueCount} other {additionalDueCount === 1 ? "plan remains" : "plans remain"} due and may bring {personName} back sooner.
          </p>
        )}
        {error && (
          <div className="form-alert" role="alert">
            <p>{error}</p>
            {onRetry && <button type="button" onClick={onRetry} disabled={saving}>Retry</button>}
          </div>
        )}
        {saving && <p className="screen-status" role="status">Saving…</p>}
        <div className="button-row sheet-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button></div>
      </section>
    </div>
  );
}
