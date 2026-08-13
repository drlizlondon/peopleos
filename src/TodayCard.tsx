import type { TodayCardProjection } from "./application/todayQueries";
import { useState } from "react";

type TodayCardProps = {
  card: TodayCardProjection;
  busy: boolean;
  error?: string;
  copyValue?: string;
  onMessage: (draft?: string) => void;
  onCall: () => void;
  onDone: () => void;
  onPause: () => void;
  onProfile: () => void;
  onRetry?: () => void;
  onCopy?: () => void;
};

function affiliation(card: TodayCardProjection): string | undefined {
  if (!card.currentAffiliation) return undefined;
  return [card.currentAffiliation.role, card.currentAffiliation.organisationName].filter(Boolean).join(" · ");
}

function initialConversationStarterIndex(card: TodayCardProjection): number {
  if (card.conversationStarters.length === 0) return 0;
  const seed = [...card.person.id, ...card.item.relevantDate]
    .reduce((total, character) => total + character.charCodeAt(0), 0);
  return seed % card.conversationStarters.length;
}

export default function TodayCard({
  card,
  busy,
  error,
  copyValue,
  onMessage,
  onCall,
  onDone,
  onPause,
  onProfile,
  onRetry,
  onCopy
}: TodayCardProps) {
  const affiliationText = affiliation(card);
  const starterKey = `${card.person.id}:${card.item.relevantDate}:${card.conversationStarters.map((starter) => starter.id).join(":")}`;
  const initialStarterIndex = initialConversationStarterIndex(card);
  const [starterState, setStarterState] = useState({ key: starterKey, index: initialStarterIndex });
  const starterIndex = starterState.key === starterKey ? starterState.index : initialStarterIndex;
  const starter = card.conversationStarters[starterIndex]?.template.replaceAll("{name}", card.person.displayName);
  const starterId = `today-conversation-starter-${card.person.id}`;

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
      </header>
      {starter && (
        <div className="today-conversation-suggestion" aria-label="Conversation starter">
          <span>Conversation starter</span>
          <p id={starterId} className="today-conversation-starter" aria-live="polite" aria-atomic="true">“{starter}”</p>
        </div>
      )}
      {card.conversationStarters.length > 1 && (
        <button
          className="text-action today-another-starter"
          type="button"
          aria-label={`Show another conversation starter for ${card.person.displayName}`}
          aria-controls={starterId}
          onClick={() => setStarterState({
            key: starterKey,
            index: (starterIndex + 1) % card.conversationStarters.length
          })}
        >Another suggestion</button>
      )}

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
        <button className="primary-action" type="button" disabled={busy} onClick={() => onMessage(starter)}>Message</button>
        <button type="button" disabled={busy} onClick={onCall}>Call</button>
        <button type="button" disabled={busy} onClick={onDone}>Done</button>
      </div>
      <div className="today-card-links">
        <button type="button" disabled={busy} onClick={onPause}>Pause</button>
      </div>
    </article>
  );
}
