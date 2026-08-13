import { useCallback, useEffect, useRef, useState } from "react";
import EmptyState from "./EmptyState";
import { ContactMethodChoiceSheet } from "./TodaySheets";
import {
  completeReachOut,
  prepareCompleteReachOutCommand,
  prepareReachOutStatusCommand,
  removeReachOut
} from "./application/reachOut";
import {
  contactNowTargetHref,
  getContactNowProjection,
  revalidateContactNowTarget,
  whatsappTargetHref,
  type ContactNowProjection,
  type ContactNowTarget
} from "./application/contactNow";
import {
  listReachOut,
  type ReachOutListItem
} from "./application/reachOutQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import type { LocalDate } from "./domain/schema";
import type { ContactHandoff } from "./integrations/contactHandoff";
import { openContactHandoff } from "./integrations/contactHandoff";
import { contactMethodsPath, personProfilePath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type ContactChoice = {
  projection: ContactNowProjection;
  requestedChannel: "call" | "message";
  error?: string;
  copyValue?: string;
};

function todayLocalDate(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ReachOutHeading() {
  return (
    <header
      className="page-heading compact-heading reach-out-populated-heading"
    >
      <h2>Reach Out</h2>
      <p>People you mean to contact.</p>
    </header>
  );
}

function targetsForChannel(
  projection: ContactNowProjection,
  channel: "call" | "message"
): ContactNowTarget[] {
  if (channel === "call") {
    return projection.targets.filter((target) => target.channel === "phone_call");
  }
  return projection.targets.filter((target) => target.channel === "phone_call" || target.channel === "email");
}

export function ReachOutActions({
  item,
  navigate,
  onCompleted,
  handoff = openContactHandoff
}: {
  item: ReachOutListItem;
  navigate: Navigate;
  onCompleted: () => void | Promise<void>;
  handoff?: ContactHandoff;
}) {
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [contactChoice, setContactChoice] = useState<ContactChoice>();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>();
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const overflowId = `reach-out-more-${item.entry.id}`;

  useEffect(() => {
    if (overflowOpen) requestAnimationFrame(() => removeButtonRef.current?.focus());
  }, [overflowOpen]);

  function restoreFocus() {
    requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus());
  }

  function openContactMethods(autoAddPhone: boolean) {
    setContactChoice(undefined);
    navigate(contactMethodsPath(item.person.id), {
      state: {
        fromPath: "/reach-out",
        autoAddPhone,
        navigationOrigin: true
      }
    });
  }

  async function launchTarget(
    target: ContactNowTarget,
    requestedChannel: "call" | "message"
  ) {
    setBusy(true);
    setError("");
    try {
      const db = await getDatabase();
      const current = await revalidateContactNowTarget(db, item.person.id, target);
      if (!current) {
        const latest = await getContactNowProjection(db, item.person.id);
        setContactChoice({
          projection: { ...latest, targets: targetsForChannel(latest, requestedChannel) },
          requestedChannel,
          error: "That contact detail is no longer available. Choose another option."
        });
        return;
      }
      const href = requestedChannel === "message" && current.channel === "phone_call"
        ? whatsappTargetHref(current)
        : contactNowTargetHref(current);
      await handoff(href);
      setContactChoice(undefined);
      restoreFocus();
    } catch {
      const latest = await getContactNowProjection(await getDatabase(), item.person.id)
        .catch(() => ({ targets: [], hasActivePhone: false }));
      setContactChoice({
        projection: { ...latest, targets: targetsForChannel(latest, requestedChannel) },
        requestedChannel,
        error: "PeopleOS could not open that contact detail. Choose another option or manage their contact details.",
        copyValue: target.canonicalValue
      });
      setError("PeopleOS could not open that contact detail.");
    } finally {
      setBusy(false);
    }
  }

  async function contactVia(
    channel: "call" | "message",
    opener: HTMLButtonElement
  ) {
    setOverflowOpen(false);
    openerRef.current = opener;
    setBusy(true);
    setError("");
    try {
      const projection = await getContactNowProjection(await getDatabase(), item.person.id);
      const targets = targetsForChannel(projection, channel);
      if (targets.length === 0) {
        openContactMethods(true);
      } else if (targets.length === 1) {
        await launchTarget(targets[0], channel);
      } else {
        setContactChoice({ projection: { ...projection, targets }, requestedChannel: channel });
      }
    } catch {
      setError(`PeopleOS could not open ${channel} yet.`);
    } finally {
      setBusy(false);
    }
  }

  async function done() {
    if (busy || item.entry.intentStatus !== "active") return;
    setOverflowOpen(false);
    setBusy(true);
    setCompleting(true);
    setError("");
    try {
      const command = prepareCompleteReachOutCommand(
        item.entry,
        item.person,
        item.currentFollowUp,
        {}
      );
      await completeReachOut(await getDatabase(), command);
      await onCompleted();
    } catch {
      setError("PeopleOS could not finish this Reach Out. It is unchanged.");
    } finally {
      setCompleting(false);
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || item.entry.intentStatus !== "active") return;
    if (!window.confirm(
      `Remove ${item.person.displayName} from Reach Out? They will remain in PeopleOS.`
    )) {
      setOverflowOpen(false);
      requestAnimationFrame(() => overflowButtonRef.current?.focus());
      return;
    }
    setBusy(true);
    setRemoving(true);
    setError("");
    try {
      const command = prepareReachOutStatusCommand(
        item.entry,
        item.person,
        item.currentFollowUp,
        "removed"
      );
      await removeReachOut(await getDatabase(), command);
      await onCompleted();
    } catch {
      setError("PeopleOS could not remove this person from Reach Out. Nothing changed.");
    } finally {
      setRemoving(false);
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="today-card-actions reach-out-card-actions" role="group" aria-label={`Actions for ${item.person.displayName}`}>
        <button className="reach-out-contact-action" type="button" disabled={busy} onClick={(event) => void contactVia("message", event.currentTarget)}>Message</button>
        <button className="reach-out-contact-action" type="button" disabled={busy} onClick={(event) => void contactVia("call", event.currentTarget)}>Call</button>
        {item.entry.intentStatus === "active" && (
          <button className="reach-out-done-action" type="button" disabled={busy} onClick={() => void done()}>{completing ? "Saving…" : "Done"}</button>
        )}
      </div>
      {item.entry.intentStatus === "active" && (
        <div
          className="reach-out-overflow"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !overflowOpen) return;
            event.preventDefault();
            setOverflowOpen(false);
            requestAnimationFrame(() => overflowButtonRef.current?.focus());
          }}
        >
          <button
            ref={overflowButtonRef}
            className="reach-out-overflow-trigger"
            type="button"
            aria-label={`More actions for ${item.person.displayName}`}
            aria-expanded={overflowOpen}
            aria-controls={overflowId}
            disabled={busy}
            onClick={() => setOverflowOpen((current) => !current)}
          >
            <span aria-hidden="true">•••</span>
          </button>
          {overflowOpen && (
            <div id={overflowId} className="reach-out-overflow-panel" role="group" aria-label={`More actions for ${item.person.displayName}`}>
              <button
                ref={removeButtonRef}
                className="danger-text"
                type="button"
                disabled={busy}
                onClick={() => void remove()}
              >
                {removing ? "Removing…" : "Remove from Reach Out"}
              </button>
            </div>
          )}
        </div>
      )}

      {contactChoice && (
        <ContactMethodChoiceSheet
          personName={item.person.displayName}
          targets={contactChoice.projection.targets}
          hasPhone={contactChoice.projection.hasActivePhone}
          error={contactChoice.error}
          copyValue={contactChoice.copyValue}
          requestedChannel={contactChoice.requestedChannel}
          onChoose={(targetId) => {
            const target = contactChoice.projection.targets.find((candidate) => candidate.id === targetId);
            if (target) void launchTarget(target, contactChoice.requestedChannel);
          }}
          onAddPhone={() => openContactMethods(true)}
          onManage={() => openContactMethods(false)}
          onClose={() => {
            setContactChoice(undefined);
            restoreFocus();
          }}
        />
      )}
    </>
  );
}

