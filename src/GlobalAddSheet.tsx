import { useEffect, useId, useRef, useState } from "react";
import { listActivePersonOptions, type PersonPickerOption } from "./application/interactionQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";

export default function GlobalAddSheet({
  onClose,
  onNavigate,
  onLogInteraction,
  onAddFollowUp,
  onAddReachOut,
  preferFollowUp = false,
  preferReachOut = false,
  allowFollowUp = true,
  activeMode = "personal"
}: {
  onClose: () => void;
  onNavigate: (path: string) => void;
  onLogInteraction: (person: PersonPickerOption) => void;
  onAddFollowUp: (person: PersonPickerOption) => void;
  onAddReachOut: () => void;
  preferFollowUp?: boolean;
  preferReachOut?: boolean;
  allowFollowUp?: boolean;
  activeMode?: ActiveRelationshipMode;
}) {
  const modalId = useId();
  const [choice, setChoice] = useState<"interaction" | "follow_up" | null>(null);
  const [people, setPeople] = useState<PersonPickerOption[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const sheetRef = useRef<HTMLElement>(null);
  const logInteractionRef = useRef<HTMLButtonElement>(null);
  const addFollowUpRef = useRef<HTMLButtonElement>(null);
  const personSearchRef = useRef<HTMLInputElement>(null);
  const previousChoiceRef = useRef<typeof choice>(null);
  const closeRef = useRef(onClose);
  const choiceRef = useRef<typeof choice>(null);
  closeRef.current = onClose;
  choiceRef.current = choice;

  useEffect(() => {
    const previousChoice = previousChoiceRef.current;
    previousChoiceRef.current = choice;
    requestAnimationFrame(() => {
      if (choice) personSearchRef.current?.focus();
      else if (previousChoice === "follow_up") addFollowUpRef.current?.focus();
      else if (previousChoice) logInteractionRef.current?.focus();
    });
  }, [choice]);

  useEffect(() => {
    const id = `global-add-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: {
        id,
        dismiss: () => {
          if (choiceRef.current) setChoice(null);
          else closeRef.current();
        }
      }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (choice) setChoice(null);
        else onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])"
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [choice, onClose]);

  async function startPersonPicker(nextChoice: "interaction" | "follow_up") {
    setChoice(nextChoice);
    setError("");
    try {
      setPeople(await listActivePersonOptions(await getDatabase(), undefined, activeMode));
    } catch {
      setError("PeopleOS could not load people. Close this sheet and try again.");
    }
  }

  const normalized = query.trim().toLocaleLowerCase("en-US");
  const visiblePeople = people.filter((option) =>
    !normalized || option.person.displayName.toLocaleLowerCase("en-US").includes(normalized)
  );

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet global-add-sheet" role="dialog" aria-modal="true" aria-labelledby="global-add-title">
        <div className="sheet-heading">
          <h3 id="global-add-title">{choice ? "Choose a person" : "Add to PeopleOS"}</h3>
          <button
            type="button"
            autoFocus
            aria-label={choice ? "Back to Add menu" : "Close Add menu"}
            onClick={() => choice ? setChoice(null) : onClose()}
          >{choice ? "←" : "×"}</button>
        </div>
        {choice ? (
          <div className="person-picker">
            <div className="form-field">
              <label htmlFor="global-person-picker">Find a person</label>
              <input
                ref={personSearchRef}
                id="global-person-picker"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Start with their name"
              />
            </div>
            {error && <p className="form-alert" role="alert">{error}</p>}
            {!error && visiblePeople.length === 0 && (
              <p className="muted-copy">{people.length === 0 ? "Add a person before logging an interaction." : "No people match this name."}</p>
            )}
            <ul className="selector-list" aria-label="People">
              {visiblePeople.map((option) => (
                <li key={option.person.id}>
                  <button type="button" onClick={() => choice === "follow_up" ? onAddFollowUp(option) : onLogInteraction(option)}>
                    <strong>{option.person.displayName}</strong>
                    {option.affiliation && <span>{option.affiliation}</span>}
                    {option.memoryCue && <span>{option.memoryCue}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="global-add-actions">
            {preferReachOut && <button className="primary-action" type="button" onClick={onAddReachOut}>Add to Reach Out</button>}
            {allowFollowUp && preferFollowUp && <button ref={addFollowUpRef} className="primary-action" type="button" onClick={() => void startPersonPicker("follow_up")}>Add follow-up</button>}
            <button className="primary-action" type="button" onClick={() => onNavigate("/people/new")}>Add person</button>
            {!preferReachOut && <button type="button" onClick={onAddReachOut}>Add to Reach Out</button>}
            {allowFollowUp && !preferFollowUp && <button ref={addFollowUpRef} type="button" onClick={() => void startPersonPicker("follow_up")}>Add follow-up</button>}
            <button ref={logInteractionRef} type="button" onClick={() => void startPersonPicker("interaction")}>Log interaction</button>
            <button type="button" onClick={() => onNavigate("/people/import")}>Import contacts</button>
          </div>
        )}
      </section>
    </div>
  );
}
