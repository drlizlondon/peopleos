import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { PreparedManualPersonCapture } from "./application/manualPersonCapture";
import type { DuplicateMatch } from "./domain/duplicates";

export type DuplicateLinkSelection = {
  contactMethodIds: string[];
  includeAffiliation: boolean;
};

type Props = {
  candidate: PreparedManualPersonCapture;
  matches: DuplicateMatch[];
  busy?: boolean;
  allowSkip?: boolean;
  showAddDetails?: boolean;
  showOpenExisting?: boolean;
  createSeparateLabel?: string;
  eyebrow?: string;
  heading?: string;
  description?: ReactNode;
  onOpenExisting: (match: DuplicateMatch) => void;
  onAddDetails: (match: DuplicateMatch, selection: DuplicateLinkSelection) => void;
  onCreateSeparate: () => void;
  onReturnToEdit: () => void;
  onSkip?: () => void;
};

function linkableSelection(candidate: PreparedManualPersonCapture, match: DuplicateMatch): DuplicateLinkSelection {
  const identicalCandidateIds = new Set(
    match.evidence
      .filter((evidence) => evidence.code === "same_phone" || evidence.code === "same_email")
      .flatMap((evidence) => evidence.candidateSourceIds)
  );
  return {
    contactMethodIds: candidate.contactMethods
      .filter((contact) => !identicalCandidateIds.has(contact.id))
      .map((contact) => contact.id),
    includeAffiliation: Boolean(candidate.affiliation)
  };
}

function contactLabel(candidate: PreparedManualPersonCapture, id: string): string {
  const contact = candidate.contactMethods.find((record) => record.id === id);
  if (!contact) return id;
  const kind = contact.label || (contact.kind === "phone" ? "Phone" : "Email");
  return `${kind}: ${contact.rawValue}`;
}

