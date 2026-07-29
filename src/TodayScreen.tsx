import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import EmptyState from "./EmptyState";
import { Icon } from "./icons";
import TodayCard from "./TodayCard";
import {
  ContactMethodChoiceSheet,
  ExplanationSheet,
  NextReminderSheet
} from "./TodaySheets";
import {
  contactNowTargetHref,
  getContactNowProjection,
  revalidateContactNowTarget,
  type ContactNowProjection,
  type ContactNowTarget
} from "./application/contactNow";
import { notToday, type NotTodayCommand } from "./application/followUps";
import { deferRegularReminder, pauseRegularReminder } from "./application/cadence";
import { removeTodayNote, saveTodayNote, setTodayNoteCompleted } from "./application/todayNotes";
import {
  alreadyContacted,
  prepareAlreadyContactedCommand,
  prepareNotTodayFromContext,
  type AlreadyContactedCommand
} from "./application/todayActions";
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
import { addDaysToLocalDate, localDateForInstant } from "./domain/followUpPolicy";
import type { LocalDate } from "./domain/schema";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import type { ContactHandoff } from "./integrations/contactHandoff";
import { openContactHandoff } from "./integrations/contactHandoff";
import { contactMethodsPath, personProfilePath, reachOutDetailPath } from "./navigation";
import { formatExplanation } from "./relationship-engine";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type TodayScreenProps = {
  activeMode?: ActiveRelationshipMode;
  navigate: Navigate;
  onAddFollowUp?: () => void;
  handoff?: ContactHandoff;
  relationshipFilter?: ReactNode;
};

type CardError = {
  message: string;
  copyValue?: string;
  retry?: "contact" | "not_today";
};

type ContactChoice = {
  card: TodayCardProjection;
  projection: ContactNowProjection;
  error?: string;
  copyValue?: string;
  requestedChannel?: "call" | "message";
};

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

function importAction(navigate: Navigate) {
  return <button className="secondary-action" type="button" onClick={() => navigate("/people/import")}>Import Contacts</button>;
}

