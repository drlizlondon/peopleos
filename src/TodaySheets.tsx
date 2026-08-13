import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ContactNowTarget } from "./application/contactNow";
import { addDaysToLocalDate, addMonthsToLocalDate } from "./domain/followUpPolicy";
import type { LocalDate } from "./domain/schema";
import { formatEngineLocalDate } from "./relationship-engine";

type ModalProps = {
  personName: string;
  onClose: () => void;
};

type ContactMethodChoiceSheetProps = ModalProps & {
  targets: readonly ContactNowTarget[];
  recoveryMode?: boolean;
  selectedTargetId?: string;
  error?: string;
  copyValue?: string;
  messageDraft?: string;
  saving?: boolean;
  iPhoneContactsAvailable?: boolean;
  onSelect: (targetId: string) => void;
  onContinue: (targetId: string) => void;
  onMessageDraftChange?: (draft: string) => void;
  onSaveManual?: (input: { targetId?: string; kind: "phone" | "email"; value: string }) => boolean | Promise<boolean>;
  onChooseIPhoneContact?: () => void | Promise<void>;
  onCopy?: () => void;
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

type PauseTodaySheetProps = ModalProps & {
  todayDate: LocalDate;
  saving: boolean;
  error?: string;
  onChooseDate: (date: LocalDate) => void;
};

function useModalSheet(
  prefix: string,
  onClose: () => void,
  firstFocusRef: React.RefObject<HTMLElement> | undefined,
  disabled = false,
  autoFocus = true
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
      detail: {
        id,
        dismiss: () => {
          if (disabledRef.current) return false;
          closeRef.current();
          return true;
        }
      }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId, prefix]);

  useEffect(() => {
    if (!autoFocus) return;
    requestAnimationFrame(() => {
      const firstFocusable = sheetRef.current?.querySelector<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      );
      (firstFocusRef?.current ?? firstFocusable)?.focus();
    });
  }, [autoFocus, firstFocusRef]);

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
      if (!first || !last) {
        event.preventDefault();
        sheetRef.current.focus();
        return;
      }
      if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
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
  recoveryMode = false,
  selectedTargetId,
  error,
  copyValue,
  messageDraft,
  saving = false,
  iPhoneContactsAvailable = false,
  onSelect,
  onContinue,
  onMessageDraftChange,
  onSaveManual,
  onChooseIPhoneContact,
  onCopy,
  onManage,
  requestedChannel,
  onClose
}: ContactMethodChoiceSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const iPhoneContactButtonRef = useRef<HTMLButtonElement>(null);
  const [changing, setChanging] = useState(recoveryMode || targets.length === 0);
  const [editing, setEditing] = useState<"add" | "correct" | null>(null);
  const [manualKind, setManualKind] = useState<"phone" | "email">(requestedChannel === "call" ? "phone" : "phone");
  const [manualValue, setManualValue] = useState("");
  const selected = targets.find((target) => target.id === selectedTargetId);
  const sheetRef = useModalSheet("today-contact-choice", onClose, closeButtonRef, saving);

  useEffect(() => {
    if (!selectedTargetId || targets.some((target) => target.id === selectedTargetId)) return;
    const first = targets[0];
    if (first) onSelect(first.id);
  }, [onSelect, selectedTargetId, targets]);

  function beginManual(mode: "add" | "correct") {
    setEditing(mode);
    const target = mode === "correct" ? selected : undefined;
    setManualKind(recoveryMode || requestedChannel === "call" ? "phone" : target?.channel === "email" ? "email" : "phone");
    setManualValue(target?.familiarValue ?? "");
  }

  async function submitManual() {
    if (!manualValue.trim()) return;
    const saved = await onSaveManual?.({
      ...(editing === "correct" && selected ? { targetId: selected.id } : {}),
      kind: recoveryMode || requestedChannel === "call" ? "phone" : manualKind,
      value: manualValue
    });
    if (saved) {
      setEditing(null);
      setChanging(false);
      setManualValue("");
      requestAnimationFrame(() => continueButtonRef.current?.focus());
    }
  }

  async function chooseIPhoneContact() {
    try {
      await onChooseIPhoneContact?.();
    } finally {
      requestAnimationFrame(() => iPhoneContactButtonRef.current?.focus());
    }
  }
  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet today-sheet" role="dialog" aria-modal="true" aria-labelledby="today-contact-choice-title" aria-busy={saving || undefined} tabIndex={-1}>
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">{recoveryMode ? "Contact details" : "Check the details"}</p>
            <h3 id="today-contact-choice-title">
              {recoveryMode
                ? `Can’t ${requestedChannel === "call" ? "call" : "message"} ${personName}`
                : `${requestedChannel === "message" ? "Message" : requestedChannel === "call" ? "Call" : "Contact"} ${personName}`}
            </h3>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close contact method choice" onClick={onClose} disabled={saving}>×</button>
        </div>
        {error && <p className="form-alert" role="alert">{error}</p>}
        {requestedChannel === "message" && messageDraft !== undefined && onMessageDraftChange && (
          <div className="form-field today-message-draft">
            <label htmlFor="today-message-draft">Message</label>
            <textarea id="today-message-draft" rows={3} value={messageDraft ?? ""} onChange={(event) => onMessageDraftChange(event.target.value)} disabled={saving} />
          </div>
        )}
        <div className="today-destination-summary">
          <span>To:</span>
          <strong>{selected?.familiarValue ?? (recoveryMode ? "No usable phone number" : requestedChannel === "call" ? "No phone number available" : "No message contact available")}</strong>
          {(!recoveryMode || !changing) && <button className="text-action" type="button" onClick={() => { setChanging(true); setEditing(null); }} disabled={saving}>{recoveryMode ? (selected ? "Change number" : "Add number") : "Change"}</button>}
        </div>
        {changing && (
          <div className="today-destination-change">
            {targets.length > 0 && (
              <ul className="today-choice-list" aria-label="Contact methods">
                {targets.map((target) => (
                  <li key={target.id}>
                    <button type="button" aria-pressed={target.id === selectedTargetId} onClick={() => {
                      onSelect(target.id);
                      setChanging(false);
                      setEditing(null);
                      requestAnimationFrame(() => continueButtonRef.current?.focus());
                    }} disabled={saving}>
                      <span>{target.channel === "phone_call" ? (requestedChannel === "message" ? "WhatsApp" : "Phone") : "Email"} · {target.label}</span>
                      <strong>{target.familiarValue}</strong>
                      {target.isPreferred && <small>Preferred</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!editing && (
              <div className="button-row compact-buttons today-correction-actions">
                {onSaveManual && selected && <button type="button" onClick={() => beginManual("correct")} disabled={saving}>{recoveryMode ? "Change number" : "Correct this detail"}</button>}
                {onSaveManual && <button type="button" onClick={() => beginManual("add")} disabled={saving}>{recoveryMode ? (selected ? "Use a different number" : "Enter number") : "Enter a different detail"}</button>}
                {iPhoneContactsAvailable && onChooseIPhoneContact && <button ref={iPhoneContactButtonRef} type="button" onClick={() => void chooseIPhoneContact()} disabled={saving}>{recoveryMode ? "Choose from iPhone Contacts" : "Add or update from iPhone Contacts"}</button>}
              </div>
            )}
            {editing && (
              <div className="today-inline-contact-editor">
                {requestedChannel === "message" && !recoveryMode && (
                  <label>Type
                    <select value={manualKind} onChange={(event) => setManualKind(event.target.value as "phone" | "email")} disabled={saving}>
                      <option value="phone">Phone number</option>
                      <option value="email">Email</option>
                    </select>
                  </label>
                )}
                <label>{requestedChannel === "call" || manualKind === "phone" ? "Phone number" : "Email"}
                  <input type={manualKind === "email" ? "email" : "tel"} value={manualValue} onChange={(event) => setManualValue(event.target.value)} disabled={saving} autoFocus />
                </label>
                {recoveryMode && <p className="muted-copy">This updates PeopleOS only. Your iPhone Contacts are not changed.</p>}
                <div className="button-row compact-buttons">
                  <button className="primary-action" type="button" onClick={() => void submitManual()} disabled={saving || !manualValue.trim()}>{saving ? "Saving…" : recoveryMode ? "Save to PeopleOS" : "Save detail"}</button>
                  <button type="button" onClick={() => {
                    setEditing(null);
                    requestAnimationFrame(() => continueButtonRef.current?.focus());
                  }} disabled={saving}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
        {requestedChannel === "message" && selected?.channel === "phone_call" && <p className="muted-copy">WhatsApp opens a message. Nothing is sent until you press Send.</p>}
        <button ref={continueButtonRef} className="primary-action today-contact-continue" type="button" disabled={saving || !selected} onClick={() => selected && onContinue(selected.id)}>
          {recoveryMode
            ? requestedChannel === "call" ? "Try call again" : "Try WhatsApp again"
            : requestedChannel === "call" ? "Continue to call" : "Continue to message"}
        </button>
        <div className="button-row sheet-actions">
          {copyValue && onCopy && <button type="button" onClick={onCopy}>Copy contact detail</button>}
          <button type="button" onClick={onManage} disabled={saving}>{recoveryMode ? "Manage contact" : "Manage all contact details"}</button>
          <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

export function ContactLinkReviewSheet({
  children,
  saving,
  onClose
}: {
  children: ReactNode;
  saving: boolean;
  onClose: () => void;
}) {
  const sheetRef = useModalSheet("today-contact-link", onClose, undefined, saving, false);
  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section
        ref={sheetRef}
        className="contact-sheet today-sheet today-contact-link-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Add or update from iPhone Contacts"
        aria-busy={saving || undefined}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}

export function PauseTodaySheet({
  personName,
  todayDate,
  saving,
  error,
  onChooseDate,
  onClose
}: PauseTodaySheetProps) {
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const dateId = `today-pause-date-${useId()}`;
  const [choosingDate, setChoosingDate] = useState(false);
  const [pickedDate, setPickedDate] = useState("");
  const [dateError, setDateError] = useState("");
  const sheetRef = useModalSheet("today-pause", onClose, firstChoiceRef, saving);

  function showDatePicker() {
    setChoosingDate(true);
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
    onChooseDate(pickedDate as LocalDate);
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet today-sheet" role="dialog" aria-modal="true" aria-labelledby={`${dateId}-title`} tabIndex={-1}>
        <div className="sheet-heading">
          <div><p className="eyebrow">{personName}</p><h3 id={`${dateId}-title`}>Pause from Today</h3></div>
          <button type="button" aria-label="Close Pause" onClick={onClose} disabled={saving}>×</button>
        </div>
        <p className="muted-copy">They’ll return to Today on the date you choose.</p>
        <div className="today-reminder-options" aria-label="Pause length">
          <button ref={firstChoiceRef} type="button" disabled={saving} onClick={() => onChooseDate(addDaysToLocalDate(todayDate, 7))}>1 week</button>
          <button type="button" disabled={saving} onClick={() => onChooseDate(addMonthsToLocalDate(todayDate, 1))}>1 month</button>
          <button type="button" disabled={saving} onClick={showDatePicker}>Choose date</button>
        </div>
        {choosingDate && (
          <div className="today-date-picker form-field">
            <label htmlFor={dateId}>Return to Today</label>
            <input
              ref={dateRef}
              id={dateId}
              type="date"
              min={addDaysToLocalDate(todayDate, 1)}
              value={pickedDate}
              aria-invalid={Boolean(dateError) || undefined}
              aria-describedby={dateError ? `${dateId}-error` : undefined}
              onChange={(event) => { setPickedDate(event.target.value); setDateError(""); }}
              disabled={saving}
            />
            {dateError && <p id={`${dateId}-error`} className="field-error" role="alert">{dateError}</p>}
            <button className="primary-action" type="button" onClick={savePickedDate} disabled={saving}>Pause until this date</button>
          </div>
        )}
        {error && <p className="form-alert" role="alert">{error}</p>}
        {saving && <p className="screen-status" role="status">Saving…</p>}
        <div className="button-row sheet-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button></div>
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
      <section ref={sheetRef} className="contact-sheet today-sheet" role="dialog" aria-modal="true" aria-labelledby="today-explanation-title" tabIndex={-1}>
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
      <section ref={sheetRef} className="contact-sheet today-sheet" role="dialog" aria-modal="true" aria-labelledby="today-next-reminder-title" tabIndex={-1}>
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
