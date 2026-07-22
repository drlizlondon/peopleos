import { useCallback, useEffect, useRef, useState } from "react";
import EmptyState from "./EmptyState";
import FollowUpEditorSheet from "./FollowUpEditorSheet";
import {
  listPersonFollowUps,
  type PersonFollowUpLists
} from "./application/followUpQueries";
import { getPersonSummary, type PersonSummary } from "./application/peopleQueries";
import { getDatabase } from "./data/client";
import type { FollowUp, FollowUpActionType } from "./domain/schema";
import {
  effectiveFollowUpDate,
  FOLLOW_UP_ACTION_OPTIONS,
  pendingFollowUpTemporalState
} from "./domain/followUpPolicy";
import { followUpDetailPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

function localDateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00.000Z`));
}

function actionLabel(action: FollowUpActionType): string {
  return FOLLOW_UP_ACTION_OPTIONS.find((option) => option.value === action)?.label ?? "Other";
}

function statusLabel(followUp: FollowUp): string {
  if (followUp.status === "pending") {
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return {
      overdue: "Overdue",
      due_today: "Due today",
      snoozed: "Snoozed",
      future_pending: "Pending"
    }[pendingFollowUpTemporalState(followUp, localDate)!];
  }
  return {
    completed: "Completed",
    cancelled: "Cancelled",
    superseded: "Superseded"
  }[followUp.status];
}

function FollowUpList({
  records,
  navigate,
  label
}: {
  records: FollowUp[];
  navigate: Navigate;
  label: string;
}) {
  return (
    <ol className="follow-up-list" aria-label={label}>
      {records.map((followUp) => (
        <li key={followUp.id}>
          <article className="timeline-item follow-up-row">
            <div className="timeline-item-heading">
              <div>
                <h4>{followUp.reason}</h4>
                <time dateTime={effectiveFollowUpDate(followUp)}>{localDateLabel(effectiveFollowUpDate(followUp))}</time>
              </div>
              <span className="status-chip">{statusLabel(followUp)}</span>
            </div>
            <p>{actionLabel(followUp.actionType)}</p>
            <button className="text-action" type="button" onClick={() => navigate(followUpDetailPath(followUp.id))}>Open follow-up</button>
          </article>
        </li>
      ))}
    </ol>
  );
}

export default function PersonFollowUpsScreen({
  personId,
  navigate,
  onBack
}: {
  personId: string;
  navigate: Navigate;
  onBack: () => void;
}) {
  const [person, setPerson] = useState<PersonSummary | null | undefined>(undefined);
  const [lists, setLists] = useState<PersonFollowUpLists | undefined>(undefined);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setError("");
    setPerson(undefined);
    setLists(undefined);
    try {
      const db = await getDatabase();
      const [summary, records] = await Promise.all([
        getPersonSummary(db, personId),
        listPersonFollowUps(db, personId)
      ]);
      setPerson(summary ?? null);
      setLists(records);
    } catch {
      setError("PeopleOS could not load this person’s follow-ups.");
    }
  }, [personId]);

  useEffect(() => { void load(); }, [load]);

  function restoreFocus() {
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      else headingRef.current?.focus();
    });
  }

  async function finishCreate() {
    setEditorOpen(false);
    await load();
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  const canCreate = Boolean(person && !person.person.archivedAt && person.person.identityStatus !== "merged");

  return (
    <main className="screen person-follow-ups-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={onBack}>← Person</button>
      {person === undefined && !error && <p role="status">Loading follow-ups…</p>}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {person === null && !error && (
        <EmptyState
          eyebrow="People"
          title="Person not found"
          description="This person may have been removed or the link may be out of date."
          action={<button className="primary-action" type="button" onClick={() => navigate("/people")}>Back to People</button>}
        />
      )}
      {person && lists && (
        <>
          <header className="page-heading page-heading-with-action compact-heading">
            <div>
              <p className="eyebrow">{person.person.displayName}</p>
              <h2 ref={headingRef} tabIndex={-1}>Follow-ups</h2>
              <p>Explicit plans and their retained history.</p>
            </div>
            {canCreate && <button className="primary-action" type="button" onClick={(event) => { openerRef.current = event.currentTarget; setEditorOpen(true); }}>Add follow-up</button>}
          </header>

          {lists.pending.length === 0 && lists.history.length === 0 ? (
            <section className="profile-card timeline-empty" aria-labelledby="person-follow-ups-empty-heading">
              <h3 id="person-follow-ups-empty-heading">No follow-ups yet.</h3>
              <p>Create one when you know what you intend to do and when.</p>
              {canCreate && <button className="secondary-action" type="button" onClick={(event) => { openerRef.current = event.currentTarget; setEditorOpen(true); }}>Plan follow-up</button>}
            </section>
          ) : (
            <>
              <section className="profile-card" aria-labelledby="person-pending-follow-ups-heading">
                <h3 id="person-pending-follow-ups-heading">Current plans</h3>
                {lists.pending.length > 0
                  ? <FollowUpList records={lists.pending} navigate={navigate} label="Current follow-ups" />
                  : <p className="muted-copy">No current plans.</p>}
              </section>
              <section className="profile-card" aria-labelledby="person-follow-up-history-heading">
                <h3 id="person-follow-up-history-heading">History</h3>
                {lists.history.length > 0
                  ? <FollowUpList records={lists.history} navigate={navigate} label="Follow-up history" />
                  : <p className="muted-copy">Completed, cancelled, and rescheduled plans will remain here.</p>}
              </section>
            </>
          )}

          {editorOpen && (
            <FollowUpEditorSheet
              mode="create"
              personId={person.person.id}
              personName={person.person.displayName}
              existingFutureWarning={lists.pending.length > 0
                ? "This person already has a pending follow-up. You can still create a separate plan."
                : undefined}
              onClose={() => { setEditorOpen(false); restoreFocus(); }}
              onSaved={() => void finishCreate()}
            />
          )}
        </>
      )}
    </main>
  );
}
