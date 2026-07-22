import { useEffect, useId, useRef, useState } from "react";
import { listActivePersonOptions, type PersonPickerOption } from "./application/interactionQueries";
import { getDatabase } from "./data/client";

export default function GlobalAddSheet({
  onClose,
  onNavigate,
  onLogInteraction
}: {
  onClose: () => void;
  onNavigate: (path: string) => void;
  onLogInteraction: (person: PersonPickerOption) => void;
}) {
  const modalId = useId();
  const [choosingPerson, setChoosingPerson] = useState(false);
  const [people, setPeople] = useState<PersonPickerOption[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const sheetRef = useRef<HTMLElement>(null);
  const logInteractionRef = useRef<HTMLButtonElement>(null);
  const personSearchRef = useRef<HTMLInputElement>(null);
  const previousChoosingRef = useRef(false);
  const closeRef = useRef(onClose);
  const choosingRef = useRef(false);
  closeRef.current = onClose;
  choosingRef.current = choosingPerson;

  useEffect(() => {
    const wasChoosing = previousChoosingRef.current;
    previousChoosingRef.current = choosingPerson;
    requestAnimationFrame(() => {
      if (choosingPerson) personSearchRef.current?.focus();
      else if (wasChoosing) logInteractionRef.current?.focus();
    });
  }, [choosingPerson]);

  useEffect(() => {
    const id = `global-add-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: {
        id,
        dismiss: () => {
          if (choosingRef.current) setChoosingPerson(false);
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
        if (choosingPerson) setChoosingPerson(false);
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
  }, [choosingPerson, onClose]);

  async function startPersonPicker() {
    setChoosingPerson(true);
    setError("");
    try {
      setPeople(await listActivePersonOptions(await getDatabase()));
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
          <h3 id="global-add-title">{choosingPerson ? "Choose a person" : "Add to PeopleOS"}</h3>
          <button
            type="button"
            autoFocus
            aria-label={choosingPerson ? "Back to Add menu" : "Close Add menu"}
            onClick={() => choosingPerson ? setChoosingPerson(false) : onClose()}
          >{choosingPerson ? "←" : "×"}</button>
        </div>
        {choosingPerson ? (
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
                  <button type="button" onClick={() => onLogInteraction(option)}>
                    <strong>{option.person.displayName}</strong>
                    {option.affiliation && <span>{option.affiliation}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="global-add-actions">
            <button className="primary-action" type="button" onClick={() => onNavigate("/people/new")}>Add person</button>
            <button ref={logInteractionRef} type="button" onClick={() => void startPersonPicker()}>Log interaction</button>
            <button type="button" onClick={() => onNavigate("/people/import")}>Import contacts</button>
          </div>
        )}
      </section>
    </div>
  );
}
