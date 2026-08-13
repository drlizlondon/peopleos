import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent
} from "react";
import { listActivePersonOptions, type PersonPickerOption } from "./application/interactionQueries";
import {
  captureManualPerson,
  createManualPersonCaptureDraft
} from "./application/manualPersonCapture";
import {
  createReachOut,
  prepareCreateReachOutCommand,
  prepareReachOutStatusCommand,
  prepareUpdateReachOutPlanCommand,
  reactivateReachOut,
  updateReachOutPlan,
  type CreateReachOutCommand,
  type ReachOutStatusCommand,
  type UpdateReachOutPlanCommand
} from "./application/reachOut";
import { getCurrentReachOutForPerson } from "./application/reachOutQueries";
import { DuplicateReviewRequiredError } from "./application/duplicateReview";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { effectiveFollowUpDate } from "./domain/followUpPolicy";
import type {
  FollowUp,
  Person,
  ReachOutContext,
  ReachOutEntry
} from "./domain/schema";
import { ValidationError } from "./domain/validation";
import type { ActiveRelationshipMode, RelationshipMode } from "./domain/relationshipMode";
import { readActiveRelationshipMode } from "./relationshipModePreference";

type ReachOutEditorProps = {
  mode: "create" | "edit";
  person?: Person;
  entry?: ReachOutEntry;
  currentFollowUp?: FollowUp;
  /** Retained for callers that still hold legacy Reach Out context data. */
  selectedContexts?: ReachOutContext[];
  onClose: () => void;
  onSaved: (entry: ReachOutEntry) => void;
  onOpenExisting: (entryId: string) => void;
  activeMode?: ActiveRelationshipMode;
};

type FieldErrors = {
  person?: string;
  reason?: string;
  form?: string;
};

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not save this Reach Out.";
}

