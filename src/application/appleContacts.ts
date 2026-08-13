import type { PeopleOsDatabase } from "../data/database";
import type {
  ConventionalContact,
  CreateIPhoneContactResult,
  IPhoneContactsErrorCode,
  PeopleOSContactsAdapter
} from "../contacts/types";
import {
  savePreparedManualPersonCapture,
  type ManualCaptureHooks,
  type PreparedManualPersonCapture
} from "./manualPersonCapture";

export type IPhoneContactSaveOutcome =
  | { status: "not_requested" }
  | {
      status: "saved";
      operationId: string;
      nativeStatus: "created" | "already_created";
      contactIdentifier: string;
    }
  | {
      status: "already_exists";
      operationId: string;
      contactIdentifier?: string;
    }
  | {
      status: "failed";
      operationId: string;
      code: IPhoneContactsErrorCode;
    };

export type SavePreparedPersonWithIPhoneContactResult = {
  prepared: PreparedManualPersonCapture;
  localSaved: true;
  iPhoneContact: IPhoneContactSaveOutcome;
};

export type SavePreparedPersonWithIPhoneContactOptions = {
  saveToIPhoneContacts: boolean;
  contactsAdapter?: PeopleOSContactsAdapter;
  localSaveHooks?: ManualCaptureHooks;
  operationId?: string;
};

const CONTACT_ERROR_CODES = new Set<IPhoneContactsErrorCode>([
  "permission_denied",
  "permission_restricted",
  "unavailable",
  "write_failed",
  "invalid_payload",
  "picker_busy"
]);

function contactErrorCode(error: unknown): IPhoneContactsErrorCode {
  if (!error || typeof error !== "object" || !("code" in error)) return "write_failed";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CONTACT_ERROR_CODES.has(code as IPhoneContactsErrorCode)
    ? code as IPhoneContactsErrorCode
    : "write_failed";
}

/**
 * The sole projection across the Apple Contacts write boundary. Its return
 * type cannot represent PeopleOS relationship mode, cadence, reminders,
 * notes, history, conversation starters or Reach Out state.
 */
export function projectPreparedPersonForIPhoneContacts(
  prepared: PreparedManualPersonCapture
): ConventionalContact {
  const activeMethods = prepared.contactMethods.filter((method) => !method.archivedAt);
  return {
    displayName: prepared.person.displayName,
    phoneNumbers: activeMethods
      .filter((method) => method.kind === "phone")
      .map((method) => ({
        value: method.rawValue,
        ...(method.label ? { label: method.label } : {})
      })),
    emailAddresses: activeMethods
      .filter((method) => method.kind === "email")
      .map((method) => ({
        value: method.rawValue,
        ...(method.label ? { label: method.label } : {})
      })),
    ...(prepared.affiliation?.organisationName
      ? { organisation: prepared.affiliation.organisationName }
      : {}),
    ...(prepared.affiliation?.role ? { jobTitle: prepared.affiliation.role } : {})
  };
}

function outcomeFromNativeResult(
  operationId: string,
  result: CreateIPhoneContactResult
): IPhoneContactSaveOutcome {
  if (result.status === "already_exists") {
    return {
      status: "already_exists",
      operationId,
      ...(result.contactIdentifier ? { contactIdentifier: result.contactIdentifier } : {})
    };
  }
  return {
    status: "saved",
    operationId,
    nativeStatus: result.status,
    contactIdentifier: result.contactIdentifier
  };
}

async function createIPhoneContact(
  prepared: PreparedManualPersonCapture,
  contactsAdapter: PeopleOSContactsAdapter | undefined,
  operationId: string
): Promise<IPhoneContactSaveOutcome> {
  if (!contactsAdapter) return { status: "failed", operationId, code: "unavailable" };
  try {
    return outcomeFromNativeResult(operationId, await contactsAdapter.createContact({
      operationId,
      contact: projectPreparedPersonForIPhoneContacts(prepared)
    }));
  } catch (error) {
    return { status: "failed", operationId, code: contactErrorCode(error) };
  }
}

/**
 * Saves PeopleOS first. An optional Apple Contacts write is deliberately a
 * separate best-effort step, so permission or native failures can never roll
 * back or hide the PeopleOS person.
 */
export async function savePreparedPersonWithOptionalIPhoneContact(
  db: PeopleOsDatabase,
  prepared: PreparedManualPersonCapture,
  options: SavePreparedPersonWithIPhoneContactOptions
): Promise<SavePreparedPersonWithIPhoneContactResult> {
  const saved = await savePreparedManualPersonCapture(db, prepared, options.localSaveHooks);
  if (!options.saveToIPhoneContacts) {
    return { prepared: saved, localSaved: true, iPhoneContact: { status: "not_requested" } };
  }

  const operationId = options.operationId ?? `iphone-contact-${saved.person.id}`;
  return {
    prepared: saved,
    localSaved: true,
    iPhoneContact: await createIPhoneContact(saved, options.contactsAdapter, operationId)
  };
}

/**
 * Retries only the native write with the original stable operation identifier.
 * This helper has no database dependency and therefore cannot create or edit
 * the PeopleOS person a second time.
 */
export async function retryPreparedPersonIPhoneContactSave(
  prepared: PreparedManualPersonCapture,
  contactsAdapter: PeopleOSContactsAdapter | undefined,
  operationId: string
): Promise<IPhoneContactSaveOutcome> {
  return createIPhoneContact(prepared, contactsAdapter, operationId);
}
