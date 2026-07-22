import {
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import InteractionEditorSheet from "./InteractionEditorSheet";
import TimelineList from "./TimelineList";
import {
  createManualContactMethodDraft,
  createManualPersonCaptureDraft,
  prepareManualPersonCapture,
  savePreparedManualPersonCapture,
  type ManualContactMethodDraft,
  type ManualPersonCaptureDraft,
  type PreparedManualPersonCapture
} from "./application/manualPersonCapture";
import { findDuplicateMatches } from "./application/duplicateDetection";
import { addReviewedDetailsToExistingPerson } from "./application/duplicateResolution";
import {
  addContactMethod,
  archiveContactMethod,
  createContactMethodDraft,
  editContactMethod,
  listContactMethodsForPerson,
  restoreContactMethod,
  setPreferredContactMethod,
  type ContactMethodDraft
} from "./application/contactMethods";
import {
  getAppSettings,
  getPersonSummary,
  listPeopleSummaries,
  type PersonSummary
} from "./application/peopleQueries";
import {
  getPersonHistory,
  type PersonHistory,
  type TimelineDisplayItem
} from "./application/interactionQueries";
import { getDatabase } from "./data/client";
import { StaleRevisionError } from "./data/repositories";
import type { ContactMethod, InteractionKind } from "./domain/schema";
import type { DuplicateMatch } from "./domain/duplicates";
import { ValidationError } from "./domain/validation";
import {
  ContactValueValidationError,
  formatPhoneNumberForDisplay,
  getPhoneRegionOptions,
  normalizeContactValue
} from "./integrations/contactValues";
import { contactMethodsPath, personProfilePath, routeFromPath, timelinePath } from "./navigation";
import DuplicateWarningSheet, { type DuplicateLinkSelection } from "./DuplicateWarningSheet";
import { DuplicateReviewRequiredError } from "./application/duplicateReview";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

const phoneRegionOptions = getPhoneRegionOptions(globalThis.navigator?.language ?? "en-GB");

function actionButton(label: string, onClick: () => void) {
  return (
    <button className="primary-action" type="button" onClick={onClick}>
      <Icon name="plus" />
      {label}
    </button>
  );
}

function importAction(navigate: Navigate, label = "Import a vCard file") {
  return (
    <button className="secondary-action" type="button" onClick={() => navigate("/people/import")}>{label}</button>
  );
}

function usePeople(): { people: PersonSummary[]; loading: boolean; error: string } {
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getDatabase()
      .then(listPeopleSummaries)
      .then((records) => { if (active) setPeople(records); })
      .catch(() => { if (active) setError("PeopleOS could not load people from this device."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { people, loading, error };
}

export function TodayScreen({ navigate }: { navigate: Navigate }) {
  const { people, loading } = usePeople();
  return (
    <main className="screen" id="main-content" tabIndex={-1}>
      <EmptyState
        eyebrow="Today"
        title="No one needs your attention yet"
        description="PeopleOS helps you remember who to contact and why. Add your first person to begin."
        note="Your data stays on this device unless you export it."
        action={!loading && people.length === 0 ? (
          <div className="empty-action-stack">
            {actionButton("Add your first person", () => navigate("/people/new"))}
            {importAction(navigate)}
          </div>
        ) : undefined}
      />
    </main>
  );
}

function affiliationLine(summary: PersonSummary): string | undefined {
  const affiliation = summary.currentAffiliation;
  if (!affiliation) return undefined;
  return [affiliation.role, affiliation.organisationName].filter(Boolean).join(" · ");
}

export function PeopleScreen({
  navigate,
  importedPersonIds = null,
  onClearImportedFilter
}: {
  navigate: Navigate;
  importedPersonIds?: string[] | null;
  onClearImportedFilter?: () => void;
}) {
  const { people, loading, error } = usePeople();
  const visiblePeople = importedPersonIds
    ? people.filter((summary) => importedPersonIds.includes(summary.person.id))
    : people;

  if (!loading && people.length === 0 && !error) {
    return (
      <main className="screen" id="main-content" tabIndex={-1}>
        <EmptyState
          eyebrow="People"
          title="Your people will live here"
          description="Add someone manually, even if all you know is enough to recognise them later."
          action={(
            <div className="empty-action-stack">
              {actionButton("Add person", () => navigate("/people/new"))}
              {importAction(navigate, "Import contacts")}
            </div>
          )}
        />
      </main>
    );
  }

  return (
    <main className="screen people-screen" id="main-content" tabIndex={-1}>
      <header className="page-heading page-heading-with-action">
        <div>
          <p className="eyebrow">People</p>
          <h2>{importedPersonIds ? "Imported people" : "People you remember"}</h2>
          <p>{importedPersonIds
            ? "People created or updated in the most recent import."
            : "A simple list for now. Search and relationship summaries arrive in later packages."}</p>
        </div>
        <div className="page-actions">
          <button className="secondary-action" type="button" onClick={() => navigate("/people/import")}>Import contacts</button>
          {importedPersonIds && onClearImportedFilter && (
            <button type="button" onClick={onClearImportedFilter}>Show all people</button>
          )}
          <button className="primary-action" type="button" onClick={() => navigate("/people/new")}>
            <Icon name="plus" /> Add person
          </button>
        </div>
      </header>
      {loading && <p className="screen-status" role="status">Loading people…</p>}
      {error && <p className="error-message screen-status" role="alert">{error}</p>}
      {!loading && !error && (
        <ul className="people-list" aria-label="People">
          {visiblePeople.map((summary) => (
            <li key={summary.person.id}>
              <a
                href={personProfilePath(summary.person.id)}
                onClick={(event) => { event.preventDefault(); navigate(personProfilePath(summary.person.id)); }}
              >
                <span className="person-list-name">{summary.person.displayName}</span>
                {summary.person.identityStatus === "provisional" && <span className="status-chip">Identity incomplete</span>}
                {affiliationLine(summary) && <span className="person-list-detail">{affiliationLine(summary)}</span>}
                {!affiliationLine(summary) && summary.latestMetInteraction?.summary && (
                  <span className="person-list-detail">Met: {summary.latestMetInteraction.summary}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && importedPersonIds && visiblePeople.length === 0 && (
        <p className="screen-status">No imported people are available in this session.</p>
      )}
    </main>
  );
}

type FieldErrors = Record<string, string>;

export type ManualCaptureResumeState = {
  draft: ManualPersonCaptureDraft;
  tagsText: string;
  cadenceText: string;
};

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? "Check the form and try again.";
  if (error instanceof ContactValueValidationError || error instanceof StaleRevisionError) return error.message;
  return "PeopleOS could not save this yet.";
}

function contactInputLabel(contact: ManualContactMethodDraft): string {
  return contact.kind === "phone" ? "Phone number" : "Email address";
}

function parseTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function mergePersonIds(
  existing: readonly string[],
  additional: readonly string[]
): string[] {
  return [...new Set([...existing, ...additional])].sort();
}

export function AddPersonScreen({
  navigate,
  dismiss,
  onDirtyChange,
  onSavingChange,
  initialCapture,
  onOpenDuplicatePerson,
  onCaptureFinished
}: {
  navigate: Navigate;
  dismiss: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  initialCapture?: ManualCaptureResumeState | null;
  onOpenDuplicatePerson: (personId: string, capture: ManualCaptureResumeState) => void;
  onCaptureFinished: () => void;
}) {
  const [draft, setDraft] = useState<ManualPersonCaptureDraft>(() => initialCapture?.draft ?? ({
    ...createManualPersonCaptureDraft(),
    contactMethods: [createManualContactMethodDraft("phone")]
  }));
  const [tagsText, setTagsText] = useState(initialCapture?.tagsText ?? "");
  const [cadenceText, setCadenceText] = useState(initialCapture?.cadenceText ?? "");
  const [defaultPhoneRegion, setDefaultPhoneRegion] = useState("GB");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const preparedRef = useRef<PreparedManualPersonCapture | null>(null);
  const validatedDraftRef = useRef<ManualPersonCaptureDraft | null>(null);
  const submittingRef = useRef(false);
  const dirtyRef = useRef(false);
  const identityRef = useRef<HTMLInputElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const acknowledgedDuplicatePersonIdsRef = useRef<string[]>([]);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([]);

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => identityRef.current?.focus());
    if (initialCapture) {
      dirtyRef.current = true;
      onDirtyChange(true);
    }
    getDatabase().then(getAppSettings).then((settings) => setDefaultPhoneRegion(settings.defaultPhoneRegion)).catch(() => undefined);
    return () => cancelAnimationFrame(focusFrame);
  }, [initialCapture, onDirtyChange]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      onDirtyChange(false);
      onSavingChange(false);
    };
  }, [onDirtyChange, onSavingChange]);

  function changed(update: (current: ManualPersonCaptureDraft) => ManualPersonCaptureDraft) {
    preparedRef.current = null;
    validatedDraftRef.current = null;
    acknowledgedDuplicatePersonIdsRef.current = [];
    setDuplicateMatches([]);
    dirtyRef.current = true;
    setDraft(update);
    onDirtyChange(true);
  }

  function updateContact(id: string, patch: Partial<ManualContactMethodDraft>) {
    changed((current) => ({
      ...current,
      contactMethods: current.contactMethods.map((contact) => contact.id === id ? { ...contact, ...patch } : contact)
    }));
  }

  function addContact(kind: "phone" | "email") {
    changed((current) => ({ ...current, contactMethods: [...current.contactMethods, createManualContactMethodDraft(kind)] }));
  }

  function removeContact(id: string) {
    changed((current) => ({ ...current, contactMethods: current.contactMethods.filter((contact) => contact.id !== id) }));
    setErrors((current) => {
      const next = { ...current };
      delete next[`contact-${id}`];
      return next;
    });
  }

  function validate(): ManualPersonCaptureDraft | undefined {
    const nextErrors: FieldErrors = {};
    const displayName = draft.displayName.trim();
    if (!displayName) {
      nextErrors.displayName = draft.identityStatus === "provisional"
        ? "Add a temporary description so you can recognise this person later."
        : "Add a name so you can recognise this person later.";
    } else if (displayName.length > 120) {
      nextErrors.displayName = "Use 120 characters or fewer.";
    }

    for (const contact of draft.contactMethods) {
      const value = contact.value.trim();
      if (!value && contact.label?.trim()) {
        nextErrors[`contact-${contact.id}`] = `Enter a ${contact.kind === "phone" ? "phone number" : "email address"} or remove this row.`;
        continue;
      }
      if (!value) continue;
      try {
        normalizeContactValue(contact.kind, value, contact.region ?? defaultPhoneRegion);
      } catch (error) {
        nextErrors[`contact-${contact.id}`] = error instanceof ContactValueValidationError
          ? error.message
          : "Check this contact detail.";
      }
    }

    const tags = parseTags(tagsText);
    if (tags.length > 10) nextErrors.tags = "Add no more than 10 tags.";
    else if (tags.some((tag) => tag.length > 40)) nextErrors.tags = "Each tag must be 40 characters or fewer.";

    let contactCadenceDays: number | undefined;
    if (cadenceText.trim()) {
      contactCadenceDays = Number(cadenceText);
      if (!Number.isInteger(contactCadenceDays) || contactCadenceDays < 1 || contactCadenceDays > 3650) {
        nextErrors.cadence = "Enter a whole number from 1 to 3650 days.";
      }
    }
    if (draft.role?.trim() && !draft.organisationName?.trim()) {
      nextErrors.organisation = "Add an organisation before adding a role.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return undefined;
    }
    return { ...draft, displayName, tags, contactCadenceDays };
  }

  function markCaptureFinished() {
    dirtyRef.current = false;
    onDirtyChange(false);
    onSavingChange(false);
    onCaptureFinished();
  }

  async function createPreparedCapture(
    prepared: PreparedManualPersonCapture,
    acknowledgedDuplicatePersonIds: readonly string[] = []
  ) {
    await savePreparedManualPersonCapture(await getDatabase(), prepared, {
      enforceDuplicateReview: true,
      acknowledgedDuplicatePersonIds
    });
    markCaptureFinished();
    navigate(personProfilePath(prepared.person.id), { replace: true });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const validated = validate();
    if (!validated) return;

    submittingRef.current = true;
    onSavingChange(true);
    setSaving(true);
    setFormError("");
    try {
      const prepared = preparedRef.current ?? prepareManualPersonCapture(validated, defaultPhoneRegion);
      preparedRef.current = prepared;
      validatedDraftRef.current = validated;
      const matches = await findDuplicateMatches(await getDatabase(), prepared);
      acknowledgedDuplicatePersonIdsRef.current = [];
      if (matches.length) {
        setDuplicateMatches(matches);
      } else {
        await createPreparedCapture(prepared);
      }
    } catch (error) {
      if (error instanceof DuplicateReviewRequiredError) setDuplicateMatches(error.matches);
      else setFormError(firstIssue(error));
    } finally {
      submittingRef.current = false;
      onSavingChange(false);
      setSaving(false);
    }
  }

  async function createSeparate() {
    const prepared = preparedRef.current;
    if (!prepared || submittingRef.current) return;
    submittingRef.current = true;
    onSavingChange(true);
    setSaving(true);
    setFormError("");
    const acknowledgedPersonIds = mergePersonIds(
      acknowledgedDuplicatePersonIdsRef.current,
      duplicateMatches.map((match) => match.person.id)
    );
    try {
      await createPreparedCapture(prepared, acknowledgedPersonIds);
    } catch (error) {
      if (error instanceof DuplicateReviewRequiredError) {
        acknowledgedDuplicatePersonIdsRef.current = acknowledgedPersonIds;
        setDuplicateMatches(error.matches);
      }
      else {
        acknowledgedDuplicatePersonIdsRef.current = [];
        setFormError(firstIssue(error));
        setDuplicateMatches([]);
        requestAnimationFrame(() => saveButtonRef.current?.focus());
      }
    } finally {
      submittingRef.current = false;
      onSavingChange(false);
      setSaving(false);
    }
  }

  async function addDetailsToExisting(match: DuplicateMatch, selection: DuplicateLinkSelection) {
    const prepared = preparedRef.current;
    if (!prepared || submittingRef.current) return;
    submittingRef.current = true;
    onSavingChange(true);
    setSaving(true);
    setFormError("");
    try {
      await addReviewedDetailsToExistingPerson(await getDatabase(), {
        targetPersonId: match.person.id,
        expectedPersonRevision: match.person.revision,
        candidate: prepared,
        selectedContactMethodIds: selection.contactMethodIds,
        includeAffiliation: selection.includeAffiliation,
        now: prepared.person.createdAt
      });
      markCaptureFinished();
      navigate(personProfilePath(match.person.id), { replace: true });
    } catch (error) {
      setFormError(firstIssue(error));
      setDuplicateMatches([]);
      requestAnimationFrame(() => saveButtonRef.current?.focus());
    } finally {
      submittingRef.current = false;
      onSavingChange(false);
      setSaving(false);
    }
  }

  function openExisting(match: DuplicateMatch) {
    const resumeDraft = validatedDraftRef.current ?? draft;
    onOpenDuplicatePerson(match.person.id, { draft: resumeDraft, tagsText, cadenceText });
  }

  function returnToEdit() {
    setDuplicateMatches([]);
    requestAnimationFrame(() => saveButtonRef.current?.focus());
  }

  const identityLabel = draft.identityStatus === "provisional" ? "Temporary description" : "Name";
  const identityHint = draft.identityStatus === "provisional"
    ? "Use enough detail to recognise this person later, such as “Hackathon organiser”."
    : "A first name is enough. You can add more later.";

  return (
    <main className="screen form-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={dismiss} disabled={saving}>← Cancel</button>
      <header className="page-heading compact-heading">
        <p className="eyebrow">People</p>
        <h2>Add a person</h2>
        <p>Capture only what you know. Everything except a recognisable identity is optional.</p>
      </header>

      <form className="person-form" onSubmit={save} noValidate>
        <fieldset className="choice-fieldset">
          <legend>What do you know?</legend>
          <label>
            <input
              type="radio"
              name="identity-status"
              value="confirmed"
              checked={draft.identityStatus === "confirmed"}
              onChange={() => changed((current) => ({ ...current, identityStatus: "confirmed" }))}
            />
            Their name
          </label>
          <label>
            <input
              type="radio"
              name="identity-status"
              value="provisional"
              checked={draft.identityStatus === "provisional"}
              onChange={() => changed((current) => ({ ...current, identityStatus: "provisional" }))}
            />
            A description for now
          </label>
        </fieldset>

        <div className="form-field">
          <label htmlFor="person-display-name">{identityLabel}</label>
          <input
            ref={identityRef}
            id="person-display-name"
            name="displayName"
            maxLength={120}
            required
            aria-required="true"
            autoComplete="name"
            value={draft.displayName}
            aria-describedby={`person-display-name-hint${errors.displayName ? " person-display-name-error" : ""}`}
            aria-invalid={Boolean(errors.displayName)}
            onChange={(event) => changed((current) => ({ ...current, displayName: event.target.value }))}
          />
          <p className="field-hint" id="person-display-name-hint">{identityHint}</p>
          {errors.displayName && <p className="field-error" id="person-display-name-error" role="alert">{errors.displayName}</p>}
        </div>

        <section className="form-section" aria-labelledby="capture-contact-heading">
          <div className="form-section-heading">
            <div>
              <h3 id="capture-contact-heading">Contact details <span>Optional</span></h3>
              <p>Add as many phone numbers or email addresses as are useful.</p>
            </div>
          </div>
          <div className="contact-draft-list">
            {draft.contactMethods.map((contact, index) => {
              const errorId = `capture-contact-${contact.id}-error`;
              const valueId = `capture-contact-${contact.id}-value`;
              const error = errors[`contact-${contact.id}`];
              return (
                <fieldset className="contact-draft" key={contact.id}>
                  <legend>Contact detail {index + 1}</legend>
                  <div className={`contact-row-grid${contact.kind === "phone" ? " phone-row-grid" : ""}`}>
                    <div className="form-field">
                      <label htmlFor={`capture-contact-${contact.id}-kind`}>Type</label>
                      <select
                        id={`capture-contact-${contact.id}-kind`}
                        value={contact.kind}
                        onChange={(event) => updateContact(contact.id, { kind: event.target.value as "phone" | "email" })}
                      >
                        <option value="phone">Phone</option>
                        <option value="email">Email</option>
                      </select>
                    </div>
                    {contact.kind === "phone" && (
                      <div className="form-field">
                        <label htmlFor={`capture-contact-${contact.id}-region`}>Phone region</label>
                        <select
                          id={`capture-contact-${contact.id}-region`}
                          value={contact.region ?? defaultPhoneRegion}
                          onChange={(event) => updateContact(contact.id, { region: event.target.value })}
                        >
                          {phoneRegionOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="form-field contact-value-field">
                      <label htmlFor={valueId}>{contactInputLabel(contact)}</label>
                      <input
                        id={valueId}
                        type={contact.kind === "email" ? "email" : "tel"}
                        inputMode={contact.kind === "email" ? "email" : "tel"}
                        autoComplete={contact.kind === "email" ? "email" : "tel"}
                        value={contact.value}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                        onChange={(event) => updateContact(contact.id, { value: event.target.value })}
                      />
                      {error && <p className="field-error" id={errorId} role="alert">{error}</p>}
                    </div>
                    <div className="form-field">
                      <label htmlFor={`capture-contact-${contact.id}-label`}>Label</label>
                      <input
                        id={`capture-contact-${contact.id}-label`}
                        placeholder={contact.kind === "phone" ? "Personal mobile" : "Work email"}
                        value={contact.label ?? ""}
                        onChange={(event) => updateContact(contact.id, { label: event.target.value })}
                      />
                    </div>
                  </div>
                  <button className="text-action danger-text" type="button" onClick={() => removeContact(contact.id)}>
                    Remove contact detail
                  </button>
                </fieldset>
              );
            })}
          </div>
          <div className="button-row compact-buttons">
            <button type="button" onClick={() => addContact("phone")}>Add phone</button>
            <button type="button" onClick={() => addContact("email")}>Add email</button>
          </div>
        </section>

        <div className="form-field">
          <label htmlFor="person-organisation">Organisation <span>Optional</span></label>
          <input
            id="person-organisation"
            value={draft.organisationName ?? ""}
            aria-invalid={Boolean(errors.organisation)}
            aria-describedby={errors.organisation ? "person-organisation-error" : undefined}
            onChange={(event) => changed((current) => ({ ...current, organisationName: event.target.value }))}
          />
          {errors.organisation && <p className="field-error" id="person-organisation-error" role="alert">{errors.organisation}</p>}
        </div>

        <div className="form-field">
          <label htmlFor="person-where-met">Where you met <span>Optional</span></label>
          <input
            id="person-where-met"
            placeholder="HealthTech Fellowship"
            value={draft.whereMet ?? ""}
            onChange={(event) => changed((current) => ({ ...current, whereMet: event.target.value }))}
          />
        </div>

        <details className="more-details">
          <summary>More details</summary>
          <div className="more-details-body">
            <div className="form-field">
              <label htmlFor="person-role">Role or job title <span>Optional</span></label>
              <input
                id="person-role"
                value={draft.role ?? ""}
                onChange={(event) => changed((current) => ({ ...current, role: event.target.value }))}
              />
            </div>
            <div className="form-field">
              <label htmlFor="person-importance">Importance</label>
              <select
                id="person-importance"
                value={draft.importance}
                onChange={(event) => changed((current) => ({ ...current, importance: event.target.value as "normal" | "high" }))}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="person-tags">Tags <span>Optional</span></label>
              <input
                id="person-tags"
                placeholder="mentor, fellowship"
                value={tagsText}
                aria-invalid={Boolean(errors.tags)}
                aria-describedby={`person-tags-hint${errors.tags ? " person-tags-error" : ""}`}
                onChange={(event) => {
                  preparedRef.current = null;
                  acknowledgedDuplicatePersonIdsRef.current = [];
                  setDuplicateMatches([]);
                  dirtyRef.current = true;
                  setTagsText(event.target.value);
                  onDirtyChange(true);
                }}
              />
              <p className="field-hint" id="person-tags-hint">Separate tags with commas.</p>
              {errors.tags && <p className="field-error" id="person-tags-error" role="alert">{errors.tags}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="person-cadence">Contact cadence in days <span>Optional</span></label>
              <input
                id="person-cadence"
                type="number"
                inputMode="numeric"
                min="1"
                max="3650"
                value={cadenceText}
                aria-invalid={Boolean(errors.cadence)}
                aria-describedby={errors.cadence ? "person-cadence-error" : undefined}
                onChange={(event) => {
                  preparedRef.current = null;
                  acknowledgedDuplicatePersonIdsRef.current = [];
                  setDuplicateMatches([]);
                  dirtyRef.current = true;
                  setCadenceText(event.target.value);
                  onDirtyChange(true);
                }}
              />
              {errors.cadence && <p className="field-error" id="person-cadence-error" role="alert">{errors.cadence}</p>}
            </div>
          </div>
        </details>

        {formError && (
          <div className="form-alert">
            <p role="alert">{formError}</p>
            <p>Nothing partial was saved. Your entries are still here so you can try again.</p>
          </div>
        )}
        <div className="form-actions">
          <button ref={saveButtonRef} className="primary-action" type="submit" disabled={saving || !draft.displayName.trim()}>
            {saving ? "Saving…" : "Save person"}
          </button>
          <button className="secondary-action" type="button" onClick={dismiss} disabled={saving}>Cancel</button>
        </div>
      </form>
      {preparedRef.current && duplicateMatches.length > 0 && (
        <DuplicateWarningSheet
          candidate={preparedRef.current}
          matches={duplicateMatches}
          busy={saving}
          onOpenExisting={openExisting}
          onAddDetails={(match, selection) => void addDetailsToExisting(match, selection)}
          onCreateSeparate={() => void createSeparate()}
          onReturnToEdit={returnToEdit}
        />
      )}
    </main>
  );
}

function displayContact(contact: ContactMethod, phoneRegion: string): string {
  if (contact.kind === "email") return contact.rawValue;
  try {
    return formatPhoneNumberForDisplay(contact.canonicalValue, phoneRegion);
  } catch {
    return contact.rawValue;
  }
}

function usePerson(personId: string, refreshVersion = 0) {
  const [summary, setSummary] = useState<PersonSummary | null | undefined>(undefined);
  const [phoneRegion, setPhoneRegion] = useState("GB");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getDatabase().then(async (db) => Promise.all([getPersonSummary(db, personId), getAppSettings(db)]))
      .then(([record, settings]) => {
        if (!active) return;
        setSummary(record ?? null);
        setPhoneRegion(settings.defaultPhoneRegion);
      })
      .catch(() => { if (active) setError("PeopleOS could not load this person."); });
    return () => { active = false; };
  }, [personId, refreshVersion]);

  return { summary, phoneRegion, error };
}

export function PersonProfileScreen({
  personId,
  navigate,
  backPath
}: {
  personId: string;
  navigate: Navigate;
  backPath: string;
}) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const { summary, phoneRegion, error } = usePerson(personId, refreshVersion);
  const [history, setHistory] = useState<PersonHistory | null | undefined>(undefined);
  const [historyError, setHistoryError] = useState("");
  const [editor, setEditor] = useState<{ interaction?: TimelineDisplayItem["interaction"]; initialKind?: InteractionKind } | null>(null);
  const editorOpenerRef = useRef<HTMLElement | null>(null);
  const profileHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    setHistory(undefined);
    setHistoryError("");
    getDatabase().then((db) => getPersonHistory(db, personId)).then((result) => {
      if (active) setHistory(result ?? null);
    }).catch(() => { if (active) setHistoryError("PeopleOS could not load recent history."); });
    return () => { active = false; };
  }, [personId, refreshVersion]);

  function openInteraction(opener: HTMLElement, initialKind?: InteractionKind, interaction?: TimelineDisplayItem["interaction"]) {
    editorOpenerRef.current = opener;
    setEditor({ initialKind, interaction });
  }

  function closeInteraction() {
    setEditor(null);
    requestAnimationFrame(() => {
      if (editorOpenerRef.current?.isConnected) editorOpenerRef.current.focus();
      else profileHeadingRef.current?.focus();
    });
  }

  function finishInteraction() {
    setEditor(null);
    setRefreshVersion((current) => current + 1);
    requestAnimationFrame(() => profileHeadingRef.current?.focus());
  }

  function openTimelineInteraction(item: TimelineDisplayItem, opener: HTMLElement) {
    if (item.interaction && item.editable) openInteraction(opener, undefined, item.interaction);
  }

  const requestedBackRoute = routeFromPath(backPath);
  const resumesCapture = backPath === "/people/new";
  const resumesImport = backPath === "/people/import";
  const resumesContactEditor = requestedBackRoute.id === "contact-methods";
  const resumesPreviousFlow = resumesCapture || resumesImport || resumesContactEditor;
  const backRoute = ["today", "reach-out", "people", "upcoming"].includes(requestedBackRoute.id)
    ? requestedBackRoute
    : routeFromPath("/people");
  return (
    <main className="screen person-profile-screen" id="main-content" tabIndex={-1}>
      <button
        className="back-button"
        type="button"
        onClick={() => resumesPreviousFlow ? window.history.back() : navigate(backRoute.path)}
      >
        ← {resumesCapture
          ? "Continue adding person"
          : resumesImport
            ? "Continue import"
            : resumesContactEditor
              ? "Continue editing contact"
              : backRoute.label}
      </button>
      {summary === undefined && !error && <p role="status">Loading person…</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {summary === null && (
        <EmptyState
          eyebrow="People"
          title="Person not found"
          description="This person may have been removed or the link may be out of date."
          action={actionButton("Add person", () => navigate("/people/new"))}
        />
      )}
      {summary && (
        <>
          <header className="profile-heading">
            <p className="eyebrow">Person</p>
            <h2 ref={profileHeadingRef} tabIndex={-1}>{summary.person.displayName}</h2>
            {summary.person.identityStatus === "provisional" && <p className="identity-note"><span className="status-chip">Identity incomplete</span> Add their confirmed name whenever you learn it.</p>}
            {affiliationLine(summary) && <p className="profile-affiliation">{affiliationLine(summary)}</p>}
          </header>
          {!summary.person.archivedAt && summary.person.identityStatus !== "merged" && (
            <div className="profile-action-row" role="group" aria-label="Person actions">
              <button className="primary-action" type="button" onClick={(event) => openInteraction(event.currentTarget)}>
                Log interaction
              </button>
              <button className="secondary-action" type="button" onClick={(event) => openInteraction(event.currentTarget, "note_added")}>
                Add note
              </button>
            </div>
          )}
          <section className="profile-card" aria-labelledby="profile-contact-heading">
            <div className="card-heading-with-action">
              <div>
                <h3 id="profile-contact-heading">Contact details</h3>
                <p>Stored methods only. Communication actions arrive later.</p>
              </div>
              <button className="secondary-action" type="button" onClick={() => navigate(contactMethodsPath(summary.person.id))}>Manage</button>
            </div>
            {summary.activeContactMethods.length === 0 ? (
              <p className="muted-copy">Add a phone number or email when you have one.</p>
            ) : (
              <dl className="profile-details">
                {summary.activeContactMethods.map((contact) => (
                  <div key={contact.id}>
                    <dt>{contact.label || (contact.kind === "phone" ? "Phone" : "Email")}{contact.isPreferred ? " · Preferred" : ""}</dt>
                    <dd>{displayContact(contact, phoneRegion)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="profile-card" aria-labelledby="profile-context-heading">
            <h3 id="profile-context-heading">Context</h3>
            <dl className="profile-details">
              {summary.currentAffiliation && <div><dt>Organisation</dt><dd>{summary.currentAffiliation.organisationName}</dd></div>}
              {summary.currentAffiliation?.role && <div><dt>Role</dt><dd>{summary.currentAffiliation.role}</dd></div>}
              {summary.latestMetInteraction?.summary && <div><dt>Where you met</dt><dd>{summary.latestMetInteraction.summary}</dd></div>}
              <div><dt>Importance</dt><dd>{summary.person.importance === "high" ? "High" : "Normal"}</dd></div>
              {summary.person.tags.length > 0 && <div><dt>Tags</dt><dd>{summary.person.tags.join(", ")}</dd></div>}
              {summary.person.contactCadenceDays && <div><dt>Contact cadence</dt><dd>Every {summary.person.contactCadenceDays} days</dd></div>}
            </dl>
          </section>
          <section className="profile-card" aria-labelledby="relationship-summary-heading">
            <h3 id="relationship-summary-heading">Relationship summary</h3>
            <dl className="profile-details">
              <div>
                <dt>Last meaningful contact</dt>
                <dd>{historyError
                  ? "Unavailable"
                  : history === undefined
                    ? "Loading…"
                  : history === null
                    ? "Unavailable"
                    : history.lastContact
                      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(history.lastContact.occurredAt))
                      : "No meaningful contact recorded"}</dd>
              </div>
              <div>
                <dt>Added to PeopleOS</dt>
                <dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(summary.person.createdAt))}</dd>
              </div>
            </dl>
          </section>
          <section className="profile-card" aria-labelledby="recent-timeline-heading">
            <div className="card-heading-with-action">
              <div>
                <h3 id="recent-timeline-heading">Recent timeline</h3>
                <p>The five newest moments in this relationship.</p>
              </div>
              <button className="secondary-action" type="button" onClick={() => navigate(timelinePath(summary.person.id))}>
                See full timeline
              </button>
            </div>
            {history === undefined && !historyError && <p role="status">Loading recent history…</p>}
            {historyError && (
              <div className="section-error">
                <p role="alert">{historyError}</p>
                <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>Retry</button>
              </div>
            )}
            {history && history.timeline.every((item) => item.source === "person_created") ? (
              <div className="timeline-empty">
                <p>No interactions recorded yet.</p>
                {!summary.person.archivedAt && summary.person.identityStatus !== "merged" && (
                  <button className="text-action" type="button" onClick={(event) => openInteraction(event.currentTarget)}>
                    Log interaction
                  </button>
                )}
              </div>
            ) : history ? (
              <TimelineList
                items={history.timeline.slice(0, 5)}
                onOpenInteraction={!summary.person.archivedAt && summary.person.identityStatus !== "merged"
                  ? openTimelineInteraction
                  : undefined}
              />
            ) : null}
          </section>
          <p className="scope-note">Memory facts, follow-ups, Reach Out and relationship insights are added in later implementation packages.</p>
          {editor && (
            <InteractionEditorSheet
              personId={summary.person.id}
              personName={summary.person.displayName}
              interaction={editor.interaction}
              initialKind={editor.initialKind}
              onClose={closeInteraction}
              onSaved={finishInteraction}
              onDeleted={finishInteraction}
            />
          )}
        </>
      )}
    </main>
  );
}

export type ContactEditorResumeState = {
  mode: "add" | "edit";
  draft: ContactMethodDraft;
  expectedRevision?: number;
};

function contactDuplicateCandidate(
  summary: PersonSummary,
  editor: ContactEditorResumeState,
  defaultPhoneRegion: string,
  existingContacts: ContactMethod[]
): PreparedManualPersonCapture {
  const normalised = normalizeContactValue(
    editor.draft.kind,
    editor.draft.value,
    editor.draft.region ?? defaultPhoneRegion
  );
  const existing = existingContacts.find((contact) => contact.id === editor.draft.id);
  const base = {
    id: editor.draft.id,
    revision: editor.mode === "edit" ? editor.expectedRevision ?? 1 : 1,
    personId: summary.person.id,
    ...(editor.draft.label?.trim() ? { label: editor.draft.label.trim() } : {}),
    rawValue: normalised.rawValue,
    canonicalValue: normalised.canonicalValue,
    isPreferred: existing?.isPreferred ?? false,
    createdAt: editor.draft.createdAt,
    updatedAt: editor.draft.createdAt
  };
  const contactMethod: ContactMethod = editor.draft.kind === "phone"
    ? { ...base, kind: "phone", ...(normalised.region ? { region: normalised.region } : {}) }
    : { ...base, kind: "email" };
  return { person: summary.person, contactMethods: [contactMethod] };
}

export function ContactMethodsScreen({
  personId,
  navigate,
  onDirtyChange,
  onSavingChange,
  initialEditor,
  onOpenDuplicatePerson,
  onEditorFinished
}: {
  personId: string;
  navigate: Navigate;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  initialEditor?: ContactEditorResumeState | null;
  onOpenDuplicatePerson: (personId: string, editor: ContactEditorResumeState) => void;
  onEditorFinished: () => void;
}) {
  const [person, setPerson] = useState<PersonSummary | null | undefined>(undefined);
  const [contacts, setContacts] = useState<ContactMethod[]>([]);
  const [phoneRegion, setPhoneRegion] = useState("GB");
  const [editor, setEditor] = useState<ContactEditorResumeState | null>(initialEditor ?? null);
  const [fieldError, setFieldError] = useState("");
  const [pageError, setPageError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState("");
  const [removedContact, setRemovedContact] = useState<{ archived: ContactMethod; wasPreferred: boolean } | null>(null);
  const [contactDuplicateMatches, setContactDuplicateMatches] = useState<DuplicateMatch[]>([]);
  const [contactDuplicateCandidateState, setContactDuplicateCandidateState] = useState<PreparedManualPersonCapture | null>(null);
  const editorDirtyRef = useRef(false);
  const editorValueRef = useRef<HTMLInputElement>(null);
  const editorOpenerRef = useRef<HTMLElement | null>(null);
  const editorOpenerIdRef = useRef("");
  const mutationInFlightRef = useRef(false);
  const acknowledgedContactDuplicatePersonIdsRef = useRef<string[]>([]);

  async function load() {
    const db = await getDatabase();
    const [summary, methods, settings] = await Promise.all([
      getPersonSummary(db, personId),
      listContactMethodsForPerson(db, personId, true),
      getAppSettings(db)
    ]);
    setPerson(summary ?? null);
    setContacts(methods);
    setPhoneRegion(settings.defaultPhoneRegion);
  }

  useEffect(() => {
    let active = true;
    getDatabase().then(async (db) => Promise.all([
      getPersonSummary(db, personId),
      listContactMethodsForPerson(db, personId, true),
      getAppSettings(db)
    ])).then(([summary, methods, settings]) => {
      if (!active) return;
      setPerson(summary ?? null);
      setContacts(methods);
      setPhoneRegion(settings.defaultPhoneRegion);
    }).catch(() => { if (active) setPageError("PeopleOS could not load contact details."); });
    return () => { active = false; };
  }, [personId]);

  useEffect(() => {
    if (!initialEditor) return;
    editorDirtyRef.current = true;
    editorOpenerIdRef.current = initialEditor.mode === "add"
      ? `add-${initialEditor.draft.kind}-contact`
      : `edit-contact-${initialEditor.draft.id}`;
    onDirtyChange(true);
  }, [initialEditor, onDirtyChange]);

  useEffect(() => () => {
    onDirtyChange(false);
    onSavingChange(false);
  }, [onDirtyChange, onSavingChange]);

  useEffect(() => {
    if (!removedContact) return;
    const timeout = window.setTimeout(() => setRemovedContact(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [removedContact]);

  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (event.key === "Tab") {
        const sheet = document.querySelector<HTMLElement>(".contact-sheet");
        const focusable = sheet ? Array.from(sheet.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])")) : [];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorDirtyRef.current) return;
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

  function setEditorDirty(dirty: boolean) {
    editorDirtyRef.current = dirty;
    onDirtyChange(dirty);
  }

  function returnFocusToEditorOpener() {
    const direct = editorOpenerRef.current;
    const openerId = editorOpenerIdRef.current;
    requestAnimationFrame(() => {
      if (direct?.isConnected) direct.focus();
      else if (openerId) document.getElementById(openerId)?.focus();
    });
    editorOpenerRef.current = null;
    editorOpenerIdRef.current = "";
  }

  function closeEditor() {
    if (saving) return;
    if (editorDirtyRef.current && !window.confirm("Discard changes?")) return;
    setEditorDirty(false);
    acknowledgedContactDuplicatePersonIdsRef.current = [];
    setEditor(null);
    setContactDuplicateMatches([]);
    setContactDuplicateCandidateState(null);
    setFieldError("");
    onEditorFinished();
    returnFocusToEditorOpener();
  }

  function changeEditor(patch: Partial<ContactMethodDraft>) {
    if (!editor) return;
    setEditor({ ...editor, draft: { ...editor.draft, ...patch } });
    acknowledgedContactDuplicatePersonIdsRef.current = [];
    setContactDuplicateMatches([]);
    setContactDuplicateCandidateState(null);
    setEditorDirty(true);
    setFieldError("");
  }

  function beginMutation(): boolean {
    if (mutationInFlightRef.current) return false;
    mutationInFlightRef.current = true;
    onSavingChange(true);
    setSaving(true);
    return true;
  }

  function endMutation() {
    mutationInFlightRef.current = false;
    onSavingChange(false);
    setSaving(false);
  }

  function startAdd(kind: "phone" | "email", opener: HTMLElement) {
    setFieldError("");
    setEditorDirty(false);
    editorOpenerRef.current = opener;
    editorOpenerIdRef.current = opener.id;
    onEditorFinished();
    acknowledgedContactDuplicatePersonIdsRef.current = [];
    setEditor({ mode: "add", draft: createContactMethodDraft(personId, kind) });
  }

  function startEdit(contact: ContactMethod, opener: HTMLElement) {
    setFieldError("");
    setEditorDirty(false);
    editorOpenerRef.current = opener;
    editorOpenerIdRef.current = opener.id;
    onEditorFinished();
    acknowledgedContactDuplicatePersonIdsRef.current = [];
    setEditor({
      mode: "edit",
      expectedRevision: contact.revision,
      draft: {
        id: contact.id,
        personId: contact.personId,
        kind: contact.kind,
        value: contact.rawValue,
        ...(contact.kind === "phone" && contact.region ? { region: contact.region } : {}),
        ...(contact.label ? { label: contact.label } : {}),
        createdAt: contact.createdAt
      }
    });
  }

  async function persistContact(acknowledgedDuplicatePersonIds: readonly string[] = []) {
    if (!editor || !beginMutation()) return;
    const cumulativeAcknowledgedPersonIds = mergePersonIds(
      acknowledgedContactDuplicatePersonIdsRef.current,
      acknowledgedDuplicatePersonIds
    );
    setFieldError("");
    setPageError("");
    try {
      const db = await getDatabase();
      if (editor.mode === "add") {
        await addContactMethod(db, editor.draft, phoneRegion, {
          enforceDuplicateReview: true,
          acknowledgedDuplicatePersonIds: cumulativeAcknowledgedPersonIds
        });
      } else {
        await editContactMethod(db, {
          id: editor.draft.id,
          expectedRevision: editor.expectedRevision ?? 0,
          kind: editor.draft.kind,
          value: editor.draft.value,
          label: editor.draft.label,
          region: editor.draft.region
        }, phoneRegion, new Date().toISOString(), {
          enforceDuplicateReview: true,
          acknowledgedDuplicatePersonIds: cumulativeAcknowledgedPersonIds
        });
      }
      await load();
      setEditorDirty(false);
      acknowledgedContactDuplicatePersonIdsRef.current = [];
      setEditor(null);
      setContactDuplicateMatches([]);
      setContactDuplicateCandidateState(null);
      onEditorFinished();
      returnFocusToEditorOpener();
    } catch (error) {
      if (error instanceof DuplicateReviewRequiredError && person) {
        acknowledgedContactDuplicatePersonIdsRef.current = cumulativeAcknowledgedPersonIds;
        setContactDuplicateCandidateState(contactDuplicateCandidate(person, editor, phoneRegion, contacts));
        setContactDuplicateMatches(error.matches);
      } else if (error instanceof ContactValueValidationError) {
        setFieldError(error.message);
        requestAnimationFrame(() => editorValueRef.current?.focus());
      }
      else setPageError(firstIssue(error));
    } finally {
      endMutation();
    }
  }

  function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    acknowledgedContactDuplicatePersonIdsRef.current = [];
    void persistContact();
  }

  function returnToContactEditor() {
    acknowledgedContactDuplicatePersonIdsRef.current = [];
    setContactDuplicateMatches([]);
    setContactDuplicateCandidateState(null);
    requestAnimationFrame(() => editorValueRef.current?.focus());
  }

  function openExistingContactDuplicate(match: DuplicateMatch) {
    if (!editor) return;
    setEditorDirty(false);
    onOpenDuplicatePerson(match.person.id, editor);
  }

  async function makePreferred(contact: ContactMethod) {
    if (!beginMutation()) return;
    setPageError("");
    try {
      await setPreferredContactMethod(await getDatabase(), contact.id, contact.revision);
      await load();
    } catch (error) {
      setPageError(firstIssue(error));
    } finally {
      endMutation();
    }
  }

  async function remove(contact: ContactMethod) {
    const alternatives = contacts.some((item) => item.id !== contact.id && !item.archivedAt && item.kind === contact.kind);
    const warning = contact.isPreferred && alternatives
      ? "Remove this preferred contact detail? No replacement will be selected automatically."
      : "Remove this contact detail? It will remain in archived history.";
    if (contact.isPreferred && alternatives && !window.confirm(warning)) return;
    if (!beginMutation()) return;
    setPageError("");
    try {
      const archived = await archiveContactMethod(await getDatabase(), contact.id, contact.revision);
      await load();
      setRemovedContact({ archived, wasPreferred: contact.isPreferred });
    } catch (error) {
      setPageError(firstIssue(error));
    } finally {
      endMutation();
    }
  }

  async function undoRemove() {
    if (!removedContact || !beginMutation()) return;
    setPageError("");
    try {
      await restoreContactMethod(
        await getDatabase(),
        removedContact.archived.id,
        removedContact.archived.revision,
        removedContact.wasPreferred
      );
      await load();
      setRemovedContact(null);
    } catch (error) {
      setPageError(firstIssue(error));
    } finally {
      endMutation();
    }
  }

  async function copy(contact: ContactMethod) {
    try {
      await navigator.clipboard.writeText(contact.rawValue);
      setCopied(`${contact.kind === "phone" ? "Phone number" : "Email address"} copied.`);
    } catch {
      setPageError("PeopleOS could not copy this contact detail. You can still select it manually.");
    }
  }

  const active = contacts.filter((contact) => !contact.archivedAt);
  const archived = contacts.filter((contact) => contact.archivedAt);

  return (
    <main className="screen contact-methods-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => navigate(personProfilePath(personId))} disabled={saving}>← Person</button>
      <header className="page-heading compact-heading">
        <p className="eyebrow">{person?.person.displayName ?? "Person"}</p>
        <h2>Contact details</h2>
        <p>Add, label and choose preferred contact details. Nothing is contacted from this screen.</p>
      </header>
      {pageError && <p className="form-alert" role="alert">{pageError}</p>}
      {removedContact && (
        <div className="undo-message" role="status">
          <span>Contact detail removed.</span>
          <button type="button" onClick={undoRemove} disabled={saving}>Undo</button>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">{copied}</p>
      {person === undefined && !pageError && <p role="status">Loading contact details…</p>}
      {person === null && <p className="error-message" role="alert">This person could not be found.</p>}
      {person && (
        <>
          <section className="profile-card" aria-labelledby="active-contact-heading">
            <div className="card-heading-with-action contact-heading-actions">
              <div>
                <h3 id="active-contact-heading">Current details</h3>
                <p>The first saved phone and email become preferred by default.</p>
              </div>
              <div className="button-row compact-buttons">
                <button id="add-phone-contact" type="button" onClick={(event) => startAdd("phone", event.currentTarget)} disabled={saving}>Add phone</button>
                <button id="add-email-contact" type="button" onClick={(event) => startAdd("email", event.currentTarget)} disabled={saving}>Add email</button>
              </div>
            </div>

            {active.length === 0 ? <p className="muted-copy">Add a phone number or email when you have one.</p> : (
              <ul className="contact-method-list">
                {active.map((contact) => (
                  <li key={contact.id}>
                    <div className="contact-method-value">
                      <span>{contact.label || (contact.kind === "phone" ? "Phone" : "Email")}</span>
                      <strong>{displayContact(contact, phoneRegion)}</strong>
                      {contact.isPreferred && <span className="status-chip">Preferred {contact.kind}</span>}
                    </div>
                    <div className="contact-method-actions">
                      <button
                        type="button"
                        aria-label={`Copy ${displayContact(contact, phoneRegion)}`}
                        disabled={saving}
                        onClick={() => copy(contact)}
                      >Copy</button>
                      <button
                        id={`edit-contact-${contact.id}`}
                        type="button"
                        aria-label={`Edit ${displayContact(contact, phoneRegion)}`}
                        disabled={saving}
                        onClick={(event) => startEdit(contact, event.currentTarget)}
                      >Edit</button>
                      {!contact.isPreferred && (
                        <button
                          type="button"
                          aria-label={`Make ${displayContact(contact, phoneRegion)} preferred`}
                          disabled={saving}
                          onClick={() => makePreferred(contact)}
                        >Make preferred</button>
                      )}
                      <button
                        className="danger-text"
                        type="button"
                        aria-label={`Remove ${displayContact(contact, phoneRegion)}`}
                        disabled={saving}
                        onClick={() => remove(contact)}
                      >Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {archived.length > 0 && (
            <details className="archived-details">
              <summary>Archived contact details ({archived.length})</summary>
              <ul>
                {archived.map((contact) => (
                  <li key={contact.id}>
                    <span>{contact.label || (contact.kind === "phone" ? "Phone" : "Email")}</span>
                    <strong>{displayContact(contact, phoneRegion)}</strong>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {editor && contactDuplicateMatches.length === 0 && (
            <div
              className="sheet-backdrop"
              onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}
            >
              <section className="contact-sheet" role="dialog" aria-modal="true" aria-labelledby="contact-editor-title">
                <div className="sheet-heading">
                  <h3 id="contact-editor-title">{editor.mode === "add" ? "Add contact detail" : "Edit contact detail"}</h3>
                  <button type="button" aria-label="Close contact editor" onClick={closeEditor} disabled={saving}>×</button>
                </div>
                <form className="contact-editor" onSubmit={saveContact} noValidate>
                  <div className={`contact-row-grid${editor.draft.kind === "phone" ? " phone-row-grid" : ""}`}>
                    <div className="form-field">
                      <label htmlFor="contact-editor-kind">Type</label>
                      <select
                        id="contact-editor-kind"
                        value={editor.draft.kind}
                        onChange={(event) => changeEditor({ kind: event.target.value as "phone" | "email" })}
                      >
                        <option value="phone">Phone</option>
                        <option value="email">Email</option>
                      </select>
                    </div>
                    {editor.draft.kind === "phone" && (
                      <div className="form-field">
                        <label htmlFor="contact-editor-region">Phone region</label>
                        <select
                          id="contact-editor-region"
                          value={editor.draft.region ?? phoneRegion}
                          onChange={(event) => changeEditor({ region: event.target.value })}
                        >
                          {phoneRegionOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="form-field contact-value-field">
                      <div className="field-label-row">
                        <label htmlFor="contact-editor-value">{editor.draft.kind === "phone" ? "Phone number" : "Email address"}</label>
                        <span aria-hidden="true">Required</span>
                      </div>
                      <input
                        ref={editorValueRef}
                        id="contact-editor-value"
                        autoFocus
                        type={editor.draft.kind === "phone" ? "tel" : "email"}
                        inputMode={editor.draft.kind === "phone" ? "tel" : "email"}
                        required
                        aria-required="true"
                        value={editor.draft.value}
                        aria-invalid={Boolean(fieldError)}
                        aria-describedby={fieldError ? "contact-editor-error" : undefined}
                        onChange={(event) => changeEditor({ value: event.target.value })}
                      />
                      {fieldError && <p className="field-error" id="contact-editor-error" role="alert">{fieldError}</p>}
                    </div>
                    <div className="form-field">
                      <label htmlFor="contact-editor-label">Label <span>Optional</span></label>
                      <input
                        id="contact-editor-label"
                        placeholder={editor.draft.kind === "phone" ? "Personal mobile" : "NHS email"}
                        value={editor.draft.label ?? ""}
                        onChange={(event) => changeEditor({ label: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="button-row sheet-actions">
                    <button className="primary-action" type="submit" disabled={saving}>{saving ? "Saving…" : "Save contact detail"}</button>
                    <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
                  </div>
                </form>
              </section>
            </div>
          )}
          {editor && contactDuplicateCandidateState && contactDuplicateMatches.length > 0 && (
            <DuplicateWarningSheet
              candidate={contactDuplicateCandidateState}
              matches={contactDuplicateMatches}
              busy={saving}
              showAddDetails={false}
              createSeparateLabel={`Keep contact detail on ${person.person.displayName}`}
              eyebrow="Review contact detail"
              heading="Contact detail already used"
              description={<>This contact detail is already stored for another person. Nothing has been changed.</>}
              onOpenExisting={openExistingContactDuplicate}
              onAddDetails={() => undefined}
              onCreateSeparate={() => void persistContact(contactDuplicateMatches.map((match) => match.person.id))}
              onReturnToEdit={returnToContactEditor}
            />
          )}
        </>
      )}
    </main>
  );
}
