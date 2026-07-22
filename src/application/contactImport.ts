import type { PeopleOsDatabase } from "../data/database";
import type { DuplicateMatch } from "../domain/duplicates";
import { ValidationError } from "../domain/validation";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import {
  ContactValueValidationError,
  normalizeContactValue
} from "../integrations/contactValues";
import { parseVCard, type ParsedVCard } from "../integrations/vcard";
import {
  addPreparedCaptureToDuplicateSnapshot,
  findDuplicateMatches,
  findDuplicateMatchesInSnapshot,
  loadDuplicateDetectionSnapshot,
  type DuplicateDetectionSnapshot
} from "./duplicateDetection";
import { addReviewedDetailsToExistingPerson } from "./duplicateResolution";
import { DuplicateReviewRequiredError } from "./duplicateReview";
import {
  createManualContactMethodDraft,
  createManualPersonCaptureDraft,
  prepareManualPersonCapture,
  savePreparedManualPersonCapture,
  type ManualPersonCaptureDraft,
  type PreparedManualPersonCapture
} from "./manualPersonCapture";

export type ContactImportIssue = {
  field: "displayName" | "organisation" | "contactMethod" | "row";
  message: string;
  contactMethodId?: string;
};

export type ContactImportDecision =
  | { kind: "create"; duplicateOverride: boolean }
  | {
      kind: "link";
      targetPersonId: string;
      expectedPersonRevision: number;
      selectedContactMethodIds: string[];
      includeAffiliation: boolean;
    }
  | { kind: "skip" };

export type ContactImportRowStatus =
  | "ready"
  | "needs_review"
  | "skipped"
  | "created"
  | "added_details"
  | "failed";

export type ContactImportRow = {
  id: string;
  sourceIndex: number;
  draft: ManualPersonCaptureDraft;
  prepared?: PreparedManualPersonCapture;
  issues: ContactImportIssue[];
  duplicateMatches: DuplicateMatch[];
  decision?: ContactImportDecision;
  selected: boolean;
  status: ContactImportRowStatus;
  resultPersonId?: string;
  error?: string;
};

export type ContactImportSession = {
  id: string;
  fileName: string;
  createdAt: string;
  defaultPhoneRegion: string;
  rows: ContactImportRow[];
};

export type ContactImportFactoryOptions = {
  now?: string;
  idFactory?: () => string;
};

export type ContactImportHooks = {
  beforeRowCommit?: (row: ContactImportRow) => void | Promise<void>;
};

export type ContactImportCounts = {
  created: number;
  addedDetails: number;
  skipped: number;
  failed: number;
};

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function issuesForDraft(draft: ManualPersonCaptureDraft, defaultPhoneRegion: string): ContactImportIssue[] {
  const issues: ContactImportIssue[] = [];
  const displayName = draft.displayName.trim();
  if (!displayName) {
    issues.push({ field: "displayName", message: "Add a name before importing this contact." });
  } else if (displayName.length > 120) {
    issues.push({ field: "displayName", message: "Use 120 characters or fewer for the name." });
  }
  if (optionalTrimmed(draft.role) && !optionalTrimmed(draft.organisationName)) {
    issues.push({ field: "organisation", message: "Add an organisation or remove the role." });
  }
  for (const contact of draft.contactMethods) {
    if (!contact.value.trim()) {
      issues.push({
        field: "contactMethod",
        contactMethodId: contact.id,
        message: `Remove the empty ${contact.kind === "phone" ? "phone" : "email"} detail or enter a value.`
      });
      continue;
    }
    try {
      normalizeContactValue(contact.kind, contact.value, contact.region ?? defaultPhoneRegion);
    } catch (error) {
      issues.push({
        field: "contactMethod",
        contactMethodId: contact.id,
        message: error instanceof ContactValueValidationError
          ? error.message
          : "Check this contact detail."
      });
    }
  }
  return issues;
}

function preferredFirst<T extends { isPreferred: boolean }>(records: T[]): T[] {
  return records
    .map((record, sourceOrder) => ({ record, sourceOrder }))
    .sort((left, right) => Number(right.record.isPreferred) - Number(left.record.isPreferred) || left.sourceOrder - right.sourceOrder)
    .map(({ record }) => record);
}

function draftFromCard(
  card: ParsedVCard,
  createdAt: string,
  idFactory: () => string
): ManualPersonCaptureDraft {
  const base = createManualPersonCaptureDraft({ now: createdAt, idFactory });
  const methods = [
    ...preferredFirst(card.phoneNumbers),
    ...preferredFirst(card.emailAddresses)
  ].map((method) => ({
    ...createManualContactMethodDraft(method.kind, idFactory),
    value: method.value,
    ...(method.label ? { label: method.label } : {})
  }));
  return {
    ...base,
    displayName: card.displayName,
    identityStatus: "confirmed",
    contactMethods: methods,
    ...(card.organisation ? { organisationName: card.organisation } : {}),
    ...(card.title ? { role: card.title } : {})
  };
}

