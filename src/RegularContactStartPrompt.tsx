import { useId, useRef, useState } from "react";
import { createRelationshipClock } from "./application/relationshipEngineQueries";
import { initialiseRegularContactSchedule } from "./application/regularContactSchedule";
// eslint-disable-next-line no-restricted-imports -- This one-time reconciliation performs one atomic application command.
import { getDatabase } from "./data/client";
import { addDaysToLocalDate, localDateForInstant } from "./domain/followUpPolicy";

export default function RegularContactStartPrompt({
  personName,
  personId,
  onStarted
}: {
  personName: string;
  personId: string;
  onStarted: () => void | Promise<void>;
}) {
  const titleId = useId();
  const [savingChoice, setSavingChoice] = useState<"today" | "tomorrow">();
  const [error, setError] = useState("");
  const mutationRef = useRef(false);

  async function start(choice: "today" | "tomorrow") {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setSavingChoice(choice);
    setError("");
    try {
      const clock = createRelationshipClock();
      const today = localDateForInstant(clock.now, clock.timeZone);
      await initialiseRegularContactSchedule(await getDatabase(), {
        personId,
        startDate: choice === "today" ? today : addDaysToLocalDate(today, 1),
        followUpId: `follow-up-${crypto.randomUUID()}`,
        followUpEventId: `follow-up-event-${crypto.randomUUID()}`,
        occurredAt: clock.now
      });
      await onStarted();
    } catch {
      setError("PeopleOS could not start regular contact. Try again.");
    } finally {
      mutationRef.current = false;
      setSavingChoice(undefined);
    }
  }

  return (
    <section className="regular-contact-start" aria-labelledby={titleId}>
      <p className="eyebrow">Regular contact · {personName}</p>
      <h3 id={titleId}>When should regular contact start?</h3>
      <div className="button-row regular-contact-start-actions">
        <button className="primary-action" type="button" disabled={Boolean(savingChoice)} onClick={() => void start("today")}>
          {savingChoice === "today" ? "Starting…" : "Start today"}
        </button>
        <button className="secondary-action" type="button" disabled={Boolean(savingChoice)} onClick={() => void start("tomorrow")}>
          {savingChoice === "tomorrow" ? "Starting…" : "Start tomorrow"}
        </button>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
    </section>
  );
}
