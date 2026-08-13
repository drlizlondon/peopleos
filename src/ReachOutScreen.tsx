import { useCallback, useEffect, useRef, useState } from "react";
import EmptyState from "./EmptyState";
import { ContactLinkReviewSheet, ContactMethodChoiceSheet } from "./TodaySheets";
import PersonContactLinkReview, { type PersonContactLinkSelection } from "./PersonContactLinkReview";
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
import {
  addContactMethod,
  createContactMethodDraft,
  editContactMethod,
  listContactMethodsForPerson
} from "./application/contactMethods";
import {
  chooseLinkDetailsForExistingPerson,
  importSelectedContacts,
  prepareContactImportFromPickerResult,
  skipContactImportRow,
  type ContactImportSession
} from "./application/contactImport";
import { getAppSettings } from "./application/peopleQueries";
import { DuplicateReviewRequiredError } from "./application/duplicateReview";
import {
  getIPhoneContactsAdapter,
  isIPhoneContactsSupported,
  pickSingleIPhoneContact
} from "./contacts/capacitorAdapter";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { StaleRevisionError } from "./data/repositories";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import type { ContactMethod, LocalDate, Person } from "./domain/schema";
import { conversationalNameFor } from "./domain/personNames";
import type { ContactHandoff } from "./integrations/contactHandoff";
import { openContactHandoff } from "./integrations/contactHandoff";
import { ContactValueValidationError } from "./integrations/contactValues";
import { contactMethodsPath, personProfilePath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type ContactChoice = {
  person: Person;
  projection: ContactNowProjection;
  requestedChannel: "call" | "message";
  error?: string;
  copyValue?: string;
  selectedTargetId?: string;
};

function firstIssue(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function iPhoneContactPickerError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "picker_busy") return "iPhone Contacts is already open. Close it and try again.";
  if (code === "permission_denied") return "Contacts access was denied. You can still type the detail manually.";
  if (code === "permission_restricted") return "iPhone Contacts are restricted on this device. You can still type the detail manually.";
  if (code === "unavailable") return "iPhone Contacts are unavailable right now. You can still type the detail manually.";
  return "PeopleOS could not open iPhone Contacts. Try again or type the detail manually.";
}

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
  onUpdated = onCompleted,
  screenBusy = false,
  claimScreenBusy = () => true,
  releaseScreenBusy = () => undefined,
  handoff = openContactHandoff
}: {
  item: ReachOutListItem;
  navigate: Navigate;
  onCompleted: () => boolean | void | Promise<boolean | void>;
  onUpdated?: () => boolean | void | Promise<boolean | void>;
  screenBusy?: boolean;
  claimScreenBusy?: () => boolean;
  releaseScreenBusy?: () => void;
  handoff?: ContactHandoff;
}) {
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [contactChoice, setContactChoice] = useState<ContactChoice>();
  const [contactLinkSession, setContactLinkSession] = useState<ContactImportSession>();
  const [contactLinkMethods, setContactLinkMethods] = useState<ContactMethod[]>([]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>();
  const pendingRef = useRef(false);
  const releaseScreenBusyRef = useRef(releaseScreenBusy);
  const contactLaunchInProgressRef = useRef(false);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const overflowId = `reach-out-more-${item.entry.id}`;
  releaseScreenBusyRef.current = releaseScreenBusy;

  useEffect(() => () => {
    releaseScreenBusyRef.current();
  }, []);

  useEffect(() => {
    if (overflowOpen) requestAnimationFrame(() => removeButtonRef.current?.focus());
  }, [overflowOpen]);

  function restoreFocus() {
    requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus());
  }

  function startPending(claimScreen = false): boolean {
    if (pendingRef.current) return false;
    if (claimScreen && !claimScreenBusy()) return false;
    pendingRef.current = true;
    setBusy(true);
    return true;
  }

  function finishPending() {
    pendingRef.current = false;
    setBusy(false);
  }

  function openContactMethods(autoAddPhone: boolean) {
    if (pendingRef.current) return;
    setContactChoice(undefined);
    setContactLinkSession(undefined);
    setContactLinkMethods([]);
    releaseScreenBusy();
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
    if (contactLaunchInProgressRef.current || !startPending()) return;
    contactLaunchInProgressRef.current = true;
    setError("");
    try {
      const db = await getDatabase();
      const current = await revalidateContactNowTarget(db, item.person.id, target);
      if (!current) {
        const latest = await getContactNowProjection(db, item.person.id);
        setContactChoice({
          person: contactChoice?.person ?? item.person,
          projection: { ...latest, targets: targetsForChannel(latest, requestedChannel) },
          requestedChannel,
          selectedTargetId: targetsForChannel(latest, requestedChannel)[0]?.id,
          error: "That contact detail is no longer available. Choose another option."
        });
        return;
      }
      const href = requestedChannel === "message" && current.channel === "phone_call"
        ? whatsappTargetHref(current)
        : contactNowTargetHref(current);
      await handoff(href);
      setContactChoice(undefined);
      setContactLinkSession(undefined);
      setContactLinkMethods([]);
      releaseScreenBusy();
      restoreFocus();
    } catch {
      const latest = await getContactNowProjection(await getDatabase(), item.person.id)
        .catch(() => ({ targets: [], hasActivePhone: false }));
      setContactChoice({
        person: contactChoice?.person ?? item.person,
        projection: { ...latest, targets: targetsForChannel(latest, requestedChannel) },
        requestedChannel,
        selectedTargetId: targetsForChannel(latest, requestedChannel).find((candidate) => candidate.contactMethodId === target.contactMethodId)?.id
          ?? targetsForChannel(latest, requestedChannel)[0]?.id,
        error: "PeopleOS could not open that contact detail. Choose another option or manage their contact details.",
        copyValue: target.canonicalValue
      });
      setError("PeopleOS could not open that contact detail.");
    } finally {
      contactLaunchInProgressRef.current = false;
      finishPending();
    }
  }

  async function contactVia(
    channel: "call" | "message",
    opener: HTMLButtonElement
  ) {
    if (!startPending(true)) return;
    let choiceOpened = false;
    setOverflowOpen(false);
    openerRef.current = opener;
    setError("");
    try {
      const projection = await getContactNowProjection(await getDatabase(), item.person.id);
      const targets = targetsForChannel(projection, channel);
      setContactLinkSession(undefined);
      setContactLinkMethods([]);
      setContactChoice({
        person: item.person,
        projection: { ...projection, targets },
        requestedChannel: channel,
        selectedTargetId: targets[0]?.id
      });
      choiceOpened = true;
    } catch {
      setError(`PeopleOS could not open ${channel} yet.`);
    } finally {
      finishPending();
      if (!choiceOpened) releaseScreenBusy();
    }
  }

  async function saveManualDestination(input: {
    targetId?: string;
    kind: "phone" | "email";
    value: string;
  }): Promise<boolean> {
    if (!contactChoice || !startPending()) return false;
    const choice = contactChoice;
    setContactChoice({ ...choice, error: undefined, copyValue: undefined });
    try {
      const db = await getDatabase();
      const settings = await getAppSettings(db);
      const target = choice.projection.targets.find((candidate) => candidate.id === input.targetId);
      let saved: ContactMethod;
      if (target) {
        const current = await db.get("contactMethods", target.contactMethodId);
        if (!current) throw new StaleRevisionError();
        saved = await editContactMethod(db, {
          id: current.id,
          expectedRevision: current.revision,
          kind: input.kind,
          value: input.value,
          label: current.label,
          ...(current.kind === "phone" && current.region ? { region: current.region } : {})
        }, settings.defaultPhoneRegion, new Date().toISOString(), { enforceDuplicateReview: true });
      } else {
        const draft = createContactMethodDraft(choice.person.id, input.kind);
        saved = await addContactMethod(db, { ...draft, value: input.value }, settings.defaultPhoneRegion, {
          enforceDuplicateReview: true
        });
      }
      const current = await getContactNowProjection(db, choice.person.id);
      const targets = targetsForChannel(current, choice.requestedChannel);
      setContactChoice({
        ...choice,
        projection: { ...current, targets },
        selectedTargetId: targets.find((candidate) => candidate.contactMethodId === saved.id)?.id
          ?? targets[0]?.id,
        error: undefined,
        copyValue: undefined
      });
      setError("");
      const refreshed = await Promise.resolve(onUpdated()).catch(() => false);
      if (refreshed === false) {
        setContactChoice((currentChoice) => currentChoice ? {
          ...currentChoice,
          error: "That detail was saved, but PeopleOS could not refresh Reach Out. Close this sheet and try again."
        } : currentChoice);
      }
      return true;
    } catch (error) {
      const message = error instanceof DuplicateReviewRequiredError
        ? "That detail is already attached to another person in PeopleOS. Choose a different detail or review it from their profile."
        : error instanceof ContactValueValidationError
          ? error.message
          : firstIssue(error, "PeopleOS could not save that contact detail.");
      setContactChoice((current) => current ? { ...current, error: message } : current);
      return false;
    } finally {
      finishPending();
    }
  }

  async function chooseIPhoneContactForDestination() {
    if (!contactChoice || !startPending()) return;
    const choice = contactChoice;
    const adapter = getIPhoneContactsAdapter();
    if (!adapter) {
      setContactChoice({ ...choice, error: "iPhone Contacts are unavailable right now. You can still type the detail manually.", copyValue: undefined });
      finishPending();
      return;
    }
    setContactChoice({ ...choice, error: undefined, copyValue: undefined });
    setContactLinkSession(undefined);
    setContactLinkMethods([]);
    try {
      const result = await pickSingleIPhoneContact(adapter);
      const db = await getDatabase();
      const settings = await getAppSettings(db);
      const session = await prepareContactImportFromPickerResult(db, result, settings.defaultPhoneRegion);
      if (!session) return;
      if (session.rows.length === 0) {
        setContactChoice({ ...choice, error: "No iPhone contact was selected.", copyValue: undefined });
        return;
      }
      setContactLinkMethods(await listContactMethodsForPerson(db, choice.person.id));
      setContactLinkSession(session);
    } catch (error) {
      setContactChoice({ ...choice, error: iPhoneContactPickerError(error), copyValue: undefined });
    } finally {
      finishPending();
    }
  }

  async function addSelectedIPhoneDetails(selection: PersonContactLinkSelection) {
    if (!contactChoice || !contactLinkSession || !startPending()) return;
    const choice = contactChoice;
    try {
      const reviewedSession: ContactImportSession = {
        ...contactLinkSession,
        rows: contactLinkSession.rows.map((row) => row.id === selection.row.id
          ? chooseLinkDetailsForExistingPerson(
              row,
              choice.person,
              selection.contactMethodIds,
              selection.includeAffiliation,
              selection.includeDisplayName
            )
          : skipContactImportRow(row))
      };
      const db = await getDatabase();
      const result = await importSelectedContacts(db, reviewedSession);
      const linkedRow = result.rows.find((row) => row.id === selection.row.id);
      if (!linkedRow || linkedRow.status === "failed") {
        setContactChoice({ ...choice, error: linkedRow?.error ?? "PeopleOS could not add those details. Nothing was changed." });
        return;
      }
      const [current, updatedPerson] = await Promise.all([
        getContactNowProjection(db, choice.person.id),
        db.get("people", choice.person.id)
      ]);
      const targets = targetsForChannel(current, choice.requestedChannel);
      setContactChoice({
        ...choice,
        person: updatedPerson ?? choice.person,
        projection: { ...current, targets },
        selectedTargetId: targets.find((candidate) => selection.contactMethodIds.includes(candidate.contactMethodId))?.id
          ?? choice.selectedTargetId
          ?? targets[0]?.id,
        error: undefined,
        copyValue: undefined
      });
      setError("");
      setContactLinkSession(undefined);
      setContactLinkMethods([]);
      const refreshed = await Promise.resolve(onUpdated()).catch(() => false);
      if (refreshed === false) {
        setContactChoice((currentChoice) => currentChoice ? {
          ...currentChoice,
          error: "Those details were saved, but PeopleOS could not refresh Reach Out. Close this sheet and try again."
        } : currentChoice);
      }
    } catch (error) {
      setContactChoice({ ...choice, error: firstIssue(error, "PeopleOS could not add those contact details.") });
    } finally {
      finishPending();
    }
  }

  function closeContactChoice() {
    if (pendingRef.current) return;
    setContactChoice(undefined);
    setContactLinkSession(undefined);
    setContactLinkMethods([]);
    releaseScreenBusy();
    restoreFocus();
  }

  function closeContactLinkReview() {
    if (pendingRef.current) return;
    setContactLinkSession(undefined);
    setContactLinkMethods([]);
  }

  async function done() {
    if (item.entry.intentStatus !== "active" || !startPending(true)) return;
    setOverflowOpen(false);
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
      finishPending();
      releaseScreenBusy();
    }
  }

  async function remove() {
    if (item.entry.intentStatus !== "active" || !startPending(true)) return;
    if (!window.confirm(
      `Remove ${item.person.displayName} from Reach Out? They will remain in PeopleOS.`
    )) {
      setOverflowOpen(false);
      finishPending();
      releaseScreenBusy();
      requestAnimationFrame(() => overflowButtonRef.current?.focus());
      return;
    }
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
      finishPending();
      releaseScreenBusy();
    }
  }

  return (
    <>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="today-card-actions reach-out-card-actions" role="group" aria-label={`Actions for ${item.person.displayName}`}>
        <button className="reach-out-contact-action" type="button" disabled={screenBusy || busy} onClick={(event) => void contactVia("message", event.currentTarget)}>Message</button>
        <button className="reach-out-contact-action" type="button" disabled={screenBusy || busy} onClick={(event) => void contactVia("call", event.currentTarget)}>Call</button>
        {item.entry.intentStatus === "active" && (
          <button className="reach-out-done-action" type="button" disabled={screenBusy || busy} onClick={() => void done()}>{completing ? "Saving…" : "Done"}</button>
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
            disabled={screenBusy || busy}
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
                disabled={screenBusy || busy}
                onClick={() => void remove()}
              >
                {removing ? "Removing…" : "Remove from Reach Out"}
              </button>
            </div>
          )}
        </div>
      )}

      {contactChoice && !contactLinkSession && (
        <ContactMethodChoiceSheet
          personName={conversationalNameFor(contactChoice.person)}
          targets={contactChoice.projection.targets}
          selectedTargetId={contactChoice.selectedTargetId}
          error={contactChoice.error}
          copyValue={contactChoice.copyValue}
          requestedChannel={contactChoice.requestedChannel}
          saving={busy}
          iPhoneContactsAvailable={isIPhoneContactsSupported()}
          onSelect={(targetId) => {
            setError("");
            setContactChoice((current) => current ? {
              ...current,
              selectedTargetId: targetId,
              error: undefined,
              copyValue: undefined
            } : current);
          }}
          onContinue={(targetId) => {
            const target = contactChoice.projection.targets.find((candidate) => candidate.id === targetId);
            if (target) void launchTarget(target, contactChoice.requestedChannel);
          }}
          onSaveManual={saveManualDestination}
          onChooseIPhoneContact={chooseIPhoneContactForDestination}
          onManage={() => openContactMethods(false)}
          onClose={closeContactChoice}
        />
      )}
      {contactChoice && contactLinkSession && (
        <ContactLinkReviewSheet saving={busy} onClose={closeContactLinkReview}>
          <PersonContactLinkReview
            session={contactLinkSession}
            targetPerson={contactChoice.person}
            targetContactMethods={contactLinkMethods}
            busy={busy}
            error={contactChoice.error}
            onCancel={closeContactLinkReview}
            onSubmit={(selection) => void addSelectedIPhoneDetails(selection)}
          />
        </ContactLinkReviewSheet>
      )}
    </>
  );
}

