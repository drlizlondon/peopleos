import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { updatePersonWithInitialSchedule } from "./application/manualPersonCapture";
import { createRelationshipClock } from "./application/relationshipEngineQueries";
import { createReachOut, prepareCreateReachOutCommand, type CreateReachOutCommand } from "./application/reachOut";
// eslint-disable-next-line no-restricted-imports -- This route coordinates two existing application commands for one saved Person.
import { getDatabase } from "./data/client";
import {
  isValidContactCadence,
  maxContactCadenceValue
} from "./domain/cadence";
import {
  addDaysToLocalDate,
  localDateForInstant
} from "./domain/followUpPolicy";
import type {
  ContactCadence,
  ContactCadenceUnit,
  LocalDate,
  Person
} from "./domain/schema";
import { relationshipModeOf } from "./domain/relationshipMode";
import { isLocalDate, ValidationError } from "./domain/validation";
import { personProfilePath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type FrequencyChoice =
  | "daily"
  | "three-days"
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "three-months"
  | "custom";

type StartChoice = "today" | "tomorrow" | "date";

const FREQUENCY_OPTIONS: ReadonlyArray<{
  value: Exclude<FrequencyChoice, "custom">;
  label: string;
  cadence: ContactCadence;
}> = [
  { value: "daily", label: "Daily", cadence: { value: 1, unit: "days" } },
  { value: "three-days", label: "Every 3 days", cadence: { value: 3, unit: "days" } },
  { value: "weekly", label: "Weekly", cadence: { value: 1, unit: "weeks" } },
  { value: "fortnightly", label: "Fortnightly", cadence: { value: 2, unit: "weeks" } },
  { value: "monthly", label: "Monthly", cadence: { value: 1, unit: "months" } },
  { value: "three-months", label: "Every 3 months", cadence: { value: 3, unit: "months" } }
];

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? "Check these choices and try again.";
  if (error instanceof Error && ["RecordConflictError", "StaleRevisionError"].includes(error.name)) return error.message;
  return "PeopleOS could not save this yet. The person is still in PeopleOS.";
}

function cadenceForChoice(
  choice: FrequencyChoice,
  customValue: string,
  customUnit: ContactCadenceUnit
): ContactCadence | undefined {
  if (choice === "custom") {
    const cadence = { value: Number(customValue), unit: customUnit };
    return isValidContactCadence(cadence) ? cadence : undefined;
  }
  return FREQUENCY_OPTIONS.find((option) => option.value === choice)?.cadence;
}

export type PostAddRelationshipScreenProps = {
  personId: string;
  navigate: Navigate;
  onSavingChange: (saving: boolean) => void;
  closePath?: string;
};

/**
 * Optional second step after a Person has already been persisted.
 *
 * The two mutations intentionally remain separate from Person creation: an X,
 * a failed schedule, or a failed Reach Out write can never remove the Person.
 */
