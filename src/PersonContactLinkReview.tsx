import { useEffect, useId, useRef, useState } from "react";
import type { ContactImportRow, ContactImportSession } from "./application/contactImport";
import {
  personUsesOwnContactAsDisplayName,
  reviewedDisplayNameCandidate
} from "./application/duplicateResolution";
import type { DuplicateMatch } from "./domain/duplicates";
import type { ContactMethod, Person } from "./domain/schema";

export type PersonContactLinkSelection = {
  row: ContactImportRow;
  contactMethodIds: string[];
  includeAffiliation: boolean;
  includeDisplayName: boolean;
};

type RowSelection = {
  contactMethodIds: string[];
  includeAffiliation: boolean;
  includeDisplayName: boolean;
};

type Props = {
  session: ContactImportSession;
  targetPerson: Person;
  targetContactMethods: readonly ContactMethod[];
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (selection: PersonContactLinkSelection) => void;
};

function contactKey(contact: Pick<ContactMethod, "kind" | "canonicalValue">): string {
  return `${contact.kind}:${contact.canonicalValue}`;
}

function exactConflictContactIds(
  row: ContactImportRow,
  targetPersonId: string
): Set<string> {
  const storedMatches = row.duplicateMatches
    .filter((match) => match.source === "stored" && match.person.id !== targetPersonId);
  const storedConflictIds = storedMatches
    .flatMap((match) => match.evidence)
    .filter((evidence) => evidence.code === "same_phone" || evidence.code === "same_email")
    .flatMap((evidence) => evidence.candidateSourceIds);
  // Matches against another contact selected in this same picker session are
  // not persisted PeopleOS ownership. If that other row is skipped, its
  // details remain safe to add to the one Person the user explicitly chose.
  return new Set(storedConflictIds);
}

function exactConflictMatches(
  row: ContactImportRow,
  targetPersonId: string
): DuplicateMatch[] {
  return row.duplicateMatches.filter((match) => (
    match.source === "stored"
    && match.person.id !== targetPersonId
    && match.evidence.some((evidence) => evidence.code === "same_phone" || evidence.code === "same_email")
  ));
}

function initialSelection(
  row: ContactImportRow,
  targetPerson: Person,
  targetContactMethods: readonly ContactMethod[]
): RowSelection {
  if (!row.prepared) {
    return { contactMethodIds: [], includeAffiliation: false, includeDisplayName: false };
  }
  const existingKeys = new Set(targetContactMethods
    .filter((contact) => !contact.archivedAt)
    .map(contactKey));
  const blockedIds = exactConflictContactIds(row, targetPerson.id);
  return {
    contactMethodIds: row.prepared.contactMethods
      .filter((contact) => !existingKeys.has(contactKey(contact)) && !blockedIds.has(contact.id))
      .map((contact) => contact.id),
    includeAffiliation: Boolean(row.prepared.affiliation),
    includeDisplayName: Boolean(
      reviewedDisplayNameCandidate(row.prepared)
      && personUsesOwnContactAsDisplayName(targetPerson, targetContactMethods)
    )
  };
}

function contactLabel(contact: ContactMethod): string {
  const kind = contact.label || (contact.kind === "phone" ? "Phone" : "Email");
  return `${kind}: ${contact.rawValue}`;
}

