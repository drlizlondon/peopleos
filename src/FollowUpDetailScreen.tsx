import { useCallback, useEffect, useRef, useState } from "react";
import EmptyState from "./EmptyState";
import FollowUpCompletionSheet from "./FollowUpCompletionSheet";
import FollowUpEditorSheet from "./FollowUpEditorSheet";
import {
  getFollowUpDetail,
  type FollowUpDetail
} from "./application/followUpQueries";
import {
  cancelFollowUp,
  createCancelFollowUpCommand
} from "./application/followUps";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { FollowUpActionType, FollowUpEvent } from "./domain/schema";
import {
  effectiveFollowUpDate,
  FOLLOW_UP_ACTION_OPTIONS,
  pendingFollowUpTemporalState
} from "./domain/followUpPolicy";
import { followUpDetailPath, personProfilePath, reachOutDetailPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

const EVENT_LABELS: Record<FollowUpEvent["kind"], string> = {
  created: "Follow-up planned",
  snoozed: "Follow-up snoozed",
  rescheduled: "Follow-up rescheduled",
  completed_with_contact: "Completed with contact",
  completed_without_contact: "Completed without contact",
  cancelled: "Follow-up cancelled"
};

function localDateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00.000Z`));
}

function instantLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function actionLabel(action: FollowUpActionType): string {
  return FOLLOW_UP_ACTION_OPTIONS.find((option) => option.value === action)?.label ?? "Other";
}

function currentLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function statusLabel(detail: FollowUpDetail): string {
  if (detail.followUp.status === "pending") {
    return {
      overdue: "Ready",
      due_today: "Today",
      snoozed: "Later",
      future_pending: "Planned"
    }[pendingFollowUpTemporalState(detail.followUp, currentLocalDate())!];
  }
  if (detail.followUp.status === "completed") {
    if (detail.events.some((event) => event.kind === "completed_with_contact")) return "Completed with contact";
    if (detail.events.some((event) => event.kind === "completed_without_contact")) return "Completed without contact";
    return "Completed";
  }
  if (detail.followUp.status === "cancelled") return "Cancelled";
  return "Superseded";
}

function eventSummary(event: FollowUpEvent): string | undefined {
  if (event.kind === "created" && event.toDate) return `Planned for ${localDateLabel(event.toDate)}`;
  if ((event.kind === "snoozed" || event.kind === "rescheduled") && event.toDate) {
    return `${event.fromDate ? `${localDateLabel(event.fromDate)} → ` : ""}${localDateLabel(event.toDate)}`;
  }
  return undefined;
}

export default function FollowUpDetailScreen({
  followUpId,
  navigate,
  onBack
}: {
  followUpId: string;
  navigate: Navigate;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<FollowUpDetail | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editorMode, setEditorMode] = useState<"reschedule" | "snooze" | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setError("");
    setDetail(undefined);
    try {
      setDetail(await getFollowUpDetail(await getDatabase(), followUpId) ?? null);
    } catch {
      setError("PeopleOS could not load this follow-up.");
    }
  }, [followUpId]);

  useEffect(() => { void load(); }, [load]);

  function restoreFocus() {
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      else headingRef.current?.focus();
    });
  }

  async function finishMutation() {
    setEditorMode(null);
    setCompletionOpen(false);
    await load();
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function cancelCurrent() {
    if (!detail || !window.confirm("Cancel this follow-up?")) return;
    setCancelling(true);
    setActionError("");
    try {
      await cancelFollowUp(await getDatabase(), createCancelFollowUpCommand(detail.followUp));
      await load();
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setActionError("PeopleOS could not cancel this follow-up. It is unchanged.");
      restoreFocus();
    } finally {
      setCancelling(false);
    }
  }

  const events = detail
    ? [...detail.events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id))
    : [];
  const isPending = detail?.followUp.status === "pending";
  const reachOutLinked = Boolean(detail?.followUp.reachOutEntryId);
  const personIsWritable = Boolean(detail
    && !detail.person.archivedAt
    && detail.person.identityStatus !== "merged");

  return (
    <main className="screen follow-up-detail-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={onBack}>← Back</button>
      {detail === undefined && !error && <p role="status">Loading follow-up…</p>}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {detail === null && !error && (
        <EmptyState
          eyebrow="Follow-up"
          title="Follow-up not found"
          description="This plan may have been removed or the link may be out of date."
          action={<button className="primary-action" type="button" onClick={() => navigate("/upcoming")}>Open Upcoming</button>}
        />
      )}
      {detail && (
        <>
          <header className="page-heading compact-heading">
            <p className="eyebrow">Follow-up</p>
            <h2 ref={headingRef} tabIndex={-1}>{detail.followUp.reason}</h2>
            <p>One explicit plan for {detail.person.displayName}.</p>
          </header>

          {actionError && <p className="form-alert" role="alert">{actionError}</p>}

          <section className="profile-card" aria-labelledby="follow-up-current-plan-heading">
            <div className="card-heading-with-action">
              <div>
                <h3 id="follow-up-current-plan-heading">Current plan</h3>
                <p>The stored plan and its current effective date.</p>
              </div>
              <span className="status-chip">{statusLabel(detail)}</span>
            </div>
            <dl className="profile-details">
              <div><dt>Person</dt><dd><button className="text-action" type="button" onClick={() => navigate(personProfilePath(detail.person.id))}>{detail.person.displayName}</button></dd></div>
              <div><dt>Next action</dt><dd>{actionLabel(detail.followUp.actionType)}</dd></div>
              <div><dt>{isPending ? "Effective date" : "Planned date"}</dt><dd><time dateTime={effectiveFollowUpDate(detail.followUp)}>{localDateLabel(effectiveFollowUpDate(detail.followUp))}</time></dd></div>
              {detail.followUp.snoozedUntilDate && <div><dt>Originally planned</dt><dd><time dateTime={detail.followUp.dueDate}>{localDateLabel(detail.followUp.dueDate)}</time></dd></div>}
              <div><dt>Created</dt><dd><time dateTime={detail.followUp.createdAt}>{instantLabel(detail.followUp.createdAt)}</time></dd></div>
              {detail.followUp.completedAt && <div><dt>Completed</dt><dd><time dateTime={detail.followUp.completedAt}>{instantLabel(detail.followUp.completedAt)}</time></dd></div>}
            </dl>
            {reachOutLinked && detail.followUp.reachOutEntryId && (
              <div className="button-row compact-buttons follow-up-row-actions">
                <button type="button" onClick={() => navigate(reachOutDetailPath(detail.followUp.reachOutEntryId!))}>Open Reach Out plan</button>
              </div>
            )}
          </section>

          {(detail.lineage.previous || detail.lineage.next) && (
            <section className="profile-card" aria-labelledby="follow-up-lineage-heading">
              <h3 id="follow-up-lineage-heading">Reschedule history</h3>
              <div className="button-row compact-buttons">
                {detail.lineage.previous && <button type="button" onClick={() => navigate(followUpDetailPath(detail.lineage.previous!.id))}>Open previous plan</button>}
                {detail.lineage.next && <button type="button" onClick={() => navigate(followUpDetailPath(detail.lineage.next!.id))}>Open replacement plan</button>}
              </div>
            </section>
          )}

          <section className="profile-card" aria-labelledby="follow-up-history-heading">
            <h3 id="follow-up-history-heading">History</h3>
            {events.length === 0 ? (
              <p className="muted-copy">No lifecycle history is available for this plan.</p>
            ) : (
              <ol className="timeline-list follow-up-history-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <article className="timeline-item">
                      <div className="timeline-item-heading">
                        <div>
                          <h4>{EVENT_LABELS[event.kind]}</h4>
                          <time dateTime={event.occurredAt}>{instantLabel(event.occurredAt)}</time>
                        </div>
                      </div>
                      {eventSummary(event) && <p>{eventSummary(event)}</p>}
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {isPending && personIsWritable && (
            <section className="profile-card" aria-labelledby="follow-up-actions-heading">
              <h3 id="follow-up-actions-heading">Actions</h3>
              <div className="button-row follow-up-detail-actions" role="group" aria-label="Follow-up actions">
                {!reachOutLinked && <button className="primary-action" type="button" onClick={(event) => { openerRef.current = event.currentTarget; setCompletionOpen(true); }}>Complete follow-up</button>}
                <button type="button" onClick={(event) => { openerRef.current = event.currentTarget; setEditorMode("snooze"); }}>Snooze</button>
                {!reachOutLinked && <button type="button" onClick={(event) => { openerRef.current = event.currentTarget; setEditorMode("reschedule"); }}>Reschedule</button>}
                {!reachOutLinked && <button className="danger-action" type="button" disabled={cancelling} onClick={(event) => { openerRef.current = event.currentTarget; void cancelCurrent(); }}>{cancelling ? "Cancelling…" : "Cancel follow-up"}</button>}
              </div>
              {reachOutLinked && <p className="muted-copy">This plan belongs to a Reach Out intention. Snoozing keeps the same plan; complete, reschedule or remove it from Reach Out.</p>}
            </section>
          )}

          {isPending && !personIsWritable && (
            <p className="profile-card muted-copy">Restore or open the current Person before changing this follow-up.</p>
          )}

          {editorMode && (
            <FollowUpEditorSheet
              mode={editorMode}
              personId={detail.person.id}
              personName={detail.person.displayName}
              followUp={detail.followUp}
              onClose={() => { setEditorMode(null); restoreFocus(); }}
              onSaved={() => void finishMutation()}
            />
          )}
          {completionOpen && (
            <FollowUpCompletionSheet
              followUp={detail.followUp}
              personName={detail.person.displayName}
              onClose={() => { setCompletionOpen(false); restoreFocus(); }}
              onCompleted={() => void finishMutation()}
            />
          )}
        </>
      )}
    </main>
  );
}
