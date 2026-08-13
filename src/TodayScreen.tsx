import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import RegularContactStartPrompt from "./RegularContactStartPrompt";
import TodayCard, { type ConversationStarterMessageIntent } from "./TodayCard";
import { ContactLinkReviewSheet, ContactMethodChoiceSheet, PauseTodaySheet } from "./TodaySheets";
import PersonContactLinkReview, { type PersonContactLinkSelection } from "./PersonContactLinkReview";
import {
  contactNowTargetHref,
  getContactNowProjection,
  revalidateContactNowTarget,
  whatsappTargetHref,
  type ContactNowProjection,
  type ContactNowTarget
} from "./application/contactNow";
import {
  alreadyContacted,
  pauseToday,
  prepareAlreadyContactedCommand,
  preparePauseTodayCommand,
  type AlreadyContactedCommand,
  type AlreadyContactedResult
} from "./application/todayActions";
import {
  createTodayCompletionReceipt,
  undoAlreadyContacted,
  type TodayCompletionReceipt
} from "./application/todayCompletionUndo";
import {
  getTodayActionContext,
  getTodayScreenProjection,
  type TodayCardProjection,
  type TodayScreenProjection
} from "./application/todayQueries";
import { recordConversationStarterUse } from "./application/conversationStarterHistory";
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
import { createRelationshipClock } from "./application/relationshipEngineQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { StaleRevisionError } from "./data/repositories";
import { contactCadenceInDays, contactCadenceOf } from "./domain/cadence";
import { addDaysToLocalDate, localDateForInstant } from "./domain/followUpPolicy";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import type { ContactMethod, LocalDate } from "./domain/schema";
import { conversationalNameFor } from "./domain/personNames";
import { ContactValueValidationError } from "./integrations/contactValues";
import type { ContactHandoff } from "./integrations/contactHandoff";
import { openContactHandoff } from "./integrations/contactHandoff";
import { contactMethodsPath, personProfilePath } from "./navigation";
import {
  advanceTodayStarter,
  todayStarterRotation,
  type TodayStarterRotation
} from "./todayStarterPresentationState";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type TodayScreenProps = {
  activeMode?: ActiveRelationshipMode;
  navigate: Navigate;
  /** Retained for test/integration callers; follow-up creation now lives with People. */
  onAddFollowUp?: () => void;
  handoff?: ContactHandoff;
  relationshipFilter?: ReactNode;
  onBusyChange?: (busy: boolean) => void;
};

type CardError = {
  message: string;
  copyValue?: string;
  retry?: "call" | "message" | "done";
  messageIntent?: ConversationStarterMessageIntent;
};

type ContactChoice = {
  card: TodayCardProjection;
  projection: ContactNowProjection;
  error?: string;
  copyValue?: string;
  requestedChannel?: "call" | "message";
  messageIntent?: ConversationStarterMessageIntent;
  selectedTargetId?: string;
};

type PauseChoice = {
  card: TodayCardProjection;
  error?: string;
};

type CompletionUndo = {
  personId: string;
  personName: string;
  receipt: TodayCompletionReceipt;
};

type StarterPresentationState = {
  localDate?: LocalDate;
  people: Record<string, TodayStarterRotation>;
};

