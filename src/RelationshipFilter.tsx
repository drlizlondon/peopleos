import { useEffect, useId, useRef, useState } from "react";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";

const options: ReadonlyArray<{ value: ActiveRelationshipMode; label: string; announcement: string }> = [
  { value: "all", label: "Everyone", announcement: "Showing everyone" },
  { value: "personal", label: "Personal", announcement: "Showing personal contacts" },
  { value: "professional", label: "Professional", announcement: "Showing professional contacts" }
];

export default function RelationshipFilter({
  value,
  onChange
}: {
  value: ActiveRelationshipMode;
  onChange: (value: ActiveRelationshipMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <div className="relationship-filter" ref={rootRef}>
      <button
        ref={triggerRef}
        className="relationship-filter-trigger"
        type="button"
        aria-label="Filter people"
        aria-describedby={`${menuId}-status`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.label}</span>
        <span className="relationship-filter-chevron" aria-hidden="true">⌄</span>
      </button>
      <span className="visually-hidden" id={`${menuId}-status`}>{selected.announcement}</span>
      {open && (
        <div className="relationship-filter-menu" id={menuId} role="menu" aria-label="Filter people">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
            >
              <span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
