import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  archiveAffiliation,
  createAffiliation,
  createAffiliationDraft,
  listPersonAffiliations,
  restoreAffiliation,
  updateAffiliation,
  type AffiliationDraft
} from "./application/affiliations";
import { getPersonSummary, type PersonSummary } from "./application/peopleQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { OrganisationAffiliation } from "./domain/schema";
import { ValidationError } from "./domain/validation";
import { personProfilePath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not save this affiliation.";
}

function draftFromAffiliation(affiliation: OrganisationAffiliation): AffiliationDraft {
  return {
    id: affiliation.id,
    personId: affiliation.personId,
    organisationName: affiliation.organisationName,
    ...(affiliation.role ? { role: affiliation.role } : {}),
    ...(affiliation.startedOn ? { startedOn: affiliation.startedOn } : {}),
    ...(affiliation.endedOn ? { endedOn: affiliation.endedOn } : {}),
    isCurrent: affiliation.isCurrent,
    createdAt: affiliation.createdAt
  };
}

function todayLocalDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value: string | undefined): string {
  if (!value) return "Date not recorded";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

function dateRange(affiliation: OrganisationAffiliation): string {
  if (affiliation.isCurrent) return `${affiliation.startedOn ? displayDate(affiliation.startedOn) : "Start date not recorded"} – Present`;
  if (!affiliation.startedOn && !affiliation.endedOn) return "Dates not recorded";
  return `${affiliation.startedOn ? displayDate(affiliation.startedOn) : "Start date not recorded"} – ${affiliation.endedOn ? displayDate(affiliation.endedOn) : "End date not recorded"}`;
}

function AffiliationEditorSheet({
  personId,
  personName,
  affiliation,
  onClose,
  onSaved
}: {
  personId: string;
  personName: string;
  affiliation?: OrganisationAffiliation;
  onClose: () => void;
  onSaved: (affiliation: OrganisationAffiliation) => void;
}) {
  const modalId = useId();
  const fieldId = useId();
  const initialDraft = useMemo(() => affiliation
    ? draftFromAffiliation(affiliation)
    : createAffiliationDraft(personId), [affiliation, personId]);
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const organisationRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef<HTMLInputElement>(null);
  const endedRef = useRef<HTMLInputElement>(null);
  const mutationRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  dirtyRef.current = dirty;
  savingRef.current = saving;
  closeRef.current = onClose;

  useEffect(() => {
    const id = `affiliation-editor-${modalId}`;
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
      if (!sheetRef.current?.contains(document.activeElement)) organisationRef.current?.focus();
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

  function change(patch: Partial<AffiliationDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current) return;
    mutationRef.current = true;
    setSaving(true);
    setError("");
    try {
      const db = await getDatabase();
      const saved = affiliation
        ? await updateAffiliation(db, draft, affiliation.revision)
        : await createAffiliation(db, draft);
      setDirty(false);
      onSaved(saved);
    } catch (caught) {
      const message = firstIssue(caught);
      setError(message);
      requestAnimationFrame(() => {
        if (/start/i.test(message)) startedRef.current?.focus();
        else if (/end|current/i.test(message)) endedRef.current?.focus();
        else organisationRef.current?.focus();
      });
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  const organisationHasError = /organisation/i.test(error);
  const startedHasError = /start/i.test(error);
  const endedHasError = /end|current/i.test(error);

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <section ref={sheetRef} className="contact-sheet" role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`}>
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">{personName}</p>
            <h3 id={`${fieldId}-title`}>{affiliation ? "Edit affiliation" : "Add affiliation"}</h3>
          </div>
          <button type="button" aria-label="Close affiliation editor" onClick={closeEditor} disabled={saving}>×</button>
        </div>

        <form className="contact-editor" onSubmit={save} noValidate>
          <div className="form-field">
            <label htmlFor={`${fieldId}-organisation`}>Organisation <span>Required</span></label>
            <input
              ref={organisationRef}
              id={`${fieldId}-organisation`}
              required
              value={draft.organisationName}
              aria-invalid={organisationHasError || undefined}
              aria-describedby={organisationHasError ? `${fieldId}-error` : undefined}
              onChange={(event) => change({ organisationName: event.target.value })}
              placeholder="Watford General Hospital"
            />
          </div>

          <div className="form-field">
            <label htmlFor={`${fieldId}-role`}>Role <span>Optional</span></label>
            <input id={`${fieldId}-role`} value={draft.role ?? ""} onChange={(event) => change({ role: event.target.value || undefined })} placeholder="Chief Information Officer" />
          </div>

          <div className="form-field">
            <label htmlFor={`${fieldId}-started`}>Started <span>Optional</span></label>
            <input
              ref={startedRef}
              id={`${fieldId}-started`}
              type="date"
              value={draft.startedOn ?? ""}
              aria-invalid={startedHasError || undefined}
              aria-describedby={startedHasError ? `${fieldId}-error` : undefined}
              onChange={(event) => change({ startedOn: event.target.value || undefined })}
            />
          </div>

          <fieldset className="choice-fieldset">
            <legend>Status</legend>
            <label>
              <input
                type="checkbox"
                checked={draft.isCurrent}
                onChange={(event) => change({ isCurrent: event.target.checked, ...(event.target.checked ? { endedOn: undefined } : {}) })}
              />
              This is a current affiliation
            </label>
          </fieldset>

          <div className="form-field">
            <label htmlFor={`${fieldId}-ended`}>Ended <span>{draft.isCurrent ? "Not applicable while current" : "Optional"}</span></label>
            <input
              ref={endedRef}
              id={`${fieldId}-ended`}
              type="date"
              disabled={draft.isCurrent}
              value={draft.endedOn ?? ""}
              aria-invalid={endedHasError || undefined}
              aria-describedby={endedHasError ? `${fieldId}-error` : undefined}
              onChange={(event) => change({ endedOn: event.target.value || undefined, isCurrent: false })}
            />
          </div>

          {error && <p className="field-error" id={`${fieldId}-error`} role="alert">{error}</p>}

          <div className="button-row sheet-actions">
            <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
            <button className="primary-action" type="submit" disabled={saving}>{saving ? "Saving…" : affiliation ? "Save changes" : "Save affiliation"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function AffiliationsScreen({
  personId,
  navigate,
  onBack
}: {
  personId: string;
  navigate: Navigate;
  onBack?: () => void;
}) {
  const [person, setPerson] = useState<PersonSummary | null | undefined>(undefined);
  const [affiliations, setAffiliations] = useState<OrganisationAffiliation[]>([]);
  const [editor, setEditor] = useState<OrganisationAffiliation | "new" | null>(null);
  const [removedAffiliation, setRemovedAffiliation] = useState<OrganisationAffiliation | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const db = await getDatabase();
      const [summary, storedAffiliations] = await Promise.all([
        getPersonSummary(db, personId),
        listPersonAffiliations(db, personId)
      ]);
      setPerson(summary ?? null);
      setAffiliations([
        ...storedAffiliations.current,
        ...storedAffiliations.past,
        ...storedAffiliations.archived
      ]);
    } catch {
      setError("PeopleOS could not load affiliations.");
    }
  }, [personId]);

  useEffect(() => { void load(); }, [load]);

  const active = affiliations.filter((affiliation) => !affiliation.archivedAt);
  const current = active.filter((affiliation) => affiliation.isCurrent);
  const past = active.filter((affiliation) => !affiliation.isCurrent);
  const archived = affiliations.filter((affiliation) => affiliation.archivedAt);
  const editable = Boolean(person && !person.person.archivedAt && person.person.identityStatus !== "merged");

  function openEditor(value: OrganisationAffiliation | "new", opener: HTMLElement) {
    openerRef.current = opener;
    setEditor(value);
  }

  function closeEditor() {
    setEditor(null);
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      else headingRef.current?.focus();
    });
  }

  async function finishEditor() {
    setEditor(null);
    setRemovedAffiliation(null);
    await load();
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function archive(affiliation: OrganisationAffiliation) {
    if (busyId) return;
    setBusyId(affiliation.id);
    setError("");
    try {
      const archivedAffiliation = await archiveAffiliation(await getDatabase(), affiliation.id, affiliation.revision);
      setRemovedAffiliation(archivedAffiliation);
      await load();
    } catch {
      setError("PeopleOS could not archive this affiliation. Reload and try again.");
    } finally {
      setBusyId("");
    }
  }

  async function restore(affiliation: OrganisationAffiliation) {
    if (busyId) return;
    setBusyId(affiliation.id);
    setError("");
    try {
      await restoreAffiliation(await getDatabase(), affiliation.id, affiliation.revision);
      setRemovedAffiliation(null);
      await load();
    } catch {
      setError("PeopleOS could not restore this affiliation. Reload and try again.");
    } finally {
      setBusyId("");
    }
  }

  async function changeStatus(affiliation: OrganisationAffiliation, isCurrent: boolean) {
    if (busyId) return;
    setBusyId(affiliation.id);
    setError("");
    try {
      const draft = draftFromAffiliation(affiliation);
      await updateAffiliation(await getDatabase(), {
        ...draft,
        isCurrent,
        ...(isCurrent ? { endedOn: undefined } : { endedOn: todayLocalDate() })
      }, affiliation.revision);
      await load();
    } catch {
      setError(`PeopleOS could not ${isCurrent ? "mark this affiliation as current" : "end this affiliation"}. Edit its dates and try again.`);
    } finally {
      setBusyId("");
    }
  }

  function affiliationList(records: OrganisationAffiliation[]) {
    return (
      <ul className="timeline-list">
        {records.map((affiliation) => (
          <li className="timeline-item" key={affiliation.id}>
            <div className="timeline-item-heading">
              <div>
                <h4>{affiliation.organisationName}</h4>
                {affiliation.role && <p className="muted-copy">{affiliation.role}</p>}
                <span className="muted-copy">{dateRange(affiliation)}</span>
              </div>
              {affiliation.isCurrent && <span className="status-chip">Current</span>}
            </div>
            {editable && (
              <div className="button-row compact-buttons">
                <button type="button" aria-label={`Edit ${affiliation.organisationName}`} onClick={(event) => openEditor(affiliation, event.currentTarget)}>Edit</button>
                <button type="button" aria-label={`${affiliation.isCurrent ? "End" : "Mark current"} ${affiliation.organisationName}`} onClick={() => void changeStatus(affiliation, !affiliation.isCurrent)} disabled={busyId === affiliation.id}>
                  {affiliation.isCurrent ? "End today" : "Mark current"}
                </button>
                <button className="danger-text" type="button" aria-label={`Archive ${affiliation.organisationName}`} onClick={() => void archive(affiliation)} disabled={busyId === affiliation.id}>Archive</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main className="screen timeline-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => onBack ? onBack() : navigate(personProfilePath(personId))}>← Person</button>

      {person === undefined && !error && <p role="status">Loading affiliations…</p>}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {person === null && (
        <section className="profile-card">
          <h2>This person is no longer available.</h2>
          <button type="button" onClick={() => navigate("/people")}>Back to People</button>
        </section>
      )}

      {person && (
        <>
          <header className="page-heading page-heading-with-action compact-heading">
            <div>
              <p className="eyebrow">{person.person.displayName}</p>
              <h2 ref={headingRef} tabIndex={-1}>Affiliations</h2>
              <p>Organisation and role history, without creating a separate organisation record.</p>
            </div>
            {editable && <button className="primary-action" type="button" onClick={(event) => openEditor("new", event.currentTarget)}>Add affiliation</button>}
          </header>

          {removedAffiliation && (
            <div className="undo-message" role="status">
              <span>Affiliation archived.</span>
              <button type="button" onClick={() => void restore(removedAffiliation)} disabled={busyId === removedAffiliation.id}>Undo</button>
            </div>
          )}

          {active.length === 0 ? (
            <section className="profile-card timeline-empty">
              <h3>Add an organisation when it helps you remember their context.</h3>
              <p>Several current affiliations are allowed.</p>
              {editable && <button className="text-action" type="button" onClick={(event) => openEditor("new", event.currentTarget)}>Add affiliation</button>}
            </section>
          ) : (
            <div className="timeline-groups">
              {current.length > 0 && (
                <section className="timeline-group" aria-labelledby="current-affiliations-heading">
                  <h3 id="current-affiliations-heading">Current</h3>
                  {affiliationList(current)}
                </section>
              )}
              {past.length > 0 && (
                <section className="timeline-group" aria-labelledby="past-affiliations-heading">
                  <h3 id="past-affiliations-heading">Past</h3>
                  {affiliationList(past)}
                </section>
              )}
            </div>
          )}

          {archived.length > 0 && (
            <details className="archived-details">
              <summary>Archived affiliations ({archived.length})</summary>
              <ul>
                {archived.map((affiliation) => (
                  <li key={affiliation.id}>
                    <strong>{affiliation.organisationName}</strong>
                    <span>{affiliation.role || "Role not recorded"}</span>
                    {editable && <button type="button" aria-label={`Restore ${affiliation.organisationName}`} onClick={() => void restore(affiliation)} disabled={busyId === affiliation.id}>Restore</button>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {editor && (
            <AffiliationEditorSheet
              personId={person.person.id}
              personName={person.person.displayName}
              affiliation={editor === "new" ? undefined : editor}
              onClose={closeEditor}
              onSaved={() => void finishEditor()}
            />
          )}
        </>
      )}
    </main>
  );
}
