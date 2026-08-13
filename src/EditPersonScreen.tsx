import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import EmptyState from "./EmptyState";
import {
  archivePerson,
  restorePerson,
  updatePerson,
  type PersonEditDraft
} from "./application/personLifecycle";
import { getNextPlanForPerson } from "./application/followUpQueries";
import {
  updatePersonWithInitialSchedule,
  updatePersonWithoutRegularSchedule
} from "./application/manualPersonCapture";
import { getRegularContactStartRequirement } from "./application/regularContactSchedule";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { RecordConflictError, StaleRevisionError } from "./data/repositories";
import {
  contactCadenceOf,
  isValidContactCadence,
  maxContactCadenceValue
} from "./domain/cadence";
import type { ContactCadence, ContactCadenceUnit, FollowUp, LocalDate, Person } from "./domain/schema";
import { conversationalNameFor, defaultConversationalName } from "./domain/personNames";
import { RELATIONSHIP_MODE_OPTIONS, relationshipModeOf } from "./domain/relationshipMode";
import { ValidationError } from "./domain/validation";
import { contactMethodsPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type FieldErrors = {
  displayName?: string;
  conversationalName?: string;
  tags?: string;
  cadence?: string;
  start?: string;
};

function parseTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? "Check the form and try again.";
  if (error instanceof StaleRevisionError || error instanceof RecordConflictError) return error.message;
  return "PeopleOS could not save these changes. Your draft is still here.";
}

