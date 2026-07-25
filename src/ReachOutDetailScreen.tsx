import { useCallback, useEffect, useRef, useState } from "react";
import EmptyState from "./EmptyState";
import FollowUpEditorSheet from "./FollowUpEditorSheet";
import ReachOutCompletionSheet from "./ReachOutCompletionSheet";
import ReachOutEditorSheet from "./ReachOutEditorSheet";
import {
  moveReachOutToDormant,
  prepareReachOutStatusCommand,
  reactivateReachOut,
  removeReachOut
} from "./application/reachOut";
import { getReachOutDetail, type ReachOutDetail } from "./application/reachOutQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { FOLLOW_UP_ACTION_OPTIONS } from "./domain/followUpPolicy";
import type { FollowUpActionType, LocalDate, ReachOutEvent } from "./domain/schema";
import { followUpDetailPath, personProfilePath, resolveProvisionalPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

const EVENT_LABELS: Record<ReachOutEvent["kind"], string> = {
  added: "Added to Reach Out",
  activated: "Reactivated",
  completed: "Outreach completed",
  moved_to_dormant: "Moved to Dormant",
  removed: "Removed from Reach Out",
  follow_up_linked: "Reminder linked"
};

function todayLocalDate(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateLabel(value: LocalDate): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00.000Z`));
}

function instantLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function actionLabel(value: FollowUpActionType | undefined): string {
  return FOLLOW_UP_ACTION_OPTIONS.find((option) => option.value === value)?.label ?? "Choose next action";
}

function displayState(value: ReachOutDetail["displayState"], dueToday: boolean): string {
  if (dueToday) return "Due today";
  return { active: "Active", waiting: "Waiting", snoozed: "Snoozed", overdue: "Overdue", completed: "Completed", dormant: "Dormant" }[value];
}

export default function ReachOutDetailScreen({ entryId, navigate, onBack }: { entryId: string; navigate: Navigate; onBack: () => void }) {
  const [detail, setDetail] = useState<ReachOutDetail | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const localDate = todayLocalDate();

  const load = useCallback(async () => {
    setError("");
    setDetail(undefined);
    try {
      setDetail(await getReachOutDetail(await getDatabase(), entryId, localDate) ?? null);
    } catch {
      setError("PeopleOS could not load this Reach Out plan.");
    }
  }, [entryId, localDate]);

  useEffect(() => { void load(); }, [load]);

  function restoreFocus() {
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      else headingRef.current?.focus();
    });
  }

  async function finishMutation() {
    setEditorOpen(false);
    setCompletionOpen(false);
    setSnoozeOpen(false);
    await load();
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function statusChange(kind: "dormant" | "active" | "removed") {
    if (!detail) return;
    const confirmation = kind === "dormant"
      ? detail.currentFollowUp ? "Move this plan to Dormant and cancel its reminder?" : "Move this plan to Dormant?"
      : kind === "removed"
        ? "Remove this plan from Reach Out? Its history and Person will be kept."
        : undefined;
    if (confirmation && !window.confirm(confirmation)) return;
    setBusy(true);
    setActionError("");
    try {
      const transition = kind === "dormant"
        ? "moved_to_dormant"
        : kind === "active"
          ? "activated"
          : "removed";
      const command = prepareReachOutStatusCommand(
        detail.entry,
        detail.person,
        detail.currentFollowUp,
        transition
      );
      const db = await getDatabase();
      if (kind === "dormant") await moveReachOutToDormant(db, command);
      else if (kind === "active") await reactivateReachOut(db, command);
      else await removeReachOut(db, command);
      await load();
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setActionError("PeopleOS could not update this Reach Out plan. It is unchanged.");
      restoreFocus();
    } finally {
      setBusy(false);
    }
  }

  const dueToday = Boolean(detail?.relevantDate === localDate && detail.displayState === "active");
  const readOnly = Boolean(detail?.entry.removedAt || detail?.person.archivedAt || detail?.person.identityStatus === "merged");

  return (
    <main className="screen reach-out-detail-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={onBack}>← Reach Out</button>
      {detail === undefined && !error && <p role="status">Loading Reach Out plan…</p>}
      {error && <div className="form-alert" role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Retry</button></div>}
      {detail === null && !error && (
        <EmptyState eyebrow="Reach Out" title="Plan not found" description="This plan may have been removed or the link may be out of date." action={<button className="primary-action" type="button" onClick={() => navigate("/reach-out")}>Open Reach Out</button>} />
      )}
      {detail && (
        <>
          <header className="page-heading compact-heading">
            <p className="eyebrow">Reach Out</p>
            <h2 ref={headingRef} tabIndex={-1}>{detail.person.displayName}</h2>
            <p>{detail.entry.reason ?? "Finish the plan when you’re ready."}</p>
            <div className="reach-out-heading-status">
              <span className="status-chip">{displayState(detail.displayState, dueToday)}</span>
              {detail.person.identityStatus === "provisional" && <span className="status-chip">Identity incomplete</span>}
              {detail.entry.removedAt && <span className="status-chip">Removed</span>}
            </div>
          </header>
          {actionError && <p className="form-alert" role="alert">{actionError}</p>}
          {detail.repairNotice && <p className="form-alert" role="alert">{detail.repairNotice}</p>}

          <section className="profile-card" aria-labelledby="reach-out-plan-heading">
            <div className="card-heading-with-action">
              <div><h3 id="reach-out-plan-heading">Outreach plan</h3><p>The intention and next step you chose.</p></div>
              {!readOnly && detail.entry.intentStatus !== "completed" && <button type="button" onClick={(event) => { openerRef.current = event.currentTarget; setEditorOpen(true); }}>Edit</button>}
            </div>
            <dl className="profile-details">
              <div><dt>Why</dt><dd>{detail.entry.reason ?? "Add why"}</dd></div>
              <div><dt>Intended next action</dt><dd>{detail.entry.actionDetail ?? actionLabel(detail.entry.intendedActionType)}</dd></div>
              {detail.relevantDate && <div><dt>Reminder</dt><dd><time dateTime={detail.relevantDate}>{localDateLabel(detail.relevantDate)}</time></dd></div>}
              {detail.contexts.length > 0 && <div><dt>Context</dt><dd>{detail.contexts.map((context) => context.label).join(" · ")}</dd></div>}
              {detail.entry.notes && <div><dt>Notes</dt><dd className="preserve-lines">{detail.entry.notes}</dd></div>}
              <div><dt>Added</dt><dd><time dateTime={detail.entry.addedAt}>{instantLabel(detail.entry.addedAt)}</time></dd></div>
              {detail.entry.lastCompletedAt && <div><dt>Last completed</dt><dd><time dateTime={detail.entry.lastCompletedAt}>{instantLabel(detail.entry.lastCompletedAt)}</time></dd></div>}
            </dl>
            <div className="button-row compact-buttons">
              <button type="button" onClick={() => navigate(personProfilePath(detail.person.id))}>Open Person</button>
              {detail.currentFollowUp && <button type="button" onClick={() => navigate(followUpDetailPath(detail.currentFollowUp!.id))}>Open follow-up</button>}
              {detail.person.identityStatus === "provisional" && !readOnly && <button type="button" onClick={() => navigate(resolveProvisionalPath(detail.entry.id))}>Complete identity</button>}
            </div>
          </section>

          <section className="profile-card" aria-labelledby="reach-out-history-heading">
            <h3 id="reach-out-history-heading">History</h3>
            <ol className="timeline-list reach-out-history-list">
              {detail.events.map((event) => (
                <li key={event.id}><article className="timeline-item"><div className="timeline-item-heading"><div><h4>{EVENT_LABELS[event.kind]}</h4><time dateTime={event.occurredAt}>{instantLabel(event.occurredAt)}</time></div></div></article></li>
              ))}
            </ol>
          </section>

          {!readOnly && detail.entry.intentStatus !== "completed" && (
            <section className="profile-card" aria-labelledby="reach-out-actions-heading">
              <h3 id="reach-out-actions-heading">Actions</h3>
              <div className="button-row reach-out-actions" role="group" aria-label="Reach Out actions">
                {detail.entry.intentStatus === "active" && <button className="primary-action" type="button" onClick={(event) => { openerRef.current = event.currentTarget; setCompletionOpen(true); }}>Mark outreach complete</button>}
                {detail.currentFollowUp && <button type="button" onClick={(event) => { openerRef.current = event.currentTarget; setSnoozeOpen(true); }}>Snooze reminder</button>}
                {detail.entry.intentStatus === "active" && <button type="button" disabled={busy} onClick={(event) => { openerRef.current = event.currentTarget; void statusChange("dormant"); }}>Move to Dormant</button>}
                {detail.entry.intentStatus === "dormant" && <button className="primary-action" type="button" disabled={busy} onClick={(event) => { openerRef.current = event.currentTarget; void statusChange("active"); }}>Reactivate</button>}
                <button className="danger-action" type="button" disabled={busy} onClick={(event) => { openerRef.current = event.currentTarget; void statusChange("removed"); }}>Remove from Reach Out</button>
              </div>
              <p className="muted-copy">Opening a contact app is introduced with Today. This plan changes only after an explicit action here.</p>
            </section>
          )}
          {detail.entry.intentStatus === "completed" && !readOnly && (
            <section className="profile-card"><h3>Outreach completed</h3><p className="muted-copy">This cycle remains in history. Add the Person to Reach Out again when you have a new intention.</p></section>
          )}
          {readOnly && <p className="profile-card muted-copy">This retained plan is read-only.</p>}

          {editorOpen && <ReachOutEditorSheet mode="edit" person={detail.person} entry={detail.entry} currentFollowUp={detail.currentFollowUp} selectedContexts={detail.contexts} onClose={() => { setEditorOpen(false); restoreFocus(); }} onSaved={() => void finishMutation()} onOpenExisting={() => {}} />}
          {completionOpen && <ReachOutCompletionSheet entry={detail.entry} person={detail.person} currentFollowUp={detail.currentFollowUp} onClose={() => { setCompletionOpen(false); restoreFocus(); }} onCompleted={() => void finishMutation()} />}
          {snoozeOpen && detail.currentFollowUp && <FollowUpEditorSheet mode="snooze" personId={detail.person.id} personName={detail.person.displayName} followUp={detail.currentFollowUp} onClose={() => { setSnoozeOpen(false); restoreFocus(); }} onSaved={() => void finishMutation()} />}
        </>
      )}
    </main>
  );
}
