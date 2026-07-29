import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import EmptyState from "./EmptyState";
import FollowUpCompletionSheet from "./FollowUpCompletionSheet";
import FollowUpEditorSheet from "./FollowUpEditorSheet";
import {
  listUpcomingFollowUps,
  listUpcomingCadences,
  type UpcomingCadence,
  type UpcomingFollowUp,
  type UpcomingFilters,
  type UpcomingResult
} from "./application/followUpQueries";
import {
  cancelFollowUp,
  createCancelFollowUpCommand
} from "./application/followUps";
import {
  listActivePersonOptions,
  type PersonPickerOption
} from "./application/interactionQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { FollowUp, FollowUpActionType } from "./domain/schema";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import { FOLLOW_UP_ACTION_OPTIONS } from "./domain/followUpPolicy";
import { followUpDetailPath, personProfilePath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;
type WindowFilter = NonNullable<UpcomingFilters["window"]>;

type UpcomingViewState = {
  window: "" | WindowFilter;
  personId: string;
  actionType: "" | FollowUpActionType;
  scrollY: number;
};

const WINDOW_FILTERS = new Set<WindowFilter>(["next_7_days", "next_30_days", "later"]);
const ACTION_FILTERS = new Set<FollowUpActionType>(FOLLOW_UP_ACTION_OPTIONS.map((option) => option.value));

function readUpcomingViewState(): UpcomingViewState {
  const saved = window.history.state?.upcomingView as Partial<UpcomingViewState> | undefined;
  return {
    window: typeof saved?.window === "string" && WINDOW_FILTERS.has(saved.window as WindowFilter)
      ? saved.window as WindowFilter
      : "",
    personId: typeof saved?.personId === "string" ? saved.personId : "",
    actionType: typeof saved?.actionType === "string" && ACTION_FILTERS.has(saved.actionType as FollowUpActionType)
      ? saved.actionType as FollowUpActionType
      : "",
    scrollY: typeof saved?.scrollY === "number" && Number.isFinite(saved.scrollY)
      ? Math.max(0, saved.scrollY)
      : 0
  };
}

function writeUpcomingViewState(view: UpcomingViewState) {
  window.history.replaceState({ ...(window.history.state ?? {}), upcomingView: view }, "", window.location.href);
}

type EditorState = {
  mode: "create" | "reschedule" | "snooze";
  person: PersonPickerOption["person"];
  followUp?: FollowUp;
};

function currentLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateLabel(value: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00.000Z`));
}

function actionLabel(action: FollowUpActionType): string {
  return FOLLOW_UP_ACTION_OPTIONS.find((option) => option.value === action)?.label ?? "Other";
}

function relativeDate(date: string, today: string): string {
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  if (days < 365) return `in ${Math.round(days / 30)} months`;
  return `in ${Math.round(days / 365)} years`;
}

function cadenceLabel(days: number): string {
  return days === 1 ? "Every day" : days === 3 ? "Every few days" : days === 7 ? "Every week" : days === 14 ? "Every 2 weeks"
    : days === 30 ? "Every month" : days === 90 ? "Every few months"
      : days === 2 ? "Every 2 days" : days === 60 ? "Every 2 months"
      : days === 180 ? "Every 6 months" : days === 365 ? "Every year" : `Every ${days} days`;
}

function groupUpcoming(items: readonly UpcomingFollowUp[]): Array<{
  key: string;
  label: string;
  items: UpcomingFollowUp[];
}> {
  const groups: Array<{ key: string; label: string; items: UpcomingFollowUp[] }> = [];
  for (const item of items) {
    const key = item.effectiveDate.slice(0, 7);
    const current = groups[groups.length - 1];
    if (current?.key === key) current.items.push(item);
    else groups.push({
      key,
      label: localDateLabel(`${key}-01`, { month: "long", year: "numeric" }),
      items: [item]
    });
  }
  return groups;
}

function PersonPicker({
  activeMode,
  onClose,
  onSelect
}: {
  activeMode: ActiveRelationshipMode;
  onClose: () => void;
  onSelect: (person: PersonPickerOption) => void;
}) {
  const modalId = useId();
  const [people, setPeople] = useState<PersonPickerOption[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sheetRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let active = true;
    getDatabase().then((db) => listActivePersonOptions(db, undefined, activeMode))
      .then((records) => { if (active) setPeople(records); })
      .catch(() => { if (active) setError("PeopleOS could not load people. Close this sheet and try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeMode]);

  useEffect(() => {
    const id = `upcoming-person-picker-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: { id, dismiss: () => closeRef.current() }
    }));
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])"
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
  }, [onClose]);

  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  const visible = people.filter((option) => !normalizedQuery
    || option.person.displayName.toLocaleLowerCase("en-US").includes(normalizedQuery));

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet global-add-sheet" role="dialog" aria-modal="true" aria-labelledby="upcoming-person-picker-title">
        <div className="sheet-heading">
          <h3 id="upcoming-person-picker-title">Choose a person</h3>
          <button type="button" aria-label="Close person picker" onClick={onClose}>×</button>
        </div>
        <div className="person-picker">
          <div className="form-field">
            <label htmlFor="upcoming-person-picker-search">Find a person</label>
            <input
              ref={searchRef}
              id="upcoming-person-picker-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Start with their name"
            />
          </div>
          {loading && <p role="status">Loading people…</p>}
          {error && <p className="form-alert" role="alert">{error}</p>}
          {!loading && !error && visible.length === 0 && (
            <p className="muted-copy">{people.length === 0 ? "Add a person before planning a follow-up." : "No people match this name."}</p>
          )}
          {!error && (
            <ul className="selector-list" aria-label="People">
              {visible.map((option) => (
                <li key={option.person.id}>
                  <button type="button" onClick={() => onSelect(option)}>
                    <strong>{option.person.displayName}</strong>
                    {option.affiliation && <span>{option.affiliation}</span>}
                    {option.memoryCue && <span>{option.memoryCue}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function UpcomingFilterSheet({
  applied,
  people,
  actions,
  onApply,
  onClose
}: {
  applied: { window: "" | WindowFilter; personId: string; actionType: "" | FollowUpActionType };
  people: PersonPickerOption["person"][];
  actions: typeof FOLLOW_UP_ACTION_OPTIONS;
  onApply: (filters: { window: "" | WindowFilter; personId: string; actionType: "" | FollowUpActionType }) => void;
  onClose: () => void;
}) {
  const modalId = useId();
  const [draft, setDraft] = useState(applied);
  const sheetRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = `upcoming-filter-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: { id, dismiss: () => closeRef.current() }
    }));
    const frame = requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), select:not([disabled])"
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
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet follow-up-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="upcoming-filter-title">
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">Upcoming</p>
            <h3 id="upcoming-filter-title">Filter follow-ups</h3>
          </div>
          <button type="button" aria-label="Close filters" onClick={onClose}>×</button>
        </div>
        <div className="follow-up-filter-grid">
          <div className="form-field">
            <label htmlFor="upcoming-filter-window">Date window</label>
            <select
              ref={firstFieldRef}
              id="upcoming-filter-window"
              value={draft.window}
              onChange={(event) => setDraft((current) => ({ ...current, window: event.target.value as "" | WindowFilter }))}
            >
              <option value="">All future dates</option>
              <option value="next_7_days">Next 7 days</option>
              <option value="next_30_days">Next 30 days</option>
              <option value="later">Later</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="upcoming-filter-person">Person</label>
            <select id="upcoming-filter-person" value={draft.personId} onChange={(event) => setDraft((current) => ({ ...current, personId: event.target.value }))}>
              <option value="">Everyone</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="upcoming-filter-action">Action type</label>
            <select id="upcoming-filter-action" value={draft.actionType} onChange={(event) => setDraft((current) => ({ ...current, actionType: event.target.value as "" | FollowUpActionType }))}>
              <option value="">All actions</option>
              {actions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>
        <div className="sheet-actions button-row">
          <button className="primary-action" type="button" onClick={() => onApply(draft)}>Show results</button>
          <button type="button" onClick={() => setDraft({ window: "", personId: "", actionType: "" })}>Clear all</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

export default function UpcomingScreen({ activeMode = "personal", navigate, relationshipFilter }: { activeMode?: ActiveRelationshipMode; navigate: Navigate; relationshipFilter?: ReactNode }) {
  const [initialView] = useState(readUpcomingViewState);
  const [localDate] = useState(currentLocalDate);
  const [windowFilter, setWindowFilter] = useState<"" | WindowFilter>(initialView.window);
  const [personFilter, setPersonFilter] = useState(initialView.personId);
  const [actionFilter, setActionFilter] = useState<"" | FollowUpActionType>(initialView.actionType);
  const [result, setResult] = useState<UpcomingResult | undefined>(undefined);
  const [allItems, setAllItems] = useState<UpcomingFollowUp[]>([]);
  const [cadences, setCadences] = useState<UpcomingCadence[]>([]);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [completion, setCompletion] = useState<UpcomingFollowUp | null>(null);
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const rememberedScrollRef = useRef(initialView.scrollY);
  const restoredScrollRef = useRef(false);

  const filters = useMemo<UpcomingFilters>(() => ({
    localDate,
    activeMode,
    ...(windowFilter ? { window: windowFilter } : {}),
    ...(personFilter ? { personId: personFilter } : {}),
    ...(actionFilter ? { actionType: actionFilter } : {})
  }), [actionFilter, activeMode, localDate, personFilter, windowFilter]);

  const load = useCallback(async () => {
    setError("");
    setResult(undefined);
    try {
      const db = await getDatabase();
      const [filtered, all, regular] = await Promise.all([
        listUpcomingFollowUps(db, filters),
        listUpcomingFollowUps(db, { localDate, activeMode }),
        listUpcomingCadences(db, { localDate, activeMode })
      ]);
      setResult(filtered);
      setAllItems(all.items);
      setCadences(regular);
    } catch {
      setError("PeopleOS could not load upcoming follow-ups.");
    }
  }, [activeMode, filters, localDate]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    writeUpcomingViewState({
      window: windowFilter,
      personId: personFilter,
      actionType: actionFilter,
      scrollY: rememberedScrollRef.current
    });
  }, [actionFilter, personFilter, windowFilter]);

  useEffect(() => {
    const rememberScroll = () => {
      if (window.location.pathname !== "/upcoming") return;
      rememberedScrollRef.current = window.scrollY;
      writeUpcomingViewState({
        window: windowFilter,
        personId: personFilter,
        actionType: actionFilter,
        scrollY: rememberedScrollRef.current
      });
    };
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, [actionFilter, personFilter, windowFilter]);

  useEffect(() => {
    if (result === undefined || restoredScrollRef.current) return;
    restoredScrollRef.current = true;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: initialView.scrollY, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [initialView.scrollY, result]);

  function rememberBeforeNavigation() {
    rememberedScrollRef.current = window.scrollY;
    writeUpcomingViewState({
      window: windowFilter,
      personId: personFilter,
      actionType: actionFilter,
      scrollY: rememberedScrollRef.current
    });
  }

  function restoreFocus() {
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      else headingRef.current?.focus();
    });
  }

  function closeEditor() {
    setEditor(null);
    restoreFocus();
  }

  async function finishMutation() {
    setEditor(null);
    setCompletion(null);
    await load();
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function beginEditor(item: UpcomingFollowUp, mode: EditorState["mode"], opener: HTMLElement) {
    openerRef.current = opener;
    setEditor({ mode, person: item.person, followUp: item.followUp });
  }

  async function cancel(item: UpcomingFollowUp, opener: HTMLElement) {
    if (!window.confirm("Cancel this follow-up?")) return;
    openerRef.current = opener;
    setBusyId(item.followUp.id);
    setActionError("");
    try {
      const command = createCancelFollowUpCommand(item.followUp);
      await cancelFollowUp(await getDatabase(), command);
      await load();
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setActionError("PeopleOS could not cancel this follow-up. It is unchanged.");
      restoreFocus();
    } finally {
      setBusyId("");
    }
  }

  const groups = result ? groupUpcoming(result.items) : [];
  const chronological = result ? [
    ...cadences.map((item) => ({ kind: "cadence" as const, date: item.effectiveDate, item })),
    ...result.items.map((item) => ({ kind: "follow_up" as const, date: item.effectiveDate, item }))
  ].sort((left, right) => left.date.localeCompare(right.date)
    || left.item.person.displayName.localeCompare(right.item.person.displayName)) : [];
  const peopleOptions = Array.from(new Map(allItems.map((item) => [item.person.id, item.person])).values())
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "en-US", { sensitivity: "base" }) || left.id.localeCompare(right.id));
  const actionOptions = FOLLOW_UP_ACTION_OPTIONS.filter((option) => allItems.some((item) => item.followUp.actionType === option.value));
  const filtersActive = Boolean(windowFilter || personFilter || actionFilter);
  const activeFilterCount = [windowFilter, personFilter, actionFilter].filter(Boolean).length;

  return (
    <main className="screen upcoming-screen" id="main-content" tabIndex={-1}>
      <header className="page-heading page-heading-with-action">
        <div>
          <p className="eyebrow">Upcoming</p>
          <h2 ref={headingRef} tabIndex={-1}>What you’ve planned for later</h2>
          {relationshipFilter}
        </div>
        <button className="primary-action" type="button" onClick={(event) => { openerRef.current = event.currentTarget; setPickerOpen(true); }}>
          Add follow-up
        </button>
      </header>

      {error && (
        <div className="form-alert screen-status" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {!error && result === undefined && <p className="screen-status" role="status">Loading follow-ups…</p>}

      {!error && result && (allItems.length > 0 || filtersActive) && (
        <div className="follow-up-filter-summary">
          <button
            className="secondary-action"
            type="button"
            aria-haspopup="dialog"
            onClick={(event) => { openerRef.current = event.currentTarget; setFilterOpen(true); }}
          >
            Filter{activeFilterCount ? ` · ${activeFilterCount}` : ""}
          </button>
          <p>{activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied.` : "Showing all future follow-ups."}</p>
        </div>
      )}

      {actionError && <p className="form-alert screen-status" role="alert">{actionError}</p>}

      {!error && result && result.items.length === 0 && cadences.length === 0 && (
        filtersActive ? (
          <section className="profile-card timeline-empty" aria-labelledby="upcoming-filter-empty-heading">
            <h3 id="upcoming-filter-empty-heading">No follow-ups match these filters.</h3>
            <button className="secondary-action" type="button" onClick={() => { setWindowFilter(""); setPersonFilter(""); setActionFilter(""); }}>Clear filters</button>
          </section>
        ) : (
          <EmptyState
            eyebrow="Upcoming"
            title={result.dueCount > 0 ? "No future follow-ups." : "Nothing planned yet."}
            description={result.dueCount > 0
              ? `You have ${result.dueCount} due follow-up${result.dueCount === 1 ? "" : "s"}. Upcoming only shows plans after today.`
              : "Create a follow-up when you know what you want to do and when."}
            action={(
              <div className="empty-action-stack">
                <button className="primary-action" type="button" onClick={(event) => { openerRef.current = event.currentTarget; setPickerOpen(true); }}>Add follow-up</button>
                <button className="secondary-action" type="button" onClick={() => navigate("/people")}>Find a person</button>
              </div>
            )}
          />
        )
      )}

      {!error && result && chronological.length > 0 && !filtersActive && (
        <section className="timeline-group upcoming-cadence-group" aria-labelledby="upcoming-chronological-heading">
          <h3 id="upcoming-chronological-heading">Coming up</h3>
          <ol className="follow-up-list">
            {chronological.map((entry) => entry.kind === "cadence" ? (
              <li key={`cadence-${entry.item.person.id}`}>
                <article className="timeline-item follow-up-row">
                  <div className="timeline-item-heading">
                    <h4><button className="text-action" type="button" onClick={() => navigate(personProfilePath(entry.item.person.id))}>{entry.item.person.displayName}</button></h4>
                    <time dateTime={entry.item.effectiveDate}>{localDateLabel(entry.item.effectiveDate)} · {relativeDate(entry.item.effectiveDate, localDate)}</time>
                  </div>
                  <p className="muted-copy">{cadenceLabel(entry.item.cadenceDays)}</p>
                </article>
              </li>
            ) : (
              <li key={entry.item.followUp.id}>
                <article className="timeline-item follow-up-row">
                  <div className="timeline-item-heading"><div><h4>{entry.item.followUp.reason}</h4><time dateTime={entry.item.effectiveDate}>{localDateLabel(entry.item.effectiveDate)} · {relativeDate(entry.item.effectiveDate, localDate)}</time></div></div>
                  <dl className="timeline-context follow-up-meta"><div><dt>Person</dt><dd><button className="text-action" type="button" onClick={() => navigate(personProfilePath(entry.item.person.id))}>{entry.item.person.displayName}</button></dd></div></dl>
                  <button className="primary-action" type="button" onClick={() => navigate(followUpDetailPath(entry.item.followUp.id))}>Open plan</button>
                </article>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!error && result && result.items.length > 0 && filtersActive && (
        <div className="upcoming-groups">
          {groups.map((group) => (
            <section className="timeline-group" key={group.key} aria-labelledby={`upcoming-month-${group.key}`}>
              <h3 id={`upcoming-month-${group.key}`}>{group.label}</h3>
              <ol className="follow-up-list">
                {group.items.map((item) => (
                  <li key={item.followUp.id}>
                    <article className="timeline-item follow-up-row">
                      <div className="timeline-item-heading">
                        <div>
                          <h4>{item.followUp.reason}</h4>
                          <time dateTime={item.effectiveDate}>{localDateLabel(item.effectiveDate)}</time>
                        </div>
                        {item.followUp.snoozedUntilDate && <span className="status-chip">Snoozed</span>}
                      </div>
                      <dl className="timeline-context follow-up-meta">
                        <div><dt>Person</dt><dd><button className="text-action" type="button" onClick={() => { rememberBeforeNavigation(); navigate(personProfilePath(item.person.id)); }}>{item.person.displayName}</button></dd></div>
                        <div><dt>Next action</dt><dd>{actionLabel(item.followUp.actionType)}</dd></div>
                      </dl>
                      <div className="button-row compact-buttons follow-up-row-actions" role="group" aria-label={`Actions for ${item.followUp.reason}`}>
                        <button className="primary-action" type="button" onClick={() => { rememberBeforeNavigation(); navigate(followUpDetailPath(item.followUp.id)); }}>Open plan</button>
                        <button type="button" onClick={(event) => beginEditor(item, "snooze", event.currentTarget)}>Snooze</button>
                        {!item.followUp.reachOutEntryId && <button type="button" onClick={(event) => beginEditor(item, "reschedule", event.currentTarget)}>Reschedule</button>}
                        {!item.followUp.reachOutEntryId && <button type="button" onClick={(event) => { openerRef.current = event.currentTarget; setCompletion(item); }}>Complete</button>}
                        {!item.followUp.reachOutEntryId && <button className="danger-action" type="button" disabled={busyId === item.followUp.id} onClick={(event) => void cancel(item, event.currentTarget)}>{busyId === item.followUp.id ? "Cancelling…" : "Cancel"}</button>}
                      </div>
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {pickerOpen && (
        <PersonPicker
          activeMode={activeMode}
          onClose={() => { setPickerOpen(false); restoreFocus(); }}
          onSelect={(option) => {
            setPickerOpen(false);
            setEditor({ mode: "create", person: option.person });
          }}
        />
      )}
      {filterOpen && (
        <UpcomingFilterSheet
          applied={{ window: windowFilter, personId: personFilter, actionType: actionFilter }}
          people={peopleOptions}
          actions={actionOptions}
          onClose={() => { setFilterOpen(false); restoreFocus(); }}
          onApply={(next) => {
            setWindowFilter(next.window);
            setPersonFilter(next.personId);
            setActionFilter(next.actionType);
            setFilterOpen(false);
            restoreFocus();
          }}
        />
      )}
      {editor && (
        <FollowUpEditorSheet
          mode={editor.mode}
          personId={editor.person.id}
          personName={editor.person.displayName}
          followUp={editor.followUp}
          existingFutureWarning={editor.mode === "create" && allItems.some((item) => item.person.id === editor.person.id)
            ? "This person already has a future follow-up. You can still create a separate plan."
            : undefined}
          onClose={closeEditor}
          onSaved={(followUp) => {
            if (editor.mode === "create") {
              setEditor(null);
              navigate(followUpDetailPath(followUp.id));
            } else {
              void finishMutation();
            }
          }}
        />
      )}
      {completion && (
        <FollowUpCompletionSheet
          followUp={completion.followUp}
          personName={completion.person.displayName}
          onClose={() => { setCompletion(null); restoreFocus(); }}
          onCompleted={() => void finishMutation()}
        />
      )}
    </main>
  );
}