function blurActiveField() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export default function ReachOutEditorSheet({
  mode,
  person,
  entry,
  currentFollowUp,
  onClose,
  onSaved,
  onOpenExisting,
  activeMode = readActiveRelationshipMode()
}: ReachOutEditorProps) {
  const modalId = useId();
  const fieldId = useId();
  const [people, setPeople] = useState<PersonPickerOption[]>([]);
  const [loading, setLoading] = useState(mode === "create");
  const [identityQuery, setIdentityQuery] = useState(person?.displayName ?? "");
  const [selectedPerson, setSelectedPerson] = useState<Person | undefined>(person);
  const [existingEntry, setExistingEntry] = useState<ReachOutEntry>();
  const [checkingPerson, setCheckingPerson] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonPersonal, setNewPersonPersonal] = useState(activeMode !== "professional");
  const [newPersonProfessional, setNewPersonProfessional] = useState(activeMode === "professional");
  const [personSaving, setPersonSaving] = useState(false);
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const identityRef = useRef<HTMLInputElement>(null);
  const newPersonNameRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const personCheckVersionRef = useRef(0);
  const createCommandRef = useRef<{ signature: string; command: CreateReachOutCommand }>();
  const updateCommandRef = useRef<{ signature: string; command: UpdateReachOutPlanCommand }>();
  const reactivateCommandRef = useRef<{ signature: string; command: ReachOutStatusCommand }>();
  const savingRef = useRef(false);
  const personSavingRef = useRef(false);
  const dirtyRef = useRef(false);
  const closeRef = useRef(onClose);
  savingRef.current = saving;
  personSavingRef.current = personSaving;
  dirtyRef.current = dirty;
  closeRef.current = onClose;

  useEffect(() => {
    let active = true;
    if (mode === "edit") {
      setLoading(false);
      return () => { active = false; };
    }
    getDatabase().then(async (db) => Promise.all([
      // Search all People so a mode filter cannot invite an accidental duplicate.
      listActivePersonOptions(db, undefined, "all"),
      person ? getCurrentReachOutForPerson(db, person.id) : Promise.resolve(undefined)
    ])).then(([personOptions, current]) => {
      if (!active) return;
      setPeople(personOptions);
      setExistingEntry(current);
      if (current?.reason) setReason(current.reason);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setErrors({ form: "PeopleOS could not load your people." });
      setLoading(false);
    });
    return () => { active = false; };
  }, [mode, person]);

  useEffect(() => {
    const id = `reach-out-editor-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: {
        id,
        dismiss: () => {
          if (savingRef.current || personSavingRef.current) return false;
          if (dirtyRef.current && !window.confirm("Discard changes?")) return false;
          closeRef.current();
          return true;
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
      if (!sheetRef.current?.contains(document.activeElement)) closeButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled])"
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

  function closeEditor(): boolean {
    if (savingRef.current || personSavingRef.current) return false;
    if (dirtyRef.current && !window.confirm("Discard changes?")) return false;
    onClose();
    return true;
  }

  function changed() {
    setDirty(true);
    setErrors({});
    createCommandRef.current = undefined;
    updateCommandRef.current = undefined;
    reactivateCommandRef.current = undefined;
  }

  async function choosePerson(option: PersonPickerOption) {
    const checkVersion = ++personCheckVersionRef.current;
    setSelectedPerson(option.person);
    setIdentityQuery(option.person.displayName);
    setCreatingPerson(false);
    setExistingEntry(undefined);
    setCheckingPerson(true);
    setReason("");
    changed();
    blurActiveField();
    try {
      const current = await getCurrentReachOutForPerson(await getDatabase(), option.person.id);
      if (personCheckVersionRef.current !== checkVersion) return;
      setExistingEntry(current);
      setReason(current?.reason ?? "");
    } catch {
      if (personCheckVersionRef.current !== checkVersion) return;
      setErrors({ form: "PeopleOS could not check whether this person is already in Reach Out." });
    } finally {
      if (personCheckVersionRef.current === checkVersion) setCheckingPerson(false);
    }
  }

  function changeIdentity(value: string) {
    personCheckVersionRef.current += 1;
    setCheckingPerson(false);
    setIdentityQuery(value);
    setSelectedPerson(undefined);
    setExistingEntry(undefined);
    setCreatingPerson(false);
    setReason("");
    changed();
  }

  function startAddingPerson() {
    const name = identityQuery.trim();
    if (!name) return;
    setNewPersonName(name);
    setNewPersonPersonal(activeMode !== "professional");
    setNewPersonProfessional(activeMode === "professional");
    setCreatingPerson(true);
    setErrors({});
    requestAnimationFrame(() => newPersonNameRef.current?.focus());
  }

  function cancelAddingPerson() {
    if (personSavingRef.current) return;
    setCreatingPerson(false);
    setErrors({});
    blurActiveField();
  }

  function selectedRelationshipMode(): RelationshipMode | undefined {
    if (newPersonPersonal && newPersonProfessional) return "both";
    if (newPersonProfessional) return "professional";
    if (newPersonPersonal) return "personal";
    return undefined;
  }

  async function addNewPerson() {
    if (personSavingRef.current) return;
    const displayName = newPersonName.trim();
    const relationshipMode = selectedRelationshipMode();
    if (!displayName) {
      setErrors({ person: "Add a name." });
      requestAnimationFrame(() => newPersonNameRef.current?.focus());
      return;
    }
    if (displayName.length > 120) {
      setErrors({ person: "Use 120 characters or fewer." });
      requestAnimationFrame(() => newPersonNameRef.current?.focus());
      return;
    }
    if (!relationshipMode) {
      setErrors({ person: "Choose Personal, Professional, or both." });
      return;
    }

    personSavingRef.current = true;
    setPersonSaving(true);
    setErrors({});
    try {
      const capture = await captureManualPerson(await getDatabase(), {
        ...createManualPersonCaptureDraft(),
        displayName,
        relationshipMode
      }, "GB", { enforceDuplicateReview: true });
      const option: PersonPickerOption = { person: capture.person };
      setPeople((current) => [
        option,
        ...current.filter((candidate) => candidate.person.id !== capture.person.id)
      ]);
      await choosePerson(option);
      blurActiveField();
    } catch (caught) {
      if (caught instanceof DuplicateReviewRequiredError) {
        const duplicateOptions = caught.matches.map((match): PersonPickerOption => ({ person: match.person }));
        setPeople((current) => {
          const duplicateIds = new Set(duplicateOptions.map((option) => option.person.id));
          return [...duplicateOptions, ...current.filter((option) => !duplicateIds.has(option.person.id))];
        });
        setIdentityQuery(displayName);
        setCreatingPerson(false);
        setErrors({ person: "This person may already be in PeopleOS. Choose them below." });
        blurActiveField();
      } else {
        setErrors({ person: firstIssue(caught) });
        requestAnimationFrame(() => newPersonNameRef.current?.focus());
      }
    } finally {
      personSavingRef.current = false;
      setPersonSaving(false);
    }
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (mode === "create" && !selectedPerson) {
      next.person = identityQuery.trim()
        ? `Choose a person or add ${identityQuery.trim()}.`
        : "Choose a person.";
    }
    if (!selectedPerson && identityQuery.trim().length > 120) next.person = "Use 120 characters or fewer.";
    if (reason.trim().length > 240) next.reason = "Keep the note to 240 characters or fewer.";
    return next;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || checkingPerson) return;
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        if (nextErrors.person) identityRef.current?.focus();
        else reasonRef.current?.focus();
      });
      return;
    }
    if (!selectedPerson || (mode === "edit" && !entry)) return;

    setSaving(true);
    setErrors({});
    savingRef.current = true;
    try {
      const db = await getDatabase();
      let saved: ReachOutEntry;

      if (mode === "create" && existingEntry?.intentStatus === "active") {
        setDirty(false);
        onOpenExisting(existingEntry.id);
        return;
      }

      if (mode === "create" && existingEntry?.intentStatus === "dormant") {
        const signature = `${existingEntry.id}:${existingEntry.revision}:reactivate`;
        if (reactivateCommandRef.current?.signature !== signature) {
          reactivateCommandRef.current = {
            signature,
            command: prepareReachOutStatusCommand(existingEntry, selectedPerson, undefined, "activated")
          };
        }
        saved = (await reactivateReachOut(db, reactivateCommandRef.current.command)).entry;
      } else if (mode === "create") {
        const signature = JSON.stringify([selectedPerson.id, reason.trim()]);
        if (createCommandRef.current?.signature !== signature) {
          createCommandRef.current = {
            signature,
            command: prepareCreateReachOutCommand({
              person: selectedPerson,
              ...(reason.trim() ? { reason: reason.trim() } : {})
            })
          };
        }
        saved = (await createReachOut(db, createCommandRef.current.command)).entry;
      } else {
        const signature = JSON.stringify([entry!.id, entry!.revision, reason.trim()]);
        if (updateCommandRef.current?.signature !== signature) {
          updateCommandRef.current = {
            signature,
            command: prepareUpdateReachOutPlanCommand(entry!, selectedPerson, currentFollowUp, {
              ...(reason.trim() ? { reason: reason.trim() } : {}),
              ...(entry!.intendedActionType ? { intendedActionType: entry!.intendedActionType } : {}),
              ...(entry!.actionDetail ? { actionDetail: entry!.actionDetail } : {}),
              ...(entry!.notes ? { notes: entry!.notes } : {}),
              contextIds: entry!.contextIds,
              ...(currentFollowUp ? { reminderDate: effectiveFollowUpDate(currentFollowUp) } : {})
            })
          };
        }
        saved = (await updateReachOutPlan(db, updateCommandRef.current.command)).entry;
      }

      setDirty(false);
      onSaved(saved);
    } catch (caught) {
      const message = firstIssue(caught);
      const existingMatch = message.match(/already in Reach Out:([^\s]+)/);
      if (existingMatch) {
        setDirty(false);
        onOpenExisting(existingMatch[1]);
        return;
      }
      setErrors({ form: message });
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  const normalized = identityQuery.trim().toLocaleLowerCase("en-US");
  const matches = people.filter((option) => !normalized
    || option.person.displayName.toLocaleLowerCase("en-US").includes(normalized)
    || option.affiliation?.toLocaleLowerCase("en-US").includes(normalized));
  const showAddPerson = mode === "create" && !person && normalized.length > 0 && !selectedPerson && matches.length === 0;
  const noteVisible = mode === "edit" || Boolean(selectedPerson && !existingEntry);
  const existingIsActive = existingEntry?.intentStatus === "active";
  const existingIsDormant = existingEntry?.intentStatus === "dormant";

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <section ref={sheetRef} className="contact-sheet interaction-sheet reach-out-editor-sheet" role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`}>
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">Reach Out</p>
            <h3 id={`${fieldId}-title`}>{mode === "edit" ? "Edit note" : "Add someone"}</h3>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close Reach Out" onClick={closeEditor} disabled={saving || personSaving}>×</button>
        </div>

        {loading ? <p role="status">Loading people…</p> : (
          <form className="contact-editor" onSubmit={save} noValidate>
            {mode === "create" && (
              <div className="form-field">
                {creatingPerson ? (
                  <div className="reach-out-add-person" role="group" aria-labelledby={`${fieldId}-add-person-title`}>
                    <h4 id={`${fieldId}-add-person-title`}>Add someone</h4>
                    <label htmlFor={`${fieldId}-new-person-name`}>Name <span>Required</span></label>
                    <input
                      ref={newPersonNameRef}
                      id={`${fieldId}-new-person-name`}
                      value={newPersonName}
                      maxLength={120}
                      aria-invalid={Boolean(errors.person) || undefined}
                      aria-describedby={errors.person ? `${fieldId}-person-error` : `${fieldId}-new-person-hint`}
                      onChange={(event) => { setNewPersonName(event.target.value); setErrors({}); changed(); }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void addNewPerson();
                      }}
                      autoComplete="name"
                      enterKeyHint="done"
                    />
                    <fieldset className="choice-fieldset reach-out-add-person-lists">
                      <legend>Lists</legend>
                      <label><input type="checkbox" checked={newPersonPersonal} onChange={(event) => { setNewPersonPersonal(event.target.checked); setErrors({}); changed(); }} /> Personal</label>
                      <label><input type="checkbox" checked={newPersonProfessional} onChange={(event) => { setNewPersonProfessional(event.target.checked); setErrors({}); changed(); }} /> Professional</label>
                    </fieldset>
                    <p className="field-hint" id={`${fieldId}-new-person-hint`}>You can add more details later.</p>
                    {errors.person && <p className="field-error" id={`${fieldId}-person-error`} role="alert">{errors.person}</p>}
                    <div className="button-row reach-out-add-person-actions">
                      <button type="button" onClick={cancelAddingPerson} disabled={personSaving}>Back</button>
                      <button className="primary-action" type="button" onClick={() => void addNewPerson()} disabled={personSaving}>
                        {personSaving ? "Adding…" : "Add person"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <label htmlFor={`${fieldId}-person`}>Person <span>Required</span></label>
                    <input
                      ref={identityRef}
                      id={`${fieldId}-person`}
                      value={identityQuery}
                      readOnly={Boolean(person)}
                      maxLength={120}
                      aria-invalid={Boolean(errors.person) || undefined}
                      aria-describedby={errors.person ? `${fieldId}-person-error` : `${fieldId}-person-hint`}
                      onChange={(event) => changeIdentity(event.target.value)}
                      placeholder="Search by name"
                      autoComplete="off"
                      enterKeyHint="search"
                    />
                    <p className="field-hint" id={`${fieldId}-person-hint`}>Choose someone already in PeopleOS or add their name.</p>
                    {errors.person && <p className="field-error" id={`${fieldId}-person-error`} role="alert">{errors.person}</p>}
                    {!person && !selectedPerson && matches.length > 0 && normalized && (
                      <ul className="selector-list compact-selector" aria-label="Matching people">
                        {matches.slice(0, 5).map((option) => (
                          <li key={option.person.id}>
                            <button className="reach-out-person-option" type="button" onClick={() => void choosePerson(option)}>
                              <strong>{option.person.displayName}</strong>
                              {option.affiliation && <span>{option.affiliation}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {showAddPerson && (
                      <button className="text-action reach-out-add-person-option" type="button" onClick={startAddingPerson}>
                        + Add {identityQuery.trim()}
                      </button>
                    )}
                    {selectedPerson && <p className="identity-note"><span className="status-chip">Selected</span> {selectedPerson.displayName}</p>}
                  </>
                )}
              </div>
            )}

            {noteVisible && (
              <div className="form-field">
                <label htmlFor={`${fieldId}-reason`}>Note <span>Optional</span></label>
                <textarea
                  ref={reasonRef}
                  id={`${fieldId}-reason`}
                  rows={3}
                  maxLength={240}
                  value={reason}
                  aria-invalid={Boolean(errors.reason) || undefined}
                  aria-describedby={errors.reason ? `${fieldId}-reason-error` : undefined}
                  onChange={(event) => { setReason(event.target.value); changed(); }}
                  placeholder="Catch up about fellowship"
                  enterKeyHint="done"
                />
                {errors.reason && <p className="field-error" id={`${fieldId}-reason-error`} role="alert">{errors.reason}</p>}
              </div>
            )}

            {existingIsActive && (
              <p className="interaction-kind-readout" role="status">
                {existingEntry.reason ? `${existingEntry.reason} · ` : ""}This person is already in Reach Out.
              </p>
            )}
            {existingIsDormant && (
              <p className="interaction-kind-readout" role="status">
                {existingEntry.reason ? `${existingEntry.reason} · ` : ""}Add them back to your Reach Out list.
              </p>
            )}

            {errors.form && <p className="form-alert" role="alert">{errors.form}</p>}
            {!creatingPerson && (
              <div className="button-row sheet-actions">
                <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving || loading || checkingPerson}>
                  {existingIsActive
                    ? "View in Reach Out"
                    : saving
                      ? "Saving…"
                      : existingIsDormant
                        ? "Add back"
                        : mode === "edit"
                          ? "Save note"
                          : "Save"}
                </button>
              </div>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
