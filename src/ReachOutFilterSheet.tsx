import { useEffect, useId, useRef, useState } from "react";
import type { ReachOutStatusFilter } from "./domain/reachOutPolicy";
import type { ReachOutContext } from "./domain/schema";

const STATUS_OPTIONS: Array<{ value: ReachOutStatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "due", label: "Due" },
  { value: "overdue", label: "Overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "waiting", label: "Waiting" },
  { value: "snoozed", label: "Snoozed" },
  { value: "dormant", label: "Dormant" },
  { value: "completed", label: "Completed" }
];

export const REACH_OUT_STATUS_OPTIONS = STATUS_OPTIONS;

export type ReachOutFilters = {
  statusFilters: ReachOutStatusFilter[];
  contextId: string;
};

export default function ReachOutFilterSheet({
  applied,
  contexts,
  onApply,
  onClose
}: {
  applied: ReachOutFilters;
  contexts: ReachOutContext[];
  onApply: (filters: ReachOutFilters) => void;
  onClose: () => void;
}) {
  const modalId = useId();
  const [draft, setDraft] = useState<ReachOutFilters>({
    statusFilters: [...applied.statusFilters],
    contextId: applied.contextId
  });
  const sheetRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = `reach-out-filter-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: { id, dismiss: () => closeRef.current() }
    }));
    const frame = requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])"
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
  }, [onClose]);

  function toggleStatus(status: ReachOutStatusFilter, checked: boolean) {
    setDraft((current) => ({
      ...current,
      statusFilters: checked
        ? [...current.statusFilters, status]
        : current.statusFilters.filter((candidate) => candidate !== status)
    }));
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={sheetRef}
        className="contact-sheet reach-out-filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reach-out-filter-title"
      >
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">Reach Out</p>
            <h3 id="reach-out-filter-title">Filter the queue</h3>
          </div>
          <button type="button" aria-label="Close filters" onClick={onClose}>×</button>
        </div>
        <div className="reach-out-filter-fields">
          <fieldset className="reach-out-filter-options">
            <legend>Status</legend>
            <p id="reach-out-status-filter-hint">Choose any statuses. A plan can match any selected status.</p>
            {STATUS_OPTIONS.map((option, index) => (
              <label key={option.value}>
                <input
                  ref={index === 0 ? firstFieldRef : undefined}
                  type="checkbox"
                  value={option.value}
                  checked={draft.statusFilters.includes(option.value)}
                  aria-describedby="reach-out-status-filter-hint"
                  onChange={(event) => toggleStatus(option.value, event.target.checked)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <div className="form-field">
            <label htmlFor="reach-out-context-filter">Context</label>
            <select
              id="reach-out-context-filter"
              value={draft.contextId}
              onChange={(event) => setDraft((current) => ({ ...current, contextId: event.target.value }))}
            >
              <option value="">All contexts</option>
              {contexts.map((context) => <option key={context.id} value={context.id}>{context.label}</option>)}
            </select>
          </div>
        </div>
        <div className="sheet-actions button-row">
          <button className="primary-action" type="button" onClick={() => onApply(draft)}>Show results</button>
          <button type="button" onClick={() => setDraft({ statusFilters: [], contextId: "" })}>Clear all</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
