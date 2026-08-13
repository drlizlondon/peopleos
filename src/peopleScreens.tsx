import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import PhoneRegionSelect from "./PhoneRegionSelect";
import {
  createManualContactMethodDraft,
  createManualPersonCaptureDraft,
  prepareManualPersonCapture,
  type ManualPersonCaptureDraft,
  type PreparedManualPersonCapture
} from "./application/manualPersonCapture";
import {
  retryPreparedPersonIPhoneContactSave,
  savePreparedPersonWithOptionalIPhoneContact,
  type IPhoneContactSaveOutcome
} from "./application/appleContacts";
import {
  getIPhoneContactsAdapter,
  isIPhoneContactsSupported
} from "./contacts/capacitorAdapter";
import {
  chooseLinkDetailsForExistingPerson,
  importSelectedContacts,
  prepareContactImportFromPickerResult,
  skipContactImportRow,
  type ContactImportSession
} from "./application/contactImport";
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
  getPersonSearchView,
  MAX_PERSON_SEARCH_QUERY_LENGTH,
  PersonSearchValidationError,
  type PersonSearchFilters,
  type PersonSearchMatch,
  type PersonSearchResult
} from "./application/personSearch";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "./useDebouncedValue";
import { restorePerson } from "./application/personLifecycle";
import {
  getPersonHistory,
  type PersonHistory
} from "./application/interactionQueries";
import { createInteraction, createInteractionDraft } from "./application/interactions";
import {
  createRelationshipClock,
  getRelationshipAssessment
} from "./application/relationshipEngineQueries";
import { resolveContactNowTargets } from "./application/contactNow";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { StaleRevisionError } from "./data/repositories";
import type { ContactCadenceUnit, ContactMethod, Person } from "./domain/schema";
import type { ActiveRelationshipMode, RelationshipMode } from "./domain/relationshipMode";
import { formatContactCadence } from "./domain/cadence";
import type { DuplicateMatch } from "./domain/duplicates";
import { ValidationError } from "./domain/validation";
import type { RelationshipAssessment } from "./relationship-engine";
import {
  ContactValueValidationError,
  formatPhoneNumberForDisplay,
  getPhoneRegionOptions,
  normalizeContactValue
} from "./integrations/contactValues";
import {
  contactMethodsPath,
  editPersonPath,
  postAddRelationshipPath,
  personProfilePath,
  routeFromPath
} from "./navigation";
import { browserPathForLogicalPath, logicalPathFromBrowserPath } from "./platformRouting";
import DuplicateWarningSheet, { type DuplicateLinkSelection } from "./DuplicateWarningSheet";
import { DuplicateReviewRequiredError } from "./application/duplicateReview";
import PersonContactLinkReview, { type PersonContactLinkSelection } from "./PersonContactLinkReview";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

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

function affiliationLine(summary: PersonSummary): string | undefined {
  const affiliation = summary.currentAffiliation;
  if (!affiliation) return undefined;
  return [affiliation.role, affiliation.organisationName].filter(Boolean).join(" · ");
}

type PeopleDirectoryState = {
  query: string;
  filters: PersonSearchFilters;
  scrollY: number;
};

function initialPeopleDirectoryState(): PeopleDirectoryState {
  const saved = window.history.state?.peopleDirectory as Partial<PeopleDirectoryState> | undefined;
  return {
    query: typeof saved?.query === "string" ? saved.query : "",
    filters: saved?.filters && typeof saved.filters === "object" ? saved.filters : { archive: "active" },
    scrollY: typeof saved?.scrollY === "number" ? saved.scrollY : 0
  };
}

function matchExplanation(match: PersonSearchMatch): string | undefined {
  if (match.tier <= 3) return undefined;
  if (match.source === "event") return `Event · ${match.value}`;
  return `${match.label} · ${match.value}`;
}

function resultAffiliation(result: PersonSearchResult): string | undefined {
  if (!result.currentAffiliation) return undefined;
  return [result.currentAffiliation.role, result.currentAffiliation.organisationName].filter(Boolean).join(" · ");
}

function preferredProfileContacts(summary: PersonSummary, phoneRegion: string): ContactMethod[] {
  const validIds = new Set(resolveContactNowTargets(summary.activeContactMethods, phoneRegion)
    .targets.map((target) => target.contactMethodId));
  return (["phone", "email"] as const).flatMap((kind) => {
    const methods = summary.activeContactMethods.filter((contact) => contact.kind === kind && validIds.has(contact.id));
    const selected = methods.find((contact) => contact.isPreferred) ?? methods[0];
    return selected ? [selected] : [];
  });
}

