import {
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import InteractionEditorSheet from "./InteractionEditorSheet";
import FactEditorSheet from "./FactEditorSheet";
import FollowUpEditorSheet from "./FollowUpEditorSheet";
import CadenceEditorSheet from "./CadenceEditorSheet";
import TimelineList from "./TimelineList";
import ReachOutCompletionSheet from "./ReachOutCompletionSheet";
import { ContactMethodChoiceSheet } from "./TodaySheets";
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
  getPersonSearchView,
  MAX_PERSON_SEARCH_QUERY_LENGTH,
  PersonSearchValidationError,
  type PersonFilterOptions,
  type PersonSearchFilters,
  type PersonSearchMatch,
  type PersonSearchResult
} from "./application/personSearch";
import { restorePerson } from "./application/personLifecycle";
import {
  getPersonHistory,
  type PersonHistory,
  type TimelineDisplayItem
} from "./application/interactionQueries";
import {
  listPersonMemoryFacts,
  memoryFactKindLabel,
  memoryFactValueLabel,
  selectCompactProfileFacts
} from "./application/memoryFacts";
import {
  createRelationshipClock,
  getRelationshipAssessment
} from "./application/relationshipEngineQueries";
import {
  getNextPlanForPerson,
  type NextPlanProjection
} from "./application/followUpQueries";
import {
  getCurrentReachOutForPerson,
  getReachOutDetail,
  listReachOutHistoryForPerson,
  type ReachOutDetail
} from "./application/reachOutQueries";
import {
  contactNowTargetHref,
  getContactNowProjection,
  revalidateContactNowTarget,
  resolveContactNowTargets,
  type ContactNowProjection,
  type ContactNowTarget
} from "./application/contactNow";
import {
  prepareReachOutStatusCommand,
  removeReachOut
} from "./application/reachOut";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { StaleRevisionError } from "./data/repositories";
import type { ContactMethod, FollowUp, Interaction, InteractionKind, MemoryFact, Person, ReachOutEntry } from "./domain/schema";
import { effectiveFollowUpDate, FOLLOW_UP_ACTION_OPTIONS } from "./domain/followUpPolicy";
import type { DuplicateMatch } from "./domain/duplicates";
import { ValidationError } from "./domain/validation";
import {
  formatExplanation,
  relationshipStageLabel,
  type RelationshipAssessment
} from "./relationship-engine";
import {
  ContactValueValidationError,
  formatPhoneNumberForDisplay,
  getPhoneRegionOptions,
  normalizeContactValue
} from "./integrations/contactValues";
import { openContactHandoff } from "./integrations/contactHandoff";
import {
  affiliationsPath,
  contactMethodsPath,
  editPersonPath,
  memoryFactsPath,
  followUpDetailPath,
  personFollowUpsPath,
  personProfilePath,
  routeFromPath,
  reachOutDetailPath,
  resolveProvisionalPath,
  resolvePersonPath,
  timelinePath
} from "./navigation";
import DuplicateWarningSheet, { type DuplicateLinkSelection } from "./DuplicateWarningSheet";
import { DuplicateReviewRequiredError } from "./application/duplicateReview";
import PeopleFilterSheet from "./PeopleFilterSheet";

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

const EMPTY_PERSON_FILTER_OPTIONS: PersonFilterOptions = {
  tags: [],
  currentOrganisations: [],
  events: [],
  relationshipStages: []
};

function initialPeopleDirectoryState(): PeopleDirectoryState {
  const saved = window.history.state?.peopleDirectory as Partial<PeopleDirectoryState> | undefined;
  return {
    query: typeof saved?.query === "string" ? saved.query : "",
    filters: saved?.filters && typeof saved.filters === "object" ? saved.filters : { archive: "active" },
    scrollY: typeof saved?.scrollY === "number" ? saved.scrollY : 0
  };
}