export default function PersonContactLinkReview({
  session,
  targetPerson,
  targetContactMethods,
  busy,
  error,
  onCancel,
  onSubmit
}: Props) {
  const headingId = useId();
  const rows = session.rows;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRequiredRadioRef = useRef<HTMLInputElement>(null);
  const [rowId, setRowId] = useState(rows.length === 1 ? rows[0]?.id ?? "" : "");
  const [selections, setSelections] = useState<Record<string, RowSelection>>(() => Object.fromEntries(
    rows.map((row) => [row.id, initialSelection(row, targetPerson, targetContactMethods)])
  ));
  const row = rows.find((candidate) => candidate.id === rowId);
  const selection = row
    ? selections[row.id] ?? { contactMethodIds: [], includeAffiliation: false, includeDisplayName: false }
    : { contactMethodIds: [], includeAffiliation: false, includeDisplayName: false };
  const blockedIds = row ? exactConflictContactIds(row, targetPerson.id) : new Set<string>();
  const existingKeys = new Set(targetContactMethods
    .filter((contact) => !contact.archivedAt)
    .map(contactKey));
  const conflictMatches = row ? exactConflictMatches(row, targetPerson.id) : [];
  const canSubmit = Boolean(
    row?.prepared
    && row.issues.length === 0
    && (selection.contactMethodIds.length > 0 || selection.includeAffiliation || selection.includeDisplayName)
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (rows.length > 1) firstRequiredRadioRef.current?.focus();
      else headingRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [rows.length]);

  function updateSelection(update: (current: RowSelection) => RowSelection) {
    if (!row) return;
    setSelections((current) => ({
      ...current,
      [row.id]: update(current[row.id] ?? {
        contactMethodIds: [],
        includeAffiliation: false,
        includeDisplayName: false
      })
    }));
  }

  return (
    <section className="profile-card" aria-labelledby={headingId} aria-busy={busy}>
      <div className="card-heading-with-action">
        <div>
          <h3 ref={headingRef} id={headingId} tabIndex={-1}>Link iPhone contact</h3>
          <p>Review the details to add to {targetPerson.displayName}. This is a one-time copy, not ongoing sync.</p>
        </div>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>

      {rows.length > 1 && (
        <fieldset className="choice-fieldset">
          <legend>Choose the iPhone contact to add to {targetPerson.displayName}</legend>
          {rows.map((candidate, index) => (
            <label key={candidate.id}>
              <input
                ref={index === 0 ? firstRequiredRadioRef : undefined}
                type="radio"
                name="iphone-contact-to-link"
                value={candidate.id}
                checked={row?.id === candidate.id}
                disabled={busy}
                required
                onChange={() => setRowId(candidate.id)}
              />
              {candidate.prepared?.person.displayName || candidate.draft.displayName || "Contact"}
            </label>
          ))}
        </fieldset>
      )}

      {row && (
        <div className="link-details-review">
          {rows.length === 1 && (
            <p><strong>Selected:</strong> {row.prepared?.person.displayName || row.draft.displayName || "Contact"}</p>
          )}
          {row.issues.length > 0 && (
            <div className="form-alert" role="alert">
              {row.issues.map((issue, index) => <p key={`${issue.field}-${issue.contactMethodId ?? index}`}>{issue.message}</p>)}
            </div>
          )}
          {conflictMatches.length > 0 && (
            <div className="form-alert" role="alert">
              <p>
                {conflictMatches.length === 1
                  ? `Some details already belong to ${conflictMatches[0].person.displayName} in PeopleOS, so they cannot be added here.`
                  : "Some details already belong to other people in PeopleOS, so they cannot be added here."}
              </p>
            </div>
          )}
          {row.prepared && (
            <fieldset className="choice-fieldset">
              <legend>Details to add</legend>
              {reviewedDisplayNameCandidate(row.prepared)
                && personUsesOwnContactAsDisplayName(targetPerson, targetContactMethods) && (
                <label>
                  <input
                    type="checkbox"
                    checked={selection.includeDisplayName}
                    disabled={busy}
                    onChange={(event) => updateSelection((current) => ({
                      ...current,
                      includeDisplayName: event.target.checked
                    }))}
                  />
                  Name: {reviewedDisplayNameCandidate(row.prepared)}
                </label>
              )}
              {row.prepared.contactMethods.map((contact) => {
                const alreadySaved = existingKeys.has(contactKey(contact));
                const blocked = blockedIds.has(contact.id);
                return (
                  <label key={contact.id}>
                    <input
                      type="checkbox"
                      checked={selection.contactMethodIds.includes(contact.id)}
                      disabled={busy || alreadySaved || blocked}
                      onChange={(event) => updateSelection((current) => ({
                        ...current,
                        contactMethodIds: event.target.checked
                          ? [...current.contactMethodIds, contact.id]
                          : current.contactMethodIds.filter((id) => id !== contact.id)
                      }))}
                    />
                    {contactLabel(contact)}
                    {alreadySaved ? " · Already saved" : blocked ? " · Used by another person" : ""}
                  </label>
                );
              })}
              {row.prepared.affiliation && (
                <label>
                  <input
                    type="checkbox"
                    checked={selection.includeAffiliation}
                    disabled={busy}
                    onChange={(event) => updateSelection((current) => ({
                      ...current,
                      includeAffiliation: event.target.checked
                    }))}
                  />
                  Organisation: {row.prepared.affiliation.organisationName}
                  {row.prepared.affiliation.role ? ` · ${row.prepared.affiliation.role}` : ""}
                </label>
              )}
              {row.prepared.contactMethods.length === 0 && !row.prepared.affiliation && (
                <p className="muted-copy">This iPhone contact has no supported details to add.</p>
              )}
            </fieldset>
          )}
        </div>
      )}

      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="button-row compact-buttons">
        <button
          className="primary-action"
          type="button"
          disabled={busy || !canSubmit || !row}
          onClick={() => row && onSubmit({
            row,
            contactMethodIds: selection.contactMethodIds,
            includeAffiliation: selection.includeAffiliation,
            includeDisplayName: selection.includeDisplayName
          })}
        >
          {busy ? "Adding…" : `Add selected details to ${targetPerson.displayName}`}
        </button>
      </div>
    </section>
  );
}
