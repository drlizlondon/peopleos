import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  createInteraction,
  createInteractionDraft,
  createRelationshipEventDraft,
  deleteInteraction,
  DuplicateEventError,
  normalizeEventName,
  updateInteraction,
  type InteractionDraft,
  type RelationshipEventDraft
} from "./application/interactions";
import {
  listActivePersonOptions,
  listEvents,
  type PersonPickerOption
} from "./application/interactionQueries";
import { getDatabase } from "./data/client";
import {
  interactionCountsAsContact,
  interactionKindLabel,
  MANUAL_INTERACTION_KINDS
} from "./domain/interactionPolicy";
import type { Interaction, InteractionKind, RelationshipEvent } from "./domain/schema";
import { ValidationError } from "./domain/validation";

function firstIssue(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? error.message;
  return error instanceof Error ? error.message : "PeopleOS could not save this interaction.";
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
}

function draftFromInteraction(interaction: Interaction): InteractionDraft {
  return {
    id: interaction.id,
    personId: interaction.personId,
    kind: interaction.kind,
    occurredAt: interaction.occurredAt,
    ...(interaction.summary ? { summary: interaction.summary } : {}),
    ...(interaction.eventId ? { eventId: interaction.eventId } : {}),
    ...(interaction.relatedPersonId ? { relatedPersonId: interaction.relatedPersonId } : {}),
    ...(interaction.followUpId ? { followUpId: interaction.followUpId } : {}),
    createdAt: interaction.createdAt,
    origin: interaction.kind === "note_added" ? "note" : "manual"
  };
}

function eventDescription(event: RelationshipEvent): string {
  return [event.occurredOn, event.location].filter(Boolean).join(" · ");
}