export default function TodayScreen({ activeMode = "personal", navigate, handoff = openContactHandoff, relationshipFilter }: TodayScreenProps) {
  const [projection, setProjection] = useState<TodayScreenProjection>();
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
  const [busyPersonId, setBusyPersonId] = useState("");
  const [cardErrors, setCardErrors] = useState<Record<string, CardError>>({});
  const [contactChoice, setContactChoice] = useState<ContactChoice>();
  const [explanationCard, setExplanationCard] = useState<TodayCardProjection>();
  const [alreadyCard, setAlreadyCard] = useState<TodayCardProjection>();
  const [alreadyAttemptedDate, setAlreadyAttemptedDate] = useState<LocalDate>();
  const [alreadyError, setAlreadyError] = useState("");
  const [committedHiddenPersonIds, setCommittedHiddenPersonIds] = useState<Set<string>>(() => new Set());
  const [copiedStatus, setCopiedStatus] = useState("");
  const mountedRef = useRef(true);
  const focusPersonRef = useRef<string | undefined>(storedFocusPersonId());
  const focusIndexRef = useRef<number>();
  const contactOpenerRef = useRef<HTMLButtonElement>();
  const explanationOpenerRef = useRef<HTMLButtonElement>();
  const alreadyOpenerRef = useRef<HTMLButtonElement>();
  const notTodayCommandsRef = useRef(new Map<string, NotTodayCommand>());
  const alreadyCommandsRef = useRef(new Map<string, { nextDate: LocalDate; command: AlreadyContactedCommand }>());
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
      const target = Array.from(card?.querySelectorAll<HTMLButtonElement>(".today-card-actions button") ?? [])
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

  async function launchTarget(card: TodayCardProjection, target: ContactNowTarget, href?: string, focusLabel = "Message") {
    setBusyPersonId(card.person.id);
    setCardError(card.person.id);
    try {
      const current = await revalidateContactNowTarget(await getDatabase(), card.person.id, target);
      if (!current) {
        const next = await latestContactProjection(card);
        setContactChoice({ card, projection: next, error: "That contact method is no longer available. Choose another option." });
        return;
      }
      await handoff(href ?? contactNowTargetHref(current));
      setContactChoice(undefined);
      focusCardAction(card.person.id, focusLabel);
    } catch {
      const next = await latestContactProjection(card).catch(() => card.contact);
      setContactChoice({
        card,
        projection: next,
        error: "PeopleOS could not open that contact method. Copy it, choose another option, or manage contact details.",
        copyValue: target.canonicalValue
      });
      setCardError(card.person.id, {
        message: "PeopleOS could not open that contact method. You can copy it or manage contact details.",
        copyValue: target.canonicalValue,
        retry: "contact"
      });
    } finally {
      setBusyPersonId("");
    }
  }

  async function contactVia(card: TodayCardProjection, channel: "call" | "message") {
    setBusyPersonId(card.person.id);
    setCardError(card.person.id);
    try {
      const current = await latestContactProjection(card);
      const targets = channel === "call"
        ? current.targets.filter((target) => target.channel === "phone_call")
        : current.targets.filter((target) => target.channel === "phone_call" || target.channel === "email");
      if (targets.length === 0) return openContactMethods(card, channel === "call");
      if (targets.length > 1) {
        setContactChoice({ card, projection: { ...current, targets }, requestedChannel: channel });
        return;
      }
      const target = targets[0];
      await launchTarget(card, target, channel === "message" && target.channel === "phone_call" ? `sms:${target.canonicalValue}` : undefined, channel === "call" ? "Call" : "Message");
    } catch {
      setCardError(card.person.id, { message: `PeopleOS could not open ${channel}.` });
    } finally {
      setBusyPersonId("");
    }
  }

  async function editTodayNote(card: TodayCardProjection) {
    const next = window.prompt("Note for today", card.person.todayNote ?? "");
    if (next === null) return;
    try {
      if (next.trim()) await saveTodayNote(await getDatabase(), card.person.id, next);
      else if (card.person.todayNote) await removeTodayNote(await getDatabase(), card.person.id);
      await load();
    } catch (error) {
      setCardError(card.person.id, { message: firstIssue(error, "PeopleOS could not save this note.") });
    }
  }

  async function toggleTodayNote(card: TodayCardProjection, completed: boolean) {
    try {
      await setTodayNoteCompleted(await getDatabase(), card.person.id, completed);
      await load();
    } catch (error) {
      setCardError(card.person.id, { message: firstIssue(error, "PeopleOS could not update this note.") });
    }
  }

  function openContacted(card: TodayCardProjection) {
    if (document.activeElement instanceof HTMLButtonElement) alreadyOpenerRef.current = document.activeElement;
    setAlreadyCard(card);
  }

  async function contactNow(card: TodayCardProjection, opener?: HTMLButtonElement) {
    if (opener) contactOpenerRef.current = opener;
    setBusyPersonId(card.person.id);
    setCardError(card.person.id);
    try {
      const current = await latestContactProjection(card);
      if (current.targets.length === 0) {
        openContactMethods(card, true);
      } else if (current.targets.length === 1) {
        await launchTarget(card, current.targets[0]);
      } else {
        setContactChoice({ card, projection: current });
      }
    } catch {
      setCardError(card.person.id, { message: "PeopleOS could not check contact details yet.", retry: "contact" });
    } finally {
      setBusyPersonId("");
    }
  }

  async function notTodayAction(card: TodayCardProjection) {
    if (mutationLocksRef.current.size > 0) return;
    mutationLocksRef.current.add(card.person.id);
    rememberCardPosition(card);
    setBusyPersonId(card.person.id);
    setCardError(card.person.id);
    try {
      const clock = createRelationshipClock();
      let command = notTodayCommandsRef.current.get(card.person.id);
      if (command && command.localDate !== localDateForInstant(clock.now, clock.timeZone)) {
        notTodayCommandsRef.current.delete(card.person.id);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, { message: "Today moved to a new day. Choose Not today again." });
        return;
      }
      if (!command) {
        const context = await getTodayActionContext(await getDatabase(), card.person.id, clock, activeMode);
        if (!context) throw new Error("This person is no longer due today.");
        command = prepareNotTodayFromContext(context, { now: new Date().toISOString() });
        notTodayCommandsRef.current.set(card.person.id, command);
      }
      await notToday(await getDatabase(), command);
      notTodayCommandsRef.current.delete(card.person.id);
      setCommittedHiddenPersonIds((current) => new Set(current).add(card.person.id));
      await load();
    } catch (error) {
      if (error instanceof StaleRevisionError) {
        notTodayCommandsRef.current.delete(card.person.id);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, { message: "This changed elsewhere. Today has been reloaded; choose Not today again." });
      } else {
        setCardError(card.person.id, {
          message: firstIssue(error, "PeopleOS could not save this yet."),
          retry: "not_today"
        });
      }
    } finally {
      mutationLocksRef.current.delete(card.person.id);
      setBusyPersonId("");
    }
  }

  async function pauseCadence(card: TodayCardProjection, until?: LocalDate, pause = false) {
    if (mutationLocksRef.current.size > 0) return;
    mutationLocksRef.current.add(card.person.id);
    setBusyPersonId(card.person.id);
    setCardError(card.person.id);
    try {
      const now = new Date().toISOString();
      if (pause) await pauseRegularReminder(await getDatabase(), card.person.id, now);
      else if (until) await deferRegularReminder(await getDatabase(), card.person.id, until, now);
      setCommittedHiddenPersonIds((current) => new Set(current).add(card.person.id));
      await load();
    } catch (error) {
      setCardError(card.person.id, { message: firstIssue(error, "PeopleOS could not pause this reminder.") });
    } finally {
      mutationLocksRef.current.delete(card.person.id);
      setBusyPersonId("");
    }
  }

  function closeAlreadyContacted() {
    if (busyPersonId) return;
    const personId = alreadyCard?.person.id;
    setAlreadyCard(undefined);
    setAlreadyAttemptedDate(undefined);
    setAlreadyError("");
    if (personId) focusCardAction(personId, "Already contacted");
    else requestAnimationFrame(() => alreadyOpenerRef.current?.focus());
  }

  async function chooseNextReminder(nextDate: LocalDate, selectedCard = alreadyCard) {
    if (!selectedCard || mutationLocksRef.current.size > 0) return;
    const card = selectedCard;
    mutationLocksRef.current.add(card.person.id);
    setAlreadyAttemptedDate(nextDate);
    rememberCardPosition(card);
    setBusyPersonId(card.person.id);
    setAlreadyError("");
    try {
      const clock = createRelationshipClock();
      const currentLocalDate = localDateForInstant(clock.now, clock.timeZone);
      const openedLocalDate = projection?.result.localDate;
      if (currentLocalDate !== openedLocalDate) {
        alreadyCommandsRef.current.delete(card.person.id);
        setAlreadyCard(undefined);
        setAlreadyAttemptedDate(undefined);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, {
          message: "Today moved to a new day. Choose Already contacted again so the interval starts from today."
        });
        return;
      }
      let prepared = alreadyCommandsRef.current.get(card.person.id);
      if (prepared && prepared.command.localDate !== currentLocalDate) {
        alreadyCommandsRef.current.delete(card.person.id);
        prepared = undefined;
      }
      if (!prepared || prepared.nextDate !== nextDate) {
        const context = await getTodayActionContext(await getDatabase(), card.person.id, clock, activeMode);
        if (!context) throw new Error("This person is no longer due today.");
        if (context.projection.result.localDate !== openedLocalDate) {
          setAlreadyCard(undefined);
          setAlreadyAttemptedDate(undefined);
          focusPersonRef.current = card.person.id;
          await load();
          setCardError(card.person.id, {
            message: "Today moved to a new day. Choose Already contacted again so the interval starts from today."
          });
          return;
        }
        prepared = {
          nextDate,
          command: prepareAlreadyContactedCommand(context, nextDate, { now: new Date().toISOString() })
        };
        alreadyCommandsRef.current.set(card.person.id, prepared);
      }
      await alreadyContacted(await getDatabase(), prepared.command);
      alreadyCommandsRef.current.delete(card.person.id);
      setCommittedHiddenPersonIds((current) => new Set(current).add(card.person.id));
      setAlreadyCard(undefined);
      setAlreadyAttemptedDate(undefined);
      setCopiedStatus(`Next reminder: ${new Intl.DateTimeFormat("en-GB").format(new Date(`${nextDate}T12:00:00`))}`);
      await load();
    } catch (error) {
      if (error instanceof StaleRevisionError) {
        alreadyCommandsRef.current.delete(card.person.id);
        setAlreadyCard(undefined);
        setAlreadyAttemptedDate(undefined);
        focusPersonRef.current = card.person.id;
        await load();
        setCardError(card.person.id, { message: "This changed elsewhere. Today has been reloaded; choose Already contacted again." });
      } else {
        setAlreadyError(firstIssue(error, "PeopleOS could not save this yet."));
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

  function closeExplanation() {
    setExplanationCard(undefined);
    requestAnimationFrame(() => explanationOpenerRef.current?.focus());
  }

  if (loading && !projection) {
    return <main className="screen today-screen" id="main-content" tabIndex={-1}><p className="screen-status" role="status">Loading Today…</p></main>;
  }

  if (!projection) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <div className="section-error"><p role="alert">{pageError}</p><button type="button" onClick={() => void load(true)}>Retry</button></div>
      </main>
    );
  }

  const hiddenPersonId = alreadyCard?.person.id;
  const visibleCards = projection.cards.filter((card) =>
    card.person.id !== hiddenPersonId && !committedHiddenPersonIds.has(card.person.id)
  ).slice(0, visibleCount);
  const hasMore = projection.cards.length > visibleCount;

  if (projection.cards.length === 0 && projection.activePersonCount === 0) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <EmptyState
          eyebrow="Today"
          title="Start with one person you want to remember."
          description="PeopleOS will show who needs your attention and explain why."
          filter={relationshipFilter}
          action={<div className="empty-action-stack"><button className="primary-action" type="button" onClick={() => navigate("/people/new")}><Icon name="plus" /> Add your first person</button>{importAction(navigate)}</div>}
        />
      </main>
    );
  }

  if (projection.cards.length === 0 && projection.evaluationIssues.length > 0) {
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <div className="today-evaluation-notice">
          <p role="alert">{projection.evaluationIssues.length === 1 ? "One relationship could not be evaluated" : `${projection.evaluationIssues.length} relationships could not be evaluated`}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
        <EmptyState
          eyebrow="Today"
          title="Today could not check every relationship."
          description="Retry before treating the list as complete."
          filter={relationshipFilter}
        />
      </main>
    );
  }

  if (projection.cards.length === 0) {
    const cleared = projection.skippedEligibleCount > 0;
    return (
      <main className="screen today-screen" id="main-content" tabIndex={-1}>
        <EmptyState
          eyebrow="Today"
          title={cleared ? "You’ve cleared Today for now." : "Nothing needs your attention today."}
          description={cleared ? "Your deferred plans remain available in Upcoming." : "Your people and plans are still here whenever you need them."}
          filter={relationshipFilter}
          action={!cleared ? <button className="primary-action" type="button" onClick={() => navigate("/people")}>Find someone in People</button> : undefined}
        />
      </main>
    );
  }

  return (
    <main className="screen today-screen" id="main-content" tabIndex={-1}>
      <header className="page-heading compact-heading today-heading">
        <p className="eyebrow">Today</p>
        <h2>Who should I contact today?</h2>
        {relationshipFilter}
      </header>
      {pageError && <div className="section-error"><p role="alert">{pageError}</p><button type="button" onClick={() => void load()}>Retry</button></div>}
      {projection.evaluationIssues.length > 0 && (
        <div className="today-evaluation-notice">
          <p role="status">{projection.evaluationIssues.length === 1 ? "One relationship could not be evaluated" : `${projection.evaluationIssues.length} relationships could not be evaluated`}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">{copiedStatus}</p>
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
              onCall={() => void contactVia(card, "call")}
              onMessage={() => void contactVia(card, "message")}
              onNotToday={() => void notTodayAction(card)}
              onAlreadyContacted={() => openContacted(card)}
              onAddPhone={() => openContactMethods(card, true)}
              onWhy={() => {
                if (document.activeElement instanceof HTMLButtonElement) explanationOpenerRef.current = document.activeElement;
                setExplanationCard(card);
              }}
              onProfile={() => {
                rememberTodayHistory(card.person.id);
                navigate(personProfilePath(card.person.id), { state: { fromPath: "/", todayOriginPrepared: true } });
              }}
              onReachOut={card.reachOut ? () => {
                rememberTodayHistory(card.person.id);
                navigate(reachOutDetailPath(card.reachOut!.entry.id), { state: { fromPath: "/" } });
              } : undefined}
              onPauseFor={(days) => void pauseCadence(card, addDaysToLocalDate(projection.result.localDate, days))}
              onPauseUntil={(date) => void pauseCadence(card, date)}
              onPauseRegular={() => void pauseCadence(card, undefined, true)}
              onEditSchedule={() => navigate(`/people/${encodeURIComponent(card.person.id)}/edit`)}
              onToggleNote={(completed) => void toggleTodayNote(card, completed)}
              onEditNote={() => void editTodayNote(card)}
              onRetry={error?.retry === "contact" ? () => void contactNow(card) : error?.retry === "not_today" ? () => void notTodayAction(card) : undefined}
              onCopy={error?.copyValue ? () => void copyValue(error.copyValue!) : undefined}
            />
          );
        })}
      </div>
      {hasMore && <button className="today-show-more" type="button" onClick={() => setVisibleCount((current) => current + 5)}>Show more due people</button>}

      {contactChoice && (
        <ContactMethodChoiceSheet
          personName={contactChoice.card.person.displayName}
          targets={contactChoice.projection.targets}
          hasPhone={contactChoice.projection.hasActivePhone}
          error={contactChoice.error}
          copyValue={contactChoice.copyValue}
          onChoose={(targetId) => {
            const target = contactChoice.projection.targets.find((candidate) => candidate.id === targetId);
            if (target) void launchTarget(
              contactChoice.card,
              target,
              contactChoice.requestedChannel === "message" && target.channel === "phone_call" ? `sms:${target.canonicalValue}` : undefined,
              contactChoice.requestedChannel === "call" ? "Call" : "Message"
            );
          }}
          onAddPhone={() => openContactMethods(contactChoice.card, true)}
          onManage={() => openContactMethods(contactChoice.card, false)}
          onCopy={contactChoice.copyValue ? () => void copyValue(contactChoice.copyValue!) : undefined}
          onClose={closeContactChoice}
        />
      )}
      {explanationCard && (
        <ExplanationSheet
          personName={explanationCard.person.displayName}
          reason={formatExplanation(explanationCard.item.explanation)}
          intendedAction={formatExplanation(explanationCard.item.intendedActionContext.explanation)}
          memoryCue={explanationCard.memoryCue?.text}
          reachOutReason={explanationCard.reachOut?.entry.reason}
          onClose={closeExplanation}
        />
      )}
      {alreadyCard && (
        <NextReminderSheet
          personName={alreadyCard.person.displayName}
          todayDate={projection.result.localDate}
          defaultDays={projection.alreadyContactedDefaultReminderDays}
          attemptedDate={alreadyAttemptedDate}
          additionalDueCount={alreadyCard.item.additionalDueFollowUpIds.length}
          saving={busyPersonId === alreadyCard.person.id}
          error={alreadyError}
          onChooseDate={(date) => void chooseNextReminder(date)}
          onRetry={alreadyAttemptedDate ? () => void chooseNextReminder(alreadyAttemptedDate) : undefined}
          onClose={closeAlreadyContacted}
        />
      )}
    </main>
  );
}