export default function ReachOutScreen({
  activeMode = "personal",
  navigate,
  onAdd,
  handoff = openContactHandoff
}: {
  activeMode?: ActiveRelationshipMode;
  navigate: Navigate;
  onAdd: (opener: HTMLElement) => void;
  handoff?: ContactHandoff;
}) {
  const [items, setItems] = useState<ReachOutListItem[]>();
  const [error, setError] = useState("");
  const [localDate] = useState(todayLocalDate);
  const mainRef = useRef<HTMLElement>(null);
  const completionFocusPendingRef = useRef(false);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setItems(undefined);
    setError("");
    try {
      const next = await listReachOut(await getDatabase(), { localDate, activeMode });
      setItems(next);
    } catch {
      setError("PeopleOS could not load Reach Out from this device.");
    }
  }, [activeMode, localDate]);

  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    if (!items || !completionFocusPendingRef.current) return;
    completionFocusPendingRef.current = false;
    requestAnimationFrame(() => {
      mainRef.current?.querySelector<HTMLElement>(
        ".reach-out-person-link, .empty-action button, .page-heading .primary-action"
      )?.focus();
    });
  }, [items]);

  return (
    <main ref={mainRef} className={`screen reach-out-screen${items?.length ? " reach-out-screen-populated" : ""}`} id="main-content" tabIndex={-1}>
      {(items === undefined || items.length > 0) && <ReachOutHeading />}

      {items === undefined && !error && <p className="screen-status" role="status">Loading Reach Out…</p>}
      {error && (
        <div className="form-alert screen-status" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load(true)}>Retry</button>
        </div>
      )}

      {!error && items?.length === 0 && (
        <EmptyState
          eyebrow="Reach Out"
          title="Reach Out"
          description="People you mean to contact."
          action={<button className="primary-action" type="button" onClick={(event) => onAdd(event.currentTarget)}>Add someone</button>}
        />
      )}

      {!error && items && items.length > 0 && (
        <ol className="reach-out-list" aria-label="Reach Out list">
          {items.map((item) => (
            <li key={item.entry.id}>
              <article className="reach-out-card" aria-labelledby={`reach-out-person-${item.entry.id}`}>
                <button
                  id={`reach-out-person-${item.entry.id}`}
                  className="text-action reach-out-person-link"
                  type="button"
                  onClick={() => navigate(personProfilePath(item.person.id), { state: { fromPath: "/reach-out", navigationOrigin: true } })}
                >
                  {item.person.displayName}
                </button>
                {item.entry.reason && <p className="reach-out-note preserve-lines">{item.entry.reason}</p>}
                {item.repairNotice && <p className="form-alert" role="alert">{item.repairNotice}</p>}
                <ReachOutActions
                  item={item}
                  navigate={navigate}
                  handoff={handoff}
                  onCompleted={() => {
                    completionFocusPendingRef.current = true;
                    return load();
                  }}
                />
              </article>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
