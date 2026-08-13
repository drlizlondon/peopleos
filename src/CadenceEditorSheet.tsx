import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent
} from "react";
import { updateContactCadence } from "./application/followUps";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import {
  contactCadenceOf,
  contactCadencesEqual,
  isValidContactCadence,
  maxContactCadenceValue
} from "./domain/cadence";
import { CADENCE_PRESET_OPTIONS } from "./domain/followUpPolicy";
import type { ContactCadence, ContactCadenceUnit, Person } from "./domain/schema";
import { ValidationError } from "./domain/validation";

type CadenceChoice = "none" | "1" | "3" | "7" | "14" | "30" | "90" | "custom";

const PRESET_CADENCES: Readonly<Record<Exclude<CadenceChoice, "none" | "custom">, ContactCadence>> = {
  "30": { value: 1, unit: "months" },
  "90": { value: 3, unit: "months" },
  "1": { value: 1, unit: "days" },
  "3": { value: 3, unit: "days" },
  "7": { value: 1, unit: "weeks" },
  "14": { value: 2, unit: "weeks" }
};

export type CadenceEditorSheetProps = {
  person: Person;
  onClose: () => void;
  onSaved: (person: Person) => void;
};

function initialChoice(cadence: ContactCadence | undefined): CadenceChoice {
  if (cadence === undefined) return "none";
  const preset = Object.entries(PRESET_CADENCES).find(([, value]) => contactCadencesEqual(value, cadence));
  if (preset) return preset[0] as CadenceChoice;
  return "custom";
}

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not update this cadence.";
}

export default function CadenceEditorSheet({ person, onClose, onSaved }: CadenceEditorSheetProps) {
  const modalId = useId();
  const fieldId = useId();
  const initialCadence = contactCadenceOf(person);
  const [choice, setChoice] = useState<CadenceChoice>(() => initialChoice(initialCadence));
  const [customValue, setCustomValue] = useState(() =>
    initialChoice(initialCadence) === "custom" ? String(initialCadence?.value ?? "") : ""
  );
  const [customUnit, setCustomUnit] = useState<ContactCadenceUnit>(() => initialCadence?.unit ?? "days");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const choiceRef = useRef<HTMLSelectElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const mutationRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  dirtyRef.current = dirty;
  savingRef.current = saving;
  closeRef.current = onClose;

  useEffect(() => {
    const id = `cadence-editor-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: {
        id,
        dismiss: () => {
          if (savingRef.current) return;
          if (dirtyRef.current && !window.confirm("Discard changes?")) return;
          closeRef.current();
        }
      }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!sheetRef.current?.contains(document.activeElement)) choiceRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (choice === "custom") requestAnimationFrame(() => customRef.current?.focus());
  }, [choice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  });

  function closeEditor() {
    if (savingRef.current) return;
    if (dirtyRef.current && !window.confirm("Discard changes?")) return;
    onClose();
  }

  function selectChoice(next: CadenceChoice) {
    setChoice(next);
    setDirty(true);
    setError("");
  }

  function selectedCadence(): ContactCadence | undefined {
    if (choice === "none") return undefined;
    if (choice === "custom") return { value: Number(customValue), unit: customUnit };
    return PRESET_CADENCES[choice];
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current) return;
    const cadence = selectedCadence();
    if (cadence !== undefined && !isValidContactCadence(cadence)) {
      setError(`Enter a whole number from 1 to ${maxContactCadenceValue(customUnit)} ${customUnit}.`);
      requestAnimationFrame(() => customRef.current?.focus());
      return;
    }
    if (person.contactCadenceDays === undefined
      && contactCadencesEqual(cadence, contactCadenceOf(person))) {
      setDirty(false);
      onSaved(person);
      return;
    }

    mutationRef.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await updateContactCadence(await getDatabase(), {
        personId: person.id,
        expectedRevision: person.revision,
        ...(cadence === undefined ? {} : { cadence }),
        occurredAt: new Date().toISOString()
      });
      setDirty(false);
      onSaved(saved);
    } catch (caught) {
      setError(firstIssue(caught));
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <section
        ref={sheetRef}
        className="contact-sheet interaction-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-title`}
      >
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">{person.displayName}</p>
            <h3 id={`${fieldId}-title`}>Contact cadence</h3>
          </div>
          <button type="button" aria-label="Close cadence editor" onClick={closeEditor} disabled={saving}>×</button>
        </div>

        <form className="contact-editor" onSubmit={save} noValidate>
          <div className="form-field">
            <label htmlFor={`${fieldId}-choice`}>Recurring cadence</label>
            <select
              ref={choiceRef}
              id={`${fieldId}-choice`}
              value={choice}
              onChange={(event) => selectChoice(event.target.value as CadenceChoice)}
            >
              {CADENCE_PRESET_OPTIONS.map((option) => (
                <option key={option.value ?? "none"} value={option.value ?? "none"}>{option.label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>

          {choice === "custom" && (
            <div className="form-field">
              <label htmlFor={`${fieldId}-custom`}>Cadence interval <span>Required</span></label>
              <div className="cadence-input-row">
                <input
                  ref={customRef}
                  id={`${fieldId}-custom`}
                  aria-label="Contact cadence value"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={maxContactCadenceValue(customUnit)}
                  step={1}
                  required
                  value={customValue}
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby={error ? `${fieldId}-error` : `${fieldId}-custom-hint`}
                  onChange={(event) => { setCustomValue(event.target.value); setDirty(true); setError(""); }}
                />
                <select
                  aria-label="Contact cadence unit"
                  value={customUnit}
                  onChange={(event) => {
                    setCustomUnit(event.target.value as ContactCadenceUnit);
                    setDirty(true);
                    setError("");
                  }}
                >
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </select>
              </div>
              <p className="field-hint" id={`${fieldId}-custom-hint`}>Use a positive whole number.</p>
            </div>
          )}

          <p className="interaction-kind-readout">
            Cadence is a preference calculated from meaningful contact. Saving it does not create a follow-up automatically.
          </p>

          {error && <p className="field-error" id={`${fieldId}-error`} role="alert">{error}</p>}

          <div className="button-row sheet-actions">
            <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
            <button className="primary-action" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save cadence"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
