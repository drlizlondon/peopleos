import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  completeReachOut,
  prepareCompleteReachOutCommand,
  type CompleteReachOutCommand
} from "./application/reachOut";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { FOLLOW_UP_ACTION_OPTIONS } from "./domain/followUpPolicy";
import {
  MANUAL_INTERACTION_KINDS,
  interactionCountsAsContact,
  interactionKindLabel
} from "./domain/interactionPolicy";
import type {
  FollowUp,
  FollowUpActionType,
  InteractionKind,
  Person,
  ReachOutEntry
} from "./domain/schema";
import { ValidationError } from "./domain/validation";

type CompletionChoice = "contact" | "without_contact" | "";
type NextChoice = "yes" | "no" | "";

type Props = {
  entry: ReachOutEntry;
  person: Person;
  currentFollowUp?: FollowUp;
  onClose: () => void;
  onCompleted: (entry: ReachOutEntry) => void;
};

type Errors = {
  choice?: string;
  completionAt?: string;
  summary?: string;
  next?: string;
  nextDate?: string;
  nextReason?: string;
  form?: string;
};

const CONTACT_KINDS = MANUAL_INTERACTION_KINDS.filter(interactionCountsAsContact);

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
}

function localDateFromInstant(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not complete this outreach.";
}

export default function ReachOutCompletionSheet({ entry, person, currentFollowUp, onClose, onCompleted }: Props) {
  const modalId = useId();
  const fieldId = useId();
  const [choice, setChoice] = useState<CompletionChoice>("");
  const [kind, setKind] = useState<InteractionKind>("email");
  const [completionAt, setCompletionAt] = useState(() => new Date().toISOString());
  const [summary, setSummary] = useState("");
  const [next, setNext] = useState<NextChoice>("");
  const [nextDate, setNextDate] = useState("");
  const [nextReason, setNextReason] = useState(currentFollowUp?.reason ?? entry.reason ?? `Reach out to ${person.displayName}`);
  const [nextAction, setNextAction] = useState<FollowUpActionType>(currentFollowUp?.actionType ?? entry.intendedActionType ?? "other");
  const [errors, setErrors] = useState<Errors>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const firstChoiceRef = useRef<HTMLInputElement>(null);
  const completionRef = useRef<HTMLInputElement>(null);
  const nextNoRef = useRef<HTMLInputElement>(null);
  const nextDateRef = useRef<HTMLInputElement>(null);
  const nextReasonRef = useRef<HTMLTextAreaElement>(null);
  const preparedRef = useRef<{ signature: string; command: CompleteReachOutCommand }>();
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const closeRef = useRef(onClose);
  savingRef.current = saving;
  dirtyRef.current = dirty;
  closeRef.current = onClose;

  useEffect(() => {
    const id = `reach-out-completion-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: { id, dismiss: () => {
        if (savingRef.current) return;
        if (dirtyRef.current && !window.confirm("Discard changes?")) return;
        closeRef.current();
      } }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => { requestAnimationFrame(() => firstChoiceRef.current?.focus()); }, []);

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
  });

  function closeEditor() {
    if (savingRef.current) return;
    if (dirtyRef.current && !window.confirm("Discard changes?")) return;
    onClose();
  }

  function changed() {
    setDirty(true);
    setErrors({});
    preparedRef.current = undefined;
  }

  function validate(): Errors {
    const nextErrors: Errors = {};
    if (!choice) nextErrors.choice = "Choose whether contact happened.";
    const completed = new Date(completionAt);
    if (!completionAt || !Number.isFinite(completed.getTime()) || completed.getTime() > Date.now()) {
      nextErrors.completionAt = "Choose a completion date and time that is not in the future.";
    }
    if (summary.trim().length > 5_000) nextErrors.summary = "Summary must be 5,000 characters or fewer.";
    if (!next) nextErrors.next = "Choose whether you want another follow-up.";
    if (next === "yes") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || nextDate <= localDateFromInstant(completionAt)) {
        nextErrors.nextDate = "Choose a follow-up date after the completion date.";
      }
      if (!nextReason.trim()) nextErrors.nextReason = "Add a reason for the next follow-up.";
      else if (nextReason.trim().length > 240) nextErrors.nextReason = "Reason must be 240 characters or fewer.";
    }
    return nextErrors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        if (nextErrors.choice) firstChoiceRef.current?.focus();
        else if (nextErrors.completionAt) completionRef.current?.focus();
        else if (nextErrors.next) nextNoRef.current?.focus();
        else if (nextErrors.nextDate) nextDateRef.current?.focus();
        else nextReasonRef.current?.focus();
      });
      return;
    }
    if (!choice || !next) return;
    const signature = JSON.stringify([choice, kind, completionAt, summary.trim(), next, nextDate, nextReason.trim(), nextAction]);
    setSaving(true);
    savingRef.current = true;
    setErrors({});
    try {
      if (preparedRef.current?.signature !== signature) {
        preparedRef.current = {
          signature,
          command: prepareCompleteReachOutCommand(entry, person, currentFollowUp, {
            ...(choice === "contact" ? {
              logInteraction: {
                kind,
                occurredAt: completionAt,
                ...(summary.trim() ? { summary: summary.trim() } : {})
              }
            } : {}),
            ...(next === "yes" ? {
              nextFollowUp: { dueDate: nextDate, reason: nextReason.trim(), actionType: nextAction }
            } : {})
          }, { now: completionAt, localDate: localDateFromInstant(completionAt) })
        };
      }
      const result = await completeReachOut(await getDatabase(), preparedRef.current.command);
      setDirty(false);
      onCompleted(result.entry);
    } catch (caught) {
      setErrors({ form: firstIssue(caught) });
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <section ref={sheetRef} className="contact-sheet interaction-sheet reach-out-completion-sheet" role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`}>
        <div className="sheet-heading">
          <div><p className="eyebrow">{person.displayName}</p><h3 id={`${fieldId}-title`}>Complete outreach</h3></div>
          <button type="button" aria-label="Close outreach completion" onClick={closeEditor} disabled={saving}>×</button>
        </div>
        <form className="contact-editor" onSubmit={submit} noValidate>
          <fieldset
            className="choice-fieldset"
            aria-invalid={Boolean(errors.choice) || undefined}
            aria-describedby={errors.choice ? `${fieldId}-choice-error` : undefined}
          >
            <legend>What happened? <span>Required</span></legend>
            <label><input ref={firstChoiceRef} type="radio" name={`${fieldId}-choice`} checked={choice === "contact"} onChange={() => { setChoice("contact"); changed(); }} /> I contacted them</label>
            <label><input type="radio" name={`${fieldId}-choice`} checked={choice === "without_contact"} onChange={() => { setChoice("without_contact"); changed(); }} /> Complete without logging contact</label>
          </fieldset>
          {errors.choice && <p className="field-error" id={`${fieldId}-choice-error`} role="alert">{errors.choice}</p>}

          <div className="form-field">
            <label htmlFor={`${fieldId}-completed`}>Completion date and time <span>Required</span></label>
            <input ref={completionRef} id={`${fieldId}-completed`} type="datetime-local" value={toLocalInputValue(completionAt)} max={toLocalInputValue(new Date().toISOString())} aria-invalid={Boolean(errors.completionAt) || undefined} aria-describedby={errors.completionAt ? `${fieldId}-completed-error` : undefined} onChange={(event) => { setCompletionAt(fromLocalInputValue(event.target.value)); changed(); }} />
            {errors.completionAt && <p className="field-error" id={`${fieldId}-completed-error`} role="alert">{errors.completionAt}</p>}
          </div>

          {choice === "contact" && (
            <>
              <div className="form-field"><label htmlFor={`${fieldId}-kind`}>Interaction type</label><select id={`${fieldId}-kind`} value={kind} onChange={(event) => { setKind(event.target.value as InteractionKind); changed(); }}>{CONTACT_KINDS.map((value) => <option key={value} value={value}>{interactionKindLabel(value)}</option>)}</select></div>
              <div className="form-field"><div className="field-label-row"><label htmlFor={`${fieldId}-summary`}>Summary</label><span>Optional · {summary.length}/5,000</span></div><textarea id={`${fieldId}-summary`} rows={3} maxLength={5_000} value={summary} aria-invalid={Boolean(errors.summary) || undefined} aria-describedby={errors.summary ? `${fieldId}-summary-error` : undefined} onChange={(event) => { setSummary(event.target.value); changed(); }} />{errors.summary && <p className="field-error" id={`${fieldId}-summary-error`} role="alert">{errors.summary}</p>}</div>
            </>
          )}
          {choice === "without_contact" && <p className="interaction-kind-readout">This records outreach completion without changing last meaningful contact.</p>}

          <fieldset
            className="choice-fieldset"
            aria-invalid={Boolean(errors.next) || undefined}
            aria-describedby={errors.next ? `${fieldId}-next-error` : undefined}
          >
            <legend>Do you want another follow-up? <span>Required</span></legend>
            <label><input ref={nextNoRef} type="radio" name={`${fieldId}-next`} checked={next === "no"} onChange={() => { setNext("no"); changed(); }} /> No, complete this outreach</label>
            <label><input type="radio" name={`${fieldId}-next`} checked={next === "yes"} onChange={() => { setNext("yes"); changed(); }} /> Yes, plan the next follow-up</label>
          </fieldset>
          {errors.next && <p className="field-error" id={`${fieldId}-next-error`} role="alert">{errors.next}</p>}

          {next === "yes" && (
            <>
              <div className="form-field"><label htmlFor={`${fieldId}-next-date`}>Next follow-up date <span>Required</span></label><input ref={nextDateRef} id={`${fieldId}-next-date`} type="date" min={localDateFromInstant(completionAt)} value={nextDate} aria-invalid={Boolean(errors.nextDate) || undefined} aria-describedby={errors.nextDate ? `${fieldId}-next-date-error` : undefined} onChange={(event) => { setNextDate(event.target.value); changed(); }} />{errors.nextDate && <p className="field-error" id={`${fieldId}-next-date-error`} role="alert">{errors.nextDate}</p>}</div>
              <div className="form-field"><label htmlFor={`${fieldId}-next-reason`}>Reason <span>Required</span></label><textarea ref={nextReasonRef} id={`${fieldId}-next-reason`} rows={2} maxLength={240} value={nextReason} aria-invalid={Boolean(errors.nextReason) || undefined} aria-describedby={errors.nextReason ? `${fieldId}-next-reason-error` : undefined} onChange={(event) => { setNextReason(event.target.value); changed(); }} />{errors.nextReason && <p className="field-error" id={`${fieldId}-next-reason-error`} role="alert">{errors.nextReason}</p>}</div>
              <div className="form-field"><label htmlFor={`${fieldId}-next-action`}>Action type</label><select id={`${fieldId}-next-action`} value={nextAction} onChange={(event) => { setNextAction(event.target.value as FollowUpActionType); changed(); }}>{FOLLOW_UP_ACTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            </>
          )}

          {errors.form && <p className="form-alert" role="alert">{errors.form}</p>}
          <div className="button-row sheet-actions"><button type="button" onClick={closeEditor} disabled={saving}>Cancel</button><button className="primary-action" type="submit" disabled={saving}>{saving ? "Completing…" : "Complete outreach"}</button></div>
        </form>
      </section>
    </div>
  );
}