function localDate(offsetDays = 0): LocalDate {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` as LocalDate;
}

function frequencyValue(cadence: ContactCadence | undefined): string {
  if (!cadence) return "none";
  const key = `${cadence.value}-${cadence.unit}`;
  return ["1-days", "3-days", "1-weeks", "2-weeks", "1-months"].includes(key) ? key : "custom";
}

export default function EditPersonScreen({
  personId,
  navigate,
  onBack,
  onDirtyChange,
  onSavingChange
}: {
  personId: string;
  navigate: Navigate;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const prefix = useId();
  const [person, setPerson] = useState<Person | null | undefined>(undefined);
  const [loadVersion, setLoadVersion] = useState(0);
  const [draft, setDraft] = useState<PersonEditDraft>({ displayName: "", relationshipMode: "personal", importance: "normal", tags: [] });
  const [tagsText, setTagsText] = useState("");
  const [cadenceText, setCadenceText] = useState("");
  const [cadenceUnit, setCadenceUnit] = useState<ContactCadenceUnit>("days");
  const [frequency, setFrequency] = useState("none");
  const [needsStartDate, setNeedsStartDate] = useState(false);
  const [regularScheduleFollowUp, setRegularScheduleFollowUp] = useState<FollowUp>();
  const [startChoice, setStartChoice] = useState<"today" | "tomorrow">();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const mutationRef = useRef(false);
  const attemptTimeRef = useRef<string | null>(null);
  const archiveAttemptTimeRef = useRef<string | null>(null);
  const restoreAttemptTimeRef = useRef<string | null>(null);
  const initialScheduleIdsRef = useRef({
    followUpId: `follow-up-${crypto.randomUUID()}`,
    followUpEventId: `follow-up-event-${crypto.randomUUID()}`
  });
  const scheduleCancellationEventIdRef = useRef(`follow-up-event-${crypto.randomUUID()}`);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const conversationalNameRef = useRef<HTMLInputElement>(null);
  const tagsRef = useRef<HTMLInputElement>(null);
  const cadenceRef = useRef<HTMLInputElement>(null);
  const startFieldsetRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    let active = true;
    setPerson(undefined);
    setFormError("");
    getDatabase().then(async (db) => Promise.all([
      db.get("people", personId),
      getNextPlanForPerson(db, personId, localDate()),
      db.getAllFromIndex("followUps", "by-person", personId),
      getRegularContactStartRequirement(db, personId).catch(() => "existing_anchor" as const)
    ])).then(([record, nextPlan, followUps, startRequirement]) => {
      if (!active) return;
      const loaded = record ?? null;
      setPerson(loaded);
      if (record) {
        const contactCadence = contactCadenceOf(record);
        setDraft({
          displayName: record.displayName,
          conversationalName: conversationalNameFor(record),
          relationshipMode: relationshipModeOf(record),
          importance: record.importance,
          tags: record.tags,
          ...(contactCadence ? { contactCadence } : {})
        });
        setTagsText(record.tags.join(", "));
        setCadenceText(contactCadence ? String(contactCadence.value) : "");
        setCadenceUnit(contactCadence?.unit ?? "days");
        setFrequency(frequencyValue(contactCadence));
        setNeedsStartDate(startRequirement === "start_required"
          || (nextPlan.kind === "cadence" && !nextPlan.date));
        setStartChoice(undefined);
        setRegularScheduleFollowUp(followUps
          .filter((followUp) => followUp.status === "pending"
            && ["initial_schedule", "today_already_contacted"].includes(followUp.suggestedByRule ?? "")
            && !followUp.reachOutEntryId)
          .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id))[0]);
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (active === document.body || active?.id === "main-content") headingRef.current?.focus();
        });
      }
    }).catch(() => { if (active) setFormError("PeopleOS could not load this person."); });
    return () => { active = false; };
  }, [loadVersion, personId]);

  useEffect(() => () => {
    onDirtyChange(false);
    onSavingChange(false);
  }, [onDirtyChange, onSavingChange]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function changed(next: Partial<PersonEditDraft>) {
    dirtyRef.current = true;
    attemptTimeRef.current = null;
    setDraft((current) => {
      const updated = { ...current, ...next };
      if ("contactCadence" in next && next.contactCadence === undefined) delete updated.contactCadence;
      if ("contactCadenceDays" in next && next.contactCadenceDays === undefined) delete updated.contactCadenceDays;
      return updated;
    });
    setErrors({});
    setFormError("");
    onDirtyChange(true);
  }

  function cancel() {
    if (dirtyRef.current && !window.confirm("Discard changes?")) return;
    dirtyRef.current = false;
    onDirtyChange(false);
    onBack();
  }

  function validate(): PersonEditDraft | undefined {
    const nextErrors: FieldErrors = {};
    const displayName = draft.displayName.trim();
    const conversationalName = draft.conversationalName?.trim()
      || defaultConversationalName(displayName);
    const tags = parseTags(tagsText);
    const cadence: ContactCadence | undefined = cadenceText.trim()
      ? { value: Number(cadenceText), unit: cadenceUnit }
      : undefined;
    if (!displayName) nextErrors.displayName = "Add a name or description so you can recognise this person.";
    else if (displayName.length > 120) nextErrors.displayName = "Use 120 characters or fewer.";
    if (conversationalName.length > 120) nextErrors.conversationalName = "Use 120 characters or fewer.";
    if (tags.length > 10) nextErrors.tags = "Add no more than 10 tags.";
    else if (tags.some((tag) => tag.length > 40)) nextErrors.tags = "Each tag must be 40 characters or fewer.";
    if (cadence !== undefined && !isValidContactCadence(cadence)) {
      nextErrors.cadence = `Enter a whole number from 1 to ${maxContactCadenceValue(cadenceUnit)} ${cadenceUnit}, or leave this blank.`;
    }
    if (cadence !== undefined && needsStartDate && !startChoice) {
      nextErrors.start = "Choose Start today or Start tomorrow.";
    }
    setErrors(nextErrors);
    const first = nextErrors.displayName
      ? nameRef.current
      : nextErrors.conversationalName
        ? conversationalNameRef.current
        : nextErrors.tags
          ? tagsRef.current
          : undefined;
    if (Object.keys(nextErrors).length > 0) {
      requestAnimationFrame(() => {
        if (first) first.focus();
        else if (nextErrors.start) startFieldsetRef.current?.focus();
      });
      return undefined;
    }
    return {
      displayName,
      conversationalName,
      relationshipMode: draft.relationshipMode,
      importance: draft.importance,
      tags,
      ...(cadence === undefined ? {} : { contactCadence: cadence })
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person || person.archivedAt || mutationRef.current) return;
    const validated = validate();
    if (!validated) return;
    mutationRef.current = true;
    setSaving(true);
    setFormError("");
    onSavingChange(true);
    const occurredAt = attemptTimeRef.current ?? new Date().toISOString();
    attemptTimeRef.current = occurredAt;
    try {
      const db = await getDatabase();
      const saved = validated.contactCadence && needsStartDate
        ? await updatePersonWithInitialSchedule(db, {
          personId: person.id,
          expectedRevision: person.revision,
          draft: validated,
          startDate: startChoice === "today"
            ? localDate()
            : startChoice === "tomorrow"
              ? localDate(1)
              : undefined,
          ...initialScheduleIdsRef.current,
          occurredAt
        })
        : !validated.contactCadence && regularScheduleFollowUp
          ? await updatePersonWithoutRegularSchedule(db, {
            personId: person.id,
            expectedRevision: person.revision,
            draft: validated,
            followUpId: regularScheduleFollowUp.id,
            expectedFollowUpRevision: regularScheduleFollowUp.revision,
            cancellationEventId: scheduleCancellationEventIdRef.current,
            occurredAt
          })
          : await updatePerson(db, {
          personId: person.id,
          expectedRevision: person.revision,
          draft: validated,
          occurredAt
        });
      dirtyRef.current = false;
      attemptTimeRef.current = null;
      onDirtyChange(false);
      setPerson(saved);
      setSaving(false);
      onSavingChange(false);
      onBack();
    } catch (error) {
      setFormError(firstIssue(error));
      if (error instanceof StaleRevisionError) attemptTimeRef.current = null;
    } finally {
      mutationRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  async function archive() {
    if (!person || person.archivedAt || mutationRef.current) return;
    const confirmation = dirtyRef.current
      ? `Archive ${person.displayName} and discard your unsaved edits? They will leave active views. Their saved information will be kept.`
      : `Archive ${person.displayName}? They will leave active views. Their saved information will be kept.`;
    if (!window.confirm(confirmation)) return;
    mutationRef.current = true;
    setSaving(true);
    setFormError("");
    onSavingChange(true);
    const occurredAt = archiveAttemptTimeRef.current ?? new Date().toISOString();
    archiveAttemptTimeRef.current = occurredAt;
    try {
      await archivePerson(await getDatabase(), {
        personId: person.id,
        expectedRevision: person.revision,
        occurredAt
      });
      archiveAttemptTimeRef.current = null;
      dirtyRef.current = false;
      onDirtyChange(false);
      setSaving(false);
      onSavingChange(false);
      onBack();
    } catch (error) {
      setFormError(firstIssue(error));
    } finally {
      mutationRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  async function restore() {
    if (!person?.archivedAt || mutationRef.current) return;
    mutationRef.current = true;
    setSaving(true);
    setFormError("");
    onSavingChange(true);
    const occurredAt = restoreAttemptTimeRef.current ?? new Date().toISOString();
    restoreAttemptTimeRef.current = occurredAt;
    try {
      await restorePerson(await getDatabase(), {
        personId: person.id,
        expectedRevision: person.revision,
        occurredAt
      });
      restoreAttemptTimeRef.current = null;
      setSaving(false);
      onSavingChange(false);
      onBack();
    } catch (error) {
      setFormError(firstIssue(error));
    } finally {
      mutationRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <main className="screen edit-person-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={cancel} disabled={saving}>← Person</button>
      {person === undefined && !formError && <p role="status">Loading person…</p>}
      {person === undefined && formError && (
        <div className="form-alert" role="alert">
          <p>{formError}</p>
          <button type="button" onClick={() => setLoadVersion((current) => current + 1)}>Retry</button>
        </div>
      )}
      {person === null && (
        <EmptyState
          eyebrow="People"
          title="Person not found"
          description="This person may have been removed or the link may be out of date."
          action={<button className="primary-action" type="button" onClick={() => navigate("/people")}>Return to People</button>}
        />
      )}
      {person && (
        <>
          <header className="page-heading">
            <p className="eyebrow">Person</p>
            <h2 ref={headingRef} tabIndex={-1}>{person.archivedAt ? "Archived person" : "Edit person"}</h2>
            <p>{person.archivedAt ? "Restore this person before making changes." : "Keep their basic details and contact frequency up to date."}</p>
          </header>
          {formError && <p className="form-alert" role="alert">{formError}</p>}
          {person.archivedAt ? (
            <section className="profile-card archived-person-card" aria-labelledby={`${prefix}-archived`}>
              <h3 id={`${prefix}-archived`}>{person.displayName}</h3>
              <p>Archived people stay readable but do not appear in Today, Upcoming, active Reach Out or default People results.</p>
              <button className="primary-action" type="button" onClick={() => void restore()} disabled={saving}>
                {saving ? "Restoring…" : "Restore person"}
              </button>
            </section>
          ) : (
            <form className="person-edit-form" onSubmit={save} noValidate>
              <fieldset className="person-edit-controls" disabled={saving}>
              <fieldset className="choice-fieldset relationship-mode-fieldset">
                <legend>Relationship</legend>
                <div className="segmented-control three-way">
                  {RELATIONSHIP_MODE_OPTIONS.map((option) => (
                    <button key={option.value} type="button" aria-pressed={draft.relationshipMode === option.value} onClick={() => changed({ relationshipMode: option.value })}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="form-field">
                <label htmlFor={`${prefix}-name`}>{person.identityStatus === "provisional" ? "Name or description" : "Full or contact name"} <span>Required</span></label>
                <input
                  ref={nameRef}
                  id={`${prefix}-name`}
                  value={draft.displayName}
                  maxLength={121}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(errors.displayName) || undefined}
                  aria-describedby={errors.displayName ? `${prefix}-name-error` : undefined}
                  onChange={(event) => changed({ displayName: event.target.value })}
                />
                {errors.displayName && <p id={`${prefix}-name-error`} className="field-error" role="alert">{errors.displayName}</p>}
              </div>
              <div className="form-field">
                <label htmlFor={`${prefix}-conversational-name`}>What do you call them?</label>
                <input
                  ref={conversationalNameRef}
                  id={`${prefix}-conversational-name`}
                  value={draft.conversationalName ?? ""}
                  maxLength={121}
                  aria-invalid={Boolean(errors.conversationalName) || undefined}
                  aria-describedby={`${prefix}-conversational-name-hint${errors.conversationalName ? ` ${prefix}-conversational-name-error` : ""}`}
                  onChange={(event) => changed({ conversationalName: event.target.value })}
                />
                <p id={`${prefix}-conversational-name-hint`} className="field-hint">Used in conversation starters; their full name stays unchanged.</p>
                {errors.conversationalName && <p id={`${prefix}-conversational-name-error`} className="field-error" role="alert">{errors.conversationalName}</p>}
              </div>
              <div className="form-field">
                <label htmlFor={`${prefix}-frequency`}>How often do you want to contact them?</label>
                <select
                  id={`${prefix}-frequency`}
                  value={frequency}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFrequency(value);
                    if (value === "none") {
                      setCadenceText("");
                      changed({ contactCadence: undefined });
                    } else if (value !== "custom") {
                      const [amount, unit] = value.split("-") as [string, ContactCadenceUnit];
                      setCadenceText(amount);
                      setCadenceUnit(unit);
                      changed({ contactCadence: { value: Number(amount), unit } });
                    }
                  }}
                >
                  <option value="none">Not scheduled</option>
                  <option value="1-days">Every day</option>
                  <option value="3-days">Every 3 days</option>
                  <option value="1-weeks">Weekly</option>
                  <option value="2-weeks">Every 2 weeks</option>
                  <option value="1-months">Monthly</option>
                  <option value="custom">Custom</option>
                </select>
                {frequency === "custom" && <div className="cadence-input-row simple-frequency-custom">
                  <input
                    ref={cadenceRef}
                    id={`${prefix}-cadence`}
                    aria-label="Custom contact frequency"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={maxContactCadenceValue(cadenceUnit)}
                    step="1"
                    value={cadenceText}
                    aria-invalid={Boolean(errors.cadence) || undefined}
                    aria-describedby={errors.cadence ? `${prefix}-cadence-error` : `${prefix}-cadence-hint`}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCadenceText(value);
                      changed({ contactCadence: value ? { value: Number(value), unit: cadenceUnit } : undefined });
                    }}
                  />
                  <select
                    aria-label="Custom contact frequency unit"
                    value={cadenceUnit}
                    onChange={(event) => {
                      const unit = event.target.value as ContactCadenceUnit;
                      setCadenceUnit(unit);
                      changed({ contactCadence: cadenceText ? { value: Number(cadenceText), unit } : undefined });
                    }}
                  >
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                    <option value="months">months</option>
                  </select>
                </div>}
                {errors.cadence && <p id={`${prefix}-cadence-error`} className="field-error" role="alert">{errors.cadence}</p>}
              </div>
              {needsStartDate && cadenceText && (
                <fieldset
                  ref={startFieldsetRef}
                  className="choice-fieldset simple-start-fieldset"
                  tabIndex={errors.start ? -1 : undefined}
                  aria-invalid={Boolean(errors.start) || undefined}
                  aria-describedby={errors.start ? `${prefix}-start-error` : undefined}
                >
                  <legend>Start</legend>
                  <div className="segmented-control">
                    <button type="button" aria-pressed={startChoice === "today"} onClick={() => { setStartChoice("today"); dirtyRef.current = true; onDirtyChange(true); }}>Today</button>
                    <button type="button" aria-pressed={startChoice === "tomorrow"} onClick={() => { setStartChoice("tomorrow"); dirtyRef.current = true; onDirtyChange(true); }}>Tomorrow</button>
                  </div>
                  {errors.start && <p id={`${prefix}-start-error`} className="field-error" role="alert">{errors.start}</p>}
                </fieldset>
              )}
              <button className="secondary-action" type="button" onClick={() => navigate(contactMethodsPath(person.id))}>Edit mobile and email</button>
              <div className="button-row form-actions">
                <button className="primary-action" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                <button type="button" onClick={cancel} disabled={saving}>Cancel</button>
              </div>
              <section className="danger-zone" aria-labelledby={`${prefix}-archive`}>
                <h3 id={`${prefix}-archive`}>Archive person</h3>
                <p>Remove this person from active views while keeping their saved information.</p>
                <button className="danger-action" type="button" onClick={() => void archive()} disabled={saving}>Archive person</button>
              </section>
              </fieldset>
            </form>
          )}
        </>
      )}
    </main>
  );
}
