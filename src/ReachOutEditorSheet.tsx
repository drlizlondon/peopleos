import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { listActivePersonOptions, type PersonPickerOption } from "./application/interactionQueries";
import { getAppSettings } from "./application/peopleQueries";
import {
  createReachOut,
  prepareCreateReachOutCommand,
  prepareUpdateReachOutPlanCommand,
  reminderDateFromDefault,
  updateReachOutPlan,
  type CreateReachOutCommand,
  type NewReachOutContextInput,
  type UpdateReachOutPlanCommand
} from "./application/reachOut";
import {
  getCurrentReachOutForPerson,
  listReachOutContexts
} from "./application/reachOutQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { addDaysToLocalDate, effectiveFollowUpDate, FOLLOW_UP_ACTION_OPTIONS } from "./domain/followUpPolicy";
import type {
  FollowUp,
  FollowUpActionType,
  LocalDate,
  Person,
  ReachOutContext,
  ReachOutEntry
} from "./domain/schema";
import { ValidationError } from "./domain/validation";

type ReachOutEditorProps = {
  mode: "create" | "edit";
  person?: Person;
  entry?: ReachOutEntry;
  currentFollowUp?: FollowUp;
  selectedContexts?: ReachOutContext[];
  onClose: () => void;
  onSaved: (entry: ReachOutEntry) => void;
  onOpenExisting: (entryId: string) => void;
};

type FieldErrors = {
  person?: string;
  reason?: string;
  notes?: string;
  date?: string;
  context?: string;
  form?: string;
};

function localDateToday(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not save this Reach Out plan.";
}

