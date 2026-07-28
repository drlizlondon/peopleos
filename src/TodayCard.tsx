import type { TodayCardProjection } from "./application/todayQueries";
import { formatEngineLocalDate, formatExplanation } from "./relationship-engine";

type TodayCardProps = {
  card: TodayCardProjection;
  busy: boolean;
  error?: string;
  copyValue?: string;
  onContactNow: () => void;
  onNotToday: () => void;
  onAlreadyContacted: () => void;
  onAddPhone: () => void;
  onWhy: () => void;
  onProfile: () => void;
  onReachOut?: () => void;
  onPauseFor: (days: number) => void;
  onPauseUntil: (date: string) => void;
  onPauseRegular: () => void;
  onEditSchedule: () => void;
  onRetry?: () => void;
  onCopy?: () => void;
};

function affiliation(card: TodayCardProjection): string | undefined {
  if (!card.currentAffiliation) return undefined;
  return [card.currentAffiliation.role, card.currentAffiliation.organisationName].filter(Boolean).join(" · ");
}

function dueLabel(card: TodayCardProjection): { label?: string; detail?: string } {
  if (card.item.dueState === "overdue") {
    return { label: "Overdue", detail: `Planned for ${formatEngineLocalDate(card.item.relevantDate)}` };
  }
  if (card.item.dueState === "due_today") return { label: "Due today" };
  return {};
}

export default function TodayCard({
  card,
  busy,
  error,
  copyValue,
  onContactNow,
  onNotToday,
  onAlreadyContacted,
  onAddPhone,
  onWhy,
  onProfile,
  onReachOut,
  onPauseFor,
  onPauseUntil,
  onPauseRegular,
  onEditSchedule,
  onRetry,
  onCopy
}: TodayCardProps) {
  const due = dueLabel(card);
  const affiliationText = affiliation(card);
  const reason = formatExplanation(card.item.explanation);
  const intendedAction = formatExplanation(card.item.intendedActionContext.explanation);

  return (
    <article
      className="today-card"
      aria-labelledby={`today-person-${card.person.id}`}
      aria-busy={busy || undefined}
      data-today-person-id={card.person.id}
    >
      <header className="today-card-heading">
        <div>
          <button id={`today-person-${card.person.id}`} className="today-person-link" type="button" onClick={onProfile}>
            {card.person.displayName}
          </button>
          {affiliationText && <p>{affiliationText}</p>}
        </div>
        {due.label && <span className={`today-due-state${card.item.dueState === "overdue" ? " overdue" : ""}`}>{due.label}</span>}
      </header>
      {due.detail && <p className="today-planned-date">{due.detail}</p>}
      <p className="today-reason"><span>Reason</span>{reason}</p>
      <p className="today-action-context">{intendedAction}</p>
      {card.memoryCue && (
        <div className="today-memory-cue" aria-label="Memory cue">
          <span>Remember</span>
          <strong>{card.memoryCue.text}</strong>
        </div>
      )}
      {card.item.additionalDueFollowUpIds.length > 0 && (
        <p className="today-also-due">Also due: {card.item.additionalDueFollowUpIds.length} other {card.item.additionalDueFollowUpIds.length === 1 ? "plan" : "plans"}</p>
      )}
      {card.reachOut?.entry.reason && <p className="today-reach-out-context">Reach Out: {card.reachOut.entry.reason}</p>}

      {error && (
        <div className="today-card-error" role="alert">
          <p>{error}</p>
          <div className="button-row compact-buttons">
            {onRetry && <button type="button" onClick={onRetry} disabled={busy}>Retry</button>}
            {copyValue && onCopy && <button type="button" onClick={onCopy}>Copy contact detail</button>}
          </div>
        </div>
      )}

      <div className="today-card-actions" role="group" aria-label={`Actions for ${card.person.displayName}`}>
        <button className="primary-action" type="button" disabled={busy} onClick={onAlreadyContacted}>Contacted</button>
        <button type="button" disabled={busy} onClick={onNotToday}>Not today</button>
        <details className="today-more-actions">
          <summary aria-label={`More actions for ${card.person.displayName}`}>•••</summary>
          <div>
            <button type="button" disabled={busy} onClick={onContactNow}>Contact now</button>
            <button type="button" disabled={busy} onClick={() => onPauseFor(3)}>Pause for 3 days</button>
            <button type="button" disabled={busy} onClick={() => onPauseFor(7)}>Pause for 1 week</button>
            <button type="button" disabled={busy} onClick={() => onPauseFor(14)}>Pause for 2 weeks</button>
            <label className="today-pause-date">Choose date<input type="date" onChange={(event) => { if (event.target.value) onPauseUntil(event.target.value); }} /></label>
            <button type="button" disabled={busy} onClick={onPauseRegular}>Pause regular reminders</button>
            <button type="button" onClick={onEditSchedule}>Edit stay-in-touch schedule</button>
            <button type="button" onClick={onWhy}>Why this person?</button>
            <button type="button" onClick={onProfile}>View person</button>
            {card.reachOut && onReachOut && <button type="button" onClick={onReachOut}>Open Reach Out plan</button>}
          </div>
        </details>
      </div>
      {!card.contact.hasActivePhone && (
        <button className="today-add-phone" type="button" disabled={busy} onClick={onAddPhone}>Add phone number</button>
      )}
    </article>
  );
}
