import { useEffect, useId, useRef, useState } from "react";
import type {
  PersonArchiveFilter,
  PersonFilterOptions,
  PersonSearchFilters
} from "./application/personSearch";
import { relationshipStageLabel, type RelationshipStageValue } from "./relationship-engine";

function toggleValue<T>(values: readonly T[] | undefined, value: T): T[] {
  const current = values ?? [];
  return current.includes(value)
    ? current.filter((candidate) => candidate !== value)
    : [...current, value];
}

function hasAnyChoice(options: PersonFilterOptions): boolean {
  return options.tags.length > 0
    || options.currentOrganisations.length > 0
    || options.events.length > 0
    || options.relationshipStages.length > 0;
}

export default function PeopleFilterSheet({
  filters,
  options,
  onApply,
  onClose
}: {
  filters: PersonSearchFilters;
  options: PersonFilterOptions;
  onApply: (filters: PersonSearchFilters) => void;
  onClose: () => void;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState<PersonSearchFilters>({ ...filters });
  const sheetRef = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = `people-filter-${prefix}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", { detail: { id, dismiss: onClose } }));
    requestAnimationFrame(() => firstRef.current?.focus());
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [onClose, prefix]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])"
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function clearAll() {
    setDraft({ archive: "active" });
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet filter-sheet" role="dialog" aria-modal="true" aria-labelledby={`${prefix}-title`}>
        <div className="sheet-heading">
          <div><p className="eyebrow">People</p><h3 id={`${prefix}-title`}>Filter people</h3></div>
          <button ref={firstRef} type="button" aria-label="Close people filters" onClick={onClose}>×</button>
        </div>

        {!hasAnyChoice(options) && <p className="muted-copy">No filter values yet. Due, contact-detail and archive filters are still available.</p>}

        {options.tags.length > 0 && (
          <fieldset className="filter-group">
            <legend>Tags</legend>
            {options.tags.map((tag) => (
              <label key={tag}><input type="checkbox" checked={draft.tags?.includes(tag) ?? false} onChange={() => setDraft((current) => ({ ...current, tags: toggleValue(current.tags, tag) }))} />{tag}</label>
            ))}
          </fieldset>
        )}

        {options.currentOrganisations.length > 0 && (
          <fieldset className="filter-group">
            <legend>Current organisation</legend>
            {options.currentOrganisations.map((organisation) => (
              <label key={organisation}><input type="checkbox" checked={draft.currentOrganisations?.includes(organisation) ?? false} onChange={() => setDraft((current) => ({ ...current, currentOrganisations: toggleValue(current.currentOrganisations, organisation) }))} />{organisation}</label>
            ))}
          </fieldset>
        )}

        {options.events.length > 0 && (
          <fieldset className="filter-group">
            <legend>Event</legend>
            {options.events.map((event) => (
              <label key={event.id}>
                <input type="checkbox" checked={draft.eventIds?.includes(event.id) ?? false} onChange={() => setDraft((current) => ({ ...current, eventIds: toggleValue(current.eventIds, event.id) }))} />
                <span>{event.name}{event.occurredOn ? ` · ${event.occurredOn}` : ""}</span>
              </label>
            ))}
          </fieldset>
        )}

        {options.relationshipStages.length > 0 && (
          <fieldset className="filter-group">
            <legend>Relationship stage</legend>
            {options.relationshipStages.map((stage) => (
              <label key={stage}><input type="checkbox" checked={draft.relationshipStages?.includes(stage) ?? false} onChange={() => setDraft((current) => ({ ...current, relationshipStages: toggleValue<RelationshipStageValue>(current.relationshipStages, stage) }))} />{relationshipStageLabel(stage)}</label>
            ))}
          </fieldset>
        )}

        <fieldset className="filter-group">
          <legend>Plans and contact details</legend>
          <label><input type="checkbox" checked={draft.hasDueFollowUp === true} onChange={(event) => setDraft((current) => ({ ...current, hasDueFollowUp: event.target.checked ? true : undefined }))} />Has due follow-up</label>
          <label><input type="checkbox" checked={draft.missingContactDetails === true} onChange={(event) => setDraft((current) => ({ ...current, missingContactDetails: event.target.checked ? true : undefined }))} />Missing contact details</label>
        </fieldset>

        <fieldset className="filter-group">
          <legend>Archived status</legend>
          {(["active", "archived", "all"] as PersonArchiveFilter[]).map((value) => (
            <label key={value}>
              <input type="radio" name={`${prefix}-archive`} value={value} checked={(draft.archive ?? "active") === value} onChange={() => setDraft((current) => ({ ...current, archive: value }))} />
              {value === "active" ? "Active" : value === "archived" ? "Archived" : "All"}
            </label>
          ))}
        </fieldset>

        <div className="button-row sheet-actions">
          <button type="button" onClick={clearAll}>Clear all</button>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" onClick={() => onApply(draft)}>Show results</button>
        </div>
      </section>
    </div>
  );
}