function peopleFilterCount(filters: PersonSearchFilters): number {
  return (filters.tags?.length ?? 0)
    + (filters.currentOrganisations?.length ?? 0)
    + (filters.eventIds?.length ?? 0)
    + (filters.relationshipStages?.length ?? 0)
    + Number(filters.hasDueFollowUp === true)
    + Number(filters.missingContactDetails === true)
    + Number(Boolean(filters.archive && filters.archive !== "active"));
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
  importedPersonIds = null,
  onClearImportedFilter
}: {
  navigate: Navigate;
  importedPersonIds?: string[] | null;
  onClearImportedFilter?: () => void;
}) {
  const initialStateRef = useRef(initialPeopleDirectoryState());
  const [query, setQuery] = useState(initialStateRef.current.query);
  const [filters, setFilters] = useState<PersonSearchFilters>(initialStateRef.current.filters);
  const [results, setResults] = useState<PersonSearchResult[] | undefined>(undefined);
  const [filterOptions, setFilterOptions] = useState<PersonFilterOptions>(EMPTY_PERSON_FILTER_OPTIONS);
  const [storedPersonCount, setStoredPersonCount] = useState<number | undefined>(undefined);
  const [fallbackPeople, setFallbackPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const filterOpenerRef = useRef<HTMLButtonElement>(null);
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
      if (window.location.pathname !== "/people") return;
      window.history.replaceState({
        ...(window.history.state ?? {}),
        peopleDirectory: { query, filters, scrollY: window.scrollY }
      }, "", window.location.href);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [filters, query]);

  useEffect(() => {
    let active = true;
    if (query.length > MAX_PERSON_SEARCH_QUERY_LENGTH) {
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
      query,
      filters
    })).then((view) => {
      if (!active) return;
      setResults(view.results);
      setFilterOptions(view.filterOptions);
      setStoredPersonCount(view.totalPersonCount);
      setFallbackPeople([]);
    }).catch(async (caught) => {
      if (!active) return;
      if (caught instanceof PersonSearchValidationError) {
        setQueryError(caught.message);
        setResults([]);
        return;
      }
      setError("Context search is unavailable. Showing the name-only directory.");
      setResults(undefined);
      try {
        const people = await listPeopleSummaries(await getDatabase());
        if (active) setFallbackPeople(people.filter((summary) => {
          const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
          return !normalizedQuery || summary.person.displayName.toLocaleLowerCase("en-US").includes(normalizedQuery);
        }));
      } catch {
        if (active) setFallbackPeople([]);
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, query, retryVersion]);

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

  function removeFilter<K extends "tags" | "currentOrganisations" | "eventIds" | "relationshipStages">(key: K, value: NonNullable<PersonSearchFilters[K]>[number]) {
    setFilters((current) => ({ ...current, [key]: (current[key] ?? []).filter((candidate) => candidate !== value) }));
  }

  function clearFilters() {
    setFilters({ archive: "active" });
  }

  if (noStoredPeople) {
    return (
      <main className="screen" id="main-content" tabIndex={-1}>
        <EmptyState
          eyebrow="People"
          title="Your people will appear here."
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
          <h2>{importedPersonIds ? "Imported people" : "Find a person"}</h2>
          <p>{importedPersonIds
            ? "People created or updated in the most recent import."
            : "Search by name or by the context you remember."}</p>
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
        <button
          ref={filterOpenerRef}
          className="secondary-action"
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(true)}
        >Filters{peopleFilterCount(filters) ? ` (${peopleFilterCount(filters)})` : ""}</button>
      </div>
      {peopleFilterCount(filters) > 0 && (
        <div className="active-filter-chips" aria-label="Active People filters">
          {filters.tags?.map((value) => <button key={`tag-${value}`} type="button" onClick={() => removeFilter("tags", value)}>Tag: {value} ×</button>)}
          {filters.currentOrganisations?.map((value) => <button key={`org-${value}`} type="button" onClick={() => removeFilter("currentOrganisations", value)}>Organisation: {value} ×</button>)}
          {filters.eventIds?.map((value) => <button key={`event-${value}`} type="button" onClick={() => removeFilter("eventIds", value)}>Event: {filterOptions.events.find((event) => event.id === value)?.name ?? value} ×</button>)}
          {filters.relationshipStages?.map((value) => <button key={`stage-${value}`} type="button" onClick={() => removeFilter("relationshipStages", value)}>Stage: {relationshipStageLabel(value)} ×</button>)}
          {filters.hasDueFollowUp && <button type="button" onClick={() => setFilters((current) => ({ ...current, hasDueFollowUp: undefined }))}>Has due follow-up ×</button>}
          {filters.missingContactDetails && <button type="button" onClick={() => setFilters((current) => ({ ...current, missingContactDetails: undefined }))}>Missing contact details ×</button>}
          {filters.archive && filters.archive !== "active" && <button type="button" onClick={() => setFilters((current) => ({ ...current, archive: "active" }))}>{filters.archive === "archived" ? "Archived" : "Active and archived"} ×</button>}
          <button className="clear-filter-chip" type="button" onClick={clearFilters}>Clear all</button>
        </div>
      )}
      {loading && <p className="screen-status" role="status">Loading people…</p>}
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
                href={personProfilePath(result.person.id)}
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
              <a href={personProfilePath(summary.person.id)} onClick={(event) => { event.preventDefault(); rememberScroll(); navigate(personProfilePath(summary.person.id)); }}>
                <span className="person-list-name">{summary.person.displayName}</span>
                {summary.person.identityStatus === "provisional" && <span className="status-chip">Identity incomplete</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && results && results.length === 0 && (query.trim() || peopleFilterCount(filters) > 0) && (
        <section className="profile-card people-no-matches" aria-live="polite">
          <h3>{query.trim() ? `No one matches “${query.trim()}”.` : "No one matches these filters."}</h3>
          <div className="button-row compact-buttons">
            {query && <button type="button" onClick={() => setQuery("")}>Clear search</button>}
            {peopleFilterCount(filters) > 0 && <button type="button" onClick={() => setFiltersOpen(true)}>Adjust filters</button>}
            <button type="button" onClick={() => navigate("/people/new")}>Add new person</button>
          </div>
        </section>
      )}
      {!loading && !error && results?.length === 0 && !query.trim() && peopleFilterCount(filters) === 0 && (storedPersonCount ?? 0) > 0 && (
        <section className="profile-card people-no-matches" aria-live="polite">
          <h3>No active people.</h3>
          <p>Archived people remain available when you need their history.</p>
          <button type="button" onClick={() => setFilters({ archive: "archived" })}>Show archived people</button>
        </section>
      )}
      {!loading && !error && importedPersonIds && visibleResults.length === 0 && (
        <p className="screen-status">No imported people are available in this session.</p>
      )}
      {filtersOpen && (
        <PeopleFilterSheet
          filters={filters}
          options={filterOptions}
          onClose={() => { setFiltersOpen(false); requestAnimationFrame(() => filterOpenerRef.current?.focus()); }}
          onApply={(next) => {
            setFilters(next);
            setFiltersOpen(false);
            requestAnimationFrame(() => filterOpenerRef.current?.focus());
          }}
        />
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

function followUpActionLabel(followUp: FollowUp): string {
  return FOLLOW_UP_ACTION_OPTIONS.find((option) => option.value === followUp.actionType)?.label ?? "Other";
}

function followUpTimingLabel(followUp: FollowUp, localDate: string): string {
  const effectiveDate = effectiveFollowUpDate(followUp);
  if (effectiveDate < localDate) return `Overdue · ${formatLocalDate(effectiveDate)}`;
  if (effectiveDate === localDate) return "Due today";
  return `${followUp.snoozedUntilDate ? "Snoozed until" : "Due"} ${formatLocalDate(effectiveDate)}`;
}

export function PersonProfileScreen({
  personId,
  navigate,
  backPath,
  onAddToReachOut
}: {
  personId: string;
  navigate: Navigate;
  backPath: string;
  onAddToReachOut: (person: Person, opener: HTMLElement) => void;
}) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const { summary, phoneRegion, relationship, relationshipError, error } = usePerson(personId, refreshVersion);
  const [history, setHistory] = useState<PersonHistory | null | undefined>(undefined);
  const [historyError, setHistoryError] = useState("");
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[] | undefined>(undefined);
  const [memoryError, setMemoryError] = useState("");
  const [nextPlan, setNextPlan] = useState<NextPlanProjection | null | undefined>(undefined);
  const [planError, setPlanError] = useState("");
  const [reachOut, setReachOut] = useState<ReachOutDetail | null | undefined>(undefined);
  const [reachOutHistory, setReachOutHistory] = useState<ReachOutEntry[]>([]);
  const [reachOutError, setReachOutError] = useState("");
  const [reachOutCompletionOpen, setReachOutCompletionOpen] = useState(false);
  const [reachOutRemoving, setReachOutRemoving] = useState(false);
  const [restoringPerson, setRestoringPerson] = useState(false);
  const restoreAttemptTimeRef = useRef<string | null>(null);
  const [personActionError, setPersonActionError] = useState("");
  const [contactChoice, setContactChoice] = useState<{ projection: ContactNowProjection; error?: string; copyValue?: string } | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [editor, setEditor] = useState<{ interaction?: TimelineDisplayItem["interaction"]; initialKind?: InteractionKind } | null>(null);
  const [followUpEditorOpen, setFollowUpEditorOpen] = useState(false);
  const [cadenceEditorOpen, setCadenceEditorOpen] = useState(false);
  const [factEditor, setFactEditor] = useState<{ sourceInteractionId?: string } | null>(null);
  const [memoryChoiceOpen, setMemoryChoiceOpen] = useState(false);
  const [promotionNoteId, setPromotionNoteId] = useState<string | null>(null);
  const editorOpenerRef = useRef<HTMLElement | null>(null);
  const planOpenerRef = useRef<HTMLElement | null>(null);
  const profileHeadingRef = useRef<HTMLHeadingElement>(null);
  const memoryChoiceFirstRef = useRef<HTMLButtonElement>(null);
  const reachOutOpenerRef = useRef<HTMLElement | null>(null);
  const contactOpenerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    setHistory(undefined);
    setHistoryError("");
    getDatabase().then((db) => getPersonHistory(db, personId)).then((result) => {
      if (active) setHistory(result ?? null);
    }).catch(() => { if (active) setHistoryError("PeopleOS could not load recent history."); });
    return () => { active = false; };
  }, [personId, refreshVersion]);

  useEffect(() => {
    let active = true;
    setReachOut(undefined);
    setReachOutHistory([]);
    setReachOutError("");
    getDatabase().then(async (db) => {
      const [current, entries] = await Promise.all([
        getCurrentReachOutForPerson(db, personId),
        listReachOutHistoryForPerson(db, personId)
      ]);
      const detail = current ? await getReachOutDetail(db, current.id, currentLocalDate()) : undefined;
      return { detail, entries };
    }).then(({ detail, entries }) => {
      if (!active) return;
      setReachOut(detail ?? null);
      setReachOutHistory(entries);
    }).catch(() => { if (active) setReachOutError("PeopleOS could not load this Person’s Reach Out plan."); });
    return () => { active = false; };
  }, [personId, refreshVersion]);

  useEffect(() => {
    let active = true;
    setNextPlan(undefined);
    setPlanError("");
    getDatabase().then((db) => getNextPlanForPerson(db, personId, currentLocalDate())).then((result) => {
      if (active) setNextPlan(result);
    }).catch(() => { if (active) setPlanError("PeopleOS could not load this person's follow-up plan."); });
    return () => { active = false; };
  }, [personId, refreshVersion]);

  useEffect(() => {
    let active = true;
    setMemoryFacts(undefined);
    setMemoryError("");
    getDatabase().then((db) => listPersonMemoryFacts(db, personId)).then((result) => {
      if (active) setMemoryFacts(result.active);
    }).catch(() => { if (active) setMemoryError("PeopleOS could not load memory facts."); });
    return () => { active = false; };
  }, [personId, refreshVersion]);

  useEffect(() => {
    if (memoryChoiceOpen) requestAnimationFrame(() => memoryChoiceFirstRef.current?.focus());
  }, [memoryChoiceOpen]);

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

  function finishInteraction(saved: Interaction) {
    setEditor(null);
    if (saved.kind === "note_added") setPromotionNoteId(saved.id);
    setRefreshVersion((current) => current + 1);
    requestAnimationFrame(() => profileHeadingRef.current?.focus());
  }

  function finishInteractionDelete() {
    setEditor(null);
    setPromotionNoteId(null);
    setRefreshVersion((current) => current + 1);
    requestAnimationFrame(() => profileHeadingRef.current?.focus());
  }

  function openMemoryChoice(opener: HTMLElement) {
    editorOpenerRef.current = opener;
    setMemoryChoiceOpen(true);
  }

  function chooseMemoryFact() {
    setMemoryChoiceOpen(false);
    setFactEditor({});
  }

  function chooseNote() {
    setMemoryChoiceOpen(false);
    setEditor({ initialKind: "note_added" });
  }

  function closeFactEditor() {
    setFactEditor(null);
    requestAnimationFrame(() => {
      if (editorOpenerRef.current?.isConnected) editorOpenerRef.current.focus();
      else profileHeadingRef.current?.focus();
    });
  }

  function finishFact() {
    setFactEditor(null);
    setPromotionNoteId(null);
    setRefreshVersion((current) => current + 1);
    requestAnimationFrame(() => profileHeadingRef.current?.focus());
  }

  function openTimelineInteraction(item: TimelineDisplayItem, opener: HTMLElement) {
    if (item.interaction && item.editable) openInteraction(opener, undefined, item.interaction);
  }

  function openFollowUpEditor(opener: HTMLElement) {
    planOpenerRef.current = opener;
    setFollowUpEditorOpen(true);
  }

  function openCadenceEditor(opener: HTMLElement) {
    planOpenerRef.current = opener;
    setCadenceEditorOpen(true);
  }

  function closePlanEditor() {
    setFollowUpEditorOpen(false);
    setCadenceEditorOpen(false);
    requestAnimationFrame(() => {
      if (planOpenerRef.current?.isConnected) planOpenerRef.current.focus();
      else profileHeadingRef.current?.focus();
    });
  }

  function finishPlanEditor() {
    setFollowUpEditorOpen(false);
    setCadenceEditorOpen(false);
    setRefreshVersion((current) => current + 1);
    requestAnimationFrame(() => profileHeadingRef.current?.focus());
  }

  function finishReachOutMutation() {
    setReachOutCompletionOpen(false);
    setRefreshVersion((current) => current + 1);
    requestAnimationFrame(() => profileHeadingRef.current?.focus());
  }

  async function removeCurrentReachOut() {
    if (!reachOut || !window.confirm("Remove this plan from Reach Out? Its history and Person will be kept.")) return;
    setReachOutRemoving(true);
    setReachOutError("");
    try {
      await removeReachOut(
        await getDatabase(),
        prepareReachOutStatusCommand(
          reachOut.entry,
          reachOut.person,
          reachOut.currentFollowUp,
          "removed"
        )
      );
      finishReachOutMutation();
    } catch {
      setReachOutError("PeopleOS could not remove this Reach Out plan. It is unchanged.");
      requestAnimationFrame(() => reachOutOpenerRef.current?.focus());
    } finally {
      setReachOutRemoving(false);
    }
  }

  async function restoreArchivedPerson() {
    if (!summary?.person.archivedAt || restoringPerson) return;
    setRestoringPerson(true);
    setPersonActionError("");
    const occurredAt = restoreAttemptTimeRef.current ?? new Date().toISOString();
    restoreAttemptTimeRef.current = occurredAt;
    try {
      await restorePerson(await getDatabase(), {
        personId: summary.person.id,
        expectedRevision: summary.person.revision,
        occurredAt
      });
      restoreAttemptTimeRef.current = null;
      setRefreshVersion((current) => current + 1);
      requestAnimationFrame(() => profileHeadingRef.current?.focus());
    } catch (caught) {
      setPersonActionError(firstIssue(caught));
    } finally {
      setRestoringPerson(false);
    }
  }

  function closeContactChoice() {
    setContactChoice(null);
    requestAnimationFrame(() => contactOpenerRef.current?.focus());
  }

  function openProfileContactMethods(autoAddPhone = false) {
    setContactChoice(null);
    navigate(contactMethodsPath(personId), {
      state: {
        fromPath: personProfilePath(personId),
        fromProfile: true,
        ...(autoAddPhone ? { autoAddPhone: true } : {})
      }
    });
  }

  function openIdentityResolution() {
    navigate(reachOut ? resolveProvisionalPath(reachOut.entry.id) : resolvePersonPath(personId), {
      replace: true,
      state: {
        ...(window.history.state ?? {}),
        resolverProfileReturn: true,
        resolverPersonId: personId
      }
    });
  }

  async function launchProfileTarget(target: ContactNowTarget) {
    setContactBusy(true);
    setPersonActionError("");
    try {
      const current = await revalidateContactNowTarget(await getDatabase(), personId, target);
      if (!current) {
        const projection = await getContactNowProjection(await getDatabase(), personId);
        setContactChoice({ projection, error: "That contact method is no longer available. Choose another option." });
        return;
      }
      await openContactHandoff(contactNowTargetHref(current));
      closeContactChoice();
    } catch {
      const projection = await getContactNowProjection(await getDatabase(), personId).catch(() => contactChoice?.projection ?? { targets: [], hasActivePhone: false });
      setContactChoice({
        projection,
        error: "PeopleOS could not open that contact method. Copy it, choose another option, or manage contact details.",
        copyValue: target.canonicalValue
      });
    } finally {
      setContactBusy(false);
    }
  }

  async function contactFromProfile(opener: HTMLButtonElement) {
    if (contactBusy) return;
    contactOpenerRef.current = opener;
    setContactBusy(true);
    setPersonActionError("");
    try {
      const projection = await getContactNowProjection(await getDatabase(), personId);
      if (projection.targets.length === 0) {
        openProfileContactMethods();
      } else if (projection.targets.length === 1) {
        await launchProfileTarget(projection.targets[0]);
      } else {
        setContactChoice({ projection });
      }
    } catch {
      setPersonActionError("PeopleOS could not check contact details yet.");
      requestAnimationFrame(() => opener.focus());
    } finally {
      setContactBusy(false);
    }
  }

  async function copyProfileContact(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setContactChoice((current) => current ? { ...current, error: "Contact detail copied." } : current);
    } catch {
      setContactChoice((current) => current ? { ...current, error: "PeopleOS could not copy that contact detail. You can still select it manually." } : current);
    }
  }

  const requestedBackRoute = routeFromPath(backPath);
  const resumesCapture = backPath === "/people/new";
  const resumesImport = backPath === "/people/import";
  const resumesContactEditor = requestedBackRoute.id === "contact-methods";
  const resumesFollowUp = requestedBackRoute.id === "follow-up-detail";
  const resumesReachOut = requestedBackRoute.id === "reach-out-detail";
  const resumesToday = requestedBackRoute.id === "today" && window.history.state?.todayOriginPrepared === true;
  const returnsToListOrigin = window.history.state?.navigationOrigin === true
    && ["today", "reach-out", "people", "upcoming"].includes(requestedBackRoute.id);
  const resumesPreviousFlow = resumesCapture || resumesImport || resumesContactEditor || resumesFollowUp || resumesReachOut || resumesToday || returnsToListOrigin;
  const preparedReachOutOrigin = resumesReachOut && window.history.state?.profileOriginPrepared === true;
  const returnsThroughHistory = (resumesPreviousFlow && !resumesReachOut) || preparedReachOutOrigin;
  const backRoute = ["today", "reach-out", "people", "upcoming"].includes(requestedBackRoute.id)
    ? requestedBackRoute
    : routeFromPath("/people");
  const memoryCue = relationship?.memoryCue;
  const compactFacts = selectCompactProfileFacts(memoryFacts ?? [], {
    excludeFactId: memoryCue?.source === "memory_fact" ? memoryCue.sourceId : undefined
  });
  const communicationPreference = (memoryFacts ?? [])
    .find((fact) => fact.kind === "communication_preference");
  const relationshipReady = relationship !== undefined || Boolean(relationshipError);
  const preferredContacts = summary ? preferredProfileContacts(summary, phoneRegion) : [];
  return (
    <main className="screen person-profile-screen" id="main-content" tabIndex={-1}>
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
              : resumesFollowUp
                ? "Back to follow-up"
              : resumesReachOut
                ? "Back to Reach Out plan"
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
          action={actionButton("Add person", () => navigate("/people/new"))}
        />
      )}
      {summary && (
        <>
          <header className="profile-heading">
            <p className="eyebrow">Person</p>
            <h2 ref={profileHeadingRef} tabIndex={-1}>{summary.person.displayName}</h2>
            {summary.person.identityStatus === "provisional" && (
              <div className="identity-note">
                <p><span className="status-chip">Identity incomplete</span> Add their confirmed name whenever you learn it.</p>
                {!summary.person.archivedAt && <button className="text-action" type="button" onClick={openIdentityResolution}>Complete identity</button>}
              </div>
            )}
            {affiliationLine(summary) && <p className="profile-affiliation">{affiliationLine(summary)}</p>}
            {preferredContacts.length > 0 && (
              <p className="profile-contact-summary">
                {preferredContacts.map((contact) => `${contact.label || (contact.kind === "phone" ? "Phone" : "Email")}: ${displayContact(contact, phoneRegion)}`).join(" · ")}
              </p>
            )}
          </header>
          {summary.person.archivedAt && (
            <section className="archived-person-banner" aria-labelledby="archived-person-heading">
              <div>
                <h3 id="archived-person-heading">Archived person</h3>
                <p>History and plans are preserved. Restore this person to include them in Today, Upcoming, Reach Out and default People results.</p>
              </div>
              <button className="primary-action" type="button" onClick={() => void restoreArchivedPerson()} disabled={restoringPerson}>
                {restoringPerson ? "Restoring…" : "Restore person"}
              </button>
            </section>
          )}
          {personActionError && <p className="form-alert" role="alert">{personActionError}</p>}
          {!summary.person.archivedAt && summary.person.identityStatus !== "merged" && (
            <div className="profile-action-row" role="group" aria-label="Person actions">
              <button className="primary-action" type="button" disabled={contactBusy} onClick={(event) => void contactFromProfile(event.currentTarget)}>
                {contactBusy ? "Checking…" : preferredContacts.length > 0 ? "Contact now" : "Add contact details"}
              </button>
              <button className="secondary-action" type="button" onClick={(event) => openInteraction(event.currentTarget)}>
                Log interaction
              </button>
              <button className="secondary-action" type="button" onClick={(event) => openFollowUpEditor(event.currentTarget)}>
                Plan follow-up
              </button>
              <button
                className="secondary-action"
                type="button"
                aria-expanded={memoryChoiceOpen}
                aria-controls="profile-memory-choice"
                onClick={(event) => openMemoryChoice(event.currentTarget)}
              >
                Add memory
              </button>
              <button className="secondary-action" type="button" onClick={(event) => openCadenceEditor(event.currentTarget)}>
                Cadence
              </button>
              <button className="secondary-action" type="button" onClick={() => navigate(editPersonPath(summary.person.id))}>
                Edit person
              </button>
            </div>
          )}
          {summary.person.archivedAt && (
            <div className="profile-archived-links">
              <button className="secondary-action" type="button" onClick={() => navigate(personFollowUpsPath(summary.person.id))}>View follow-up history</button>
              <button className="secondary-action" type="button" onClick={() => navigate(editPersonPath(summary.person.id))}>Archived details</button>
            </div>
          )}
          {memoryChoiceOpen && (
            <section className="memory-choice-panel" id="profile-memory-choice" aria-label="Choose memory type">
              <div>
                <strong>What would you like to add?</strong>
                <p>A fact stays easy to find. A note keeps dated narrative in the timeline.</p>
              </div>
              <div className="button-row compact-buttons">
                <button ref={memoryChoiceFirstRef} className="primary-action" type="button" onClick={chooseMemoryFact}>Memory fact</button>
                <button type="button" onClick={chooseNote}>Note</button>
                <button type="button" onClick={() => { setMemoryChoiceOpen(false); requestAnimationFrame(() => editorOpenerRef.current?.focus()); }}>Cancel</button>
              </div>
            </section>
          )}
          {promotionNoteId && !factEditor && (
            <div className="undo-message" role="status">
              <span>Note saved.</span>
              <button
                type="button"
                onClick={(event) => {
                  editorOpenerRef.current = event.currentTarget;
                  setFactEditor({ sourceInteractionId: promotionNoteId });
                }}
              >
                Promote part to memory fact
              </button>
            </div>
          )}
          {(nextPlan === undefined || planError || nextPlan?.kind !== "none" || Boolean(relationship?.today)) && (
            <section className="profile-card profile-plan-card" aria-labelledby="profile-plan-heading">
              <div className="card-heading-with-action">
                <div>
                  <h3 id="profile-plan-heading">Current plan</h3>
                  <p>What you have deliberately planned for this relationship.</p>
                </div>
                <button className="secondary-action" type="button" onClick={() => navigate(personFollowUpsPath(summary.person.id))}>See all</button>
              </div>
              {nextPlan === undefined && !planError && <p role="status">Loading follow-up plan…</p>}
              {planError && (
                <div className="section-error">
                  <p role="alert">{planError}</p>
                  <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>Retry</button>
                </div>
              )}
              {relationship?.today && (
                <p className="current-plan-reason"><strong>Why now:</strong> {formatExplanation(relationship.today.explanation)}</p>
              )}
              {relationship?.today && relationship.today.additionalDueFollowUpIds.length > 0 && (
                <p className="today-also-due">
                  Also due: {relationship.today.additionalDueFollowUpIds.length} other {relationship.today.additionalDueFollowUpIds.length === 1 ? "plan" : "plans"}
                </p>
              )}
              {nextPlan?.kind === "explicit_follow_up" && nextPlan.followUp && (
                <div className="current-plan-summary">
                  <span className="status-chip">{followUpTimingLabel(nextPlan.followUp, currentLocalDate())}</span>
                  <strong>{nextPlan.followUp.reason}</strong>
                  <p>{followUpActionLabel(nextPlan.followUp)}</p>
                  <div className="button-row compact-buttons">
                    <button type="button" onClick={() => navigate(followUpDetailPath(nextPlan.followUp!.id))}>Open follow-up</button>
                    <button type="button" onClick={(event) => openFollowUpEditor(event.currentTarget)}>Add another</button>
                  </div>
                </div>
              )}
              {nextPlan?.kind === "cadence" && (
                <div className="current-plan-summary">
                  <strong>Every {nextPlan.cadenceDays} days</strong>
                  {nextPlan.date
                    ? <p>Next expected contact: {formatLocalDate(nextPlan.date)}</p>
                    : <p>Cadence is saved. Plan the first follow-up when you are ready.</p>}
                  <p className="muted-copy">A cadence never creates a follow-up automatically.</p>
                  <div className="button-row compact-buttons">
                    <button type="button" onClick={(event) => openFollowUpEditor(event.currentTarget)}>Plan follow-up</button>
                    <button type="button" onClick={(event) => openCadenceEditor(event.currentTarget)}>Change cadence</button>
                  </div>
                </div>
              )}
              {nextPlan?.kind === "none" && relationship?.today && (
                <div className="button-row compact-buttons">
                  <button type="button" onClick={(event) => openFollowUpEditor(event.currentTarget)}>Plan follow-up</button>
                </div>
              )}
            </section>
          )}
          <section className="profile-card profile-reach-out-card" aria-labelledby="profile-reach-out-heading">
            <div className="card-heading-with-action">
              <div>
                <h3 id="profile-reach-out-heading">Reach Out</h3>
                <p>The deliberate intention attached to this Person.</p>
              </div>
            </div>
            {reachOut === undefined && !reachOutError && <p role="status">Loading Reach Out plan…</p>}
            {reachOutError && <div className="section-error"><p role="alert">{reachOutError}</p><button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>Retry</button></div>}
            {reachOut && (
              <div className="current-plan-summary">
                <span className="status-chip">{reachOut.displayState === "active" && reachOut.relevantDate === currentLocalDate() ? "Due today" : reachOut.displayState[0].toUpperCase() + reachOut.displayState.slice(1)}</span>
                <strong>{reachOut.entry.reason ?? "Add why"}</strong>
                <p>{reachOut.entry.actionDetail ?? (FOLLOW_UP_ACTION_OPTIONS.find((option) => option.value === reachOut.entry.intendedActionType)?.label ?? "Choose next action")}</p>
                {reachOut.relevantDate && <p>Reminder: {formatLocalDate(reachOut.relevantDate)}</p>}
                <div className="button-row compact-buttons">
                  <button type="button" onClick={() => navigate(reachOutDetailPath(reachOut.entry.id))}>Open plan</button>
                  {!summary.person.archivedAt && reachOut.entry.intentStatus === "active" && <button type="button" onClick={(event) => { reachOutOpenerRef.current = event.currentTarget; setReachOutCompletionOpen(true); }}>Mark complete</button>}
                  {!summary.person.archivedAt && <button className="danger-action" type="button" disabled={reachOutRemoving} onClick={(event) => { reachOutOpenerRef.current = event.currentTarget; void removeCurrentReachOut(); }}>{reachOutRemoving ? "Removing…" : "Remove"}</button>}
                </div>
              </div>
            )}
            {reachOut === null && !reachOutError && (
              <div className="timeline-empty">
                <p>{reachOutHistory.some((entry) => entry.intentStatus === "completed") ? "The latest outreach cycle is complete and remains in history." : "This Person is not currently in Reach Out."}</p>
                {!summary.person.archivedAt && summary.person.identityStatus !== "merged" && <button className="text-action" type="button" onClick={(event) => onAddToReachOut(summary.person, event.currentTarget)}>Add to Reach Out</button>}
                {reachOutHistory[0] && <button className="text-action" type="button" onClick={() => navigate(reachOutDetailPath(reachOutHistory[0].id))}>Open Reach Out history</button>}
              </div>
            )}
          </section>
          <section className="profile-card profile-relationship-card" aria-labelledby="relationship-summary-heading">
            <h3 id="relationship-summary-heading">Relationship summary</h3>
            {relationship === undefined && !relationshipError && <p role="status">Calculating relationship summary…</p>}
            {relationshipError && (
              <div className="section-error">
                <p role="alert">{relationshipError}</p>
                <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>Retry</button>
              </div>
            )}
            <dl className="profile-details">
              {relationship && (
                <div>
                  <dt>Relationship stage</dt>
                  <dd>
                    <strong>{relationshipStageLabel(relationship.relationshipStage.value)}</strong>
                    <span className="detail-supporting-copy">{formatExplanation(relationship.relationshipStage.explanation)}</span>
                  </dd>
                </div>
              )}
              <div>
                <dt>Last meaningful contact</dt>
                <dd>{historyError || relationshipError
                  ? "Unavailable"
                  : relationship === undefined
                    ? "Loading…"
                  : relationship === null
                    ? "Unavailable"
                    : relationship.lastContact
                      ? formatExplanation(relationship.lastContact.explanation)
                      : "No meaningful contact recorded"}</dd>
              </div>
              {relationship && (
                <div>
                  <dt>Relationship age</dt>
                  <dd>{formatExplanation(relationship.relationshipAge.explanation)}</dd>
                </div>
              )}
              {relationship?.suggestedReminder && (
                <div>
                  <dt>Suggested reminder</dt>
                  <dd>{formatExplanation(relationship.suggestedReminder.explanation)}</dd>
                </div>
              )}
              <div>
                <dt>Added to PeopleOS</dt>
                <dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(summary.person.createdAt))}</dd>
              </div>
            </dl>
          </section>
          <section className="profile-card profile-memory-card" aria-labelledby="profile-memory-heading">
            <div className="card-heading-with-action">
              <div>
                <h3 id="profile-memory-heading">Memory</h3>
                <p>Structured details you chose to keep easy to find.</p>
              </div>
              <button className="secondary-action" type="button" onClick={() => navigate(memoryFactsPath(summary.person.id))}>See all</button>
            </div>
            {memoryFacts === undefined && !memoryError && <p role="status">Loading memory…</p>}
            {memoryError && (
              <div className="section-error">
                <p role="alert">{memoryError}</p>
                <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>Retry</button>
              </div>
            )}
            {memoryFacts && memoryFacts.length === 0 && (
              <div className="timeline-empty">
                <p>Add one thing you want to remember.</p>
                {!summary.person.archivedAt && summary.person.identityStatus !== "merged" && (
                  <button className="text-action" type="button" onClick={(event) => openMemoryChoice(event.currentTarget)}>Add memory</button>
                )}
              </div>
            )}
            {memoryCue && (
              <div className="memory-cue" aria-label="Memory cue">
                <span>Memory cue</span>
                <strong>{memoryCue.text}</strong>
                <p>{formatExplanation(memoryCue.explanation)}</p>
              </div>
            )}
            {compactFacts.length > 0 && (
              <dl className="profile-details profile-memory-facts">
                {compactFacts.map((fact) => (
                  <div key={fact.id}>
                    <dt>{memoryFactKindLabel(fact.kind)}</dt>
                    <dd>{memoryFactValueLabel(fact)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {memoryFacts && memoryFacts.length > 0 && !memoryCue && compactFacts.length === 0 && (
              <p className="muted-copy">Saved in Memory facts. None are currently set to surface on the profile.</p>
            )}
          </section>
          <section className="profile-card profile-timeline-card" aria-labelledby="recent-timeline-heading">
            <div className="card-heading-with-action">
              <div>
                <h3 id="recent-timeline-heading">Recent timeline</h3>
                <p>The five newest moments in this relationship.</p>
              </div>
              <button className="secondary-action" type="button" onClick={() => navigate(timelinePath(summary.person.id))}>
                See full timeline
              </button>
            </div>
            {(history === undefined || !relationshipReady) && !historyError && <p role="status">Loading recent history…</p>}
            {historyError && (
              <div className="section-error">
                <p role="alert">{historyError}</p>
                <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>Retry</button>
              </div>
            )}
            {relationshipReady && history && history.timeline.every((item) => item.source === "person_created") ? (
              <div className="timeline-empty">
                <p>No interactions recorded yet.</p>
                {!summary.person.archivedAt && summary.person.identityStatus !== "merged" && (
                  <button className="text-action" type="button" onClick={(event) => openInteraction(event.currentTarget)}>
                    Log interaction
                  </button>
                )}
              </div>
            ) : relationshipReady && history ? (
              <TimelineList
                items={history.timeline.slice(0, 5)}
                onOpenInteraction={!summary.person.archivedAt && summary.person.identityStatus !== "merged"
                  ? openTimelineInteraction
                  : undefined}
                onOpenFollowUp={(followUpId) => navigate(followUpDetailPath(followUpId))}
                onOpenReachOut={(entryId) => navigate(reachOutDetailPath(entryId))}
              />
            ) : null}
          </section>
          <section className="profile-card profile-contact-card" aria-labelledby="profile-contact-heading">
            <div className="card-heading-with-action">
              <div>
                <h3 id="profile-contact-heading">Contact details</h3>
                <p>Preferred ways to reach this person.</p>
              </div>
              <button className="secondary-action" type="button" onClick={() => navigate(contactMethodsPath(summary.person.id))}>See all</button>
            </div>
            {preferredContacts.length === 0 && !communicationPreference && (
              <div className="timeline-empty">
                <p>No contact details yet.</p>
                {!summary.person.archivedAt && <button className="text-action" type="button" onClick={() => navigate(contactMethodsPath(summary.person.id))}>Add contact details</button>}
              </div>
            )}
            {(preferredContacts.length > 0 || communicationPreference) && (
              <dl className="profile-details">
                {preferredContacts.map((contact) => (
                  <div key={contact.id}>
                    <dt>{contact.label || (contact.kind === "phone" ? "Phone" : "Email")}{contact.isPreferred ? " · Preferred" : ""}</dt>
                    <dd>{displayContact(contact, phoneRegion)}</dd>
                  </div>
                ))}
                {communicationPreference && (
                  <div>
                    <dt>Communication preference</dt>
                    <dd>{memoryFactValueLabel(communicationPreference)}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
          <section className="profile-card profile-affiliation-card" aria-labelledby="profile-affiliation-heading">
            <div className="card-heading-with-action">
              <div>
                <h3 id="profile-affiliation-heading">Affiliation</h3>
                <p>Current organisation and role context.</p>
              </div>
              <button className="secondary-action" type="button" onClick={() => navigate(affiliationsPath(summary.person.id))}>See history</button>
            </div>
            {summary.currentAffiliation ? (
              <dl className="profile-details">
                <div><dt>Organisation</dt><dd>{summary.currentAffiliation.organisationName}</dd></div>
                {summary.currentAffiliation.role && <div><dt>Role</dt><dd>{summary.currentAffiliation.role}</dd></div>}
              </dl>
            ) : (
              <p className="muted-copy">Add an organisation when it helps you remember their context.</p>
            )}
          </section>
          {editor && (
            <InteractionEditorSheet
              personId={summary.person.id}
              personName={summary.person.displayName}
              interaction={editor.interaction}
              initialKind={editor.initialKind}
              onClose={closeInteraction}
              onSaved={finishInteraction}
              onDeleted={finishInteractionDelete}
            />
          )}
          {factEditor && (
            <FactEditorSheet
              personId={summary.person.id}
              personName={summary.person.displayName}
              sourceInteractionId={factEditor.sourceInteractionId}
              onClose={closeFactEditor}
              onSaved={finishFact}
            />
          )}
          {followUpEditorOpen && (
            <FollowUpEditorSheet
              mode="create"
              personId={summary.person.id}
              personName={summary.person.displayName}
              onClose={closePlanEditor}
              onSaved={finishPlanEditor}
            />
          )}
          {cadenceEditorOpen && (
            <CadenceEditorSheet
              person={summary.person}
              onClose={closePlanEditor}
              onSaved={finishPlanEditor}
            />
          )}
          {reachOutCompletionOpen && reachOut && (
            <ReachOutCompletionSheet
              entry={reachOut.entry}
              person={reachOut.person}
              currentFollowUp={reachOut.currentFollowUp}
              onClose={() => { setReachOutCompletionOpen(false); requestAnimationFrame(() => reachOutOpenerRef.current?.focus()); }}
              onCompleted={finishReachOutMutation}
            />
          )}
          {contactChoice && (
            <ContactMethodChoiceSheet
              personName={summary.person.displayName}
              targets={contactChoice.projection.targets}
              hasPhone={contactChoice.projection.hasActivePhone}
              error={contactChoice.error}
              copyValue={contactChoice.copyValue}
              onChoose={(targetId) => {
                const target = contactChoice.projection.targets.find((candidate) => candidate.id === targetId);
                if (target) void launchProfileTarget(target);
              }}
              onCopy={contactChoice.copyValue ? () => void copyProfileContact(contactChoice.copyValue!) : undefined}
              onAddPhone={() => openProfileContactMethods(true)}
              onManage={() => openProfileContactMethods()}
              onClose={closeContactChoice}
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