export default function ReachOutScreen({
  activeMode = "personal",
  navigate,
  onAdd,
  onBusyChange,
  handoff = openContactHandoff
}: {
  activeMode?: ActiveRelationshipMode;
  navigate: Navigate;
  onAdd: (opener: HTMLElement) => void;
  onBusyChange?: (busy: boolean) => void;
  handoff?: ContactHandoff;
}) {
  const [items, setItems] = useState<ReachOutListItem[]>();
  const [error, setError] = useState("");
  const [busyOwnerId, setBusyOwnerId] = useState<string>();
  const [localDate] = useState(todayLocalDate);
  const mainRef = useRef<HTMLElement>(null);
  const completionFocusPendingRef = useRef(false);
  const busyOwnerRef = useRef<string>();
  const mountedRef = useRef(true);
  const onBusyChangeRef = useRef(onBusyChange);
  const loadRequestRef = useRef(0);
  onBusyChangeRef.current = onBusyChange;

  const claimBusy = useCallback((ownerId: string): boolean => {
    if (busyOwnerRef.current) return false;
    busyOwnerRef.current = ownerId;
    setBusyOwnerId(ownerId);
    onBusyChangeRef.current?.(true);
    return true;
  }, []);

  const releaseBusy = useCallback((ownerId: string) => {
    if (busyOwnerRef.current !== ownerId) return;
    busyOwnerRef.current = undefined;
    setBusyOwnerId(undefined);
    onBusyChangeRef.current?.(false);
  }, []);

  const load = useCallback(async (showLoading = false): Promise<boolean> => {
    if (!mountedRef.current) return false;
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    if (showLoading) setItems(undefined);
    setError("");
    try {
      const next = await listReachOut(await getDatabase(), { localDate, activeMode });
      if (!mountedRef.current || loadRequestRef.current !== requestId) return false;
      setItems(next);
      return true;
    } catch {
      if (!mountedRef.current || loadRequestRef.current !== requestId) return false;
      setError("PeopleOS could not load Reach Out from this device.");
      return false;
    }
  }, [activeMode, localDate]);

  useEffect(() => {
    mountedRef.current = true;
    void load(true);
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, [load]);

  useEffect(() => () => {
    if (!busyOwnerRef.current) return;
    busyOwnerRef.current = undefined;
    onBusyChangeRef.current?.(false);
  }, []);

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

      {items?.length === 0 && (
        <EmptyState
          eyebrow="Reach Out"
          title="Reach Out"
          description="People you mean to contact."
          action={<button className="primary-action" type="button" disabled={Boolean(busyOwnerId)} onClick={(event) => onAdd(event.currentTarget)}>Add someone</button>}
        />
      )}

      {items && items.length > 0 && (
        <ol className="reach-out-list" aria-label="Reach Out list">
          {items.map((item) => (
            <li key={item.entry.id}>
              <article className="reach-out-card" aria-labelledby={`reach-out-person-${item.entry.id}`}>
                <button
                  id={`reach-out-person-${item.entry.id}`}
                  className="text-action reach-out-person-link"
                  type="button"
                  disabled={Boolean(busyOwnerId)}
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
                  screenBusy={Boolean(busyOwnerId)}
                  claimScreenBusy={() => claimBusy(item.entry.id)}
                  releaseScreenBusy={() => releaseBusy(item.entry.id)}
                  onUpdated={() => load()}
                  onCompleted={() => {
                    completionFocusPendingRef.current = true;
                    setItems((current) => current?.filter(
                      (candidate) => candidate.entry.id !== item.entry.id
                    ));
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
