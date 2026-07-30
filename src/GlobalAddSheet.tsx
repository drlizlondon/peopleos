import { useEffect, useId, useRef } from "react";

type GlobalAddSheetProps = {
  onClose: () => void;
  onNavigate: (path: string) => void;
};

export default function GlobalAddSheet({ onClose, onNavigate }: GlobalAddSheetProps) {
  const modalId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = `global-add-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: {
        id,
        dismiss: () => closeRef.current()
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
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled])"
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

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="contact-sheet global-add-sheet" role="dialog" aria-modal="true" aria-labelledby="global-add-title">
        <div className="sheet-heading">
          <h3 id="global-add-title">Add to PeopleOS</h3>
          <button
            type="button"
            autoFocus
            aria-label="Close Add menu"
            onClick={onClose}
          >×</button>
        </div>
        <div className="global-add-actions">
          <button className="primary-action" type="button" onClick={() => onNavigate("/people/new")}>Add person</button>
        </div>
      </section>
    </div>
  );
}
