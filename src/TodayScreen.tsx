import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import RegularContactStartPrompt from "./RegularContactStartPrompt";
import TodayCard from "./TodayCard";
import { ContactMethodChoiceSheet, PauseTodaySheet } from "./TodaySheets";
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
  type AlreadyContactedCommand
} from "./application/todayActions";
import {
  completeReachOut,
  prepareCompleteReachOutCommand,
  type CompleteReachOutCommand
} from "./application/reachOut";
import {
  getTodayActionContext,
  getTodayScreenProjection,
  type TodayCardProjection,
  type TodayScreenProjection
} from "./application/todayQueries";
import { createRelationshipClock } from "./application/relationshipEngineQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { StaleRevisionError } from "./data/repositories";
import { contactCadenceInDays, contactCadenceOf } from "./domain/cadence";
import { addDaysToLocalDate, localDateForInstant } from "./domain/followUpPolicy";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import type { LocalDate } from "./domain/schema";
import type { ContactHandoff } from "./integrations/contactHandoff";
import { openContactHandoff } from "./integrations/contactHandoff";
import { contactMethodsPath, personProfilePath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type TodayScreenProps = {
  activeMode?: ActiveRelationshipMode;
  navigate: Navigate;
  /** Retained for test/integration callers; follow-up creation now lives with People. */
  onAddFollowUp?: () => void;
  handoff?: ContactHandoff;
  relationshipFilter?: ReactNode;
};

type CardError = {
  message: string;
  copyValue?: string;
  retry?: "call" | "message" | "done";
  messageDraft?: string;
};

type ContactChoice = {
  card: TodayCardProjection;
  projection: ContactNowProjection;
  error?: string;
  copyValue?: string;
  requestedChannel?: "call" | "message";
  messageDraft?: string;
};

type PauseChoice = {
  card: TodayCardProjection;
  error?: string;
};

type DoneCommand =
  | { kind: "regular"; command: AlreadyContactedCommand }
  | { kind: "reach_out"; command: CompleteReachOutCommand };

function firstIssue(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
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

function targetsForChannel(
  projection: ContactNowProjection,
  channel: "call" | "message" | undefined
): ContactNowTarget[] {
  if (channel === "call") return projection.targets.filter((target) => target.channel === "phone_call");
  if (channel === "message") return projection.targets.filter((target) => target.channel === "phone_call" || target.channel === "email");
  return [...projection.targets];
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
  relationshipFilter
}: TodayScreenProps) {
  const [projection, setProjection] = useState<TodayScreenProjection>();
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
  const [busyPersonId, setBusyPersonId] = useState("");
  const [cardErrors, setCardErrors] = useState<Record<string, CardError>>({});
  const [contactChoice, setContactChoice] = useState<ContactChoice>();
  const [pauseChoice, setPauseChoice] = useState<PauseChoice>();
  const [committedHiddenPersonIds, setCommittedHiddenPersonIds] = useState<Set<string>>(() => new Set());
  const [copiedStatus, setCopiedStatus] = useState("");
  const mountedRef = useRef(true);
  const focusPersonRef = useRef<string | undefined>(storedFocusPersonId());
  const focusIndexRef = useRef<number>();
  const contactOpenerRef = useRef<HTMLButtonElement>();
  const pauseOpenerRef = useRef<HTMLButtonElement>();
  const doneCommandsRef = useRef(new Map<string, DoneCommand>());
  const mutationLocksRef = useRef(new Set<string>());

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setPageError("");
    try {
      const next = await getTodayScreenProjection(await getDatabase(), createRelationshipClock(), activeMode);
      if (!mountedRef.current) return;
      setProjection(next);
      setCommittedHiddenPersonIds(new Set());
      setVisibleCount((current) => Math.max(5, Math.min(current, Math.max(5, next.cards.length))));
      return true;
    } catch {
      if (mountedRef.current) setPageError("PeopleOS could not load Today from this device.");
      return false;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [activeMode]);

  useEffect(() => {
    mountedRef.current = true;
    void load(true);
    return () => { mountedRef.current = false; };
  }, [load]);

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
    setCardErrors((current) => {
      const next = { ...current };
      if (error) next[personId] = error;
      else delete next[personId];
      return next;
    });
  }

  function rememberTodayHistory(personId: string) {
    window.history.replaceState(
      { ...(window.history.state ?? {}), todayVisibleCount: visibleCount, todayFocusPersonId: personId },
      "",
      window.location.pathname
    );
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
    intent: Pick<ContactChoice, "requestedChannel" | "messageDraft"> = {}
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
          error: "That contact method is no longer available. Choose another option."
        });
        return;
      }
      const href = intent.requestedChannel === "message"
        ? current.channel === "phone_call"
          ? whatsappTargetHref(current, intent.messageDraft)
          : contactNowTargetHref(current, intent.messageDraft)
        : contactNowTargetHref(current);
      await handoff(href);
      setContactChoice(undefined);
      focusCardAction(card.person.id, intent.requestedChannel === "call" ? "Call" : "Message");
    } catch {
      const next = await latestContactProjection(card).catch(() => card.contact);
      setContactChoice({
        card,
        projection: { ...next, targets: targetsForChannel(next, intent.requestedChannel) },
        ...intent,
        error: "PeopleOS could not open that contact method. Copy it, choose another option, or manage contact details.",
        copyValue: target.canonicalValue
      });
      setCardError(card.person.id, {
        message: "PeopleOS could not open that contact method. You can copy it or manage contact details.",
        copyValue: target.canonicalValue,
        ...(intent.requestedChannel ? { retry: intent.requestedChannel } : {}),
        ...(intent.messageDraft ? { messageDraft: intent.messageDraft } : {})
      });
    } finally {
      setBusyPersonId("");
    }
  }

  async function contactVia(
    card: TodayCardProjection,
    channel: "call" | "message",
    messageDraft?: string,
    opener?: HTMLButtonElement
  ) {
    if (opener) contactOpenerRef.current = opener;
    setBusyPersonId(card.person.id);
    setCardError(card.person.id);
    try {
      const current = await latestContactProjection(card);
      const targets = targetsForChannel(current, channel);
      if (targets.length === 0) {
        openContactMethods(card, true);
      } else if (targets.length === 1) {
        await launchTarget(card, targets[0], { requestedChannel: channel, messageDraft });
      } else {
        setContactChoice({
          card,
          projection: { ...current, targets },
          requestedChannel: channel,
          messageDraft
        });
      }
    } catch {
      setCardError(card.person.id, {
        message: `PeopleOS could not open ${channel} yet.`,
        retry: channel,
        ...(messageDraft ? { messageDraft } : {})
      });
    } finally {
      setBusyPersonId("");
    }
  }

  function openPause(card: TodayCardProjection, opener?: HTMLButtonElement) {
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
    mutationLocksRef.current.add(card.person.id);
    rememberCardPosition(card);
    setBusyPersonId(card.person.id);
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
          message: "Today moved to a new day. The list has been refreshed; choose Done again."
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
            message: "Today moved to a new day. The list has been refreshed; choose Done again."
          });
          return;
        }
        const occurredAt = new Date().toISOString();
        if (context.card.reachOut) {
          prepared = {
            kind: "reach_out",
            command: prepareCompleteReachOutCommand(
              context.card.reachOut.entry,
              context.card.person,
              context.card.primaryFollowUp,
              { logInteraction: { kind: "contacted", occurredAt } },
              {
                now: occurredAt,
                localDate: context.projection.result.localDate,
                completionOrigin: "already_contacted"
              }
            )
          };
        } else {
          const cadence = contactCadenceOf(context.card.person);
          const reminderDays = cadence
            ? contactCadenceInDays(cadence)
            : context.alreadyContactedDefaultReminderDays;
          const nextDate = addDaysToLocalDate(context.projection.result.localDate, reminderDays);
          prepared = {
            kind: "regular",
            command: prepareAlreadyContactedCommand(context, nextDate, { now: occurredAt })
          };
        }
        doneCommandsRef.current.set(card.person.id, prepared);
      }
      if (prepared.kind === "reach_out") {
        await completeReachOut(await getDatabase(), prepared.command);
      } else {
        await alreadyContacted(await getDatabase(), prepared.command);
      }
      doneCommandsRef.current.delete(card.person.id);
      await load();
      setCommittedHiddenPersonIds((current) => new Set(current).add(card.person.id));
    } catch (error) {
      if (error instanceof StaleRevisionError) {
        doneCommandsRef.current.delete(card.person.id);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, { message: "This changed elsewhere. Today has been reloaded; choose Done again." });
      } else {
        setCardError(card.person.id, {
          message: firstIssue(error, "PeopleOS could not mark this as done yet."),
          retry: "done"
        });
      }
    } finally {
      mutationLocksRef.current.delete(card.person.id);
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
    setContactChoice(undefined);
    requestAnimationFrame(() => contactOpenerRef.current?.focus());
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

  if (visibleCards.length === 0 && projection.totalActivePersonCount === 0) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <TodayHeading relationshipFilter={relationshipFilter} status={copiedStatus} />
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

  if (projection.cards.length === 0) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <TodayHeading relationshipFilter={relationshipFilter} status={copiedStatus} />
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
          return (
            <TodayCard
              key={card.person.id}
              card={card}
              busy={Boolean(busyPersonId)}
              error={error?.message}
              copyValue={error?.copyValue}
              onMessage={(draft) => void contactVia(card, "message", draft, document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined)}
              onCall={() => void contactVia(card, "call", undefined, document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined)}
              onDone={() => void doneAction(card)}
              onPause={() => openPause(card, document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined)}
              onProfile={() => {
                rememberTodayHistory(card.person.id);
                navigate(personProfilePath(card.person.id), { state: { fromPath: "/", todayOriginPrepared: true } });
              }}
              onRetry={error?.retry === "message"
                ? () => void contactVia(card, "message", error.messageDraft)
                : error?.retry === "call"
                  ? () => void contactVia(card, "call")
                  : error?.retry === "done" ? () => void doneAction(card) : undefined}
              onCopy={error?.copyValue ? () => void copyValue(error.copyValue!) : undefined}
            />
          );
        })}
      </div>
      {hasMore && <button className="today-show-more" type="button" onClick={() => setVisibleCount((current) => current + 5)}>Show more people</button>}

      {contactChoice && (
        <ContactMethodChoiceSheet
          personName={contactChoice.card.person.displayName}
          targets={contactChoice.projection.targets}
          hasPhone={contactChoice.projection.hasActivePhone}
          error={contactChoice.error}
          copyValue={contactChoice.copyValue}
          requestedChannel={contactChoice.requestedChannel}
          onChoose={(targetId) => {
            const target = contactChoice.projection.targets.find((candidate) => candidate.id === targetId);
            if (target) void launchTarget(contactChoice.card, target, {
              requestedChannel: contactChoice.requestedChannel,
              messageDraft: contactChoice.messageDraft
            });
          }}
          onAddPhone={() => openContactMethods(contactChoice.card, true)}
          onManage={() => openContactMethods(contactChoice.card, false)}
          onCopy={contactChoice.copyValue ? () => void copyValue(contactChoice.copyValue!) : undefined}
          onClose={closeContactChoice}
        />
      )}
      {pauseChoice && (
        <PauseTodaySheet
          personName={pauseChoice.card.person.displayName}
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
