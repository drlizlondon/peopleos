import {
  useRef,
  useState,
  type ChangeEvent
} from "react";
import EmptyState from "./EmptyState";
import DuplicateWarningSheet, { type DuplicateLinkSelection } from "./DuplicateWarningSheet";
import {
  chooseCreateSeparate,
  chooseLinkDetails,
  contactImportCounts,
  importedPersonIds,
  importSelectedContacts,
  prepareContactImport,
  restoreSkippedImportRow,
  reviewContactImportSessionFromRow,
  skipContactImportRow,
  type ContactImportRow,
  type ContactImportSession
} from "./application/contactImport";
import { createManualContactMethodDraft } from "./application/manualPersonCapture";
import { getAppSettings } from "./application/peopleQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { DuplicateMatch } from "./domain/duplicates";
import { MAX_VCARD_BYTES, VCardParseError } from "./integrations/vcard";
import { personProfilePath, postAddRelationshipPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

type ImportScreenProps = {
  session: ContactImportSession | null;
  setSession: (session: ContactImportSession | null) => void;
  navigate: Navigate;
  onBusyChange?: (busy: boolean) => void;
  originPath?: string;
};

function importOrigin(path: string | undefined): { path: string; label: string } {
  if (path === "/") return { path, label: "Today" };
  if (path === "/settings") return { path, label: "Settings" };
  return { path: "/people", label: "People" };
}

function parserError(error: unknown): string {
  if (error instanceof VCardParseError) return error.message;
  return "PeopleOS could not read that vCard file. Choose another file and try again.";
}

function rowLabel(row: ContactImportRow): string {
  return row.draft.displayName.trim()
    || row.draft.contactMethods.find((contact) => contact.value.trim())?.value.trim()
    || `Contact ${row.sourceIndex + 1}`;
}

function rowStatus(row: ContactImportRow): string {
  if (row.status === "created") return "Created";
  if (row.status === "added_details") return "Details added";
  if (row.status === "skipped") return "Skipped";
  if (row.status === "failed") return "Failed";
  if (row.issues.length) return "Needs attention";
  if (row.duplicateMatches.length && !row.decision) return "Possible duplicate";
  if (row.decision?.kind === "link") return "Ready · Add details";
  if (row.decision?.kind === "create" && row.decision.duplicateOverride) return "Ready · Create separately";
  return "Ready";
}

function replaceRow(session: ContactImportSession, nextRow: ContactImportRow): ContactImportSession {
  return {
    ...session,
    rows: session.rows.map((row) => row.id === nextRow.id ? nextRow : row)
  };
}

function ContactSummary({ row }: { row: ContactImportRow }) {
  return (
    <dl className="import-contact-summary">
      {row.draft.contactMethods.map((contact) => (
        <div key={contact.id}>
          <dt>{contact.label || (contact.kind === "phone" ? "Phone" : "Email")}</dt>
          <dd>{contact.value || "No value"}</dd>
        </div>
      ))}
      {row.draft.organisationName && <div><dt>Organisation</dt><dd>{row.draft.organisationName}</dd></div>}
      {row.draft.role && <div><dt>Role</dt><dd>{row.draft.role}</dd></div>}
    </dl>
  );
}

function ImportRowEditor({
  row,
  onChange,
  onDone,
  disabled
}: {
  row: ContactImportRow;
  onChange: (row: ContactImportRow) => void;
  onDone: () => void;
  disabled: boolean;
}) {
  const nameIssue = row.issues.find((issue) => issue.field === "displayName");
  const organisationIssue = row.issues.find((issue) => issue.field === "organisation");

  function updateDraft(patch: Partial<ContactImportRow["draft"]>) {
    onChange({
      ...row,
      draft: { ...row.draft, ...patch },
      decision: undefined,
      selected: false,
      status: "needs_review",
      error: undefined
    });
  }

  function updateContact(id: string, patch: Partial<ContactImportRow["draft"]["contactMethods"][number]>) {
    updateDraft({
      contactMethods: row.draft.contactMethods.map((contact) => contact.id === id ? { ...contact, ...patch } : contact)
    });
  }

  return (
    <div className="import-row-editor">
      <div className="form-field">
        <label htmlFor={`import-${row.id}-name`}>Name <span aria-hidden="true">Optional</span></label>
        <input
          id={`import-${row.id}-name`}
          aria-label="Name"
          value={row.draft.displayName}
          aria-invalid={Boolean(nameIssue)}
          aria-describedby={nameIssue ? `import-${row.id}-name-error` : undefined}
          onChange={(event) => updateDraft({ displayName: event.target.value })}
        />
        {nameIssue && <p className="field-error" id={`import-${row.id}-name-error`} role="alert">{nameIssue.message}</p>}
      </div>
      {row.draft.contactMethods.map((contact, index) => {
        const issue = row.issues.find((candidate) => candidate.contactMethodId === contact.id);
        const issueId = `import-${row.id}-${contact.id}-error`;
        return (
          <fieldset className="import-contact-editor" key={contact.id}>
            <legend>Contact detail {index + 1}</legend>
            <div className="contact-row-grid">
              <div className="form-field">
                <label htmlFor={`import-${row.id}-${contact.id}-kind`}>Type</label>
                <select
                  id={`import-${row.id}-${contact.id}-kind`}
                  value={contact.kind}
                  onChange={(event) => updateContact(contact.id, { kind: event.target.value as "phone" | "email" })}
                >
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div className="form-field contact-value-field">
                <label htmlFor={`import-${row.id}-${contact.id}-value`}>{contact.kind === "phone" ? "Phone number" : "Email address"}</label>
                <input
                  id={`import-${row.id}-${contact.id}-value`}
                  type={contact.kind === "phone" ? "tel" : "email"}
                  value={contact.value}
                  aria-invalid={Boolean(issue)}
                  aria-describedby={issue ? issueId : undefined}
                  onChange={(event) => updateContact(contact.id, { value: event.target.value })}
                />
                {issue && <p className="field-error" id={issueId} role="alert">{issue.message}</p>}
              </div>
              <div className="form-field">
                <label htmlFor={`import-${row.id}-${contact.id}-label`}>Label</label>
                <input
                  id={`import-${row.id}-${contact.id}-label`}
                  value={contact.label ?? ""}
                  onChange={(event) => updateContact(contact.id, { label: event.target.value })}
                />
              </div>
            </div>
            <button
              className="text-action danger-text"
              type="button"
              onClick={() => updateDraft({ contactMethods: row.draft.contactMethods.filter((candidate) => candidate.id !== contact.id) })}
            >
              Remove contact detail {index + 1}
            </button>
          </fieldset>
        );
      })}
      <div className="button-row compact-buttons">
        <button type="button" onClick={() => updateDraft({ contactMethods: [...row.draft.contactMethods, createManualContactMethodDraft("phone")] })}>Add phone</button>
        <button type="button" onClick={() => updateDraft({ contactMethods: [...row.draft.contactMethods, createManualContactMethodDraft("email")] })}>Add email</button>
      </div>
      <div className="form-field">
        <label htmlFor={`import-${row.id}-organisation`}>Organisation</label>
        <input
          id={`import-${row.id}-organisation`}
          value={row.draft.organisationName ?? ""}
          aria-invalid={Boolean(organisationIssue)}
          aria-describedby={organisationIssue ? `import-${row.id}-organisation-error` : undefined}
          onChange={(event) => updateDraft({ organisationName: event.target.value })}
        />
        {organisationIssue && <p className="field-error" id={`import-${row.id}-organisation-error`} role="alert">{organisationIssue.message}</p>}
      </div>
      <div className="form-field">
        <label htmlFor={`import-${row.id}-role`}>Role or job title</label>
        <input
          id={`import-${row.id}-role`}
          value={row.draft.role ?? ""}
          onChange={(event) => updateDraft({ role: event.target.value })}
        />
      </div>
      <button className="secondary-action" type="button" onClick={onDone} disabled={disabled}>Check this contact</button>
    </div>
  );
}

export function ImportContactsScreen({ session, setSession, navigate, onBusyChange, originPath }: ImportScreenProps) {
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [duplicateRowId, setDuplicateRowId] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const origin = importOrigin(originPath);

  const duplicateRow = session?.rows.find((row) => row.id === duplicateRowId);
  const selectedFromIPhone = session?.sourceKind === "iphone_contacts";

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setParsing(true);
    onBusyChange?.(true);
    setPageError("");
    try {
      if (file.size > MAX_VCARD_BYTES) {
        throw new VCardParseError(
          "file_too_large",
          `Choose a vCard file no larger than ${MAX_VCARD_BYTES} bytes.`
        );
      }
      const db = await getDatabase();
      const settings = await getAppSettings(db);
      const next = await prepareContactImport(db, await file.arrayBuffer(), file.name, settings.defaultPhoneRegion);
      setSession(next);
      setEditingRowId(null);
      setDuplicateRowId(null);
    } catch (error) {
      setPageError(parserError(error));
    } finally {
      setParsing(false);
      onBusyChange?.(false);
      event.target.value = "";
    }
  }

  function updateRow(row: ContactImportRow) {
    if (session) setSession(replaceRow(session, row));
  }

  async function recheckRow(row: ContactImportRow) {
    if (!session) return;
    setPageError("");
    try {
      const reviewedSession = await reviewContactImportSessionFromRow(await getDatabase(), session, row);
      const checked = reviewedSession.rows.find((candidate) => candidate.id === row.id) ?? row;
      setSession(reviewedSession);
      setEditingRowId(checked.issues.length ? row.id : null);
      if (!checked.issues.length && checked.duplicateMatches.length) setDuplicateRowId(row.id);
      if (checked.issues.length) {
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-import-row-id='${row.id}'] [aria-invalid='true']`)?.focus());
      }
    } catch {
      setPageError(`PeopleOS could not recheck ${rowLabel(row)}. Your edits are still here; try again.`);
      setEditingRowId(row.id);
    }
  }

  function selectReadyRows() {
    if (!session) return;
    setSession({
      ...session,
      rows: session.rows.map((row) => row.status === "ready" && row.decision
        ? { ...row, selected: true }
        : row)
    });
  }

  async function runImport() {
    if (!session || submittingRef.current) return;
    submittingRef.current = true;
    setImporting(true);
    onBusyChange?.(true);
    setPageError("");
    try {
      const result = await importSelectedContacts(await getDatabase(), session);
      setSession(result);
      const onlyRow = result.rows.length === 1 ? result.rows[0] : undefined;
      if (result.sourceKind === "iphone_contacts"
        && onlyRow?.status === "created"
        && onlyRow.resultPersonId) {
        onBusyChange?.(false);
        navigate(postAddRelationshipPath(onlyRow.resultPersonId), { replace: true });
        return;
      }
      onBusyChange?.(false);
      navigate("/people/import/results");
    } catch {
      setPageError("PeopleOS could not finish this import. Completed rows are unchanged; try the remaining rows again.");
    } finally {
      submittingRef.current = false;
      setImporting(false);
      onBusyChange?.(false);
    }
  }

  function cancel() {
    if (session && session.rows.some((row) => !["created", "added_details", "skipped"].includes(row.status))) {
      if (!window.confirm("Cancel this import? Unimported contacts will be discarded.")) return;
    }
    setSession(null);
    navigate(origin.path, { replace: true });
  }

  function focusImportRow(rowId: string, selector: string) {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-import-row-id='${rowId}'] ${selector}`)?.focus();
    });
  }

  const groupedRows = session ? {
    review: session.rows.filter((row) => row.status === "needs_review" || row.status === "failed"),
    ready: session.rows.filter((row) => row.status === "ready"),
    skipped: session.rows.filter((row) => row.status === "skipped"),
    imported: session.rows.filter((row) => row.status === "created" || row.status === "added_details")
  } : undefined;
  const selectableCount = session?.rows.filter((row) => row.status === "ready" && row.selected).length ?? 0;
  const unresolvedCount = session?.rows.filter((row) => (
    row.status === "needs_review" || (row.status === "ready" && !row.selected)
  )).length ?? 0;
  const resolvedOutcomeCount = session?.rows.filter((row) => (
    (row.status === "ready" && row.selected)
    || ["skipped", "failed", "created", "added_details"].includes(row.status)
  )).length ?? 0;

  function renderGroup(title: string, rows: ContactImportRow[]) {
    if (!rows.length) return null;
    return (
      <section className="import-group" aria-labelledby={`import-group-${title.replaceAll(" ", "-").toLowerCase()}`}>
        <h3 id={`import-group-${title.replaceAll(" ", "-").toLowerCase()}`}>{title} <span>{rows.length}</span></h3>
        <div className="import-row-list">
          {rows.map((row) => {
            const locked = row.status === "created" || row.status === "added_details";
            const editing = editingRowId === row.id;
            return (
              <article data-import-row-id={row.id} className="import-row" key={row.id} aria-labelledby={`import-row-${row.id}-heading`}>
                <div className="import-row-heading">
                  <div>
                    <h4 id={`import-row-${row.id}-heading`}>{rowLabel(row)}</h4>
                    <span className={`status-chip status-${row.status}`}>{rowStatus(row)}</span>
                  </div>
                  {row.status === "ready" && (
                    <label className="import-select">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(event) => updateRow({ ...row, selected: event.target.checked })}
                      />
                      Import {rowLabel(row)}
                    </label>
                  )}
                </div>
                {editing ? (
                  <ImportRowEditor
                    row={row}
                    onChange={updateRow}
                    onDone={() => void recheckRow(row)}
                    disabled={importing}
                  />
                ) : (
                  <>
                    <ContactSummary row={row} />
                    {row.issues.length > 0 && (
                      <ul className="import-issues" aria-live="polite" aria-label={`Problems with ${rowLabel(row)}`}>
                        {row.issues.map((issue, index) => <li key={`${issue.contactMethodId ?? issue.field}-${index}`}>{issue.message}</li>)}
                      </ul>
                    )}
                    {row.error && <p className="field-error" role="alert">{row.error}</p>}
                    {!locked && (
                      <div className="button-row import-row-actions">
                        {row.duplicateMatches.length > 0 && (
                          <button
                            type="button"
                            aria-label={`Review duplicate for ${rowLabel(row)}`}
                            onClick={() => setDuplicateRowId(row.id)}
                          >
                            Review duplicate
                          </button>
                        )}
                        {(row.issues.length > 0 || row.status === "ready") && (
                          <button type="button" onClick={() => setEditingRowId(row.id)}>Edit {rowLabel(row)}</button>
                        )}
                        {row.status === "failed" && (
                          <button type="button" onClick={() => void recheckRow(row)}>Recheck {rowLabel(row)}</button>
                        )}
                        {row.status === "skipped" ? (
                          <button data-import-restore type="button" onClick={() => updateRow(restoreSkippedImportRow(row))}>Restore {rowLabel(row)}</button>
                        ) : (
                          <button type="button" onClick={() => updateRow(skipContactImportRow(row))}>Skip {rowLabel(row)}</button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <main className="screen import-screen" id="main-content" tabIndex={-1} aria-busy={parsing || importing}>
      <button className="back-button" type="button" onClick={cancel} disabled={parsing || importing}>← {origin.label}</button>
      <header className="page-heading compact-heading">
        <p className="eyebrow">People</p>
        <h2>{selectedFromIPhone ? "Review selected contacts" : "Import contacts"}</h2>
        <p>{selectedFromIPhone
          ? "PeopleOS received only the contacts you chose. Review them before adding."
          : "Choose a vCard. PeopleOS reads it on this device without access to your whole address book."}</p>
      </header>

      <section className={`file-picker-card${selectedFromIPhone ? " file-picker-secondary" : ""}`} aria-labelledby="vcard-file-heading">
        <h3 id="vcard-file-heading">{selectedFromIPhone ? "Import a file instead" : "Choose a vCard file"}</h3>
        <p>{selectedFromIPhone
          ? "Use a vCard when you want to import a larger list."
          : "Version 3.0 or 4.0, up to 5 MiB and 5,000 contacts."}</p>
        <label className="visually-hidden" htmlFor="vcard-file">vCard file</label>
        <input
          ref={fileInputRef}
          className="visually-hidden-file"
          id="vcard-file"
          type="file"
          accept=".vcf,text/vcard,text/x-vcard"
          onChange={chooseFile}
          disabled={parsing || importing}
        />
        <button className={selectedFromIPhone ? "secondary-action" : "primary-action"} type="button" onClick={() => fileInputRef.current?.click()} disabled={parsing || importing}>
          {parsing ? "Reading file…" : selectedFromIPhone ? "Choose vCard file" : session ? "Choose another file" : "Choose file"}
        </button>
        {parsing && <p role="status">Parsing the vCard locally…</p>}
      </section>

      {pageError && <p className="form-alert" role="alert">{pageError}</p>}
      {session && session.rows.length === 0 && (
        <EmptyState
          eyebrow="Import"
          title={selectedFromIPhone ? "No contacts selected" : "No contacts found"}
          description={selectedFromIPhone
            ? "Return to Add person and choose at least one contact."
            : "This vCard file does not contain any contacts. Choose another file."}
        />
      )}
      {session && session.rows.length > 0 && groupedRows && (
        <>
          <div className="import-summary-bar">
            <p><strong>{session.rows.length}</strong> {selectedFromIPhone ? "selected from iPhone Contacts" : `contacts in ${session.fileName}`}</p>
            <button type="button" onClick={selectReadyRows}>Select all ready rows</button>
          </div>
          {renderGroup("Needs review", groupedRows.review)}
          {renderGroup("Ready", groupedRows.ready)}
          {renderGroup("Skipped", groupedRows.skipped)}
          {renderGroup("Already imported", groupedRows.imported)}
          <p className="import-resolution-help" id="import-resolution-help" role="status">
            {unresolvedCount > 0
              ? `${unresolvedCount} ${unresolvedCount === 1 ? "contact still needs" : "contacts still need"} a decision. Import selected contacts, resolve a possible duplicate, or skip the contact.`
              : "Every contact has a clear import, skip, or failed outcome."}
          </p>
          <div className="sticky-form-actions">
            <button
              className="primary-action"
              type="button"
              aria-describedby="import-resolution-help"
              disabled={importing || unresolvedCount > 0 || resolvedOutcomeCount === 0}
              onClick={() => void runImport()}
            >
              {importing ? "Importing…" : selectableCount > 0 ? `Import selected (${selectableCount})` : "View results"}
            </button>
            <button className="secondary-action" type="button" onClick={cancel} disabled={importing}>Cancel</button>
          </div>
        </>
      )}

      {duplicateRow?.prepared && duplicateRow.duplicateMatches.length > 0 && (
        <DuplicateWarningSheet
          key={duplicateRow.id}
          candidate={duplicateRow.prepared}
          matches={duplicateRow.duplicateMatches}
          busy={importing}
          allowSkip
          onOpenExisting={(match) => navigate(personProfilePath(match.person.id))}
          onAddDetails={(match: DuplicateMatch, selection: DuplicateLinkSelection) => {
            updateRow(chooseLinkDetails(
              duplicateRow,
              match,
              selection.contactMethodIds,
              selection.includeAffiliation,
              selection.includeDisplayName
            ));
            setDuplicateRowId(null);
            focusImportRow(duplicateRow.id, ".import-select input");
          }}
          onCreateSeparate={() => {
            updateRow(chooseCreateSeparate(duplicateRow));
            setDuplicateRowId(null);
            focusImportRow(duplicateRow.id, ".import-select input");
          }}
          onReturnToEdit={() => {
            setDuplicateRowId(null);
            setEditingRowId(duplicateRow.id);
          }}
          onSkip={() => {
            updateRow(skipContactImportRow(duplicateRow));
            setDuplicateRowId(null);
            focusImportRow(duplicateRow.id, "[data-import-restore]");
          }}
        />
      )}
    </main>
  );
}

export function ImportResultsScreen({
  session,
  setSession,
  navigate,
  onViewPeople
}: ImportScreenProps & { onViewPeople: (personIds: string[]) => void }) {
  if (!session) {
    return (
      <main className="screen" id="main-content" tabIndex={-1}>
        <EmptyState
          eyebrow="Import"
          title="No import results"
          description="Choose a vCard file to start a new contact import."
          action={<button className="primary-action" type="button" onClick={() => navigate("/people/import", { replace: true })}>Choose file</button>}
        />
      </main>
    );
  }

  const counts = contactImportCounts(session);
  const personIds = importedPersonIds(session);
  const failures = session.rows.filter((row) => row.status === "failed");
  const added = counts.created + counts.addedDetails;

  return (
    <main className="screen import-results-screen" id="main-content" tabIndex={-1}>
      <header className="page-heading compact-heading">
        <p className="eyebrow">Import complete</p>
        <h2>{added ? "Your contacts were reviewed" : "No people were added"}</h2>
        <p>{added ? "PeopleOS saved each selected person separately and left every other record unchanged." : "All contacts were skipped, left for review, or could not be imported."}</p>
      </header>
      <dl className="result-counts" aria-label="Import results">
        <div><dt>Created</dt><dd>{counts.created}</dd></div>
        <div><dt>Added details</dt><dd>{counts.addedDetails}</dd></div>
        <div><dt>Skipped</dt><dd>{counts.skipped}</dd></div>
        <div><dt>Failed</dt><dd>{counts.failed}</dd></div>
      </dl>
      {failures.length > 0 && (
        <section className="failed-imports" aria-labelledby="failed-imports-heading">
          <h3 id="failed-imports-heading">Needs another look</h3>
          <ul>
            {failures.map((row) => <li key={row.id}><strong>{rowLabel(row)}</strong><span>{row.error}</span></li>)}
          </ul>
        </section>
      )}
      <div className="form-actions">
        {personIds.length > 0 && (
          <button className="primary-action" type="button" onClick={() => onViewPeople(personIds)}>View imported people</button>
        )}
        {failures.length > 0 && (
          <button className="secondary-action" type="button" onClick={() => navigate("/people/import")}>Review failed rows</button>
        )}
        {session.sourceKind === "iphone_contacts" ? (
          <button className="secondary-action" type="button" onClick={() => { setSession(null); navigate("/people/new", { replace: true }); }}>Add more people</button>
        ) : (
          <button className="secondary-action" type="button" onClick={() => { setSession(null); navigate("/people/import", { replace: true }); }}>Import another file</button>
        )}
        <button type="button" onClick={() => { setSession(null); navigate("/people"); }}>Done</button>
      </div>
    </main>
  );
}