export default function DuplicateWarningSheet({
  candidate,
  matches,
  busy = false,
  allowSkip = false,
  showAddDetails = true,
  showOpenExisting = true,
  createSeparateLabel = "Create separate person",
  eyebrow = "Review before saving",
  heading = "Possible duplicate",
  description,
  onOpenExisting,
  onAddDetails,
  onCreateSeparate,
  onReturnToEdit,
  onSkip
}: Props) {
  const modalId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const dismissRef = useRef(onReturnToEdit);
  busyRef.current = busy;
  dismissRef.current = onReturnToEdit;
  const initialSelections = useMemo(() => Object.fromEntries(
    matches.map((match) => [match.person.id, linkableSelection(candidate, match)])
  ), [candidate, matches]);
  const [selections, setSelections] = useState<Record<string, DuplicateLinkSelection>>(initialSelections);

  useEffect(() => {
    const id = `duplicate-warning-${modalId}`;
    window.dispatchEvent(new CustomEvent("peopleos:modal-open", {
      detail: {
        id,
        dismiss: () => {
          if (!busyRef.current) dismissRef.current();
        }
      }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("peopleos:modal-close", { detail: { id } }));
    };
  }, [modalId]);

  useEffect(() => {
    headingRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onReturnToEdit();
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), summary, [tabindex='0']"
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onReturnToEdit]);

  function updateSelection(personId: string, update: (current: DuplicateLinkSelection) => DuplicateLinkSelection) {
    setSelections((current) => ({ ...current, [personId]: update(current[personId] ?? { contactMethodIds: [], includeAffiliation: false }) }));
  }

  return (
    <div className="sheet-backdrop duplicate-backdrop">
      <section ref={sheetRef} className="contact-sheet duplicate-sheet" role="dialog" aria-modal="true" aria-labelledby="duplicate-warning-heading">
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3 id="duplicate-warning-heading" ref={headingRef} tabIndex={-1}>{heading}</h3>
          </div>
          <button type="button" onClick={onReturnToEdit} disabled={busy} aria-label="Return to edit">×</button>
        </div>
        <p>{description ?? <><strong>{candidate.person.displayName}</strong> may already be in PeopleOS. Nothing has been saved or merged.</>}</p>

        <div className="duplicate-match-list">
          {matches.map((match, matchIndex) => {
            const selection = selections[match.person.id] ?? { contactMethodIds: [], includeAffiliation: false };
            const linkableContactIds = linkableSelection(candidate, match).contactMethodIds;
            const affiliationCanBeAdded = Boolean(candidate.affiliation);
            const hasSelectedDetail = selection.contactMethodIds.length > 0 || selection.includeAffiliation;
            const persistedMatch = match.source !== "import";
            return (
              <article className="duplicate-match" key={match.person.id}>
                <div className="duplicate-match-heading">
                  <h4>{match.person.displayName}</h4>
                  <span className={`status-chip ${match.strength === "strong" ? "status-strong" : ""}`}>
                    {match.strength === "strong" ? "Strong match" : "Check this match"}
                  </span>
                </div>
                <div className="duplicate-comparison">
                  <section aria-label="New information">
                    <h5>New information</h5>
                    <p><strong>{candidate.person.displayName}</strong></p>
                    {candidate.contactMethods.map((contact) => <p key={contact.id}>{contactLabel(candidate, contact.id)}</p>)}
                    {candidate.affiliation && (
                      <p>
                        {candidate.affiliation.organisationName}
                        {candidate.affiliation.role ? ` · ${candidate.affiliation.role}` : ""}
                      </p>
                    )}
                  </section>
                  <section aria-label={persistedMatch ? "Existing person" : "Other contact in this file"}>
                    <h5>{persistedMatch ? "Existing person" : "Other contact in this file"}</h5>
                    <p><strong>{match.person.displayName}</strong></p>
                    <ul className="duplicate-evidence" aria-label={`Why ${match.person.displayName} may match`}>
                      {match.evidence.map((evidence) => (
                        <li key={`${evidence.code}-${evidence.existingSourceIds.join("-")}`}>{evidence.explanation}</li>
                      ))}
                    </ul>
                  </section>
                </div>
                {showOpenExisting && persistedMatch && <div className="button-row duplicate-actions">
                  <button
                    className={match.strength === "strong" ? "primary-action" : "secondary-action"}
                    type="button"
                    onClick={() => onOpenExisting(match)}
                    disabled={busy}
                    aria-label={`Open existing person ${match.person.displayName}${matches.length > 1 ? `, match ${matchIndex + 1} of ${matches.length}` : ""}`}
                  >
                    Open existing person
                  </button>
                </div>}
                {showAddDetails && persistedMatch && (linkableContactIds.length > 0 || affiliationCanBeAdded) && (
                  <details className="link-details-review">
                    <summary>Review details to add</summary>
                    <fieldset>
                      <legend>Only checked details will be added to {match.person.displayName}</legend>
                      {linkableContactIds.map((id) => (
                        <label key={id}>
                          <input
                            type="checkbox"
                            checked={selection.contactMethodIds.includes(id)}
                            onChange={(event) => updateSelection(match.person.id, (current) => ({
                              ...current,
                              contactMethodIds: event.target.checked
                                ? [...current.contactMethodIds, id]
                                : current.contactMethodIds.filter((candidateId) => candidateId !== id)
                            }))}
                          />
                          {contactLabel(candidate, id)}
                        </label>
                      ))}
                      {affiliationCanBeAdded && candidate.affiliation && (
                        <label>
                          <input
                            type="checkbox"
                            checked={selection.includeAffiliation}
                            onChange={(event) => updateSelection(match.person.id, (current) => ({
                              ...current,
                              includeAffiliation: event.target.checked
                            }))}
                          />
                          Organisation: {candidate.affiliation.organisationName}
                          {candidate.affiliation.role ? ` · ${candidate.affiliation.role}` : ""}
                        </label>
                      )}
                      {affiliationCanBeAdded && (
                        <p className="field-hint">PeopleOS adds this only when the complete affiliation is not already stored.</p>
                      )}
                    </fieldset>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={busy || !hasSelectedDetail}
                      onClick={() => onAddDetails(match, selection)}
                      aria-label={`Add selected details to ${match.person.displayName}${matches.length > 1 ? `, match ${matchIndex + 1} of ${matches.length}` : ""}`}
                    >
                      Add selected details to {match.person.displayName}
                    </button>
                  </details>
                )}
              </article>
            );
          })}
        </div>

        <div className="sheet-actions duplicate-footer-actions">
          <button className="secondary-action" type="button" onClick={onCreateSeparate} disabled={busy}>{createSeparateLabel}</button>
          {allowSkip && onSkip && <button className="secondary-action" type="button" onClick={onSkip} disabled={busy}>Skip this contact</button>}
          <button type="button" onClick={onReturnToEdit} disabled={busy}>Return to edit</button>
        </div>
      </section>
    </div>
  );
}
