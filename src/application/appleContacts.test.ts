import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import type { PeopleOSContactsAdapter } from "../contacts/types";
import { fixedNow } from "../test/fixtures";
import {
  createManualPersonCaptureDraft,
  prepareManualPersonCapture,
  type ManualPersonCaptureDraft
} from "./manualPersonCapture";
import {
  projectPreparedPersonForIPhoneContacts,
  retryPreparedPersonIPhoneContactSave,
  savePreparedPersonWithOptionalIPhoneContact
} from "./appleContacts";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function databaseName(label: string): string {
  const name = `peopleos-apple-contacts-${label}-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const db = await openPeopleOsDatabase(databaseName(label), fixedNow);
  connections.add(db);
  return db;
}

function captureDraft(overrides: Partial<ManualPersonCaptureDraft> = {}) {
  let nextId = 0;
  return {
    ...createManualPersonCaptureDraft({
      now: fixedNow,
      idFactory: () => `stable-${++nextId}`
    }),
    displayName: "Sarah Ahmed",
    relationshipMode: "professional" as const,
    importance: "high" as const,
    tags: ["private-tag"],
    contactCadence: { value: 3, unit: "days" as const },
    contactMethods: [
      { id: "phone-mobile", kind: "phone" as const, value: "07900 123456", label: "Mobile" },
      { id: "phone-work", kind: "phone" as const, value: "+44 20 7946 0018", label: "Work" },
      { id: "email-work", kind: "email" as const, value: "sarah@example.com", label: "Work" }
    ],
    organisationName: "PeopleOS",
    role: "Founder",
    whereMet: "Private conference context",
    ...overrides
  } satisfies ManualPersonCaptureDraft;
}

function preparedCapture(overrides: Partial<ManualPersonCaptureDraft> = {}) {
  return prepareManualPersonCapture(captureDraft(overrides), "GB");
}

function contactsAdapter(
  createContact: PeopleOSContactsAdapter["createContact"]
): PeopleOSContactsAdapter {
  return {
    pickContacts: vi.fn(async () => ({ status: "cancelled" as const, contacts: [] as [] })),
    createContact
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("selective Apple Contacts creation", () => {
  it("projects only conventional contact fields and preserves every ordered method", () => {
    const projected = projectPreparedPersonForIPhoneContacts(preparedCapture());

    expect(projected).toEqual({
      displayName: "Sarah Ahmed",
      phoneNumbers: [
        { value: "07900 123456", label: "Mobile" },
        { value: "+44 20 7946 0018", label: "Work" }
      ],
      emailAddresses: [{ value: "sarah@example.com", label: "Work" }],
      organisation: "PeopleOS",
      jobTitle: "Founder"
    });
    expect(Object.keys(projected).sort()).toEqual([
      "displayName",
      "emailAddresses",
      "jobTitle",
      "organisation",
      "phoneNumbers"
    ]);
    expect(JSON.stringify(projected)).not.toContain("private-tag");
    expect(JSON.stringify(projected)).not.toContain("Private conference context");
    expect(projected).not.toHaveProperty("relationshipMode");
    expect(projected).not.toHaveProperty("contactCadence");
    expect(projected).not.toHaveProperty("notes");
    expect(projected).not.toHaveProperty("history");
  });

  it("saves locally without contacting Apple when the option is off", async () => {
    const db = await openDatabase("not-requested");
    const prepared = preparedCapture();
    const createContact = vi.fn<PeopleOSContactsAdapter["createContact"]>();

    const result = await savePreparedPersonWithOptionalIPhoneContact(db, prepared, {
      saveToIPhoneContacts: false,
      contactsAdapter: contactsAdapter(createContact)
    });

    expect(result).toMatchObject({ localSaved: true, iPhoneContact: { status: "not_requested" } });
    expect(createContact).not.toHaveBeenCalled();
    expect(await db.get("people", prepared.person.id)).toEqual(prepared.person);
  });

  it("writes the strict projection only after the PeopleOS person is saved", async () => {
    const db = await openDatabase("created");
    const prepared = preparedCapture();
    const createContact = vi.fn<PeopleOSContactsAdapter["createContact"]>(async (input) => {
      expect(await db.get("people", prepared.person.id)).toEqual(prepared.person);
      expect(input.contact).toEqual(projectPreparedPersonForIPhoneContacts(prepared));
      return { status: "created", contactIdentifier: "apple-contact-sarah" };
    });

    const result = await savePreparedPersonWithOptionalIPhoneContact(db, prepared, {
      saveToIPhoneContacts: true,
      contactsAdapter: contactsAdapter(createContact)
    });

    expect(result).toMatchObject({
      localSaved: true,
      iPhoneContact: {
        status: "saved",
        nativeStatus: "created",
        operationId: `iphone-contact-${prepared.person.id}`,
        contactIdentifier: "apple-contact-sarah"
      }
    });
  });

  it("keeps the PeopleOS person when Contacts permission or writing fails", async () => {
    const db = await openDatabase("write-failure");
    const prepared = preparedCapture();
    const createContact = vi.fn<PeopleOSContactsAdapter["createContact"]>(async () => {
      throw Object.assign(new Error("Not allowed"), { code: "permission_denied" });
    });

    const result = await savePreparedPersonWithOptionalIPhoneContact(db, prepared, {
      saveToIPhoneContacts: true,
      contactsAdapter: contactsAdapter(createContact)
    });

    expect(result).toMatchObject({
      localSaved: true,
      iPhoneContact: {
        status: "failed",
        code: "permission_denied",
        operationId: `iphone-contact-${prepared.person.id}`
      }
    });
    expect(await db.get("people", prepared.person.id)).toEqual(prepared.person);
    expect((await db.getAllFromIndex("contactMethods", "by-person", prepared.person.id))
      .sort((left, right) => left.id.localeCompare(right.id))).toEqual(
      [...prepared.contactMethods].sort((left, right) => left.id.localeCompare(right.id))
    );
    expect(await db.getAllFromIndex("affiliations", "by-person", prepared.person.id)).toEqual([prepared.affiliation]);
  });

  it("treats an unavailable native adapter as a contact-only failure", async () => {
    const db = await openDatabase("unavailable");
    const prepared = preparedCapture();

    const result = await savePreparedPersonWithOptionalIPhoneContact(db, prepared, {
      saveToIPhoneContacts: true
    });

    expect(result).toMatchObject({
      localSaved: true,
      iPhoneContact: {
        status: "failed",
        code: "unavailable",
        operationId: `iphone-contact-${prepared.person.id}`
      }
    });
    expect(await db.get("people", prepared.person.id)).toEqual(prepared.person);
  });

  it("retries only the native write with the original stable operation id", async () => {
    const db = await openDatabase("retry");
    const prepared = preparedCapture();
    const createContact = vi.fn<PeopleOSContactsAdapter["createContact"]>()
      .mockRejectedValueOnce(Object.assign(new Error("Write failed"), { code: "write_failed" }))
      .mockResolvedValueOnce({ status: "already_created", contactIdentifier: "apple-contact-sarah" });
    const adapter = contactsAdapter(createContact);
    const first = await savePreparedPersonWithOptionalIPhoneContact(db, prepared, {
      saveToIPhoneContacts: true,
      contactsAdapter: adapter
    });
    if (first.iPhoneContact.status !== "failed") throw new Error("Expected the native write to fail.");
    const metadataAfterLocalSave = await db.get("metadata", "app");

    const retried = await retryPreparedPersonIPhoneContactSave(
      prepared,
      adapter,
      first.iPhoneContact.operationId
    );

    expect(retried).toMatchObject({
      status: "saved",
      nativeStatus: "already_created",
      operationId: first.iPhoneContact.operationId
    });
    expect(createContact).toHaveBeenCalledTimes(2);
    expect(createContact.mock.calls.map(([input]) => input.operationId)).toEqual([
      first.iPhoneContact.operationId,
      first.iPhoneContact.operationId
    ]);
    expect(await db.count("people")).toBe(1);
    expect(await db.get("metadata", "app")).toEqual(metadataAfterLocalSave);
  });

  it("reports an existing Apple contact without retrying or losing the local person", async () => {
    const db = await openDatabase("already-exists");
    const prepared = preparedCapture();
    const adapter = contactsAdapter(vi.fn(async () => ({
      status: "already_exists" as const,
      contactIdentifier: "apple-existing"
    })));

    const result = await savePreparedPersonWithOptionalIPhoneContact(db, prepared, {
      saveToIPhoneContacts: true,
      contactsAdapter: adapter
    });

    expect(result.iPhoneContact).toEqual({
      status: "already_exists",
      operationId: `iphone-contact-${prepared.person.id}`,
      contactIdentifier: "apple-existing"
    });
    expect(await db.get("people", prepared.person.id)).toEqual(prepared.person);
  });

  it("never calls Apple when the local PeopleOS transaction fails", async () => {
    const db = await openDatabase("local-failure");
    const prepared = preparedCapture();
    const createContact = vi.fn<PeopleOSContactsAdapter["createContact"]>();

    await expect(savePreparedPersonWithOptionalIPhoneContact(db, prepared, {
      saveToIPhoneContacts: true,
      contactsAdapter: contactsAdapter(createContact),
      localSaveHooks: { beforeCommit: () => { throw new Error("Local write failed"); } }
    })).rejects.toThrow("Local write failed");

    expect(createContact).not.toHaveBeenCalled();
    expect(await db.count("people")).toBe(0);
  });
});
