import type { TodayCardProjection } from "./application/todayQueries";
import { formatUkLocalDate } from "./application/conversationStarterHistory";
import { conversationalNameFor } from "./domain/personNames";

export type ConversationStarterMessageIntent = {
  draft: string;
  starterId: string;
  starterTemplate: string;
};

export type TodayCardCompletionState = "idle" | "saving" | "complete";

export type TodayCardProps = {
  card: TodayCardProjection;
  busy: boolean;
  expanded: boolean;
  selectedStarterId?: string;
  completionState?: TodayCardCompletionState;
  error?: string;
  copyValue?: string;
  onMessage: (intent?: ConversationStarterMessageIntent) => void;
  onCall: () => void;
  onAnother: () => void;
  onExpand: () => void;
  onComplete: () => void;
  onNotToday: () => void;
  onProfile: () => void;
  onRetry?: () => void;
  onCopy?: () => void;
};

function affiliation(card: TodayCardProjection): string | undefined {
  if (!card.currentAffiliation) return undefined;
  return [card.currentAffiliation.role, card.currentAffiliation.organisationName].filter(Boolean).join(" · ");
}

export default function TodayCard({
  card,
  busy,
  expanded,
  selectedStarterId,
  completionState = "idle",
  error,
  copyValue,
  onMessage,
  onCall,
  onAnother,
  onExpand,
  onComplete,
  onNotToday,
  onProfile,
  onRetry,
  onCopy
}: TodayCardProps) {
  const affiliationText = affiliation(card);
  const personName = card.person.conversationalName?.trim() || card.person.displayName;
  const starterName = conversationalNameFor(card.person);
  const starterSuggestion = card.conversationStarters.find((starter) => starter.id === selectedStarterId)
    ?? card.conversationStarters[0];
  const starter = starterSuggestion?.template.replaceAll("{name}", starterName);
  const starterId = `today-conversation-starter-${card.person.id}`;
  const bodyId = `today-card-body-${card.person.id}`;
  const completionPending = completionState === "saving";
  const completed = completionState === "complete";
  const disabled = busy || completionPending || completed;
  const bodyExpanded = expanded && !completed;
  const broughtToToday = card.item.eligibilityCode === "brought_to_today";

  return (
    <article
      className={`today-card today-card--${bodyExpanded ? "expanded" : "collapsed"}${completionPending ? " today-card--completing" : ""}${completed ? " today-card--complete" : ""}`}
      aria-labelledby={`today-person-${card.person.id}`}
      aria-busy={busy || completionPending || undefined}
      data-today-person-id={card.person.id}
      data-completion-state={completionState}
    >
      <header className="today-card-heading">
        <div className="today-card-person">
          <button id={`today-person-${card.person.id}`} className="today-person-link" type="button" disabled={disabled} onClick={onProfile}>
            {personName}
          </button>
          {(affiliationText || broughtToToday) && (
            <div className="today-card-meta">
              {affiliationText && <p>{affiliationText}</p>}
              {broughtToToday && <span className="today-brought-forward">Brought to Today</span>}
            </div>
          )}
        </div>
        <div className="today-card-heading-actions">
          <button
            className="today-card-disclosure"
            type="button"
            aria-expanded={bodyExpanded}
            aria-controls={bodyId}
            aria-label={`${bodyExpanded ? "Collapse" : "Show"} actions for ${personName}`}
            disabled={disabled}
            onClick={onExpand}
          >
            <span aria-hidden="true">⌄</span>
          </button>
          <button
            className="today-completion-tick"
            type="button"
            aria-label={completed
              ? `${personName} completed`
              : completionPending
                ? `Marking ${personName} complete`
                : `Mark ${personName} complete`}
            disabled={disabled}
            onClick={onComplete}
          >
            <span aria-hidden="true">✓</span>
          </button>
        </div>
      </header>

      <div id={bodyId} className="today-card-body" hidden={!bodyExpanded}>
        {bodyExpanded && (
          <>
            {starter && (
              <div className="today-conversation-suggestion">
                <p id={starterId} className="today-conversation-starter" aria-live="polite" aria-atomic="true">{starter}</p>
                {starterSuggestion?.lastUsedDate && (
                  <p className="today-conversation-history">Last used: {formatUkLocalDate(starterSuggestion.lastUsedDate)}</p>
                )}
              </div>
            )}
            {card.conversationStarters.length > 1 && (
              <button
                className="text-action today-another-starter"
                type="button"
                aria-label={`Show another conversation starter for ${personName}`}
                aria-controls={starterId}
                disabled={disabled}
                onClick={onAnother}
              >Another suggestion</button>
            )}

            {error && (
              <div className="today-card-error" role="alert">
                <p>{error}</p>
                <div className="button-row compact-buttons">
                  {onRetry && <button type="button" onClick={onRetry} disabled={disabled}>Retry</button>}
                  {copyValue && onCopy && <button type="button" onClick={onCopy} disabled={disabled}>Copy contact detail</button>}
                </div>
              </div>
            )}

            <div className="today-card-actions" role="group" aria-label={`Contact ${personName}`}>
              <button className="primary-action" type="button" disabled={disabled} onClick={() => onMessage(starter && starterSuggestion ? {
                draft: starter,
                starterId: starterSuggestion.id,
                starterTemplate: starterSuggestion.template
              } : undefined)}>Message</button>
              <button type="button" disabled={disabled} onClick={onCall}>Call</button>
            </div>
            <div className="today-card-links">
              <button className="today-not-today" type="button" disabled={disabled} onClick={onNotToday}>Not today</button>
            </div>
          </>
        )}
      </div>

      {completed && (
        <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {personName} completed.
        </span>
      )}
    </article>
  );
}