export async function reviewContactImportRow(
  db: PeopleOsDatabase,
  row: ContactImportRow,
  defaultPhoneRegion: string,
  duplicateSnapshot?: DuplicateDetectionSnapshot
): Promise<ContactImportRow> {
  if (row.status === "created" || row.status === "added_details" || row.status === "skipped") return row;
  const issues = issuesForDraft(row.draft, defaultPhoneRegion);
  if (issues.length) {
    return {
      ...row,
      prepared: undefined,
      issues,
      duplicateMatches: [],
      decision: undefined,
      selected: false,
      status: "needs_review",
      error: undefined
    };
  }

  try {
    const prepared = prepareManualPersonCapture(row.draft, defaultPhoneRegion);
    const duplicateMatches = duplicateSnapshot
      ? findDuplicateMatchesInSnapshot(duplicateSnapshot, prepared)
      : await findDuplicateMatches(db, prepared);
    return {
      ...row,
      prepared,
      issues: [],
      duplicateMatches,
      decision: duplicateMatches.length ? undefined : { kind: "create", duplicateOverride: false },
      selected: duplicateMatches.length === 0,
      status: duplicateMatches.length ? "needs_review" : "ready",
      error: undefined
    };
  } catch (error) {
    const messages = error instanceof ValidationError ? error.issues : ["Check this contact before importing it."];
    return {
      ...row,
      prepared: undefined,
      issues: messages.map((message) => ({ field: "row", message })),
      duplicateMatches: [],
      decision: undefined,
      selected: false,
      status: "needs_review",
      error: undefined
    };
  }
}

export async function prepareContactImport(
  db: PeopleOsDatabase,
  input: ArrayBuffer | Uint8Array,
  fileName: string,
  defaultPhoneRegion: string,
  options: ContactImportFactoryOptions = {}
): Promise<ContactImportSession> {
  const cards = parseVCard(input);
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const createdAt = options.now ?? new Date().toISOString();
  const duplicateSnapshot = await loadDuplicateDetectionSnapshot(db);
  const rows: ContactImportRow[] = [];
  for (const card of cards) {
    const draft = draftFromCard(card, createdAt, idFactory);
    const row = await reviewContactImportRow(db, {
      id: `import-row-${idFactory()}`,
      sourceIndex: card.sourceIndex,
      draft,
      issues: [],
      duplicateMatches: [],
      selected: false,
      status: "needs_review"
    }, defaultPhoneRegion, duplicateSnapshot);
    rows.push(row);
    if (row.prepared) addPreparedCaptureToDuplicateSnapshot(duplicateSnapshot, row.prepared);
  }
  return {
    id: `import-session-${idFactory()}`,
    fileName,
    createdAt,
    defaultPhoneRegion,
    rows
  };
}

/**
 * Rechecks an edited row and every later preview row against one fresh stored
 * snapshot plus the preceding valid rows in this file. This prevents editing
 * an early row from leaving stale same-file duplicate decisions downstream.
 */
export async function reviewContactImportSessionFromRow(
  db: PeopleOsDatabase,
  session: ContactImportSession,
  changedRow: ContactImportRow
): Promise<ContactImportSession> {
  const snapshot = await loadDuplicateDetectionSnapshot(db);
  const changedSourceIndex = changedRow.sourceIndex;
  const sourceRows = session.rows
    .map((row) => row.id === changedRow.id ? changedRow : row)
    .sort((left, right) => left.sourceIndex - right.sourceIndex);
  const reviewedRows: ContactImportRow[] = [];

  for (const row of sourceRows) {
    let reviewed = row;
    const terminal = row.status === "created" || row.status === "added_details";
    if (!terminal && row.status !== "skipped" && row.sourceIndex >= changedSourceIndex) {
      reviewed = await reviewContactImportRow(db, {
        ...row,
        status: row.status === "ready" ? "needs_review" : row.status
      }, session.defaultPhoneRegion, snapshot);
    }
    reviewedRows.push(reviewed);
    if (!terminal && reviewed.status !== "skipped" && reviewed.prepared) {
      addPreparedCaptureToDuplicateSnapshot(snapshot, reviewed.prepared);
    }
  }

  return {
    ...session,
    rows: reviewedRows.sort((left, right) => left.sourceIndex - right.sourceIndex)
  };
}

export function chooseCreateSeparate(row: ContactImportRow): ContactImportRow {
  if (!row.prepared || row.issues.length) return row;
  return {
    ...row,
    decision: { kind: "create", duplicateOverride: true },
    selected: true,
    status: "ready",
    error: undefined
  };
}

