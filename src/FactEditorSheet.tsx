import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject
} from "react";
import {
  FACT_KIND_OPTIONS,
  DuplicateMemoryFactError,
  archiveMemoryFact,
  createMemoryFact,
  createMemoryFactDraft,
  defaultMemoryCueEligibility,
  updateMemoryFact,
  type MemoryFactDraft
} from "./application/memoryFacts";
import { listActivePersonOptions, type PersonPickerOption } from "./application/interactionQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { MemoryFact, MemoryFactKind } from "./domain/schema";
import { ValidationError } from "./domain/validation";
import { readActiveRelationshipMode } from "./relationshipModePreference";

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not save this fact.";
}

function draftFromFact(fact: MemoryFact): MemoryFactDraft {
  return {
    id: fact.id,
    personId: fact.personId,
    kind: fact.kind,
    value: fact.value,
    showAsMemoryCue: fact.showAsMemoryCue,
    ...(fact.relatedPersonId ? { relatedPersonId: fact.relatedPersonId } : {}),
    ...(fact.sourceInteractionId ? { sourceInteractionId: fact.sourceInteractionId } : {}),
    createdAt: fact.createdAt
  };
}

export default function FactEditorSheet({
  personId,
  personName,
  fact,
  initialKind,
  sourceInteractionId,
  onClose,
  onSaved,
  onArchived
}: {
  personId: string;
  personName: string;
  fact?: MemoryFact;
  initialKind?: MemoryFactKind;
  sourceInteractionId?: string;
  onClose: () => void;
  onSaved: (fact: MemoryFact) => void;
  onArchived?: (fact: MemoryFact) => void;
}) {
  const modalId = useId();
  const fieldId = useId();
  const initialDraft = useMemo(() => fact
    ? draftFromFact(fact)
    : createMemoryFactDraft(personId, {
      ...(initialKind ? { kind: initialKind } : {}),
      ...(sourceInteractionId ? { sourceInteractionId } : {})
    }), [fact, initialKind, personId, sourceInteractionId]);
  const [draft, setDraft] = useState(initialDraft);
  const [people, setPeople] = useState<PersonPickerOption[]>([]);
  const [peopleError, setPeopleError] = useState("");
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<DuplicateMemoryFactError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const duplicateRef = useRef<HTMLElement>(null);
  const duplicateCancelRef = useRef<HTMLButtonElement>(null);
  const kindRef = useRef<HTMLSelectElement>(null);
  const valueRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const mutationRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  dirtyRef.current = dirty;
  savingRef.current = saving;
  closeRef.current = onClose;

  useEffect(() => {
    let active = true;
    getDatabase()
      .then((db) => listActivePersonOptions(db, personId, readActiveRelationshipMode()))
      .then((options) => { if (active) setPeople(options); })
      .catch(() => { if (active) setPeopleError("PeopleOS could not load people to link."); });
    return () => { active = false; };
  }, [personId]);

  useEffect(() => {
    const id = `fact-editor-${modalId}`;
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
      if (!sheetRef.current?.contains(document.activeElement)) kindRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (duplicate) requestAnimationFrame(() => duplicateCancelRef.current?.focus());
  }, [duplicate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (duplicate) {
          setDuplicate(null);
          requestAnimationFrame(() => valueRef.current?.focus());
          return;
        }
        closeEditor();
        return;
      }
      const focusRoot = duplicate ? duplicateRef.current : sheetRef.current;
      if (event.key !== "Tab" || !focusRoot) return;
      const focusable = Array.from(focusRoot.querySelectorAll<HTMLElement>(
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

  function change(patch: Partial<MemoryFactDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setError("");
    setDuplicate(null);
  }

  function changeKind(kind: MemoryFactKind) {
    setDraft((current) => ({
      ...current,
      kind,
      value: kind === "communication_preference" || current.kind === "communication_preference" ? "" : current.value,
      showAsMemoryCue: defaultMemoryCueEligibility(kind),
      ...(kind === "introduced_by" ? {} : { relatedPersonId: undefined })
    }));
    setDirty(true);
    setError("");
    setDuplicate(null);
  }

  function changeRelatedPerson(relatedPersonId: string) {
    const previousPerson = people.find((option) => option.person.id === draft.relatedPersonId);
    const selectedPerson = people.find((option) => option.person.id === relatedPersonId);
    const shouldUseSelectedName = !draft.value.trim() || draft.value === previousPerson?.person.displayName;
    change({
      relatedPersonId: relatedPersonId || undefined,
      ...(selectedPerson && shouldUseSelectedName ? { value: selectedPerson.person.displayName } : {})
    });
  }

  async function persist(allowDuplicate: boolean) {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setSaving(true);
    setError("");
    setDuplicate(null);
    try {
      const db = await getDatabase();
      const saved = fact
        ? await updateMemoryFact(db, draft, fact.revision, { allowDuplicate })
        : await createMemoryFact(db, draft, { allowDuplicate });
      setDirty(false);
      onSaved(saved);
    } catch (caught) {
      if (caught instanceof DuplicateMemoryFactError) {
        setDuplicate(caught);
      } else {
        const message = firstIssue(caught);
        setError(message);
        requestAnimationFrame(() => {
          if (/kind/i.test(message)) kindRef.current?.focus();
          else valueRef.current?.focus();
        });
      }
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void persist(false);
  }

  async function archive() {
    if (!fact || !onArchived || mutationRef.current) return;
    mutationRef.current = true;
    setSaving(true);
    setError("");
    try {
      const archived = await archiveMemoryFact(await getDatabase(), fact.id, fact.revision);
      setDirty(false);
      onArchived(archived);
    } catch (caught) {
      setError(firstIssue(caught));
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  const valueHasError = Boolean(error) && !/kind/i.test(error);
  const kindHasError = /kind/i.test(error);
  const valueLabel = draft.kind === "communication_preference" ? "Preferred method" : "What to remember";

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
            <h3 id={`${fieldId}-title`}>{fact ? "Edit memory fact" : "Add memory fact"}</h3>
          </div>
          <button type="button" aria-label="Close memory fact editor" onClick={closeEditor} disabled={saving}>×</button>
        </div>

        <form className="contact-editor" onSubmit={save} noValidate>
          {sourceInteractionId && !fact && (
            <p className="interaction-kind-readout">
              Create a structured fact from this note. The note stays unchanged, and PeopleOS will not copy or interpret its text.
            </p>
          )}

          <div className="form-field">
            <label htmlFor={`${fieldId}-kind`}>Kind <span>Required</span></label>
            <select
              ref={kindRef}
              id={`${fieldId}-kind`}
              value={draft.kind}
              aria-invalid={kindHasError || undefined}
              aria-describedby={kindHasError ? `${fieldId}-error` : undefined}
              onChange={(event) => changeKind(event.target.value as MemoryFactKind)}
            >
              {FACT_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label htmlFor={`${fieldId}-value`}>{valueLabel} <span>Required</span></label>
            {draft.kind === "communication_preference" ? (
              <select
                ref={valueRef as RefObject<HTMLSelectElement>}
                id={`${fieldId}-value`}
                value={draft.value}
                required
                aria-invalid={valueHasError || undefined}
                aria-describedby={valueHasError ? `${fieldId}-error` : `${fieldId}-value-hint`}
                onChange={(event) => change({ value: event.target.value })}
              >
                <option value="">Choose a method</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </select>
            ) : (
              <input
                ref={valueRef as RefObject<HTMLInputElement>}
                id={`${fieldId}-value`}
                value={draft.value}
                required
                maxLength={240}
                aria-invalid={valueHasError || undefined}
                aria-describedby={valueHasError ? `${fieldId}-error` : `${fieldId}-value-hint`}
                onChange={(event) => change({ value: event.target.value })}
                placeholder={draft.kind === "introduced_by" ? "Introduced by James" : "Interested in simulation"}
              />
            )}
            <p className="field-hint" id={`${fieldId}-value-hint`}>
              {draft.kind === "communication_preference"
                ? "This is context for future actions; it does not choose a contact address automatically."
                : `${draft.value.length}/240 characters`}
            </p>
          </div>

          {draft.kind === "introduced_by" && (
            <div className="form-field">
              <label htmlFor={`${fieldId}-person`}>Related person <span>Optional</span></label>
              <select
                id={`${fieldId}-person`}
                value={draft.relatedPersonId ?? ""}
                onChange={(event) => changeRelatedPerson(event.target.value)}
              >
                <option value="">No linked person</option>
                {people.map((option) => (
                  <option key={option.person.id} value={option.person.id}>{option.person.displayName}</option>
                ))}
              </select>
              <p className="field-hint">Link the person when they are already in PeopleOS. Keep the readable wording above too.</p>
              {peopleError && <p className="field-error" role="status">{peopleError}</p>}
            </div>
          )}

          <fieldset className="choice-fieldset">
            <legend>Memory cue</legend>
            <label>
              <input
                type="checkbox"
                checked={draft.showAsMemoryCue}
                onChange={(event) => change({ showAsMemoryCue: event.target.checked })}
              />
              Show this as a short reminder on the person’s profile
            </label>
          </fieldset>

          {error && <p className="field-error" id={`${fieldId}-error`} role="alert">{error}</p>}

          {duplicate && (
            <section ref={duplicateRef} className="confirmation-panel" role="alertdialog" aria-labelledby={`${fieldId}-duplicate-title`}>
              <h4 id={`${fieldId}-duplicate-title`}>This fact is already saved</h4>
              <p>An active fact with the same kind and wording already exists. Save another only when it represents a distinct context you need to keep.</p>
              <div className="button-row">
                <button ref={duplicateCancelRef} type="button" onClick={() => { setDuplicate(null); requestAnimationFrame(() => valueRef.current?.focus()); }} disabled={saving}>
                  Cancel
                </button>
                <button className="primary-action" type="button" onClick={() => void persist(true)} disabled={saving}>
                  {saving ? "Saving…" : "Save anyway"}
                </button>
              </div>
            </section>
          )}

          <div className="button-row sheet-actions">
            {fact && onArchived && (
              <button className="danger-text" type="button" onClick={() => void archive()} disabled={saving}>Archive fact</button>
            )}
            <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
            <button className="primary-action" type="submit" disabled={saving || Boolean(duplicate)}>
              {saving ? "Saving…" : fact ? "Save changes" : "Save fact"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
