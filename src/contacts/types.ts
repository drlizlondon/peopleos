export type ContactFieldValue = {
  value: string;
  label?: string;
};

/**
 * The complete contact payload that may cross the Apple Contacts boundary.
 * PeopleOS-only relationship data is deliberately impossible to represent here.
 */
export type ConventionalContact = {
  displayName: string;
  phoneNumbers: ContactFieldValue[];
  emailAddresses: ContactFieldValue[];
  organisation?: string;
  jobTitle?: string;
};

export type SelectedIPhoneContact = ConventionalContact & {
  /** The native contact's given name when Apple makes it available. */
  givenName?: string;
};

export type ContactPickerResult =
  | { status: "selected"; contacts: SelectedIPhoneContact[] }
  | { status: "cancelled"; contacts: [] };

export type CreateIPhoneContactInput = {
  /** Stable per PeopleOS person; used only to make an explicit write retry-safe on this device. */
  operationId: string;
  contact: ConventionalContact;
};

export type CreateIPhoneContactResult =
  | { status: "created" | "already_created"; contactIdentifier: string }
  | { status: "already_exists"; contactIdentifier?: string };

export type IPhoneContactsErrorCode =
  | "permission_denied"
  | "permission_restricted"
  | "unavailable"
  | "write_failed"
  | "invalid_payload"
  | "picker_busy";

export interface PeopleOSContactsAdapter {
  /**
   * Opens Apple's single-contact picker. The single-selection delegate keeps
   * the native search experience available for correction and linking flows.
   * Older native bundles may not expose this method, so callers must retain a
   * pickContacts fallback until those builds have rolled forward.
   */
  pickContact?(): Promise<ContactPickerResult>;
  pickContacts(): Promise<ContactPickerResult>;
  createContact(input: CreateIPhoneContactInput): Promise<CreateIPhoneContactResult>;
}