type DoneCommand = {
  command: AlreadyContactedCommand;
  personBefore: TodayCardProjection["person"];
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

function initialVisibleCount(): number {
  const value = window.history.state?.todayVisibleCount;
  return Number.isInteger(value) && value >= 5 ? value : 5;
}

function storedFocusPersonId(): string | undefined {
  return typeof window.history.state?.todayFocusPersonId === "string"
    ? window.history.state.todayFocusPersonId
    : undefined;
}

const TODAY_EXPANDED_STORAGE_KEY = "peopleos.today.expanded.v1";

function storedExpandedPersonId(localDate: LocalDate, activeMode: ActiveRelationshipMode): string | undefined {
  try {
    const raw = window.localStorage.getItem(TODAY_EXPANDED_STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as { localDate?: unknown; activeMode?: unknown; personId?: unknown };
    return value.localDate === localDate && value.activeMode === activeMode && typeof value.personId === "string"
      ? value.personId
      : undefined;
  } catch {
    return undefined;
  }
}

function rememberExpandedPersonId(localDate: LocalDate, activeMode: ActiveRelationshipMode, personId: string): void {
  try {
    window.localStorage.setItem(TODAY_EXPANDED_STORAGE_KEY, JSON.stringify({ localDate, activeMode, personId }));
  } catch {
    // Today still works in memory when private storage is unavailable.
  }
}

function targetsForChannel(
  projection: ContactNowProjection,
  channel: "call" | "message" | undefined
): ContactNowTarget[] {
  if (channel === "call") return projection.targets.filter((target) => target.channel === "phone_call");
  if (channel === "message") return projection.targets.filter((target) => target.channel === "phone_call");
  return [...projection.targets];
}

function missingPhoneMessage(channel: "call" | "message"): string {
  return channel === "message"
    ? "No usable phone number is stored. Add or choose a number to open WhatsApp."
    : "No usable phone number is stored. Add or choose a number to call.";
}

function handoffFailureMessage(channel: "call" | "message" | undefined): string {
  return channel === "message"
    ? "We couldn’t open WhatsApp with this number. Change it or choose another number."
    : "We couldn’t open the call action with this number. Change it or choose another number.";
}

function TodayHeading({
  loading = false,
  relationshipFilter,
  status = "",
  onViewUpcoming
}: {
  loading?: boolean;
  relationshipFilter?: ReactNode;
  status?: string;
  onViewUpcoming?: () => void;
}) {
  return (
    <header
      className={`page-heading compact-heading today-heading${onViewUpcoming ? " today-heading-with-action" : ""}`}
    >
      <div>
        <h2>Today</h2>
        <p>People you meant to contact.</p>
        {!loading && relationshipFilter}
      </div>
      {!loading && onViewUpcoming && (
        <button className="text-action" type="button" onClick={onViewUpcoming}>View upcoming</button>
      )}
      {!loading && <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{status}</p>}
    </header>
  );
}

export default function TodayScreen({
  activeMode = "personal",
  navigate,
  handoff = openContactHandoff,
  relationshipFilter,
  onBusyChange
}: TodayScreenProps) {
  const [projection, setProjection] = useState<TodayScreenProjection>();
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
  const [busyPersonId, setBusyPersonId] = useState("");
  const [cardErrors, setCardErrors] = useState<Record<string, CardError>>({});
  const [contactChoice, setContactChoice] = useState<ContactChoice>();
  const [contactLinkSession, setContactLinkSession] = useState<ContactImportSession>();
  const [contactLinkMethods, setContactLinkMethods] = useState<ContactMethod[]>([]);
  const [pauseChoice, setPauseChoice] = useState<PauseChoice>();
  const [expandedPersonId, setExpandedPersonId] = useState(() => storedFocusPersonId() ?? "");
  const [completionState, setCompletionState] = useState<Record<string, "saving" | "complete">>({});
  const [completionUndo, setCompletionUndo] = useState<CompletionUndo>();
  const [starterPresentation, setStarterPresentation] = useState<StarterPresentationState>({ people: {} });
  const [committedHiddenPersonIds, setCommittedHiddenPersonIds] = useState<Set<string>>(() => new Set());
  const [copiedStatus, setCopiedStatus] = useState("");
  const mountedRef = useRef(true);
  const activeModeRef = useRef(activeMode);
  const loadRequestRef = useRef(0);
  const focusPersonRef = useRef<string | undefined>(storedFocusPersonId());
  const focusIndexRef = useRef<number>();
  const contactOpenerRef = useRef<HTMLButtonElement>();
  const pauseOpenerRef = useRef<HTMLButtonElement>();
  const doneCommandsRef = useRef(new Map<string, DoneCommand>());
  const completionRemovalTimerRef = useRef<number>();
  const mutationLocksRef = useRef(new Set<string>());
  activeModeRef.current = activeMode;

  const load = useCallback(async (showLoading = false) => {
    const requestId = ++loadRequestRef.current;
    if (showLoading) setLoading(true);
    setPageError("");
    try {
      const next = await getTodayScreenProjection(await getDatabase(), createRelationshipClock(), activeModeRef.current);
      if (!mountedRef.current || requestId !== loadRequestRef.current) return false;
      setProjection(next);
      setStarterPresentation({
        localDate: next.result.localDate,
        people: Object.fromEntries(next.cards.map((card) => [
          card.person.id,
          todayStarterRotation(next.result.localDate, card.person.id, card.conversationStarters)
        ]))
      });
      setCommittedHiddenPersonIds(new Set());
      setExpandedPersonId((current) => {
        const available = new Set(next.cards.map((card) => card.person.id));
        const candidate = [
          focusPersonRef.current,
          current,
          storedExpandedPersonId(next.result.localDate, activeModeRef.current),
          next.cards[0]?.person.id
        ].find((personId): personId is string => Boolean(personId && available.has(personId)));
        if (candidate) rememberExpandedPersonId(next.result.localDate, activeModeRef.current, candidate);
        return candidate ?? "";
      });
      const requestedPersonIndex = focusPersonRef.current
        ? next.cards.findIndex((card) => card.person.id === focusPersonRef.current)
        : -1;
      setVisibleCount((current) => Math.max(
        5,
        Math.min(Math.max(current, requestedPersonIndex + 1), Math.max(5, next.cards.length))
      ));
      return true;
    } catch {
      if (mountedRef.current && requestId === loadRequestRef.current) {
        setPageError("PeopleOS could not load Today from this device.");
      }
      return false;
    } finally {
      if (mountedRef.current && requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load(true);
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, [activeMode, load]);

  useEffect(() => {
    onBusyChange?.(Boolean(busyPersonId));
  }, [busyPersonId, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  useEffect(() => () => {
    if (completionRemovalTimerRef.current !== undefined) window.clearTimeout(completionRemovalTimerRef.current);
  }, []);

  useEffect(() => {
    if (!projection) return;
    const personId = focusPersonRef.current;
    const index = focusIndexRef.current;
    focusPersonRef.current = undefined;
    focusIndexRef.current = undefined;
    requestAnimationFrame(() => {
      if (personId) {
        const card = Array.from(document.querySelectorAll<HTMLElement>("[data-today-person-id]"))
          .find((candidate) => candidate.dataset.todayPersonId === personId);
        const target = card?.querySelector<HTMLElement>(".today-card-actions button")
          ?? card?.querySelector<HTMLElement>(".today-person-link");
        if (target) {
          target.focus();
          target.scrollIntoView?.({ block: "nearest" });
          return;
        }
      }
      if (index !== undefined) {
        const cards = Array.from(document.querySelectorAll<HTMLElement>(".today-card"));
        const next = cards[Math.min(index, Math.max(0, cards.length - 1))];
        const target = next?.querySelector<HTMLElement>(".today-card-actions button")
          ?? next?.querySelector<HTMLElement>(".today-person-link");
        target?.focus();
      }
    });
  }, [projection]);

  function rememberCardPosition(card: TodayCardProjection) {
    focusIndexRef.current = projection?.cards.findIndex((candidate) => candidate.person.id === card.person.id);
  }

  function setCardError(personId: string, error?: CardError) {
    if (error && projection) {
      setExpandedPersonId(personId);
      rememberExpandedPersonId(projection.result.localDate, activeMode, personId);
    }
    setCardErrors((current) => {
      const next = { ...current };
      if (error) next[personId] = error;
      else delete next[personId];
      return next;
    });
  }

  function rememberTodayHistory(personId: string) {
    window.history.replaceState(
      {
        ...(window.history.state ?? {}),
        todayVisibleCount: visibleCount,
        todayFocusPersonId: personId,
        todayExpandedPersonId: personId
      },
      "",
      window.location.pathname
    );
  }

  function expandCard(personId: string) {
    setExpandedPersonId(personId);
    if (projection) rememberExpandedPersonId(projection.result.localDate, activeMode, personId);
  }

  function toggleCard(personId: string) {
    setCompletionUndo(undefined);
    setExpandedPersonId((current) => {
      const next = current === personId ? "" : personId;
      if (projection) rememberExpandedPersonId(projection.result.localDate, activeMode, next);
      return next;
    });
  }

  function focusCardAction(personId: string, label: string) {
    requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-today-person-id]"))
        .find((candidate) => candidate.dataset.todayPersonId === personId);
      const target = Array.from(card?.querySelectorAll<HTMLButtonElement>(".today-card-actions button, .today-card-links button") ?? [])
        .find((button) => button.textContent?.trim() === label);
      target?.focus();
    });
  }

  function focusAfterCardRemoval(personId?: string, removedPersonId?: string) {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const removedCard = removedPersonId
        ? document.querySelector<HTMLElement>(`[data-today-person-id="${CSS.escape(removedPersonId)}"]`)
        : undefined;
      const focusStillBelongsToRemoval = active === document.body
        || active === document.documentElement
        || active === null
        || Boolean(removedCard?.contains(active));
      if (!focusStillBelongsToRemoval || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const card = personId
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-today-person-id]"))
            .find((candidate) => candidate.dataset.todayPersonId === personId)
        : undefined;
      const target = card?.querySelector<HTMLElement>(".today-card-actions button")
        ?? card?.querySelector<HTMLElement>(".today-person-link")
        ?? document.querySelector<HTMLElement>(".today-completion-undo button")
        ?? document.querySelector<HTMLElement>("#main-content");
      target?.focus();
    });
  }

  function openContactMethods(card: TodayCardProjection, autoAddPhone: boolean) {
    rememberTodayHistory(card.person.id);
    navigate(contactMethodsPath(card.person.id), {
      state: {
        fromPath: "/",
        autoAddPhone,
        todayOriginPrepared: true,
        todayVisibleCount: visibleCount,
        todayFocusPersonId: card.person.id
      }
    });
  }

  async function latestContactProjection(card: TodayCardProjection): Promise<ContactNowProjection> {
    return getContactNowProjection(await getDatabase(), card.person.id);
  }

  async function launchTarget(
    card: TodayCardProjection,
    target: ContactNowTarget,
    intent: Pick<ContactChoice, "requestedChannel" | "messageIntent"> = {}
  ) {
    setBusyPersonId(card.person.id);
    setCardError(card.person.id);
    try {
      const current = await revalidateContactNowTarget(await getDatabase(), card.person.id, target);
      if (!current) {
        const next = await latestContactProjection(card);
        setContactChoice({
          card,
          projection: { ...next, targets: targetsForChannel(next, intent.requestedChannel) },
          ...intent,
          selectedTargetId: targetsForChannel(next, intent.requestedChannel)[0]?.id,
          error: "That phone number is no longer available. Choose or add another number."
        });
        return;
      }
      const href = intent.requestedChannel === "message"
        ? current.channel === "phone_call"
          ? whatsappTargetHref(current, intent.messageIntent?.draft)
          : contactNowTargetHref(current, intent.messageIntent?.draft)
        : contactNowTargetHref(current);
      await handoff(href);
      // The external composer/call handoff is the completion boundary for the
      // chooser. Release the UI immediately; starter history can persist after
      // the person is free to keep using PeopleOS.
      setContactChoice(undefined);
      setBusyPersonId("");
      focusCardAction(card.person.id, intent.requestedChannel === "call" ? "Call" : "Message");
      const messageIntent = intent.requestedChannel === "message" ? intent.messageIntent : undefined;
      if (messageIntent) {
        void (async () => {
          await recordConversationStarterUse(await getDatabase(), {
            id: `conversation-starter-use-${crypto.randomUUID()}`,
            personId: card.person.id,
            starterId: messageIntent.starterId,
            starterTemplate: messageIntent.starterTemplate,
            occurredAt: new Date().toISOString()
          });
          await load();
        })().catch(() => {
          setCopiedStatus("Message opened, but PeopleOS could not save starter history this time.");
        });
      }
    } catch {
      const next = await latestContactProjection(card).catch(() => card.contact);
      setContactChoice({
        card,
        projection: { ...next, targets: targetsForChannel(next, intent.requestedChannel) },
        ...intent,
        selectedTargetId: targetsForChannel(next, intent.requestedChannel).find((candidate) => candidate.contactMethodId === target.contactMethodId)?.id
          ?? targetsForChannel(next, intent.requestedChannel)[0]?.id,
        error: handoffFailureMessage(intent.requestedChannel),
        copyValue: target.canonicalValue
      });
      setCardError(card.person.id, {
        message: handoffFailureMessage(intent.requestedChannel),
        copyValue: target.canonicalValue,
        ...(intent.requestedChannel ? { retry: intent.requestedChannel } : {}),
        ...(intent.messageIntent ? { messageIntent: intent.messageIntent } : {})
      });
    } finally {
      setBusyPersonId("");
    }
  }

  async function contactVia(
    card: TodayCardProjection,
    channel: "call" | "message",
    messageIntent?: ConversationStarterMessageIntent,
    opener?: HTMLButtonElement
  ) {
    setCompletionUndo(undefined);
    if (opener) contactOpenerRef.current = opener;
    setBusyPersonId(card.person.id);
    setCardError(card.person.id);
    try {
      const current = await latestContactProjection(card);
      const targets = targetsForChannel(current, channel);
      const target = targets[0];
      if (target) {
        await launchTarget(card, target, {
          requestedChannel: channel,
          ...(messageIntent ? { messageIntent } : {})
        });
        return;
      }
      setContactChoice({
        card,
        projection: { ...current, targets },
        requestedChannel: channel,
        messageIntent,
        error: missingPhoneMessage(channel)
      });
    } catch {
      setCardError(card.person.id, {
        message: `PeopleOS could not open ${channel} yet.`,
        retry: channel,
        ...(messageIntent ? { messageIntent } : {})
      });
    } finally {
      setBusyPersonId("");
    }
  }

  async function saveManualDestination(input: {
    targetId?: string;
    kind: "phone" | "email";
    value: string;
  }): Promise<boolean> {
    if (!contactChoice) return false;
    const choice = contactChoice;
    setBusyPersonId(choice.card.person.id);
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
        const draft = createContactMethodDraft(choice.card.person.id, input.kind);
        saved = await addContactMethod(db, { ...draft, value: input.value }, settings.defaultPhoneRegion, {
          enforceDuplicateReview: true
        });
      }
      const current = await latestContactProjection(choice.card);
      const targets = targetsForChannel(current, choice.requestedChannel);
      setContactChoice({
        ...choice,
        projection: { ...current, targets },
        selectedTargetId: targets.find((candidate) => candidate.contactMethodId === saved.id)?.id
          ?? targets[0]?.id,
        error: undefined,
        copyValue: undefined
      });
      setCardError(choice.card.person.id);
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
      setBusyPersonId("");
    }
  }

  async function chooseIPhoneContactForDestination() {
    if (!contactChoice) return;
    const choice = contactChoice;
    const adapter = getIPhoneContactsAdapter();
    if (!adapter) {
      setContactChoice({ ...choice, error: "iPhone Contacts are unavailable right now. You can still type the detail manually.", copyValue: undefined });
      return;
    }
    setBusyPersonId(choice.card.person.id);
    setContactChoice({ ...choice, error: undefined, copyValue: undefined });
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
      setContactLinkMethods(await listContactMethodsForPerson(db, choice.card.person.id));
      setContactLinkSession(session);
    } catch (error) {
      setContactChoice({ ...choice, error: iPhoneContactPickerError(error), copyValue: undefined });
    } finally {
      setBusyPersonId("");
    }
  }

  async function addSelectedIPhoneDetails(selection: PersonContactLinkSelection) {
    if (!contactChoice || !contactLinkSession) return;
    const choice = contactChoice;
    setBusyPersonId(choice.card.person.id);
    try {
      const reviewedSession: ContactImportSession = {
        ...contactLinkSession,
        rows: contactLinkSession.rows.map((row) => row.id === selection.row.id
          ? chooseLinkDetailsForExistingPerson(
              row,
              choice.card.person,
              selection.contactMethodIds,
              selection.includeAffiliation,
              selection.includeDisplayName
            )
          : skipContactImportRow(row))
      };
      const result = await importSelectedContacts(await getDatabase(), reviewedSession);
      const linkedRow = result.rows.find((row) => row.id === selection.row.id);
      if (!linkedRow || linkedRow.status === "failed") {
        setContactChoice({ ...choice, error: linkedRow?.error ?? "PeopleOS could not add those details. Nothing was changed." });
        return;
      }
      const db = await getDatabase();
      const [current, updatedPerson] = await Promise.all([
        getContactNowProjection(db, choice.card.person.id),
        db.get("people", choice.card.person.id)
      ]);
      const targets = targetsForChannel(current, choice.requestedChannel);
      const nextCard = updatedPerson ? { ...choice.card, person: updatedPerson } : choice.card;
      const originalStarterDraft = choice.messageIntent
        ? choice.messageIntent.starterTemplate.replaceAll("{name}", conversationalNameFor(choice.card.person))
        : undefined;
      const nextMessageIntent = choice.messageIntent && updatedPerson
        ? {
            ...choice.messageIntent,
            draft: choice.messageIntent.draft === originalStarterDraft
              ? choice.messageIntent.starterTemplate.replaceAll("{name}", conversationalNameFor(updatedPerson))
              : choice.messageIntent.draft
          }
        : choice.messageIntent;
      setContactChoice({
        ...choice,
        card: nextCard,
        projection: { ...current, targets },
        ...(nextMessageIntent ? { messageIntent: nextMessageIntent } : {}),
        selectedTargetId: targets.find((candidate) => selection.contactMethodIds.includes(candidate.contactMethodId))?.id
          ?? choice.selectedTargetId
          ?? targets[0]?.id,
        error: undefined,
        copyValue: undefined
      });
      setCardError(choice.card.person.id);
      setContactLinkSession(undefined);
      setContactLinkMethods([]);
      await load();
    } catch (error) {
      setContactChoice({ ...choice, error: firstIssue(error, "PeopleOS could not add those contact details.") });
    } finally {
      setBusyPersonId("");
    }
  }

  function openPause(card: TodayCardProjection, opener?: HTMLButtonElement) {
    setCompletionUndo(undefined);
    if (opener) pauseOpenerRef.current = opener;
    setCardError(card.person.id);
    setPauseChoice({ card });
  }

  function closePause() {
    if (busyPersonId) return;
    setPauseChoice(undefined);
    requestAnimationFrame(() => pauseOpenerRef.current?.focus());
  }

  async function pauseAction(card: TodayCardProjection, untilDate: LocalDate) {
    if (mutationLocksRef.current.size > 0) return;
    mutationLocksRef.current.add(card.person.id);
    rememberCardPosition(card);
    setBusyPersonId(card.person.id);
    setPauseChoice({ card });
    setCardError(card.person.id);
    try {
      const clock = createRelationshipClock();
      const currentLocalDate = localDateForInstant(clock.now, clock.timeZone);
      const openedLocalDate = projection?.result.localDate;
      if (currentLocalDate !== openedLocalDate) {
        setPauseChoice(undefined);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, {
          message: "Today moved to a new day. The list has been refreshed; choose Pause again."
        });
        return;
      }
      const context = await getTodayActionContext(await getDatabase(), card.person.id, clock, activeMode);
      if (!context) throw new Error("This person is no longer due today.");
      if (context.projection.result.localDate !== openedLocalDate) {
        setPauseChoice(undefined);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, {
          message: "Today moved to a new day. The list has been refreshed; choose Pause again."
        });
        return;
      }
      await pauseToday(
        await getDatabase(),
        preparePauseTodayCommand(context, untilDate, { now: clock.now })
      );
      setPauseChoice(undefined);
      await load();
      setCommittedHiddenPersonIds((current) => new Set(current).add(card.person.id));
      const nextCard = projection?.cards.find((candidate) => candidate.person.id !== card.person.id);
      if (nextCard) expandCard(nextCard.person.id);
      focusAfterCardRemoval(nextCard?.person.id, card.person.id);
    } catch (error) {
      if (error instanceof StaleRevisionError) {
        setPauseChoice(undefined);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, {
          message: "This changed elsewhere. Today has been reloaded; choose Pause again."
        });
      } else {
        setPauseChoice({
          card,
          error: firstIssue(error, "PeopleOS could not pause this person yet.")
        });
      }
    } finally {
      mutationLocksRef.current.delete(card.person.id);
      setBusyPersonId("");
    }
  }

  async function doneAction(card: TodayCardProjection) {
    if (mutationLocksRef.current.size > 0) return;
    setCompletionUndo(undefined);
    mutationLocksRef.current.add(card.person.id);
    rememberCardPosition(card);
    setBusyPersonId(card.person.id);
    setCompletionState((current) => ({ ...current, [card.person.id]: "saving" }));
    setCardError(card.person.id);
    try {
      const clock = createRelationshipClock();
      const currentLocalDate = localDateForInstant(clock.now, clock.timeZone);
      const openedLocalDate = projection?.result.localDate;
      if (currentLocalDate !== openedLocalDate) {
        doneCommandsRef.current.delete(card.person.id);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, {
          message: "Today moved to a new day. The list has been refreshed; mark them complete again."
        });
        return;
      }
      let prepared = doneCommandsRef.current.get(card.person.id);
      if (prepared && prepared.command.localDate !== currentLocalDate) {
        doneCommandsRef.current.delete(card.person.id);
        prepared = undefined;
      }
      if (!prepared) {
        const context = await getTodayActionContext(await getDatabase(), card.person.id, clock, activeMode);
        if (!context) throw new Error("This person is no longer due today.");
        if (context.projection.result.localDate !== openedLocalDate) {
          focusPersonRef.current = card.person.id;
          await load();
          setCardError(card.person.id, {
            message: "Today moved to a new day. The list has been refreshed; mark them complete again."
          });
          return;
        }
        const occurredAt = new Date().toISOString();
        const cadence = contactCadenceOf(context.card.person);
        const reminderDays = cadence
          ? contactCadenceInDays(cadence)
          : context.alreadyContactedDefaultReminderDays;
        const nextDate = addDaysToLocalDate(context.projection.result.localDate, reminderDays);
        prepared = {
          command: prepareAlreadyContactedCommand(context, nextDate, {
            now: occurredAt,
            suppressNextFollowUp: Boolean(context.card.reachOut)
          }),
          personBefore: context.card.person
        };
        doneCommandsRef.current.set(card.person.id, prepared);
      }
      const result: AlreadyContactedResult = await alreadyContacted(await getDatabase(), prepared.command);
      const receipt = createTodayCompletionReceipt(prepared.command, result, prepared.personBefore);
      doneCommandsRef.current.delete(card.person.id);
      setCompletionState((current) => ({ ...current, [card.person.id]: "complete" }));
      setCompletionUndo({
        personId: card.person.id,
        personName: card.person.conversationalName?.trim() || card.person.displayName,
        receipt
      });
      if (completionRemovalTimerRef.current !== undefined) window.clearTimeout(completionRemovalTimerRef.current);
      completionRemovalTimerRef.current = window.setTimeout(() => {
        const nextCard = projection?.cards.find((candidate) =>
          candidate.person.id !== card.person.id && !committedHiddenPersonIds.has(candidate.person.id));
        setCommittedHiddenPersonIds((current) => {
          const next = new Set(current).add(card.person.id);
          if (nextCard) {
            focusPersonRef.current = nextCard.person.id;
            expandCard(nextCard.person.id);
          }
          return next;
        });
        setCompletionState((current) => {
          const next = { ...current };
          delete next[card.person.id];
          return next;
        });
        completionRemovalTimerRef.current = undefined;
        focusAfterCardRemoval(nextCard?.person.id, card.person.id);
        void load();
      }, 320);
    } catch (error) {
      if (error instanceof StaleRevisionError) {
        doneCommandsRef.current.delete(card.person.id);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, { message: "This changed elsewhere. Today has been reloaded; mark them complete again." });
      } else {
        setCardError(card.person.id, {
          message: firstIssue(error, "PeopleOS could not complete this person yet."),
          retry: "done"
        });
      }
      setCompletionState((current) => {
        const next = { ...current };
        delete next[card.person.id];
        return next;
      });
    } finally {
      mutationLocksRef.current.delete(card.person.id);
      setBusyPersonId("");
      setCompletionState((current) => {
        if (current[card.person.id] !== "saving") return current;
        const next = { ...current };
        delete next[card.person.id];
        return next;
      });
    }
  }

  async function undoCompletion() {
    const undo = completionUndo;
    if (!undo || mutationLocksRef.current.size > 0) return;
    mutationLocksRef.current.add(undo.personId);
    setBusyPersonId(undo.personId);
    try {
      if (completionRemovalTimerRef.current !== undefined) {
        window.clearTimeout(completionRemovalTimerRef.current);
        completionRemovalTimerRef.current = undefined;
      }
      await undoAlreadyContacted(await getDatabase(), undo.receipt);
      setCompletionUndo(undefined);
      setCompletionState((current) => {
        const next = { ...current };
        delete next[undo.personId];
        return next;
      });
      setCommittedHiddenPersonIds((current) => {
        const next = new Set(current);
        next.delete(undo.personId);
        return next;
      });
      focusPersonRef.current = undo.personId;
      expandCard(undo.personId);
      await load();
      setCopiedStatus(`${undo.personName} restored.`);
    } catch (error) {
      setCompletionUndo(undefined);
      setCopiedStatus(firstIssue(error, "PeopleOS could not undo that completion."));
      await load();
      focusAfterCardRemoval(undefined, undo.personId);
    } finally {
      mutationLocksRef.current.delete(undo.personId);
      setBusyPersonId("");
    }
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedStatus("Contact detail copied.");
    } catch {
      setCopiedStatus("PeopleOS could not copy this contact detail.");
    }
  }

  function closeContactChoice() {
    if (busyPersonId) return;
    setContactChoice(undefined);
    setContactLinkSession(undefined);
    setContactLinkMethods([]);
    requestAnimationFrame(() => contactOpenerRef.current?.focus());
  }

  function closeContactLinkReview() {
    if (busyPersonId) return;
    setContactLinkSession(undefined);
    setContactLinkMethods([]);
  }

  if (loading && !projection) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1} aria-busy="true">
        <TodayHeading loading relationshipFilter={relationshipFilter} />
        <p className="screen-status" role="status">Loading Today…</p>
      </main>
    );
  }

  if (!projection) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <TodayHeading relationshipFilter={relationshipFilter} status={copiedStatus} />
        <div className="section-error"><p role="alert">{pageError}</p><button type="button" onClick={() => void load(true)}>Retry</button></div>
      </main>
    );
  }

  const visibleCards = projection.cards
    .filter((card) => !committedHiddenPersonIds.has(card.person.id))
    .slice(0, visibleCount);
  const hasMore = projection.cards.length > visibleCount;
  const incompleteRegularContactPerson = projection.incompleteRegularContactPeople[0];
  const regularContactPrompt = incompleteRegularContactPerson ? (
    <RegularContactStartPrompt
      personId={incompleteRegularContactPerson.id}
      personName={incompleteRegularContactPerson.displayName}
      onStarted={async () => { await load(); }}
    />
  ) : undefined;
  const completionUndoNotice = completionUndo ? (
    <div className="today-completion-undo" role="status" aria-live="polite">
      <span>{completionUndo.personName} completed</span>
      <span aria-hidden="true"> · </span>
      <button type="button" disabled={Boolean(busyPersonId)} onClick={() => void undoCompletion()}>Undo</button>
    </div>
  ) : undefined;

  if (visibleCards.length === 0 && projection.totalActivePersonCount === 0) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <TodayHeading relationshipFilter={relationshipFilter} status={copiedStatus} />
        {completionUndoNotice}
        <EmptyState
          title="Who do you want to remember?"
          description="Add the people you mean to keep in touch with."
          action={<button className="primary-action" type="button" onClick={() => navigate("/people/new")}><Icon name="plus" /> Add someone</button>}
        />
      </main>
    );
  }

  if (projection.cards.length === 0 && incompleteRegularContactPerson) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <TodayHeading relationshipFilter={relationshipFilter} status={copiedStatus} />
        {completionUndoNotice}
        {pageError && <div className="section-error"><p role="alert">{pageError}</p><button type="button" onClick={() => void load()}>Retry</button></div>}
        {projection.evaluationIssues.length > 0 && (
          <div className="today-evaluation-notice">
            <p role="status">{projection.evaluationIssues.length === 1 ? "One person could not be checked" : `${projection.evaluationIssues.length} people could not be checked`}</p>
            <button type="button" onClick={() => void load()}>Retry</button>
          </div>
        )}
        {regularContactPrompt}
      </main>
    );
  }

  if (projection.cards.length === 0 && projection.evaluationIssues.length > 0) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <TodayHeading relationshipFilter={relationshipFilter} status={copiedStatus} />
        {completionUndoNotice}
        <div className="today-evaluation-notice">
          <p role="alert">{projection.evaluationIssues.length === 1 ? "One person could not be checked" : `${projection.evaluationIssues.length} people could not be checked`}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
        <EmptyState
          title="Today could not check everyone."
          description="Retry before treating the list as complete."
          headingLevel={3}
        />
      </main>
    );
  }

  if (visibleCards.length === 0) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <TodayHeading relationshipFilter={relationshipFilter} status={copiedStatus} />
        {completionUndoNotice}
        {pageError && <div className="section-error"><p role="alert">{pageError}</p><button type="button" onClick={() => void load()}>Retry</button></div>}
        <EmptyState
          title="That’s everyone for today."
          description="PeopleOS will bring someone back to mind when the time is right."
          mark="check"
          action={<button className="secondary-action" type="button" onClick={() => navigate("/upcoming")}>View upcoming</button>}
        />
      </main>
    );
  }

  return (
    <main className="screen today-screen" id="main-content" tabIndex={-1}>
      <TodayHeading
        relationshipFilter={relationshipFilter}
        status={copiedStatus}
        onViewUpcoming={() => navigate("/upcoming")}
      />
      {regularContactPrompt}
      {pageError && <div className="section-error"><p role="alert">{pageError}</p><button type="button" onClick={() => void load()}>Retry</button></div>}
      {projection.evaluationIssues.length > 0 && (
        <div className="today-evaluation-notice">
          <p role="status">{projection.evaluationIssues.length === 1 ? "One person could not be checked" : `${projection.evaluationIssues.length} people could not be checked`}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      <div className="today-list" aria-label="People to contact today">
        {visibleCards.map((card) => {
          const error = cardErrors[card.person.id];
          const rotation = starterPresentation.localDate === projection.result.localDate
            ? starterPresentation.people[card.person.id]
            : undefined;
          const resolvedRotation = rotation ?? {
            suggestions: card.conversationStarters,
            selectedStarterId: card.conversationStarters[0]?.id
          };
          const rotatedCard = { ...card, conversationStarters: resolvedRotation.suggestions };
          return (
            <TodayCard
              key={card.person.id}
              card={rotatedCard}
              busy={Boolean(busyPersonId)}
              expanded={expandedPersonId === card.person.id}
              selectedStarterId={resolvedRotation.selectedStarterId}
              completionState={completionState[card.person.id] ?? "idle"}
              error={error?.message}
              copyValue={error?.copyValue}
              onMessage={(intent) => void contactVia(card, "message", intent, document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined)}
              onCall={() => void contactVia(card, "call", undefined, document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined)}
              onAnother={() => {
                setCompletionUndo(undefined);
                const next = advanceTodayStarter(
                  projection.result.localDate,
                  card.person.id,
                  resolvedRotation.suggestions,
                  { selectedStarterId: resolvedRotation.selectedStarterId }
                );
                setStarterPresentation((current) => ({
                  localDate: projection.result.localDate,
                  people: { ...current.people, [card.person.id]: next }
                }));
              }}
              onExpand={() => toggleCard(card.person.id)}
              onComplete={() => void doneAction(card)}
              onNotToday={() => openPause(card, document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined)}
              onProfile={() => {
                rememberTodayHistory(card.person.id);
                navigate(personProfilePath(card.person.id), { state: { fromPath: "/", todayOriginPrepared: true } });
              }}
              onRetry={error?.retry === "message"
                ? () => void contactVia(card, "message", error.messageIntent)
                : error?.retry === "call"
                  ? () => void contactVia(card, "call")
                  : error?.retry === "done" ? () => void doneAction(card) : undefined}
              onCopy={error?.copyValue ? () => void copyValue(error.copyValue!) : undefined}
            />
          );
        })}
      </div>
      {completionUndoNotice}
      {hasMore && <button className="today-show-more" type="button" onClick={() => setVisibleCount((current) => current + 5)}>Show more people</button>}

      {contactChoice && !contactLinkSession && (
        <ContactMethodChoiceSheet
          recoveryMode
          personName={conversationalNameFor(contactChoice.card.person)}
          targets={contactChoice.projection.targets}
          selectedTargetId={contactChoice.selectedTargetId}
          error={contactChoice.error}
          copyValue={contactChoice.copyValue}
          requestedChannel={contactChoice.requestedChannel}
          messageDraft={contactChoice.messageIntent?.draft}
          saving={busyPersonId === contactChoice.card.person.id}
          iPhoneContactsAvailable={isIPhoneContactsSupported()}
          onSelect={(targetId) => {
            setCardError(contactChoice.card.person.id);
            setContactChoice((current) => current ? {
              ...current,
              selectedTargetId: targetId,
              error: undefined,
              copyValue: undefined
            } : current);
          }}
          onContinue={(targetId) => {
            const target = contactChoice.projection.targets.find((candidate) => candidate.id === targetId);
            if (target) void launchTarget(contactChoice.card, target, {
              requestedChannel: contactChoice.requestedChannel,
              messageIntent: contactChoice.messageIntent
            });
          }}
          onMessageDraftChange={(draft) => setContactChoice((current) => current?.messageIntent
            ? { ...current, messageIntent: { ...current.messageIntent, draft } }
            : current)}
          onSaveManual={saveManualDestination}
          onChooseIPhoneContact={chooseIPhoneContactForDestination}
          onManage={() => openContactMethods(contactChoice.card, false)}
          onCopy={contactChoice.copyValue ? () => void copyValue(contactChoice.copyValue!) : undefined}
          onClose={closeContactChoice}
        />
      )}
      {contactChoice && contactLinkSession && (
        <ContactLinkReviewSheet
          saving={busyPersonId === contactChoice.card.person.id}
          onClose={closeContactLinkReview}
        >
          <PersonContactLinkReview
            session={contactLinkSession}
            targetPerson={contactChoice.card.person}
            targetContactMethods={contactLinkMethods}
            busy={busyPersonId === contactChoice.card.person.id}
            error={contactChoice.error}
            onCancel={closeContactLinkReview}
            onSubmit={(selection) => void addSelectedIPhoneDetails(selection)}
          />
        </ContactLinkReviewSheet>
      )}
      {pauseChoice && (
        <PauseTodaySheet
          personName={conversationalNameFor(pauseChoice.card.person)}
          todayDate={projection.result.localDate}
          saving={busyPersonId === pauseChoice.card.person.id}
          error={pauseChoice.error}
          onChooseDate={(date) => void pauseAction(pauseChoice.card, date)}
          onClose={closePause}
        />
      )}
    </main>
  );
}