function validLocalDate(value: string): value is LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export default function ReachOutEditorSheet({
  mode,
  person,
  entry,
  currentFollowUp,
  selectedContexts = [],
  onClose,
  onSaved,
  onOpenExisting
}: ReachOutEditorProps) {
  const modalId = useId();
  const fieldId = useId();
  const today = useMemo(localDateToday, []);
  const existingEffectiveDate = currentFollowUp ? effectiveFollowUpDate(currentFollowUp) : undefined;
  const [people, setPeople] = useState<PersonPickerOption[]>([]);
  const [contexts, setContexts] = useState<ReachOutContext[]>([]);
  const [loading, setLoading] = useState(mode === "create");
  const [identityQuery, setIdentityQuery] = useState(person?.displayName ?? "");
  const [selectedPerson, setSelectedPerson] = useState<Person | undefined>(person);
  const [temporaryConfirmed, setTemporaryConfirmed] = useState(false);
  const [existingEntryId, setExistingEntryId] = useState<string>();
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [actionType, setActionType] = useState<FollowUpActionType | "">(entry?.intendedActionType ?? "");
  const [actionDetail, setActionDetail] = useState(entry?.actionDetail ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [reminderDate, setReminderDate] = useState<LocalDate | "">(
    currentFollowUp ? effectiveFollowUpDate(currentFollowUp) : ""
  );
  const [contextIds, setContextIds] = useState(() => selectedContexts.map((context) => context.id));
  const [newContextKind, setNewContextKind] = useState<ReachOutContext["kind"]>("fellowship");
  const [newContextLabel, setNewContextLabel] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const identityRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef<HTMLInputElement>(null);
  const preparedRef = useRef<{ signature: string; command: CreateReachOutCommand | UpdateReachOutPlanCommand }>();
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const closeRef = useRef(onClose);
  savingRef.current = saving;
  dirtyRef.current = dirty;
  closeRef.current = onClose;

  useEffect(() => {
    let active = true;
    if (mode === "edit") {
      getDatabase().then((db) => listReachOutContexts(db)).then((contextOptions) => {
        if (!active) return;
        setContexts(contextOptions);
        setLoading(false);
      }).catch(() => {
        if (!active) return;
        setErrors({ form: "PeopleOS could not load Reach Out contexts." });
        setLoading(false);
      });
      return () => { active = false; };
    }
    getDatabase().then(async (db) => Promise.all([
      listActivePersonOptions(db),
      listReachOutContexts(db),
      getAppSettings(db)
    ])).then(([personOptions, contextOptions, settings]) => {
      if (!active) return;
      setPeople(personOptions);
      setContexts(contextOptions);
      if (!currentFollowUp) setReminderDate(reminderDateFromDefault(today, settings.reachOutDefaultReminderDays) ?? "");
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setErrors({ form: "PeopleOS could not load Reach Out capture." });
      setLoading(false);
    });
    return () => { active = false; };
  }, [currentFollowUp, mode, today]);

  useEffect(() => {
    const id = `reach-out-editor-${modalId}`;
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
    if (loading) return;
    const frame = requestAnimationFrame(() => {
      if (!sheetRef.current?.contains(document.activeElement)) {
        if (mode === "create" && !person) identityRef.current?.focus();
        else reasonRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, mode, person]);

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

  async function choosePerson(option: PersonPickerOption) {
    setSelectedPerson(option.person);
    setIdentityQuery(option.person.displayName);
    setTemporaryConfirmed(false);
    changed();
    try {
      const current = await getCurrentReachOutForPerson(await getDatabase(), option.person.id);
      setExistingEntryId(current?.id);
    } catch {
      setErrors({ form: "PeopleOS could not check this person's Reach Out plan." });
    }
  }

  function changeIdentity(value: string) {
    setIdentityQuery(value);
    setSelectedPerson(undefined);
    setTemporaryConfirmed(false);
    setExistingEntryId(undefined);
    changed();
  }

  function confirmTemporary() {
    setTemporaryConfirmed(true);
    setSelectedPerson(undefined);
    setExistingEntryId(undefined);
    changed();
    requestAnimationFrame(() => reasonRef.current?.focus());
  }

  function setDate(value: string) {
    setReminderDate(value);
    changed();
  }

  function toggleContext(id: string) {
    setContextIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id]);
    changed();
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (mode === "create" && !selectedPerson && !temporaryConfirmed) {
      next.person = "Choose an existing person or use the text as a temporary description.";
    }
    if (!selectedPerson && identityQuery.trim().length > 120) next.person = "Temporary description must be 120 characters or fewer.";
    if (reason.trim().length > 240) next.reason = "Why you want to reach out must be 240 characters or fewer.";
    if (notes.trim().length > 5_000) next.notes = "Notes must be 5,000 characters or fewer.";
    if (reminderDate && (
      !validLocalDate(reminderDate)
      || (reminderDate < today && reminderDate !== existingEffectiveDate)
    )) next.date = "Choose today or a future date.";
    if (newContextLabel.trim().length > 120) next.context = "Context label must be 120 characters or fewer.";
    return next;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    if (existingEntryId) {
      onOpenExisting(existingEntryId);
      return;
    }
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        if (nextErrors.person) identityRef.current?.focus();
        else if (nextErrors.reason) reasonRef.current?.focus();
        else if (nextErrors.date) dateRef.current?.focus();
        else contextRef.current?.focus();
      });
      return;
    }
    if (mode === "edit" && (!entry || !person)) return;
    const newContexts: NewReachOutContextInput[] = newContextLabel.trim()
      ? [{ kind: newContextKind, label: newContextLabel.trim() }]
      : [];
    const signature = JSON.stringify([
      mode, selectedPerson?.id, identityQuery.trim(), temporaryConfirmed, reason.trim(), actionType,
      actionDetail.trim(), notes.trim(), reminderDate, contextIds, newContexts
    ]);
    setSaving(true);
    setErrors({});
    savingRef.current = true;
    try {
      const db = await getDatabase();
      let saved: ReachOutEntry;
      if (mode === "create") {
        if (preparedRef.current?.signature !== signature) {
          preparedRef.current = {
            signature,
            command: prepareCreateReachOutCommand({
              person: selectedPerson ?? { provisionalLabel: identityQuery },
              ...(reason.trim() ? { reason: reason.trim() } : {}),
              ...(actionType ? { intendedActionType: actionType } : {}),
              ...(actionDetail.trim() ? { actionDetail: actionDetail.trim() } : {}),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
              existingContextIds: contextIds,
              newContexts,
              ...(reminderDate ? { reminderDate } : {})
            }, { localDate: today })
          };
        }
        saved = (await createReachOut(db, preparedRef.current.command as CreateReachOutCommand)).entry;
      } else {
        if (preparedRef.current?.signature !== signature) {
          preparedRef.current = {
            signature,
            command: prepareUpdateReachOutPlanCommand(entry!, person!, currentFollowUp, {
              ...(reason.trim() ? { reason: reason.trim() } : {}),
              ...(actionType ? { intendedActionType: actionType } : {}),
              ...(actionDetail.trim() ? { actionDetail: actionDetail.trim() } : {}),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
              contextIds,
              newContexts,
              ...(reminderDate ? { reminderDate } : {})
            }, { localDate: today })
          };
        }
        saved = (await updateReachOutPlan(db, preparedRef.current.command as UpdateReachOutPlanCommand)).entry;
      }
      setDirty(false);
      onSaved(saved);
    } catch (caught) {
      const message = firstIssue(caught);
      const existingMatch = message.match(/already in Reach Out:([^\s]+)/);
      if (existingMatch) setExistingEntryId(existingMatch[1]);
      setErrors({ form: existingMatch ? "This person already has a current Reach Out plan." : message });
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  const normalized = identityQuery.trim().toLocaleLowerCase("en-US");
  const matches = people.filter((option) => !normalized
    || option.person.displayName.toLocaleLowerCase("en-US").includes(normalized)
    || option.affiliation?.toLocaleLowerCase("en-US").includes(normalized));
  const showTemporary = mode === "create" && !person && normalized.length > 0 && !selectedPerson && !temporaryConfirmed;
  const planVisible = mode === "edit" || Boolean(selectedPerson || temporaryConfirmed || person);

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <section ref={sheetRef} className="contact-sheet interaction-sheet reach-out-editor-sheet" role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`}>
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">Reach Out</p>
            <h3 id={`${fieldId}-title`}>{mode === "edit" ? "Edit Reach Out plan" : "Who do you want to reach out to?"}</h3>
          </div>
          <button type="button" aria-label="Close Reach Out editor" onClick={closeEditor} disabled={saving}>×</button>
        </div>

        {loading ? <p role="status">Loading Reach Out capture…</p> : (
          <form className="contact-editor" onSubmit={save} noValidate>
            {mode === "create" && (
              <div className="form-field">
                <label htmlFor={`${fieldId}-person`}>Person or description <span>Required</span></label>
                <input
                  ref={identityRef}
                  id={`${fieldId}-person`}
                  value={identityQuery}
                  readOnly={Boolean(person)}
                  aria-invalid={Boolean(errors.person) || undefined}
                  aria-describedby={errors.person ? `${fieldId}-person-error` : `${fieldId}-person-hint`}
                  onChange={(event) => changeIdentity(event.target.value)}
                  placeholder="Simon, Hackathon organiser, A potential mentor"
                />
                <p className="field-hint" id={`${fieldId}-person-hint`}>A full name or contact detail is not required.</p>
                {errors.person && <p className="field-error" id={`${fieldId}-person-error`} role="alert">{errors.person}</p>}
                {!person && !selectedPerson && matches.length > 0 && normalized && (
                  <ul className="selector-list compact-selector" aria-label="Matching people">
                    {matches.slice(0, 5).map((option) => (
                      <li key={option.person.id}>
                        <button type="button" onClick={() => void choosePerson(option)}>
                          <strong>{option.person.displayName}</strong>
                          {option.affiliation && <span>{option.affiliation}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {showTemporary && (
                  <button className="text-action temporary-label-action" type="button" onClick={confirmTemporary}>
                    Use “{identityQuery.trim()}” as a temporary description
                  </button>
                )}
                {temporaryConfirmed && <p className="identity-note"><span className="status-chip">Identity incomplete</span> You can complete or link this Person later.</p>}
                {selectedPerson && <p className="identity-note"><span className="status-chip">Existing person</span> {selectedPerson.displayName}</p>}
                {existingEntryId && <p className="interaction-kind-readout" role="status">This person already has a current Reach Out plan. Open it instead of creating a duplicate.</p>}
              </div>
            )}

            {planVisible && (
              <>
                <div className="form-field">
                  <div className="field-label-row"><label htmlFor={`${fieldId}-reason`}>Why I want to reach out</label><span>Optional · {reason.length}/240</span></div>
                  <textarea ref={reasonRef} id={`${fieldId}-reason`} rows={3} maxLength={240} value={reason} aria-invalid={Boolean(errors.reason) || undefined} aria-describedby={errors.reason ? `${fieldId}-reason-error` : undefined} onChange={(event) => { setReason(event.target.value); changed(); }} placeholder="Interested in NHS AI and worth reconnecting with" />
                  {errors.reason && <p className="field-error" id={`${fieldId}-reason-error`} role="alert">{errors.reason}</p>}
                </div>

                <div className="form-field">
                  <label htmlFor={`${fieldId}-action`}>Intended next action <span>Optional</span></label>
                  <select id={`${fieldId}-action`} value={actionType} onChange={(event) => { setActionType(event.target.value as FollowUpActionType | ""); changed(); }}>
                    <option value="">Choose later</option>
                    {FOLLOW_UP_ACTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>

                <div className="form-field">
                  <label htmlFor={`${fieldId}-action-detail`}>Action detail <span>Optional</span></label>
                  <input id={`${fieldId}-action-detail`} value={actionDetail} maxLength={240} onChange={(event) => { setActionDetail(event.target.value); changed(); }} placeholder="Ask about the fellowship programme" />
                </div>

                <fieldset className="choice-fieldset reach-out-reminder-shortcuts">
                  <legend>When do you want to contact them? <span>Optional</span></legend>
                  <div className="button-row compact-buttons">
                    <button type="button" onClick={() => setDate(today)}>Today</button>
                    <button type="button" onClick={() => setDate(addDaysToLocalDate(today, 1))}>Tomorrow</button>
                    <button type="button" onClick={() => setDate(addDaysToLocalDate(today, 7))}>Next week</button>
                    <button type="button" onClick={() => setDate(addDaysToLocalDate(today, 30))}>In one month</button>
                    {reminderDate && <button type="button" onClick={() => setDate("")}>No reminder</button>}
                  </div>
                </fieldset>
                <div className="form-field">
                  <label htmlFor={`${fieldId}-date`}>Reminder date <span>Optional</span></label>
                  <input ref={dateRef} id={`${fieldId}-date`} type="date" min={today} value={reminderDate} aria-invalid={Boolean(errors.date) || undefined} aria-describedby={errors.date ? `${fieldId}-date-error` : `${fieldId}-date-hint`} onChange={(event) => setDate(event.target.value)} />
                  <p className="field-hint" id={`${fieldId}-date-hint`}>No date means the person stays Active in Reach Out without creating a follow-up.</p>
                  {errors.date && <p className="field-error" id={`${fieldId}-date-error`} role="alert">{errors.date}</p>}
                </div>

                {contexts.length > 0 && (
                  <fieldset className="choice-fieldset context-choice-list">
                    <legend>Existing context <span>Optional</span></legend>
                    {contexts.map((context) => (
                      <label key={context.id}><input type="checkbox" checked={contextIds.includes(context.id)} onChange={() => toggleContext(context.id)} /> {context.label} · {context.kind}</label>
                    ))}
                  </fieldset>
                )}
                <div className="form-field reach-out-new-context">
                  <label htmlFor={`${fieldId}-context-label`}>Add context <span>Optional</span></label>
                  <div className="inline-field-row">
                    <select aria-label="Context type" value={newContextKind} onChange={(event) => { setNewContextKind(event.target.value as ReachOutContext["kind"]); changed(); }}>
                      <option value="fellowship">Fellowship</option><option value="event">Event</option><option value="organisation">Organisation</option><option value="project">Project</option><option value="other">Other</option>
                    </select>
                    <input ref={contextRef} id={`${fieldId}-context-label`} value={newContextLabel} maxLength={120} aria-invalid={Boolean(errors.context) || undefined} aria-describedby={errors.context ? `${fieldId}-context-error` : undefined} onChange={(event) => { setNewContextLabel(event.target.value); changed(); }} placeholder="HealthTech Fellowship" />
                  </div>
                  {errors.context && <p className="field-error" id={`${fieldId}-context-error`} role="alert">{errors.context}</p>}
                </div>

                <div className="form-field">
                  <div className="field-label-row"><label htmlFor={`${fieldId}-notes`}>Context or notes</label><span>Optional · {notes.length}/5,000</span></div>
                  <textarea id={`${fieldId}-notes`} rows={4} maxLength={5_000} value={notes} aria-invalid={Boolean(errors.notes) || undefined} aria-describedby={errors.notes ? `${fieldId}-notes-error` : undefined} onChange={(event) => { setNotes(event.target.value); changed(); }} />
                  {errors.notes && <p className="field-error" id={`${fieldId}-notes-error`} role="alert">{errors.notes}</p>}
                </div>
              </>
            )}

            {errors.form && <p className="form-alert" role="alert">{errors.form}</p>}
            <div className="button-row sheet-actions">
              <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
              <button className="primary-action" type="submit" disabled={saving || loading}>
                {existingEntryId ? "Open existing plan" : saving ? "Saving…" : mode === "edit" ? "Save plan" : "Add to Reach Out"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
