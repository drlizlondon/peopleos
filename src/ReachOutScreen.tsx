import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "./useDebouncedValue";
import EmptyState from "./EmptyState";
import ReachOutFilterSheet, {
  REACH_OUT_STATUS_OPTIONS,
  type ReachOutFilters
} from "./ReachOutFilterSheet";
import {
  hasReachOutEntries,
  listReachOut,
  listReachOutContexts,
  type ReachOutListItem,
  type ReachOutSearchSource
} from "./application/reachOutQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { FOLLOW_UP_ACTION_OPTIONS } from "./domain/followUpPolicy";
import type { ReachOutStatusFilter } from "./domain/reachOutPolicy";
import type { FollowUpActionType, LocalDate, ReachOutContext } from "./domain/schema";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import { personProfilePath, reachOutDetailPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type ReachOutViewState = {
  query: string;
  statusFilters: ReachOutStatusFilter[];
  contextId: string;
  scrollY: number;
};

const VALID_STATUS_FILTERS = new Set<ReachOutStatusFilter>(
  REACH_OUT_STATUS_OPTIONS.map((option) => option.value)
);

const SEARCH_SOURCE_LABELS: Record<ReachOutSearchSource, string> = {
  Person: "person",
  Role: "role",
  Organisation: "organisation",
  Why: "reason",
  Context: "context",
  Notes: "notes"
};

function todayLocalDate(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateLabel(value: LocalDate): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00.000Z`));
}

function actionLabel(value: FollowUpActionType | undefined): string {
  return FOLLOW_UP_ACTION_OPTIONS.find((option) => option.value === value)?.label ?? "Choose next action";
}

function statusLabel(item: ReachOutListItem, localDate: LocalDate): string {
  if (item.displayState === "active" && item.relevantDate === localDate) return "Due today";
  return {
    active: "Active",
    waiting: "Waiting",
    snoozed: "Snoozed",
    overdue: "Overdue",
    completed: "Completed",
    dormant: "Dormant"
  }[item.displayState];
}

function readViewState(): ReachOutViewState {
  const saved = window.history.state?.reachOutView;
  if (!saved || typeof saved !== "object") {
    return { query: "", statusFilters: [], contextId: "", scrollY: 0 };
  }
  const candidate = saved as Partial<ReachOutViewState>;
  const statusFilters = Array.isArray(candidate.statusFilters)
    ? candidate.statusFilters.filter((status): status is ReachOutStatusFilter =>
      typeof status === "string" && VALID_STATUS_FILTERS.has(status as ReachOutStatusFilter)
    )
    : [];
  return {
    query: typeof candidate.query === "string" ? candidate.query : "",
    statusFilters,
    contextId: typeof candidate.contextId === "string" ? candidate.contextId : "",
    scrollY: typeof candidate.scrollY === "number" && Number.isFinite(candidate.scrollY)
      ? Math.max(0, candidate.scrollY)
      : 0
  };
}

function writeViewState(view: ReachOutViewState) {
  window.history.replaceState(
    { ...(window.history.state ?? {}), reachOutView: view },
    "",
    window.location.href
  );
}

function sortedStatusFilters(filters: readonly ReachOutStatusFilter[]): ReachOutStatusFilter[] {
  return REACH_OUT_STATUS_OPTIONS
    .map((option) => option.value)
    .filter((status) => filters.includes(status));
}

export default function ReachOutScreen({ activeMode = "personal", navigate, onAdd, relationshipFilter }: { activeMode?: ActiveRelationshipMode; navigate: Navigate; onAdd: (opener: HTMLElement) => void; relationshipFilter?: ReactNode }) {
  const [initialView] = useState(readViewState);
  const [query, setQuery] = useState(initialView.query);
  const [statusFilters, setStatusFilters] = useState<ReachOutStatusFilter[]>(initialView.statusFilters);
  const [contextId, setContextId] = useState(initialView.contextId);
  const [items, setItems] = useState<ReachOutListItem[] | undefined>(undefined);
  const [contexts, setContexts] = useState<ReachOutContext[]>([]);
  const [hasEntries, setHasEntries] = useState<boolean | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [error, setError] = useState("");
  const [localDate] = useState(todayLocalDate);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const loadSequence = useRef(0);
  const scrollRestored = useRef(false);
  const rememberedScroll = useRef(initialView.scrollY);

  // Debounced for the query only: the Reach Out list re-queries the database on
  // every change, and typing a name should cost one search, not one per letter.
  // Status and context filters change on a deliberate click and are not delayed.
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setError("");
    setItems(undefined);
    try {
      const db = await getDatabase();
      const [nextItems, nextContexts, nextHasEntries] = await Promise.all([
        listReachOut(db, {
          localDate,
          activeMode,
          ...(debouncedQuery ? { query: debouncedQuery } : {}),
          ...(statusFilters.length > 0 ? { statusFilters } : {}),
          ...(contextId ? { contextId } : {})
        }),
        listReachOutContexts(db, activeMode),
        hasReachOutEntries(db, activeMode)
      ]);
      if (sequence !== loadSequence.current) return;
      setItems(nextItems);
      setContexts(nextContexts);
      setHasEntries(nextHasEntries);
    } catch {
      if (sequence !== loadSequence.current) return;
      setError("PeopleOS could not load Reach Out from this device.");
    }
  }, [activeMode, contextId, debouncedQuery, localDate, statusFilters]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    writeViewState({ query, statusFilters, contextId, scrollY: rememberedScroll.current });
  }, [contextId, query, statusFilters]);

  useEffect(() => {
    const rememberScroll = () => {
      rememberedScroll.current = window.scrollY;
      writeViewState({ query, statusFilters, contextId, scrollY: rememberedScroll.current });
    };
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, [contextId, query, statusFilters]);

  useEffect(() => {
    if (items === undefined || scrollRestored.current) return;
    scrollRestored.current = true;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, initialView.scrollY);
      rememberedScroll.current = initialView.scrollY;
    });
    return () => cancelAnimationFrame(frame);
  }, [initialView.scrollY, items]);

  const selectedContext = useMemo(
    () => contexts.find((context) => context.id === contextId),
    [contextId, contexts]
  );
  const activeFilterCount = statusFilters.length + (contextId ? 1 : 0);
  const hasRetrieval = Boolean(query.trim() || activeFilterCount);

  function rememberBeforeNavigation() {
    rememberedScroll.current = window.scrollY;
    writeViewState({ query, statusFilters, contextId, scrollY: rememberedScroll.current });
  }

  function closeFilters() {
    setFilterOpen(false);
    requestAnimationFrame(() => filterButtonRef.current?.focus());
  }

  function applyFilters(filters: ReachOutFilters) {
    setStatusFilters(sortedStatusFilters(filters.statusFilters));
    setContextId(filters.contextId);
    closeFilters();
  }

  function clearFilters() {
    setStatusFilters([]);
    setContextId("");
  }

  const heading = (
    <header className="page-heading page-heading-with-action">
      <div>
        <p className="eyebrow">Reach Out</p>
        <h2>People you mean to contact</h2>
        {relationshipFilter}
      </div>
      <button className="primary-action" type="button" onClick={(event) => onAdd(event.currentTarget)}>Add someone</button>
    </header>
  );

  return (
    <main className="screen reach-out-screen" id="main-content" tabIndex={-1}>
      {hasEntries && heading}
      {hasEntries && (
        <section className="reach-out-retrieval" aria-label="Find Reach Out plans">
          <div className="reach-out-search-row">
            <div className="form-field">
              <label htmlFor="reach-out-search">Search Reach Out</label>
              <input
                id="reach-out-search"
                type="search"
                value={query}
                placeholder="Name, organisation, reason or notes"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button
              ref={filterButtonRef}
              className="secondary-action"
              type="button"
              aria-haspopup="dialog"
              onClick={() => setFilterOpen(true)}
            >
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
          </div>
          {activeFilterCount > 0 && (
            <div className="reach-out-active-filters" aria-label="Active Reach Out filters">
              {statusFilters.map((status) => {
                const label = REACH_OUT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
                return (
                  <button
                    key={status}
                    className="reach-out-filter-chip"
                    type="button"
                    aria-label={`Remove ${label} filter`}
                    onClick={() => setStatusFilters((current) => current.filter((candidate) => candidate !== status))}
                  >{label} ×</button>
                );
              })}
              {contextId && (
                <button
                  className="reach-out-filter-chip"
                  type="button"
                  aria-label={`Remove ${selectedContext?.label ?? "context"} filter`}
                  onClick={() => setContextId("")}
                >Context: {selectedContext?.label ?? "Unavailable"} ×</button>
              )}
              <button className="text-action" type="button" onClick={clearFilters}>Clear filters</button>
            </div>
          )}
        </section>
      )}
      {items === undefined && !error && <p className="screen-status" role="status">Loading Reach Out…</p>}
      {error && (
        <div className="form-alert screen-status" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {!error && items?.length === 0 && hasEntries === false && (
        <EmptyState
          eyebrow="Reach Out"
          title="People you mean to contact"
          filter={relationshipFilter}
          description="Keep a deliberate list of people you want to contact, reconnect with or build a relationship with."
          note="You can even add someone if all you remember is where you met them."
          action={<button className="primary-action" type="button" onClick={(event) => onAdd(event.currentTarget)}>Add someone</button>}
        />
      )}
      {!error && items?.length === 0 && hasEntries === true && (
        <section className="reach-out-no-results" aria-labelledby="reach-out-no-results-title">
          <h3 id="reach-out-no-results-title">
            {hasRetrieval ? "No Reach Out plans match" : "No current Reach Out plans"}
          </h3>
          <p>
            {hasRetrieval
              ? "Try changing your search or filters."
              : "Use filters to find completed or dormant outreach."}
          </p>
          <div className="button-row">
            {query && <button type="button" onClick={() => setQuery("")}>Clear search</button>}
            {activeFilterCount > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}
            {!hasRetrieval && <button type="button" onClick={() => setFilterOpen(true)}>View filters</button>}
          </div>
        </section>
      )}
      {!error && items && items.length > 0 && (
        <>
          <p className="reach-out-result-count" role="status">
            {items.length} {items.length === 1 ? "person" : "people"}
          </p>
          <ol className="reach-out-list" aria-label="Current Reach Out queue">
            {items.map((item) => (
              <li key={item.entry.id}>
                <article className="reach-out-card">
                  <div className="reach-out-card-heading">
                    <div>
                      <button
                        className="text-action reach-out-person-link"
                        type="button"
                        onClick={() => {
                          rememberBeforeNavigation();
                          navigate(personProfilePath(item.person.id));
                        }}
                      >
                        {item.person.displayName}
                      </button>
                      {item.person.identityStatus === "provisional" && <span className="status-chip">Identity incomplete</span>}
                      {item.affiliation && <p>{[item.affiliation.role, item.affiliation.organisationName].filter(Boolean).join(" · ")}</p>}
                    </div>
                    <span className={`status-chip reach-out-status-${item.displayState}`}>{statusLabel(item, localDate)}</span>
                  </div>
                  {item.primarySearchMatch && (
                    <p className="reach-out-search-match">
                      Matched {SEARCH_SOURCE_LABELS[item.primarySearchMatch.source]}: <strong>{item.primarySearchMatch.value}</strong>
                    </p>
                  )}
                  <dl className="profile-details reach-out-summary">
                    <div><dt>Why</dt><dd>{item.entry.reason ?? "Add why"}</dd></div>
                    <div><dt>Next action</dt><dd>{item.entry.actionDetail ?? actionLabel(item.entry.intendedActionType)}</dd></div>
                    {item.relevantDate && <div><dt>Planned</dt><dd><time dateTime={item.relevantDate}>{localDateLabel(item.relevantDate)}</time></dd></div>}
                  </dl>
                  {item.contexts.length > 0 && <p className="reach-out-contexts" aria-label="Contexts">{item.contexts.map((context) => context.label).join(" · ")}</p>}
                  {item.repairNotice && <p className="form-alert" role="alert">{item.repairNotice}</p>}
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      rememberBeforeNavigation();
                      navigate(reachOutDetailPath(item.entry.id));
                    }}
                  >Open plan</button>
                </article>
              </li>
            ))}
          </ol>
        </>
      )}
      {filterOpen && (
        <ReachOutFilterSheet
          applied={{ statusFilters, contextId }}
          contexts={contexts}
          onApply={applyFilters}
          onClose={closeFilters}
        />
      )}
    </main>
  );
}