export function PeopleScreen({
  navigate,
  activeMode,
  importedPersonIds = null,
  onClearImportedFilter
}: {
  navigate: Navigate;
  activeMode: ActiveRelationshipMode;
  importedPersonIds?: string[] | null;
  onClearImportedFilter?: () => void;
  relationshipFilter?: ReactNode;
}) {
  const initialStateRef = useRef(initialPeopleDirectoryState());
  const [query, setQuery] = useState(initialStateRef.current.query);
  const [filters, setFilters] = useState<PersonSearchFilters>(initialStateRef.current.filters);
  const [results, setResults] = useState<PersonSearchResult[] | undefined>(undefined);
  const [storedPersonCount, setStoredPersonCount] = useState<number | undefined>(undefined);
  const [fallbackPeople, setFallbackPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const restoredScrollRef = useRef(false);

  useEffect(() => {
    const state = {
      ...(window.history.state ?? {}),
      peopleDirectory: { query, filters, scrollY: window.scrollY }
    };
    window.history.replaceState(state, "", window.location.href);
  }, [filters, query]);

  useEffect(() => {
    const onScroll = () => {
      if (logicalPathFromBrowserPath(window.location.pathname) !== "/people") return;
      window.history.replaceState({
        ...(window.history.state ?? {}),
        peopleDirectory: { query, filters, scrollY: window.scrollY }
      }, "", window.location.href);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [filters, query]);

  // The query is debounced but the filters are not: filters change on a
  // deliberate click, where a delay would only feel like lag.
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    let active = true;
    if (debouncedQuery.length > MAX_PERSON_SEARCH_QUERY_LENGTH) {
      setQueryError(`Search is limited to ${MAX_PERSON_SEARCH_QUERY_LENGTH} characters.`);
      setResults([]);
      setFallbackPeople([]);
      setLoading(false);
      return () => { active = false; };
    }
    setQueryError("");
    setLoading(true);
    setError("");
    getDatabase().then(async (db) => getPersonSearchView(db, {
      clock: createRelationshipClock(),
      activeMode,
      query: debouncedQuery,
      filters
    })).then((view) => {
      if (!active) return;
      setResults(view.results);
      setStoredPersonCount(view.totalPersonCount);
      setFallbackPeople([]);
      setLoading(false);
    }).catch(async (caught) => {
      if (!active) return;
      if (caught instanceof PersonSearchValidationError) {
        setQueryError(caught.message);
        setResults([]);
        setLoading(false);
        return;
      }
      setError("Context search is unavailable. Showing the name-only directory.");
      setResults(undefined);
      try {
        const people = await listPeopleSummaries(
          await getDatabase(),
          activeMode,
          filters.archive === "archived" ? "archived" : "active"
        );
        if (active) setFallbackPeople(people.filter((summary) => {
          const normalizedQuery = debouncedQuery.trim().toLocaleLowerCase("en-US");
          return !normalizedQuery || summary.person.displayName.toLocaleLowerCase("en-US").includes(normalizedQuery);
        }));
      } catch {
        if (active) setFallbackPeople([]);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [activeMode, filters, debouncedQuery, retryVersion]);

  useEffect(() => {
    if (loading || restoredScrollRef.current) return;
    restoredScrollRef.current = true;
    const target = initialStateRef.current.scrollY;
    if (target > 0) requestAnimationFrame(() => window.scrollTo({ top: target, behavior: "instant" }));
  }, [loading]);

  const visibleResults = importedPersonIds
    ? (results ?? []).filter((result) => importedPersonIds.includes(result.person.id))
    : results ?? [];
  const visibleFallback = importedPersonIds
    ? fallbackPeople.filter((summary) => importedPersonIds.includes(summary.person.id))
    : fallbackPeople;
  const noStoredPeople = !loading && !error && storedPersonCount === 0;

  function rememberScroll() {
    window.history.replaceState({
      ...(window.history.state ?? {}),
      peopleDirectory: { query, filters, scrollY: window.scrollY }
    }, "", window.location.href);
  }

  if (loading && results === undefined && storedPersonCount === undefined) {
    return (
      <main className="screen people-screen people-screen-loading" id="main-content" tabIndex={-1} aria-busy="true">
        <header className="page-heading page-heading-with-action">
          <div>
            <p className="eyebrow">People</p>
            <h2>{importedPersonIds ? "Imported people" : "People"}</h2>
          </div>
        </header>
        <p className="screen-status" role="status">Loading people…</p>
      </main>
    );
  }

  if (noStoredPeople) {
    return (
      <main className="screen" id="main-content" tabIndex={-1}>
        <EmptyState
          eyebrow="People"
          title="Your people will appear here."
          description="Add a name now. You can fill in the details later."
          action={(
            <div className="empty-action-stack">
              {actionButton("Add someone", () => navigate("/people/new"))}
              {importAction(navigate, "Import contacts")}
            </div>
          )}
        />
      </main>
    );
  }

  return (
    <main className="screen people-screen" id="main-content" tabIndex={-1} aria-busy={loading || undefined}>
      <header className="page-heading page-heading-with-action">
        <div>
          <p className="eyebrow">People</p>
          <h2>{importedPersonIds ? "Imported people" : "People"}</h2>
          {importedPersonIds && <p>People created or updated in the most recent import.</p>}
        </div>
        <div className="page-actions">
          {importedPersonIds && onClearImportedFilter && (
            <button type="button" onClick={onClearImportedFilter}>Show all people</button>
          )}
          {!importedPersonIds && (
            <button
              className="text-action"
              type="button"
              onClick={() => setFilters((current) => ({
                ...current,
                archive: current.archive === "archived" ? "active" : "archived"
              }))}
            >
              {filters.archive === "archived" ? "Active people" : "Archived"}
            </button>
          )}
        </div>
      </header>
      <div className="people-search-toolbar">
        <div className="form-field people-search-field">
          <label htmlFor="people-search">Search people</label>
          <input
            id="people-search"
            type="search"
            value={query}
            maxLength={MAX_PERSON_SEARCH_QUERY_LENGTH + 1}
            placeholder="Name, organisation, event or memory"
            aria-invalid={Boolean(queryError) || undefined}
            aria-describedby={queryError ? "people-search-error" : undefined}
            onChange={(event) => setQuery(event.target.value)}
          />
          {queryError && <p id="people-search-error" className="field-error" role="alert">{queryError}</p>}
        </div>
      </div>
      {loading && <p className="screen-status" role="status">Updating people…</p>}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetryVersion((current) => current + 1)}>Retry</button>
        </div>
      )}
      {!loading && !error && visibleResults.length > 0 && (
        <ul className="people-list" aria-label="People search results">
          {visibleResults.map((result) => (
            <li key={result.person.id}>
              <a
                href={browserPathForLogicalPath(personProfilePath(result.person.id))}
                onClick={(event) => { event.preventDefault(); rememberScroll(); navigate(personProfilePath(result.person.id)); }}
              >
                <span className="person-list-name">{result.person.displayName}</span>
                <span className="person-list-markers">
                  {result.person.identityStatus === "provisional" && <span className="status-chip">Identity incomplete</span>}
                  {result.person.archivedAt && <span className="status-chip">Archived</span>}
                </span>
                {resultAffiliation(result) && <span className="person-list-detail">{resultAffiliation(result)}</span>}
                {result.recognitionCue && result.recognitionCue.text !== resultAffiliation(result) && (
                  <span className="person-list-detail">{result.recognitionCue.text}</span>
                )}
                {result.match && matchExplanation(result.match) && <span className="person-match-explanation">Matched: {matchExplanation(result.match)}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {!loading && error && visibleFallback.length > 0 && (
        <ul className="people-list" aria-label="Name-only People directory">
          {visibleFallback.map((summary) => (
            <li key={summary.person.id}>
              <a href={browserPathForLogicalPath(personProfilePath(summary.person.id))} onClick={(event) => { event.preventDefault(); rememberScroll(); navigate(personProfilePath(summary.person.id)); }}>
                <span className="person-list-name">{summary.person.displayName}</span>
                {summary.person.identityStatus === "provisional" && <span className="status-chip">Identity incomplete</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && results && results.length === 0 && query.trim() && (
        <section className="profile-card people-no-matches" aria-live="polite">
          <h3>{`No one matches “${query.trim()}”.`}</h3>
          <div className="button-row compact-buttons">
            {query && <button type="button" onClick={() => setQuery("")}>Clear search</button>}
            <button type="button" onClick={() => navigate("/people/new")}>Add new person</button>
          </div>
        </section>
      )}
      {!loading && !error && results?.length === 0 && !query.trim() && (storedPersonCount ?? 0) > 0 && (
        <section className="profile-card people-no-matches" aria-live="polite">
          <h3>{filters.archive === "archived" ? "No archived people." : "No active people."}</h3>
          <p>{filters.archive === "archived"
            ? "Return to your active people."
            : "Archived people remain available with their saved information."}</p>
          <button type="button" onClick={() => setFilters({ archive: filters.archive === "archived" ? "active" : "archived" })}>
            {filters.archive === "archived" ? "Show active people" : "Show archived people"}
          </button>
        </section>
      )}
      {!loading && !error && importedPersonIds && visibleResults.length === 0 && (
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
  cadenceUnit?: ContactCadenceUnit;
};

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? "Check the form and try again.";
  if (error instanceof ContactValueValidationError || error instanceof StaleRevisionError) return error.message;
  return "PeopleOS could not save this yet.";
}

function iPhoneContactPickerError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "picker_busy") return "iPhone Contacts is already open. Close it and try again.";
  if (code === "permission_denied") return "Contacts access was denied. You can still type the mobile number or email manually.";
  if (code === "permission_restricted") return "iPhone Contacts are restricted on this device. You can still add details manually.";
  if (code === "unavailable") return "iPhone Contacts are unavailable right now. You can still add details manually.";
  return "PeopleOS could not open iPhone Contacts. Try again or add the details manually.";
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
  dismiss: _dismiss,
  onDirtyChange,
  onSavingChange,
  iPhoneContactsSupported = false,
  onChooseIPhoneContacts,
  initialCapture,
  defaultRelationshipMode = "personal",
  onOpenDuplicatePerson,
  onCaptureFinished
}: {
  navigate: Navigate;
  dismiss: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  iPhoneContactsSupported?: boolean;
  onChooseIPhoneContacts?: () => Promise<"selected" | "cancelled">;
  initialCapture?: ManualCaptureResumeState | null;
  defaultRelationshipMode?: RelationshipMode;
  onOpenDuplicatePerson: (personId: string, capture: ManualCaptureResumeState) => void;
  onCaptureFinished: () => void;
}) {
  const [draft, setDraft] = useState<ManualPersonCaptureDraft>(() => {
    const baseDraft: ManualPersonCaptureDraft = {
      ...createManualPersonCaptureDraft(),
      relationshipMode: defaultRelationshipMode
    };
    if (!initialCapture) return baseDraft;
    return {
      ...baseDraft,
      ...initialCapture.draft,
      relationshipMode: initialCapture.draft.relationshipMode ?? baseDraft.relationshipMode,
      contactCadence: undefined,
      contactCadenceDays: undefined,
      startDate: undefined
    };
  });
  const [tagsText] = useState(initialCapture?.tagsText ?? "");
  const [defaultPhoneRegion, setDefaultPhoneRegion] = useState("GB");
  const [choosingContacts, setChoosingContacts] = useState(false);
  const [choiceError, setChoiceError] = useState("");
  const [saveToIPhoneContacts, setSaveToIPhoneContacts] = useState(false);
  const [postSaveContactFailure, setPostSaveContactFailure] = useState<{
    prepared: PreparedManualPersonCapture;
    outcome: Extract<IPhoneContactSaveOutcome, { status: "failed" }>;
  } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const preparedRef = useRef<PreparedManualPersonCapture | null>(null);
  const validatedDraftRef = useRef<ManualPersonCaptureDraft | null>(null);
  const submittingRef = useRef(false);
  const dirtyRef = useRef(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const acknowledgedDuplicatePersonIdsRef = useRef<string[]>([]);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([]);

  useEffect(() => {
    if (initialCapture) {
      dirtyRef.current = true;
      onDirtyChange(true);
    }
    getDatabase().then(getAppSettings).then((settings) => setDefaultPhoneRegion(settings.defaultPhoneRegion)).catch(() => undefined);
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

  function validate(): ManualPersonCaptureDraft | undefined {
    const nextErrors: FieldErrors = {};
    const displayName = draft.displayName.trim();
    const hasContactIdentifier = draft.contactMethods.some((contact) => contact.value.trim());
    if (!displayName && !hasContactIdentifier) {
      nextErrors.identity = "Add a name, mobile number or email address.";
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

    if (draft.role?.trim() && !draft.organisationName?.trim()) {
      nextErrors.organisation = "Add an organisation before adding a role.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const focusInvalid = () => {
        const invalid = document.querySelector<HTMLElement>("[aria-invalid='true']");
        if (invalid) invalid.focus();
        else saveButtonRef.current?.focus();
      };
      focusInvalid();
      requestAnimationFrame(focusInvalid);
      return undefined;
    }
    return {
      ...draft,
      displayName,
      tags,
      contactCadence: undefined,
      contactCadenceDays: undefined,
      startDate: undefined
    };
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
    const result = await savePreparedPersonWithOptionalIPhoneContact(await getDatabase(), prepared, {
      saveToIPhoneContacts,
      contactsAdapter: getIPhoneContactsAdapter(),
      localSaveHooks: {
        enforceDuplicateReview: true,
        acknowledgedDuplicatePersonIds
      }
    });
    markCaptureFinished();
    if (result.iPhoneContact.status === "failed") {
      setPostSaveContactFailure({ prepared: result.prepared, outcome: result.iPhoneContact });
      setDuplicateMatches([]);
      return;
    }
    navigate(postAddRelationshipPath(prepared.person.id), { replace: true });
  }

  async function retryIPhoneContactSave() {
    if (!postSaveContactFailure || submittingRef.current) return;
    submittingRef.current = true;
    onSavingChange(true);
    setSaving(true);
    try {
      const outcome = await retryPreparedPersonIPhoneContactSave(
        postSaveContactFailure.prepared,
        getIPhoneContactsAdapter(),
        postSaveContactFailure.outcome.operationId
      );
      if (outcome.status === "failed") {
        setPostSaveContactFailure({ prepared: postSaveContactFailure.prepared, outcome });
        return;
      }
      onSavingChange(false);
      setSaving(false);
      navigate(postAddRelationshipPath(postSaveContactFailure.prepared.person.id), { replace: true });
    } finally {
      submittingRef.current = false;
      onSavingChange(false);
      setSaving(false);
    }
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
        includeDisplayName: selection.includeDisplayName,
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
    onOpenDuplicatePerson(match.person.id, {
      draft: resumeDraft,
      tagsText,
      cadenceText: initialCapture?.cadenceText ?? "",
      cadenceUnit: initialCapture?.cadenceUnit ?? "days"
    });
  }

  function returnToEdit() {
    setDuplicateMatches([]);
    requestAnimationFrame(() => saveButtonRef.current?.focus());
  }

  async function chooseIPhoneContacts() {
    if (!onChooseIPhoneContacts || choosingContacts) return;
    setChoosingContacts(true);
    setChoiceError("");
    try {
      await onChooseIPhoneContacts();
    } catch {
      setChoiceError("PeopleOS could not open iPhone Contacts. Try again.");
    } finally {
      setChoosingContacts(false);
    }
  }

  function enableIPhoneContactFields(checked: boolean) {
    setSaveToIPhoneContacts(checked);
    dirtyRef.current = true;
    onDirtyChange(true);
    if (!checked) return;
    changed((current) => {
      const methods = [...current.contactMethods];
      if (!methods.some((contact) => contact.kind === "phone")) {
        methods.push(createManualContactMethodDraft("phone"));
      }
      if (!methods.some((contact) => contact.kind === "email")) {
        methods.push(createManualContactMethodDraft("email"));
      }
      return { ...current, contactMethods: methods };
    });
  }

  function updateConventionalContact(
    kind: "phone" | "email",
    value: string
  ) {
    changed((current) => {
      const existing = current.contactMethods.find((contact) => contact.kind === kind);
      if (existing) {
        return {
          ...current,
          contactMethods: current.contactMethods.map((contact) => (
            contact.id === existing.id ? { ...contact, value } : contact
          ))
        };
      }
      return {
        ...current,
        contactMethods: [
          ...current.contactMethods,
          { ...createManualContactMethodDraft(kind), value }
        ]
      };
    });
  }

  const phone = draft.contactMethods.find((contact) => contact.kind === "phone");
  const email = draft.contactMethods.find((contact) => contact.kind === "email");

  function contactSaveFailureMessage(): string {
    if (!postSaveContactFailure) return "";
    const name = postSaveContactFailure.prepared.person.displayName;
    if (postSaveContactFailure.outcome.code === "permission_denied") {
      return `${name} is saved in PeopleOS, but Contacts permission was denied. Allow PeopleOS to access Contacts in iPhone Settings, then try again.`;
    }
    if (postSaveContactFailure.outcome.code === "permission_restricted") {
      return `${name} is saved in PeopleOS, but iPhone Contacts are restricted on this device.`;
    }
    if (postSaveContactFailure.outcome.code === "invalid_payload") {
      return `${name} is saved in PeopleOS, but those contact details could not be added to iPhone Contacts.`;
    }
    if (postSaveContactFailure.outcome.code === "unavailable") {
      return `${name} is saved in PeopleOS, but iPhone Contacts are unavailable right now.`;
    }
    return `${name} is saved in PeopleOS, but could not be added to iPhone Contacts.`;
  }

  const canRetryIPhoneContactSave = postSaveContactFailure
    ? !["permission_restricted", "invalid_payload"].includes(postSaveContactFailure.outcome.code)
    : false;

  return (
    <main className="screen form-screen" id="main-content" tabIndex={-1}>
      <header className="page-heading compact-heading">
        <p className="eyebrow">People</p>
        <h2>Add someone</h2>
      </header>

      {postSaveContactFailure && (
        <section className="post-save-contact-result" aria-labelledby="post-save-contact-title">
          <p className="eyebrow">Saved in PeopleOS</p>
          <h3 id="post-save-contact-title">Your person is safe.</h3>
          <p role="alert">{contactSaveFailureMessage()}</p>
          <div className="button-row">
            {canRetryIPhoneContactSave && (
              <button className="primary-action" type="button" disabled={saving} onClick={() => void retryIPhoneContactSave()}>
                {saving ? "Trying again…" : "Try iPhone Contacts again"}
              </button>
            )}
            <button
              className={canRetryIPhoneContactSave ? "secondary-action" : "primary-action"}
              type="button"
              disabled={saving}
              onClick={() => navigate(postAddRelationshipPath(postSaveContactFailure.prepared.person.id), { replace: true })}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {!postSaveContactFailure && <>
        {iPhoneContactsSupported && (
          <section className="add-person-picker-card" aria-labelledby="choose-iphone-contact-heading" aria-busy={choosingContacts}>
            <div>
              <h3 id="choose-iphone-contact-heading">Choose from iPhone Contacts</h3>
              <p>Pick someone already in your contacts.</p>
            </div>
            <button className="primary-action" type="button" disabled={choosingContacts} onClick={() => void chooseIPhoneContacts()}>
              {choosingContacts ? "Opening Contacts…" : "Choose from iPhone Contacts"}
            </button>
            {choiceError && <p className="form-alert" role="alert">{choiceError}</p>}
          </section>
        )}

        {iPhoneContactsSupported && <div className="add-person-divider"><span>or add directly</span></div>}

        <form className="person-form quick-capture-form" onSubmit={save} noValidate>
        <div className="form-field quick-capture-name">
          <label htmlFor="person-display-name">Name <span aria-hidden="true">Optional</span></label>
          <input
            id="person-display-name"
            name="displayName"
            aria-label="Name"
            maxLength={120}
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            value={draft.displayName}
            aria-describedby={errors.displayName
              ? "person-display-name-error"
              : errors.identity ? "person-identity-error" : undefined}
            aria-invalid={Boolean(errors.displayName || errors.identity)}
            onChange={(event) => changed((current) => ({ ...current, displayName: event.target.value, identityStatus: "confirmed" }))}
          />
          {errors.displayName && <p className="field-error" id="person-display-name-error" role="alert">{errors.displayName}</p>}
        </div>

        <section className="quick-contact-fields" aria-label="Contact details">
          <div className="form-field">
            <label htmlFor="person-phone">Mobile <span aria-hidden="true">Optional</span></label>
            <input
              id="person-phone"
              aria-label="Mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="next"
              value={phone?.value ?? ""}
              aria-invalid={Boolean(phone && errors[`contact-${phone.id}`])}
              aria-describedby={phone && errors[`contact-${phone.id}`] ? "person-phone-error" : undefined}
              onChange={(event) => updateConventionalContact("phone", event.target.value)}
            />
            {phone && errors[`contact-${phone.id}`] && (
              <p className="field-error" id="person-phone-error" role="alert">{errors[`contact-${phone.id}`]}</p>
            )}
          </div>
          <div className="form-field">
            <label htmlFor="person-email">Email <span aria-hidden="true">Optional</span></label>
            <input
              id="person-email"
              aria-label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="done"
              value={email?.value ?? ""}
              aria-invalid={Boolean(email && errors[`contact-${email.id}`])}
              aria-describedby={email && errors[`contact-${email.id}`] ? "person-email-error" : undefined}
              onChange={(event) => updateConventionalContact("email", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            {email && errors[`contact-${email.id}`] && (
              <p className="field-error" id="person-email-error" role="alert">{errors[`contact-${email.id}`]}</p>
            )}
          </div>
        </section>

        {errors.identity && <p className="field-error" id="person-identity-error" role="alert">{errors.identity}</p>}

        {iPhoneContactsSupported && (
          <details className="iphone-contact-save-option">
            <summary>Also save to iPhone Contacts</summary>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={saveToIPhoneContacts}
                onChange={(event) => enableIPhoneContactFields(event.target.checked)}
              />
              <span>Save this person to iPhone Contacts too</span>
            </label>
            <p className="field-hint">A one-time copy, not ongoing sync.</p>
          </details>
        )}

        {formError && (
          <div className="form-alert">
            <p role="alert">{formError}</p>
            <p>Nothing partial was saved. Your entries are still here so you can try again.</p>
          </div>
        )}
        <div className="quick-capture-actions form-actions">
          <button ref={saveButtonRef} className="primary-action" type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add to PeopleOS"}
          </button>
        </div>
        <div className="add-person-secondary-actions" aria-label="Other ways to add someone">
          <button className="text-action" type="button" disabled={choosingContacts} onClick={() => navigate("/people/import")}>
            Import contacts
          </button>
        </div>
        </form>
      </>}
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
  const [relationship, setRelationship] = useState<RelationshipAssessment | null | undefined>(undefined);
  const [relationshipError, setRelationshipError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setSummary((current) => current?.person.id === personId ? current : undefined);
    setRelationship(undefined);
    setRelationshipError("");
    setError("");
    const clock = createRelationshipClock();
    getDatabase().then(async (db) => Promise.allSettled([
      getPersonSummary(db, personId),
      getAppSettings(db),
      getRelationshipAssessment(db, personId, clock)
    ])).then(([summaryResult, settingsResult, relationshipResult]) => {
        if (!active) return;
        if (summaryResult.status === "rejected") {
          setError("PeopleOS could not load this person.");
          return;
        }
        setSummary(summaryResult.value ?? null);
        if (settingsResult.status === "fulfilled") setPhoneRegion(settingsResult.value.defaultPhoneRegion);
        if (relationshipResult.status === "fulfilled") {
          setRelationship(relationshipResult.value ?? null);
        } else {
          setRelationshipError("PeopleOS could not calculate this relationship summary.");
        }
      })
      .catch(() => { if (active) setError("PeopleOS could not load this person."); });
    return () => { active = false; };
  }, [personId, refreshVersion]);

  return { summary, phoneRegion, relationship, relationshipError, error };
}

function currentLocalDate(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

export function PersonProfileScreen({
  personId,
  navigate,
  backPath,
  onAddToReachOut: _onAddToReachOut,
  onDirtyChange,
  onSavingChange
}: {
  personId: string;
  navigate: Navigate;
  backPath: string;
  onAddToReachOut: (person: Person, opener: HTMLElement) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const {
    summary,
    phoneRegion,
    relationship,
    relationshipError,
    error
  } = usePerson(personId, refreshVersion);
  const [history, setHistory] = useState<PersonHistory | null | undefined>(undefined);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [contactLinkSession, setContactLinkSession] = useState<ContactImportSession | null>(null);
  const [contactLinkBusy, setContactLinkBusy] = useState(false);
  const [contactLinkError, setContactLinkError] = useState("");
  const [contactLinkStatus, setContactLinkStatus] = useState("");
  const noteSavingRef = useRef(false);
  const noteDirtyRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const contactLinkOpenerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!noteDirtyRef.current) return;
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

  useEffect(() => {
    let active = true;
    setHistory(undefined);
    getDatabase().then((db) => getPersonHistory(db, personId))
      .then((result) => { if (active) setHistory(result ?? null); })
      .catch(() => { if (active) setHistory(null); });
    return () => { active = false; };
  }, [personId, refreshVersion]);

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const summaryText = noteDraft.trim();
    if (!summaryText || noteSavingRef.current || !summary || summary.person.archivedAt) return;
    noteSavingRef.current = true;
    setSavingNote(true);
    onSavingChange(true);
    setNoteError("");
    try {
      const draft = createInteractionDraft(personId, { kind: "note_added" });
      await createInteraction(await getDatabase(), { ...draft, summary: summaryText });
      setNoteDraft("");
      noteDirtyRef.current = false;
      onDirtyChange(false);
      setRefreshVersion((current) => current + 1);
    } catch {
      setNoteError("PeopleOS could not save this note. Your text is still here.");
    } finally {
      noteSavingRef.current = false;
      setSavingNote(false);
      onSavingChange(false);
    }
  }

  async function restoreArchivedPerson() {
    if (!summary?.person.archivedAt || restoring) return;
    setRestoring(true);
    setRestoreError("");
    try {
      await restorePerson(await getDatabase(), {
        personId: summary.person.id,
        expectedRevision: summary.person.revision,
        occurredAt: new Date().toISOString()
      });
      setRefreshVersion((current) => current + 1);
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (caught) {
      setRestoreError(firstIssue(caught));
    } finally {
      setRestoring(false);
    }
  }

  function finishContactLink() {
    setContactLinkSession(null);
    setContactLinkError("");
    requestAnimationFrame(() => contactLinkOpenerRef.current?.focus());
  }

  async function chooseMatchingIPhoneContact() {
    if (!summary || contactLinkBusy) return;
    const adapter = getIPhoneContactsAdapter();
    if (!adapter) {
      setContactLinkError("iPhone Contacts are unavailable right now. You can still add details manually.");
      return;
    }
    setContactLinkBusy(true);
    setContactLinkError("");
    setContactLinkStatus("");
    onSavingChange(true);
    try {
      const result = await adapter.pickContacts();
      const session = await prepareContactImportFromPickerResult(
        await getDatabase(),
        result,
        phoneRegion
      );
      if (!session) return;
      if (session.rows.length === 0) {
        setContactLinkError("No iPhone contact was selected.");
        return;
      }
      setContactLinkSession(session);
    } catch (caught) {
      setContactLinkError(iPhoneContactPickerError(caught));
    } finally {
      setContactLinkBusy(false);
      onSavingChange(false);
    }
  }

  async function addSelectedIPhoneContactDetails(selection: PersonContactLinkSelection) {
    if (!summary || !contactLinkSession || contactLinkBusy) return;
    setContactLinkBusy(true);
    setContactLinkError("");
    setContactLinkStatus("");
    onSavingChange(true);
    try {
      const reviewedSession: ContactImportSession = {
        ...contactLinkSession,
        rows: contactLinkSession.rows.map((row) => row.id === selection.row.id
          ? chooseLinkDetailsForExistingPerson(
              row,
              summary.person,
              selection.contactMethodIds,
              selection.includeAffiliation,
              selection.includeDisplayName
            )
          : skipContactImportRow(row))
      };
      const result = await importSelectedContacts(await getDatabase(), reviewedSession);
      const linkedRow = result.rows.find((row) => row.id === selection.row.id);
      if (!linkedRow || linkedRow.status === "failed") {
        setContactLinkError(linkedRow?.error ?? "PeopleOS could not add those contact details. Nothing was changed.");
        return;
      }
      setContactLinkSession(null);
      setContactLinkStatus(linkedRow.status === "added_details"
        ? `Contact details added to ${summary.person.displayName}.`
        : `Those contact details are already saved for ${summary.person.displayName}.`);
      setRefreshVersion((current) => current + 1);
      requestAnimationFrame(() => contactLinkOpenerRef.current?.focus());
    } catch (caught) {
      setContactLinkError(firstIssue(caught));
    } finally {
      setContactLinkBusy(false);
      onSavingChange(false);
    }
  }

  const requestedBackRoute = routeFromPath(backPath);
  const resumesCapture = backPath === "/people/new";
  const resumesImport = backPath === "/people/import";
  const resumesContactEditor = requestedBackRoute.id === "contact-methods";
  const resumesReachOut = requestedBackRoute.id === "reach-out-detail";
  const resumesToday = requestedBackRoute.id === "today" && window.history.state?.todayOriginPrepared === true;
  const returnsToListOrigin = window.history.state?.navigationOrigin === true
    && ["today", "reach-out", "people", "upcoming"].includes(requestedBackRoute.id);
  const preparedReachOutOrigin = resumesReachOut && window.history.state?.profileOriginPrepared === true;
  const returnsThroughHistory = resumesCapture
    || resumesImport
    || resumesContactEditor
    || resumesToday
    || returnsToListOrigin
    || preparedReachOutOrigin;
  const backRoute = ["today", "reach-out", "people", "upcoming"].includes(requestedBackRoute.id)
    ? requestedBackRoute
    : routeFromPath("/people");
  const contacts = summary ? preferredProfileContacts(summary, phoneRegion) : [];
  const notes = (history?.interactions ?? [])
    .filter((interaction) => interaction.kind === "note_added" && interaction.summary)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const today = currentLocalDate();
  const tomorrow = (() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
  })();
  const nextDate = relationship?.scheduleState.kind === "scheduled"
    ? relationship.scheduleState.localDate
    : undefined;
  const nextLabel = relationship === undefined && !relationshipError
    ? "Loading…"
    : relationshipError
      ? "Unavailable"
    : nextDate && nextDate <= today
      ? "Today"
      : nextDate === tomorrow
        ? "Tomorrow"
        : nextDate
          ? formatLocalDate(nextDate)
          : relationship?.scheduleState.kind === "incomplete_regular_schedule"
            ? "Choose a start date in Edit"
            : "Not scheduled";

  return (
    <main className="screen person-profile-screen simple-person-profile" id="main-content" tabIndex={-1}>
      <button
        className="back-button"
        type="button"
        onClick={() => returnsThroughHistory
          ? window.history.back()
          : resumesReachOut
            ? navigate(backPath, { replace: true, state: {} })
            : navigate(backRoute.path)}
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
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>Retry</button>
        </div>
      )}
      {summary === null && (
        <EmptyState
          eyebrow="People"
          title="Person not found"
          description="This person may have been removed or the link may be out of date."
          action={actionButton("Add someone", () => navigate("/people/new"))}
        />
      )}
      {summary && (
        <>
          <header className="profile-heading simple-profile-heading">
            <div>
              <p className="eyebrow">Person</p>
              <h2 ref={headingRef} tabIndex={-1}>{summary.person.displayName}</h2>
              {affiliationLine(summary) && <p className="profile-affiliation">{affiliationLine(summary)}</p>}
            </div>
            {!summary.person.archivedAt && (
              <button className="secondary-action" type="button" onClick={() => navigate(editPersonPath(summary.person.id))}>Edit</button>
            )}
          </header>

          {summary.person.archivedAt ? (
            <section className="archived-person-banner" aria-labelledby="simple-archived-heading">
              <div>
                <h3 id="simple-archived-heading">Archived</h3>
                <p>Restore this person to include them in PeopleOS again.</p>
              </div>
              <button className="primary-action" type="button" disabled={restoring} onClick={() => void restoreArchivedPerson()}>
                {restoring ? "Restoring…" : "Restore person"}
              </button>
            </section>
          ) : null}
          {restoreError && <p className="form-alert" role="alert">{restoreError}</p>}

          <section className="simple-profile-reference" aria-label="Person details">
            <dl className="profile-details">
              {contacts.map((contact) => (
                <div key={contact.id}>
                  <dt>{contact.kind === "phone" ? "Mobile" : "Email"}</dt>
                  <dd>{displayContact(contact, phoneRegion)}</dd>
                </div>
              ))}
              <div>
                <dt>Contact every</dt>
                <dd>{summary.person.contactCadence ? formatContactCadence(summary.person.contactCadence) : "Not set"}</dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>{nextLabel}</dd>
              </div>
            </dl>
            {!summary.person.archivedAt && (
              <div className="button-row compact-buttons" aria-label="Contact detail actions">
                <button className="text-action" type="button" onClick={() => navigate(contactMethodsPath(summary.person.id))}>
                  {contacts.length === 0 ? "Add contact details" : "Edit contact details"}
                </button>
                {isIPhoneContactsSupported() && (
                  <button
                    ref={contactLinkOpenerRef}
                    className="text-action"
                    type="button"
                    disabled={contactLinkBusy}
                    onClick={() => void chooseMatchingIPhoneContact()}
                  >
                    {contactLinkBusy && !contactLinkSession ? "Opening Contacts…" : "Link iPhone contact"}
                  </button>
                )}
              </div>
            )}
          </section>

          {contactLinkStatus && <p className="undo-message" role="status">{contactLinkStatus}</p>}
          {contactLinkError && !contactLinkSession && <p className="form-alert" role="alert">{contactLinkError}</p>}
          {contactLinkSession && (
            <PersonContactLinkReview
              key={contactLinkSession.id}
              session={contactLinkSession}
              targetPerson={summary.person}
              targetContactMethods={summary.activeContactMethods}
              busy={contactLinkBusy}
              error={contactLinkError}
              onCancel={finishContactLink}
              onSubmit={(selection) => void addSelectedIPhoneContactDetails(selection)}
            />
          )}

          <section className="simple-notes" aria-labelledby="simple-notes-heading">
            <h3 id="simple-notes-heading">Notes</h3>
            {notes.length > 0 && (
              <div className="saved-notes" aria-label="Saved notes">
                {notes.map((note) => <p key={note.id}>{note.summary}</p>)}
              </div>
            )}
            {!summary.person.archivedAt && (
              <form onSubmit={saveNote}>
                <label className="visually-hidden" htmlFor="person-note">Note</label>
                <textarea
                  id="person-note"
                  rows={4}
                  maxLength={5_000}
                  value={noteDraft}
                  placeholder="Write something you want to remember."
                  onChange={(event) => {
                    setNoteDraft(event.target.value);
                    setNoteError("");
                    noteDirtyRef.current = event.target.value.length > 0;
                    onDirtyChange(noteDirtyRef.current);
                  }}
                />
                {noteError && <p className="field-error" role="alert">{noteError}</p>}
                <button className="primary-action" type="submit" disabled={savingNote || !noteDraft.trim()}>
                  {savingNote ? "Saving…" : "Save note"}
                </button>
              </form>
            )}
          </section>
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
  autoAddPhone = false,
  backLabel = "Person",
  onBack,
  onOpenDuplicatePerson,
  onEditorFinished
}: {
  personId: string;
  navigate: Navigate;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  initialEditor?: ContactEditorResumeState | null;
  autoAddPhone?: boolean;
  backLabel?: "Today" | "Person";
  onBack?: () => void;
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
  const autoAddStartedRef = useRef(false);

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

  useEffect(() => {
    if (!autoAddPhone || !person || person.person.archivedAt || person.person.identityStatus === "merged" || editor || autoAddStartedRef.current) return;
    autoAddStartedRef.current = true;
    editorOpenerIdRef.current = "add-phone-contact";
    setEditorDirty(false);
    setEditor({ mode: "add", draft: createContactMethodDraft(personId, "phone") });
  }, [autoAddPhone, editor, person, personId]);

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
    if (autoAddPhone && onBack) {
      onBack();
      return;
    }
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
    let returnToTodayAfterSave = false;
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
      if (autoAddPhone && onBack) {
        returnToTodayAfterSave = true;
      } else {
        returnFocusToEditorOpener();
      }
    } catch (error) {
      if (error instanceof DuplicateReviewRequiredError && person) {
        acknowledgedContactDuplicatePersonIdsRef.current = cumulativeAcknowledgedPersonIds;
        setContactDuplicateCandidateState(contactDuplicateCandidate(person, editor, phoneRegion, contacts));
        setContactDuplicateMatches(error.matches);
      } else if (error instanceof ContactValueValidationError) {
        setFieldError(error.message);
        requestAnimationFrame(() => editorValueRef.current?.focus());
      }
      else {
        setPageError(firstIssue(error));
        requestAnimationFrame(() => editorValueRef.current?.focus());
      }
    } finally {
      endMutation();
      if (returnToTodayAfterSave) onBack?.();
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
  const editable = Boolean(person && !person.person.archivedAt && person.person.identityStatus !== "merged");

  return (
    <main className="screen contact-methods-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => onBack ? onBack() : navigate(personProfilePath(personId))} disabled={saving}>
        ← {backLabel}
      </button>
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
          {!editable && (
            <p className="archived-notice" role="status">This person is archived. Contact details are read-only until you restore them.</p>
          )}
          <section className="profile-card" aria-labelledby="active-contact-heading">
            <div className="card-heading-with-action contact-heading-actions">
              <div>
                <h3 id="active-contact-heading">Current details</h3>
                <p>The first saved phone and email become preferred by default.</p>
              </div>
              {editable && (
                <div className="button-row compact-buttons">
                  <button id="add-phone-contact" type="button" onClick={(event) => startAdd("phone", event.currentTarget)} disabled={saving}>Add phone</button>
                  <button id="add-email-contact" type="button" onClick={(event) => startAdd("email", event.currentTarget)} disabled={saving}>Add email</button>
                </div>
              )}
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
                      {editable && (
                        <>
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
                        </>
                      )}
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
          {editable && editor && contactDuplicateMatches.length === 0 && (
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
                      <div className="form-field phone-region-field">
                        <label htmlFor="contact-editor-region">Phone region</label>
                        <PhoneRegionSelect
                          id="contact-editor-region"
                          value={editor.draft.region ?? phoneRegion}
                          options={phoneRegionOptions}
                          onChange={(region) => changeEditor({ region })}
                        />
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
