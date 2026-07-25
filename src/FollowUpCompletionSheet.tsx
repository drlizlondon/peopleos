import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  completeFollowUpWithContact,
  completeFollowUpWithoutContact,
  createCompleteFollowUpWithContactCommand,
  createCompleteFollowUpWithoutContactCommand
} from "./application/followUps";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import {
  MANUAL_INTERACTION_KINDS,
  interactionCountsAsContact,
  interactionKindLabel
} from "./domain/interactionPolicy";
import type { FollowUp, InteractionKind } from "./domain/schema";
import { ValidationError } from "./domain/validation";

type CompletionChoice = "contacted" | "without_contact" | "";

export type FollowUpCompletionSheetProps = {
  followUp: FollowUp;
  personName: string;
  onClose: () => void;
  onCompleted: (followUp: FollowUp) => void;
};

type CompletionErrors = {
  choice?: string;
  occurredAt?: string;
  summary?: string;
  form?: string;
};

const CONTACT_INTERACTION_KINDS = MANUAL_INTERACTION_KINDS.filter(interactionCountsAsContact);

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not complete this follow-up.";
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
}

export default function FollowUpCompletionSheet({
  followUp,
  personName,
  onClose,
  onCompleted
}: FollowUpCompletionSheetProps) {
  const modalId = useId();
  const fieldId = useId();
  const [choice, setChoice] = useState<CompletionChoice>("");
  const [kind, setKind] = useState<InteractionKind>("phone_call");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString());
  const [summary, setSummary] = useState("");
  const [errors, setErrors] = useState<CompletionErrors>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const contactedRef = useRef<HTMLInputElement>(null);
  const occurredRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const mutationRef = useRef(false);
  const preparedRef = useRef<{ signature: string; command: unknown } | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  dirtyRef.current = dirty;
  savingRef.current = saving;
  closeRef.current = onClose;

  useEffect(() => {
    const id = `follow-up-completion-${modalId}`;
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
      if (!sheetRef.current?.contains(document.activeElement)) contactedRef.current?.focus();
    });
  }, []);

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

  function markChanged() {
    setDirty(true);
    preparedRef.current = null;
    setErrors({});
  }

  function selectChoice(nextChoice: Exclude<CompletionChoice, "">) {
    setChoice(nextChoice);
    markChanged();
  }

  function validate(): CompletionErrors {
    const next: CompletionErrors = {};
    if (!choice) next.choice = "Choose how this follow-up was completed.";
    if (choice === "contacted") {
      const occurred = new Date(occurredAt);
      if (!occurredAt || !Number.isFinite(occurred.getTime())) next.occurredAt = "Choose when the contact happened.";
      else if (occurred.getTime() > Date.now()) next.occurredAt = "Contact date and time cannot be in the future.";
      if (summary.trim().length > 5_000) next.summary = "Summary must be 5,000 characters or fewer.";
    }
    return next;
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current) return;
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        if (nextErrors.choice) contactedRef.current?.focus();
        else if (nextErrors.occurredAt) occurredRef.current?.focus();
        else summaryRef.current?.focus();
      });
      return;
    }
    if (!choice) return;

    mutationRef.current = true;
    setSaving(true);
    setErrors({});
    try {
      const db = await getDatabase();
      let completed: FollowUp;
      if (choice === "contacted") {
        const signature = JSON.stringify([
          followUp.id,
          followUp.revision,
          choice,
          kind,
          occurredAt,
          summary.trim()
        ]);
        if (preparedRef.current?.signature !== signature) {
          preparedRef.current = {
            signature,
            command: createCompleteFollowUpWithContactCommand(followUp, {
              kind,
              occurredAt,
              ...(summary.trim() ? { summary: summary.trim() } : {})
            })
          };
        }
        const result = await completeFollowUpWithContact(
          db,
          preparedRef.current.command as ReturnType<typeof createCompleteFollowUpWithContactCommand>
        );
        completed = result.followUp;
      } else {
        const signature = JSON.stringify([followUp.id, followUp.revision, choice]);
        if (preparedRef.current?.signature !== signature) {
          preparedRef.current = {
            signature,
            command: createCompleteFollowUpWithoutContactCommand(followUp)
          };
        }
        const result = await completeFollowUpWithoutContact(
          db,
          preparedRef.current.command as ReturnType<typeof createCompleteFollowUpWithoutContactCommand>
        );
        completed = result.followUp;
      }
      setDirty(false);
      onCompleted(completed);
    } catch (caught) {
      setErrors({ form: firstIssue(caught) });
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
            <p className="eyebrow">{personName}</p>
            <h3 id={`${fieldId}-title`}>Complete follow-up</h3>
          </div>
          <button type="button" aria-label="Close follow-up completion" onClick={closeEditor} disabled={saving}>×</button>
        </div>

        <form className="contact-editor" onSubmit={complete} noValidate>
          <p className="interaction-kind-readout"><strong>{followUp.reason}</strong></p>

          <fieldset
            className="choice-fieldset"
            aria-invalid={Boolean(errors.choice) || undefined}
            aria-describedby={errors.choice ? `${fieldId}-choice-error` : undefined}
          >
            <legend>What happened? <span>Required</span></legend>
            <label>
              <input
                ref={contactedRef}
                type="radio"
                name={`${fieldId}-choice`}
                value="contacted"
                checked={choice === "contacted"}
                onChange={() => selectChoice("contacted")}
              />
              I contacted them
            </label>
            <label>
              <input
                type="radio"
                name={`${fieldId}-choice`}
                value="without_contact"
                checked={choice === "without_contact"}
                onChange={() => selectChoice("without_contact")}
              />
              Completed without contacting them
            </label>
          </fieldset>
          {errors.choice && <p className="field-error" id={`${fieldId}-choice-error`} role="alert">{errors.choice}</p>}

          {choice === "contacted" && (
            <>
              <div className="form-field">
                <label htmlFor={`${fieldId}-kind`}>Interaction type <span>Required</span></label>
                <select
                  id={`${fieldId}-kind`}
                  value={kind}
                  onChange={(event) => { setKind(event.target.value as InteractionKind); markChanged(); }}
                >
                  {CONTACT_INTERACTION_KINDS.map((interactionKind) => (
                    <option key={interactionKind} value={interactionKind}>{interactionKindLabel(interactionKind)}</option>
                  ))}
                </select>
                <p className="field-hint">This records one meaningful interaction linked to the completed follow-up.</p>
              </div>

              <div className="form-field">
                <label htmlFor={`${fieldId}-occurred`}>Date and time <span>Required</span></label>
                <input
                  ref={occurredRef}
                  id={`${fieldId}-occurred`}
                  type="datetime-local"
                  required
                  value={toLocalInputValue(occurredAt)}
                  max={toLocalInputValue(new Date().toISOString())}
                  aria-invalid={Boolean(errors.occurredAt) || undefined}
                  aria-describedby={errors.occurredAt ? `${fieldId}-occurred-error` : undefined}
                  onChange={(event) => { setOccurredAt(fromLocalInputValue(event.target.value)); markChanged(); }}
                />
                {errors.occurredAt && <p className="field-error" id={`${fieldId}-occurred-error`} role="alert">{errors.occurredAt}</p>}
              </div>

              <div className="form-field">
                <div className="field-label-row">
                  <label htmlFor={`${fieldId}-summary`}>Summary</label>
                  <span>Optional · {summary.length}/5,000</span>
                </div>
                <textarea
                  ref={summaryRef}
                  id={`${fieldId}-summary`}
                  rows={4}
                  maxLength={5_000}
                  value={summary}
                  aria-invalid={Boolean(errors.summary) || undefined}
                  aria-describedby={errors.summary ? `${fieldId}-summary-error` : undefined}
                  onChange={(event) => { setSummary(event.target.value); markChanged(); }}
                  placeholder="What happened?"
                />
                {errors.summary && <p className="field-error" id={`${fieldId}-summary-error`} role="alert">{errors.summary}</p>}
              </div>
            </>
          )}

          {choice === "without_contact" && (
            <p className="interaction-kind-readout">
              PeopleOS will record that the follow-up was completed without contact. This will not change the last-contact date.
            </p>
          )}

          {errors.form && <p className="field-error" role="alert">{errors.form}</p>}

          <div className="button-row sheet-actions">
            <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
            <button className="primary-action" type="submit" disabled={saving}>
              {saving ? "Completing…" : "Complete follow-up"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
