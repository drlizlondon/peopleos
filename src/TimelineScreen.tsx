import { useCallback, useEffect, useRef, useState } from "react";
import InteractionEditorSheet from "./InteractionEditorSheet";
import TimelineList from "./TimelineList";
import {
  getPersonHistory,
  type PersonHistory,
  type TimelineDisplayItem
} from "./application/interactionQueries";
import { getDatabase } from "./data/client";
import { filterTimelineItems, type TimelineFilter } from "./domain/timeline";
import type { InteractionKind } from "./domain/schema";
import { timelineYearKey } from "./timelineDates";
import { followUpDetailPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

const FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "contact", label: "Contact" },
  { id: "notes", label: "Notes" },
  { id: "follow_ups", label: "Follow-ups" },
  { id: "reach_out", label: "Reach Out" }
];

export default function TimelineScreen({
  personId,
  navigate,
  onBack
}: {
  personId: string;
  navigate: Navigate;
  onBack: () => void;
}) {
  const [history, setHistory] = useState<PersonHistory | null | undefined>(undefined);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [editor, setEditor] = useState<{ interaction?: TimelineDisplayItem["interaction"]; initialKind?: InteractionKind } | null>(null);
  const [error, setError] = useState("");
  const openerRef = useRef<HTMLElement | null>(null);
  const timelineHeadingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setHistory(await getPersonHistory(await getDatabase(), personId) ?? null);
    } catch {
      setError("PeopleOS could not load this timeline.");
    }
  }, [personId]);

  useEffect(() => { void load(); }, [load]);

  function openNew(opener: HTMLElement, initialKind?: InteractionKind) {
    openerRef.current = opener;
    setEditor({ initialKind });
  }

  function openExisting(item: TimelineDisplayItem, opener: HTMLElement) {
    if (!item.interaction || !item.editable) return;
    openerRef.current = opener;
    setEditor({ interaction: item.interaction });
  }

  function closeEditor() {
    setEditor(null);
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      else timelineHeadingRef.current?.focus();
    });
  }

  async function finishEditor() {
    setEditor(null);
    await load();
    requestAnimationFrame(() => timelineHeadingRef.current?.focus());
  }

  const visible = history ? filterTimelineItems(history.timeline, filter) : [];
  const hasRelationshipHistory = Boolean(history && history.timeline.some((item) => item.source !== "person_created"));
  const years = Array.from(new Set(visible.map((item) => timelineYearKey(item.occurredAt))));

  function jumpToYear(year: string) {
    if (!year) return;
    const heading = document.querySelector<HTMLElement>(`[id^="timeline-month-${year}"]`);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
    heading?.focus({ preventScroll: true });
  }

  return (
    <main className="screen timeline-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={onBack}>← Person</button>
      {history === undefined && !error && <p role="status">Loading timeline…</p>}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {history === null && (
        <section className="profile-card">
          <h2>This person is no longer available.</h2>
          <button type="button" onClick={() => navigate("/people")}>Back to People</button>
        </section>
      )}
      {history && (
        <>
          <header className="page-heading page-heading-with-action compact-heading">
            <div>
              <p className="eyebrow">{history.person.displayName}</p>
              <h2 ref={timelineHeadingRef} tabIndex={-1}>Timeline</h2>
              <p>What has happened in this relationship, newest first.</p>
            </div>
            {!history.person.archivedAt && history.person.identityStatus !== "merged" && (
              <button className="primary-action" type="button" onClick={(event) => openNew(event.currentTarget)}>
                Log interaction
              </button>
            )}
          </header>

          {!hasRelationshipHistory && (
            <section className="timeline-empty profile-card">
              <h3>No interactions recorded yet.</h3>
              <p>Person creation is shown below automatically.</p>
              {!history.person.archivedAt && history.person.identityStatus !== "merged" && (
                <button className="secondary-action" type="button" onClick={(event) => openNew(event.currentTarget)}>
                  Log interaction
                </button>
              )}
            </section>
          )}

          <div className="timeline-filters" role="group" aria-label="Filter timeline">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={filter === option.id ? "active" : undefined}
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >{option.label}</button>
            ))}
          </div>

          {years.length > 1 && (
            <div className="timeline-year-jump form-field">
              <label htmlFor="timeline-year">Jump to year</label>
              <select id="timeline-year" defaultValue="" onChange={(event) => jumpToYear(event.target.value)}>
                <option value="">Choose a year</option>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
          )}

          {visible.length > 0 ? (
            <TimelineList
              items={visible}
              onOpenInteraction={!history.person.archivedAt && history.person.identityStatus !== "merged"
                ? openExisting
                : undefined}
              onOpenFollowUp={(followUpId) => navigate(followUpDetailPath(followUpId))}
            />
          ) : (
            <p className="profile-card muted-copy" role="status">No timeline items match this filter.</p>
          )}

          {editor && (
            <InteractionEditorSheet
              personId={history.person.id}
              personName={history.person.displayName}
              interaction={editor.interaction}
              initialKind={editor.initialKind}
              onClose={closeEditor}
              onSaved={() => void finishEditor()}
              onDeleted={() => void finishEditor()}
            />
          )}
        </>
      )}
    </main>
  );
}