export default function PostAddRelationshipScreen({
  personId,
  navigate,
  onSavingChange,
  closePath
}: PostAddRelationshipScreenProps) {
  const fieldId = useId();
  const [person, setPerson] = useState<Person | null>();
  const [regularOpen, setRegularOpen] = useState(false);
  const [frequency, setFrequency] = useState<FrequencyChoice>("three-days");
  const [customValue, setCustomValue] = useState("1");
  const [customUnit, setCustomUnit] = useState<ContactCadenceUnit>("weeks");
  const [startChoice, setStartChoice] = useState<StartChoice>();
  const [chosenDate, setChosenDate] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const mutationRef = useRef(false);
  const attemptTimeRef = useRef<string>();
  const startFieldsetRef = useRef<HTMLFieldSetElement>(null);
  const scheduleIdsRef = useRef({
    followUpId: `follow-up-${crypto.randomUUID()}`,
    followUpEventId: `follow-up-event-${crypto.randomUUID()}`
  });
  const reachOutCommandRef = useRef<CreateReachOutCommand>();

  useEffect(() => {
    let active = true;
    getDatabase().then((db) => db.get("people", personId)).then((record) => {
      if (active) setPerson(record ?? null);
    }).catch(() => {
      if (active) {
        setPerson(null);
        setError("PeopleOS could not load this person.");
      }
    });
    return () => { active = false; };
  }, [personId]);

  useEffect(() => () => onSavingChange(false), [onSavingChange]);

  function close() {
    if (mutationRef.current) return;
    navigate(closePath ?? personProfilePath(personId), { replace: true });
  }

  function beginSaving() {
    mutationRef.current = true;
    setSaving(true);
    setError("");
    onSavingChange(true);
  }

  function finishSaving() {
    mutationRef.current = false;
    setSaving(false);
    onSavingChange(false);
  }

  function startDate(now: string): { today: LocalDate; selected?: LocalDate } {
    const clock = createRelationshipClock({ now });
    const today = localDateForInstant(clock.now, clock.timeZone);
    if (startChoice === "today") return { today, selected: today };
    if (startChoice === "tomorrow") return { today, selected: addDaysToLocalDate(today, 1) };
    if (startChoice === "date" && isLocalDate(chosenDate) && chosenDate >= today) {
      return { today, selected: chosenDate };
    }
    return { today };
  }

  async function saveRegularContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person || mutationRef.current) return;
    const cadence = cadenceForChoice(frequency, customValue, customUnit);
    if (!cadence) {
      setError(`Enter a whole number from 1 to ${maxContactCadenceValue(customUnit)} ${customUnit}.`);
      return;
    }
    const occurredAt = attemptTimeRef.current ?? new Date().toISOString();
    const dates = startDate(occurredAt);
    if (!dates.selected) {
      setError(startChoice === "date"
        ? "Choose today or a future date."
        : "Choose when regular contact should start.");
      requestAnimationFrame(() => startFieldsetRef.current?.focus());
      return;
    }

    attemptTimeRef.current = occurredAt;
    beginSaving();
    try {
      await updatePersonWithInitialSchedule(await getDatabase(), {
        personId: person.id,
        expectedRevision: person.revision,
        draft: {
          displayName: person.displayName,
          relationshipMode: relationshipModeOf(person),
          importance: person.importance,
          tags: person.tags,
          contactCadence: cadence
        },
        startDate: dates.selected,
        ...scheduleIdsRef.current,
        occurredAt
      });
      finishSaving();
      navigate(dates.selected <= dates.today ? "/" : "/upcoming", { replace: true });
    } catch (caught) {
      setError(firstIssue(caught));
      finishSaving();
    }
  }

  async function addToReachOut() {
    if (!person || mutationRef.current) return;
    setRegularOpen(false);
    beginSaving();
    try {
      if (!reachOutCommandRef.current) {
        reachOutCommandRef.current = prepareCreateReachOutCommand({ person });
      }
      await createReachOut(await getDatabase(), reachOutCommandRef.current);
      finishSaving();
      navigate("/reach-out", { replace: true });
    } catch (caught) {
      setError(firstIssue(caught));
      finishSaving();
    }
  }

  return (
    <main className="screen form-screen post-add-relationship-screen" id="main-content" tabIndex={-1} aria-busy={saving}>
      <header className="page-heading compact-heading">
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">PeopleOS</p>
            <h2>How do you want to keep in touch?</h2>
          </div>
          <button type="button" aria-label="Close relationship setup" onClick={close} disabled={saving}>×</button>
        </div>
        {person && <p>{person.displayName} is already in PeopleOS.</p>}
      </header>

      {person === undefined && !error && <p className="screen-status" role="status">Loading person…</p>}
      {person === null && (
        <div className="form-alert" role="alert">
          <p>{error || "This person is no longer available."}</p>
          <button type="button" onClick={close}>Close</button>
        </div>
      )}

      {person && (
        <>
          <ul className="today-choice-list" aria-label="Keep in touch options">
            <li>
              <button
                type="button"
                aria-expanded={regularOpen}
                aria-controls={`${fieldId}-regular-contact`}
                onClick={() => {
                  setRegularOpen(true);
                  setError("");
                }}
                disabled={saving}
              >
                <strong>Regular contact</strong>
                <small>Bring them back on a schedule</small>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => void addToReachOut()} disabled={saving}>
                <strong>{saving && !regularOpen ? "Adding…" : "Add to Reach Out"}</strong>
                <small>Keep them visible until you contact them</small>
              </button>
            </li>
          </ul>

          {regularOpen && (
            <form id={`${fieldId}-regular-contact`} className="person-form" onSubmit={saveRegularContact} noValidate>
              <div className="form-field">
                <label htmlFor={`${fieldId}-frequency`}>How often?</label>
                <select
                  id={`${fieldId}-frequency`}
                  value={frequency}
                  onChange={(event) => {
                    setFrequency(event.target.value as FrequencyChoice);
                    setError("");
                  }}
                >
                  {FREQUENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
                {frequency === "custom" && (
                  <div className="cadence-input-row simple-frequency-custom">
                    <input
                      aria-label="Custom contact frequency"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={maxContactCadenceValue(customUnit)}
                      step={1}
                      value={customValue}
                      onChange={(event) => {
                        setCustomValue(event.target.value);
                        setError("");
                      }}
                    />
                    <select
                      aria-label="Custom contact frequency unit"
                      value={customUnit}
                      onChange={(event) => {
                        setCustomUnit(event.target.value as ContactCadenceUnit);
                        setError("");
                      }}
                    >
                      <option value="days">days</option>
                      <option value="weeks">weeks</option>
                      <option value="months">months</option>
                    </select>
                  </div>
                )}
              </div>

              <fieldset
                ref={startFieldsetRef}
                className="choice-fieldset simple-start-fieldset"
                tabIndex={-1}
                aria-invalid={error.startsWith("Choose")}
              >
                <legend>Start</legend>
                <div className="segmented-control three-way">
                  <button type="button" aria-pressed={startChoice === "today"} onClick={() => { setStartChoice("today"); setError(""); }}>Today</button>
                  <button type="button" aria-pressed={startChoice === "tomorrow"} onClick={() => { setStartChoice("tomorrow"); setError(""); }}>Tomorrow</button>
                  <button type="button" aria-pressed={startChoice === "date"} onClick={() => { setStartChoice("date"); setError(""); }}>Choose date</button>
                </div>
                {startChoice === "date" && (
                  <div className="today-date-picker">
                    <label htmlFor={`${fieldId}-start-date`}>Start date</label>
                    <input
                      id={`${fieldId}-start-date`}
                      type="date"
                      value={chosenDate}
                      onChange={(event) => {
                        setChosenDate(event.target.value);
                        setError("");
                      }}
                    />
                  </div>
                )}
              </fieldset>

              {error && <p className="form-alert" role="alert">{error}</p>}
              <div className="button-row form-actions">
                <button className="primary-action" type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Set regular contact"}
                </button>
              </div>
            </form>
          )}

          {!regularOpen && error && <p className="form-alert" role="alert">{error}</p>}
        </>
      )}
    </main>
  );
}
