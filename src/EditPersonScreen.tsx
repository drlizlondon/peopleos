import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import EmptyState from "./EmptyState";
import {
  archivePerson,
  restorePerson,
  updatePerson,
  type PersonEditDraft
} from "./application/personLifecycle";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { RecordConflictError, StaleRevisionError } from "./data/repositories";
import type { Person } from "./domain/schema";
import { RELATIONSHIP_MODE_OPTIONS, relationshipModeOf } from "./domain/relationshipMode";
import { ValidationError } from "./domain/validation";
import { affiliationsPath, contactMethodsPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type FieldErrors = {
  displayName?: string;
  tags?: string;
  cadence?: string;
};

function parseTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? "Check the form and try again.";
  if (error instanceof StaleRevisionError || error instanceof RecordConflictError) return error.message;
  return "PeopleOS could not save these changes. Your draft is still here.";
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
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const mutationRef = useRef(false);
  const attemptTimeRef = useRef<string | null>(null);
  const archiveAttemptTimeRef = useRef<string | null>(null);
  const restoreAttemptTimeRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const tagsRef = useRef<HTMLInputElement>(null);
  const cadenceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setPerson(undefined);
    setFormError("");
    getDatabase().then((db) => db.get("people", personId)).then((record) => {
      if (!active) return;
      const loaded = record ?? null;
      setPerson(loaded);
      if (record) {
        setDraft({
          displayName: record.displayName,
          relationshipMode: relationshipModeOf(record),
          importance: record.importance,
          tags: record.tags,
          ...(record.contactCadenceDays ? { contactCadenceDays: record.contactCadenceDays } : {})
        });
        setTagsText(record.tags.join(", "));
        setCadenceText(record.contactCadenceDays ? String(record.contactCadenceDays) : "");
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
    setDraft((current) => ({ ...current, ...next }));
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
    const tags = parseTags(tagsText);
    const cadence = cadenceText.trim() ? Number(cadenceText) : undefined;
    if (!displayName) nextErrors.displayName = "Add a name or description so you can recognise this person.";
    else if (displayName.length > 120) nextErrors.displayName = "Use 120 characters or fewer.";
    if (tags.length > 10) nextErrors.tags = "Add no more than 10 tags.";
    else if (tags.some((tag) => tag.length > 40)) nextErrors.tags = "Each tag must be 40 characters or fewer.";
    if (cadence !== undefined && (!Number.isInteger(cadence) || cadence < 1 || cadence > 3_650)) {
      nextErrors.cadence = "Enter a whole number from 1 to 3650 days, or leave this blank.";
    }
    setErrors(nextErrors);
    const first = nextErrors.displayName
      ? nameRef.current
      : nextErrors.tags
        ? tagsRef.current
        : nextErrors.cadence
          ? cadenceRef.current
          : undefined;
    if (Object.keys(nextErrors).length > 0) {
      requestAnimationFrame(() => first?.focus());
      return undefined;
    }
    return {
      displayName,
      relationshipMode: draft.relationshipMode,
      importance: draft.importance,
      tags,
      ...(cadence === undefined ? {} : { contactCadenceDays: cadence })
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
      const saved = await updatePerson(await getDatabase(), {
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
      ? `Archive ${person.displayName} and discard your unsaved edits? They will leave Today, Upcoming, active Reach Out and default People results. Their history and plans will be kept.`
      : `Archive ${person.displayName}? They will leave Today, Upcoming, active Reach Out and default People results. Their history and plans will be kept.`;
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
            <p>{person.archivedAt
              ? "History and plans are preserved. Restore this person before making changes."
              : "Change identity and relationship preferences. Detailed history stays in its own sections."}</p>
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
              <fieldset className="choice-fieldset relationship-mode-fieldset">
                <legend>Relationship</legend>
                <div className="segmented-control three-way" role="group" aria-label="Relationship">
                  {RELATIONSHIP_MODE_OPTIONS.map((option) => (
                    <button key={option.value} type="button" aria-pressed={draft.relationshipMode === option.value} onClick={() => changed({ relationshipMode: option.value })}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="form-field">
                <label htmlFor={`${prefix}-name`}>{person.identityStatus === "provisional" ? "Temporary description" : "Display name"} <span>Required</span></label>
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
                <label htmlFor={`${prefix}-importance`}>Importance</label>
                <select
                  id={`${prefix}-importance`}
                  value={draft.importance}
                  onChange={(event) => changed({ importance: event.target.value as Person["importance"] })}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
                <p className="field-hint">Importance affects ordering only after someone is already due.</p>
              </div>
              <div className="form-field">
                <label htmlFor={`${prefix}-tags`}>Tags <span>Optional</span></label>
                <input
                  ref={tagsRef}
                  id={`${prefix}-tags`}
                  value={tagsText}
                  placeholder="mentor, fellowship"
                  aria-invalid={Boolean(errors.tags) || undefined}
                  aria-describedby={errors.tags ? `${prefix}-tags-error` : `${prefix}-tags-hint`}
                  onChange={(event) => { setTagsText(event.target.value); changed({ tags: parseTags(event.target.value) }); }}
                />
                <p id={`${prefix}-tags-hint`} className="field-hint">Separate up to ten tags with commas.</p>
                {errors.tags && <p id={`${prefix}-tags-error`} className="field-error" role="alert">{errors.tags}</p>}
              </div>
              <div className="form-field">
                <label htmlFor={`${prefix}-cadence`}>Contact cadence in days <span>Optional</span></label>
                <input
                  ref={cadenceRef}
                  id={`${prefix}-cadence`}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="3650"
                  value={cadenceText}
                  aria-invalid={Boolean(errors.cadence) || undefined}
                  aria-describedby={errors.cadence ? `${prefix}-cadence-error` : `${prefix}-cadence-hint`}
                  onChange={(event) => {
                    setCadenceText(event.target.value);
                    changed({ contactCadenceDays: event.target.value ? Number(event.target.value) : undefined });
                  }}
                />
                <p id={`${prefix}-cadence-hint`} className="field-hint">Leave blank for no recurring cadence.</p>
                {errors.cadence && <p id={`${prefix}-cadence-error`} className="field-error" role="alert">{errors.cadence}</p>}
              </div>
              <section className="profile-card edit-person-related" aria-labelledby={`${prefix}-details`}>
                <h3 id={`${prefix}-details`}>Detailed information</h3>
                <p>Contact details and organisation history have their own records.</p>
                <div className="button-row">
                  <button type="button" onClick={() => navigate(contactMethodsPath(person.id))}>Manage contact methods</button>
                  <button type="button" onClick={() => navigate(affiliationsPath(person.id))}>Manage affiliations</button>
                </div>
              </section>
              <div className="button-row form-actions">
                <button className="primary-action" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                <button type="button" onClick={cancel} disabled={saving}>Cancel</button>
              </div>
              <section className="danger-zone" aria-labelledby={`${prefix}-archive`}>
                <h3 id={`${prefix}-archive`}>Archive person</h3>
                <p>Remove this person from active views while preserving their history and plans.</p>
                <button className="danger-action" type="button" onClick={() => void archive()} disabled={saving}>Archive person</button>
              </section>
            </form>
          )}
        </>
      )}
    </main>
  );
}