export function chooseLinkDetails(
  row: ContactImportRow,
  match: DuplicateMatch,
  selectedContactMethodIds: string[],
  includeAffiliation: boolean
): ContactImportRow {
  if (!row.prepared || (!selectedContactMethodIds.length && !includeAffiliation)) return row;
  return {
    ...row,
    decision: {
      kind: "link",
      targetPersonId: match.person.id,
      expectedPersonRevision: match.person.revision,
      selectedContactMethodIds: [...selectedContactMethodIds],
      includeAffiliation
    },
    selected: true,
    status: "ready",
    error: undefined
  };
}

export function skipContactImportRow(row: ContactImportRow): ContactImportRow {
  if (row.status === "created" || row.status === "added_details") return row;
  return {
    ...row,
    decision: { kind: "skip" },
    selected: false,
    status: "skipped",
    error: undefined
  };
}

export function restoreSkippedImportRow(row: ContactImportRow): ContactImportRow {
  if (row.status !== "skipped") return row;
  const hasIssuesOrMatches = row.issues.length > 0 || row.duplicateMatches.length > 0;
  return {
    ...row,
    decision: hasIssuesOrMatches ? undefined : { kind: "create", duplicateOverride: false },
    selected: !hasIssuesOrMatches,
    status: hasIssuesOrMatches ? "needs_review" : "ready"
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? "Check this contact before retrying.";
  if (error instanceof ContactValueValidationError
    || error instanceof RecordConflictError
    || error instanceof StaleRevisionError) return error.message;
  return "PeopleOS could not import this contact. Nothing partial was saved.";
}

async function executeRow(
  db: PeopleOsDatabase,
  row: ContactImportRow,
  hooks: ContactImportHooks
): Promise<ContactImportRow> {
  if (!row.selected || !row.prepared || !row.decision || row.decision.kind === "skip") return row;
  try {
    if (row.decision.kind === "create") {
      await savePreparedManualPersonCapture(db, row.prepared, {
        beforeCommit: () => hooks.beforeRowCommit?.(row),
        enforceDuplicateReview: true,
        acknowledgedDuplicatePersonIds: row.decision.duplicateOverride
          ? row.duplicateMatches.map((match) => match.person.id)
          : []
      });
      return {
        ...row,
        selected: false,
        status: "created",
        resultPersonId: row.prepared.person.id,
        error: undefined
      };
    }

    const result = await addReviewedDetailsToExistingPerson(db, {
      targetPersonId: row.decision.targetPersonId,
      expectedPersonRevision: row.decision.expectedPersonRevision,
      candidate: row.prepared,
      selectedContactMethodIds: row.decision.selectedContactMethodIds,
      includeAffiliation: row.decision.includeAffiliation,
      now: row.prepared.person.createdAt
    }, {
      beforeCommit: () => hooks.beforeRowCommit?.(row)
    });
    const detailsChanged = result.addedContactMethods.length > 0 || Boolean(result.addedAffiliation);
    if (!detailsChanged) {
      return {
        ...row,
        selected: false,
        status: "skipped",
        resultPersonId: result.person.id,
        error: "No details were added because this person already has the selected information."
      };
    }
    return {
      ...row,
      selected: false,
      status: "added_details",
      resultPersonId: result.person.id,
      error: undefined
    };
  } catch (error) {
    if (error instanceof DuplicateReviewRequiredError) {
      const duplicateMatches = new Map(
        row.duplicateMatches.map((match) => [match.person.id, match] as const)
      );
      error.matches.forEach((match) => duplicateMatches.set(match.person.id, {
        ...match,
        source: "stored"
      }));
      return {
        ...row,
        duplicateMatches: [...duplicateMatches.values()],
        selected: false,
        status: "failed",
        error: "A possible duplicate appeared while importing. Review it before retrying."
      };
    }
    return { ...row, selected: false, status: "failed", error: errorMessage(error) };
  }
}

export async function importSelectedContacts(
  db: PeopleOsDatabase,
  session: ContactImportSession,
  hooks: ContactImportHooks = {}
): Promise<ContactImportSession> {
  const rows: ContactImportRow[] = [];
  for (const row of session.rows) {
    if (row.status === "created" || row.status === "added_details" || row.status === "skipped") {
      rows.push(row);
      continue;
    }
    rows.push(await executeRow(db, row, hooks));
  }
  return { ...session, rows };
}

export function contactImportCounts(session: ContactImportSession): ContactImportCounts {
  return session.rows.reduce<ContactImportCounts>((counts, row) => {
    if (row.status === "created") counts.created += 1;
    else if (row.status === "added_details") counts.addedDetails += 1;
    else if (row.status === "skipped") counts.skipped += 1;
    else if (row.status === "failed") counts.failed += 1;
    return counts;
  }, { created: 0, addedDetails: 0, skipped: 0, failed: 0 });
}

export function importedPersonIds(session: ContactImportSession): string[] {
  return [...new Set(session.rows.flatMap((row) => row.resultPersonId ? [row.resultPersonId] : []))];
}