export default function InteractionEditorSheet({
  personId,
  personName,
  interaction,
  initialKind,
  onClose,
  onSaved,
  onDeleted
}: {
  personId: string;
  personName: string;
  interaction?: Interaction;
  initialKind?: InteractionKind;
  onClose: () => void;
  onSaved: (interaction: Interaction) => void;
  onDeleted: (interactionId: string) => void;
}) {
  const modalId = useId();
  const initialDraft = useMemo(() => interaction
    ? draftFromInteraction(interaction)
    : createInteractionDraft(personId, {
      kind: initialKind ?? "met",
      origin: initialKind === "note_added" ? "note" : "manual"
    }), [initialKind, interaction, personId]);
  const [draft, setDraft] = useState(initialDraft);
  const [events, setEvents] = useState<RelationshipEvent[]>([]);
  const [people, setPeople] = useState<PersonPickerOption[]>([]);
  const [eventMode, setEventMode] = useState(false);
  const [eventSearch, setEventSearch] = useState("");
  const [newEvent, setNewEvent] = useState<RelationshipEventDraft | null>(null);
  const [eventError, setEventError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const occurredRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const relatedPersonRef = useRef<HTMLSelectElement>(null);
  const eventSearchRef = useRef<HTMLInputElement>(null);
  const newEventNameRef = useRef<HTMLInputElement>(null);
  const eventButtonRef = useRef<HTMLButtonElement>(null);
  const previousEventModeRef = useRef(false);
  const mutationRef = useRef(false);
  const dirtyRef = useRef(false);
  const eventModeRef = useRef(false);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  dirtyRef.current = dirty;
  eventModeRef.current = eventMode;
  savingRef.current = saving;
  closeRef.current = onClose;
  const creatingEvent = newEvent !== null;

  useEffect(() => {
    let active = true;
    getDatabase().then(async (db) => Promise.all([
      listEvents(db),
      listActivePersonOptions(db, personId)
    ])).then(([storedEvents, personOptions]) => {
      if (!active) return;
      setEvents(storedEvents);
      setPeople(personOptions);
    }).catch(() => { if (active) setError("PeopleOS could not load interaction choices."); });
    return () => { active = false; };
  }, [personId]);

  useEffect(() => {
    const id = `interaction-editor-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: {
        id,
        dismiss: () => {
          if (savingRef.current) return;
          if (eventModeRef.current) {
            setEventMode(false);
            return;
          }
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
      if (draft.kind === "note_added") summaryRef.current?.focus();
      else firstFieldRef.current?.focus();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const wasInEventMode = previousEventModeRef.current;
    previousEventModeRef.current = eventMode;
    requestAnimationFrame(() => {
      if (eventMode) {
        if (creatingEvent) newEventNameRef.current?.focus();
        else eventSearchRef.current?.focus();
      } else if (wasInEventMode) {
        eventButtonRef.current?.focus();
      }
    });
  }, [creatingEvent, eventMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (eventMode) {
          setEventMode(false);
          return;
        }
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
    if (saving) return;
    if (dirtyRef.current && !window.confirm("Discard changes?")) return;
    onClose();
  }

  function change(patch: Partial<InteractionDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setError("");
  }

  function openEventSelector() {
    setEventSearch("");
    setNewEvent(null);
    setEventError("");
    setEventMode(true);
  }

  function selectExistingEvent(event: RelationshipEvent) {
    change({ eventId: event.id, newEvent: undefined });
    setEventMode(false);
  }

  function startNewEvent() {
    setEventError("");
    setNewEvent({ ...createRelationshipEventDraft(), name: eventSearch });
  }

  function selectNewEvent() {
    if (!newEvent) return;
    const name = newEvent.name.trim().replace(/\s+/g, " ");
    if (!name) {
      setEventError("Add an event name.");
      return;
    }
    if (name.length > 120) {
      setEventError("Event name must be 120 characters or fewer.");
      return;
    }
    const duplicate = events.find((event) =>
      normalizeEventName(event.name) === normalizeEventName(name)
      && event.occurredOn === (newEvent.occurredOn || undefined)
    );
    if (duplicate) {
      setEventError("An event with this name and date already exists. Select it below.");
      setEventSearch(name);
      setNewEvent(null);
      return;
    }
    change({
      eventId: undefined,
      newEvent: {
        ...newEvent,
        name,
        ...(newEvent.location?.trim() ? { location: newEvent.location.trim() } : { location: undefined })
      }
    });
    setEventMode(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current) return;
    mutationRef.current = true;
    setSaving(true);
    setError("");
    try {
      const db = await getDatabase();
      const saved = interaction
        ? await updateInteraction(db, draft, interaction.revision)
        : await createInteraction(db, draft);
      setDirty(false);
      onSaved(saved);
    } catch (caught) {
      if (caught instanceof DuplicateEventError) {
        setEvents((current) => {
          const withoutDuplicate = current.filter((event) => event.id !== caught.existingEvent.id);
          return [caught.existingEvent, ...withoutDuplicate];
        });
        setEventError(caught.message);
        setEventSearch(caught.existingEvent.name);
        setNewEvent(null);
        setEventMode(true);
      } else {
        const message = firstIssue(caught);
        setError(message);
        requestAnimationFrame(() => {
          if (/future|date and time/i.test(message)) occurredRef.current?.focus();
          else if (/related person|their name|note|summary/i.test(message)) summaryRef.current?.focus();
          else firstFieldRef.current?.focus();
        });
      }
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  async function remove() {
    if (!interaction || mutationRef.current) return;
    const confirmed = window.confirm(
      "Delete this interaction? It will be removed from the timeline. Last contact, relationship stage and Today may change."
    );
    if (!confirmed) return;
    mutationRef.current = true;
    setSaving(true);
    setError("");
    try {
      await deleteInteraction(await getDatabase(), interaction.id, interaction.revision);
      setDirty(false);
      onDeleted(interaction.id);
    } catch (caught) {
      setError(firstIssue(caught));
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  const selectedEvent = draft.eventId
    ? events.find((event) => event.id === draft.eventId)
    : undefined;
  const filteredEvents = events.filter((event) =>
    !eventSearch || normalizeEventName(event.name).includes(normalizeEventName(eventSearch))
  );
  const isIntroduction = draft.kind === "introduction_received" || draft.kind === "introduction_made";
  const isNote = draft.kind === "note_added";
  const dateHasError = /future|date and time/i.test(error);
  const summaryHasError = /related person|their name|note|summary/i.test(error);

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <section
        ref={sheetRef}
        className="contact-sheet interaction-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interaction-editor-title"
      >
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">{personName}</p>
            <h3 id="interaction-editor-title">
              {eventMode ? "Choose an event" : interaction ? (isNote ? "Edit note" : "Edit interaction") : isNote ? "Add note" : "Log interaction"}
            </h3>
          </div>
          <button
            type="button"
            aria-label={eventMode ? "Back to interaction" : "Close interaction editor"}
            onClick={() => eventMode ? setEventMode(false) : closeEditor()}
            disabled={saving}
          >{eventMode ? "←" : "×"}</button>
        </div>

        {eventMode ? (
          <div className="event-selector">
            <div className="form-field">
              <label htmlFor="event-search">Find or create event</label>
              <input
                ref={eventSearchRef}
                id="event-search"
                value={eventSearch}
                maxLength={120}
                onChange={(event) => { setEventSearch(event.target.value); setEventError(""); setNewEvent(null); }}
                placeholder="HealthTech Fellowship"
              />
            </div>
            {eventError && <p className="field-error" role="alert">{eventError}</p>}
            {newEvent ? (
              <div className="new-event-form" role="group" aria-label="New event details">
                <div className="form-field">
                  <label htmlFor="new-event-name">Event name <span>Required</span></label>
                  <input
                    ref={newEventNameRef}
                    id="new-event-name"
                    value={newEvent.name}
                    maxLength={120}
                    onChange={(event) => setNewEvent({ ...newEvent, name: event.target.value })}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="new-event-date">Event date <span>Optional</span></label>
                  <input
                    id="new-event-date"
                    type="date"
                    value={newEvent.occurredOn ?? ""}
                    onChange={(event) => setNewEvent({ ...newEvent, occurredOn: event.target.value || undefined })}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="new-event-location">Location <span>Optional</span></label>
                  <input
                    id="new-event-location"
                    value={newEvent.location ?? ""}
                    onChange={(event) => setNewEvent({ ...newEvent, location: event.target.value })}
                  />
                </div>
                <div className="button-row">
                  <button className="primary-action" type="button" onClick={selectNewEvent}>Use this event</button>
                  <button type="button" onClick={() => setNewEvent(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {filteredEvents.length > 0 ? (
                  <ul className="selector-list" aria-label="Events">
                    {filteredEvents.map((event) => (
                      <li key={event.id}>
                        <button type="button" onClick={() => selectExistingEvent(event)}>
                          <strong>{event.name}</strong>
                          {eventDescription(event) && <span>{eventDescription(event)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted-copy">{events.length === 0 ? "No events yet." : "No matching events."}</p>}
                <div className="button-row">
                  <button className="primary-action" type="button" onClick={startNewEvent}>
                    {eventSearch.trim() ? `Create “${eventSearch.trim()}”` : "Create this event"}
                  </button>
                  {(draft.eventId || draft.newEvent) && (
                    <button type="button" onClick={() => { change({ eventId: undefined, newEvent: undefined }); setEventMode(false); }}>
                      Clear event
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <form className="contact-editor interaction-editor" onSubmit={save} noValidate>
            {isNote ? (
              <p className="interaction-kind-readout"><strong>Note</strong> · Does not count as contact</p>
            ) : (
              <div className="form-field">
                <label htmlFor="interaction-kind">Interaction type <span>Required</span></label>
                <select
                  ref={firstFieldRef}
                  id="interaction-kind"
                  value={draft.kind}
                  aria-describedby={error ? "interaction-error" : undefined}
                  onChange={(event) => change({ kind: event.target.value as InteractionKind, relatedPersonId: undefined })}
                >
                  {MANUAL_INTERACTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{interactionKindLabel(kind)}</option>
                  ))}
                </select>
                <p className="field-hint">
                  {interactionCountsAsContact(draft.kind)
                    ? "This will count as meaningful contact."
                    : "This adds context but will not count as contact."}
                </p>
              </div>
            )}

            <div className="form-field">
              <label htmlFor="interaction-occurred">Date and time <span>Required</span></label>
              <input
                ref={occurredRef}
                id="interaction-occurred"
                type="datetime-local"
                required
                value={toLocalInputValue(draft.occurredAt)}
                max={toLocalInputValue(new Date().toISOString())}
                aria-invalid={dateHasError || undefined}
                aria-describedby={dateHasError ? "interaction-error" : "interaction-occurred-hint"}
                onChange={(event) => change({ occurredAt: fromLocalInputValue(event.target.value) })}
              />
              <p className="field-hint" id="interaction-occurred-hint">Future plans belong in a follow-up.</p>
            </div>

            <div className="form-field">
              <div className="field-label-row">
                <label htmlFor="interaction-summary">{isNote ? "Note" : "Summary"}</label>
                <span>{isNote ? "Required" : "Optional"} · {(draft.summary ?? "").length}/5,000</span>
              </div>
              <textarea
                ref={summaryRef}
                id="interaction-summary"
                required={isNote}
                aria-required={isNote || undefined}
                aria-invalid={summaryHasError || undefined}
                aria-describedby={summaryHasError ? "interaction-error" : undefined}
                rows={5}
                maxLength={5_000}
                value={draft.summary ?? ""}
                onChange={(event) => change({ summary: event.target.value })}
                placeholder={isNote ? "What do you want to remember?" : "What happened?"}
              />
            </div>

            {isIntroduction && (
              <div className="form-field">
                <label htmlFor="interaction-related-person">Related person <span>Optional if named in summary</span></label>
                <select
                  ref={relatedPersonRef}
                  id="interaction-related-person"
                  value={draft.relatedPersonId ?? ""}
                  aria-invalid={summaryHasError || undefined}
                  aria-describedby={summaryHasError ? "interaction-error" : undefined}
                  onChange={(event) => change({ relatedPersonId: event.target.value || undefined })}
                >
                  <option value="">No linked person</option>
                  {people.map((option) => (
                    <option key={option.person.id} value={option.person.id}>
                      {option.person.displayName}{option.affiliation ? ` · ${option.affiliation}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="interaction-event-row">
              <div>
                <span>Event</span>
                <strong>{selectedEvent?.name ?? draft.newEvent?.name ?? "No event selected"}</strong>
              </div>
              <button ref={eventButtonRef} className="secondary-action" type="button" onClick={openEventSelector}>
                {selectedEvent || draft.newEvent ? "Change" : "Choose event"}
              </button>
            </div>

            {error && <p className="form-alert" id="interaction-error" role="alert">{error}</p>}
            <div className="button-row sheet-actions">
              <button className="primary-action" type="submit" disabled={saving}>
                {saving ? "Saving…" : isNote ? "Save note" : "Save interaction"}
              </button>
              <button type="button" onClick={closeEditor} disabled={saving}>Cancel</button>
              {interaction && (
                <button className="danger-action" type="button" onClick={remove} disabled={saving}>
                  Delete interaction
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
