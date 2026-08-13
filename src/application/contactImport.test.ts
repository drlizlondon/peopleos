import { afterEach, describe, expect, it } from "vitest";
import { generateBackup, previewBackup, restoreBackup } from "../data/backup";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { createRepositories } from "../data/repositories";
import type { OrganisationAffiliation, Person } from "../domain/schema";
import { fixedNow } from "../test/fixtures";
import {
  chooseCreateSeparate,
  chooseLinkDetails,
  chooseLinkDetailsForExistingPerson,
  contactImportCounts,
  importSelectedContacts,
  prepareContactImport,
  prepareContactImportFromPickerResult,
  prepareContactImportFromSelectedContacts,
  reviewContactImportSessionFromRow,
  reviewContactImportRow,
  skipContactImportRow,
  type ContactImportSession
} from "./contactImport";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function databaseName(label: string): string {
  const name = `peopleos-import-${label}-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const db = await openPeopleOsDatabase(databaseName(label), fixedNow);
  connections.add(db);
  return db;
}

function stableIds() {
  let next = 0;
  return () => `stable-${++next}`;
}

function vcard(cards: string[]): Uint8Array {
  return new TextEncoder().encode(cards.map((body) => [
    "BEGIN:VCARD",
    "VERSION:4.0",
    body,
    "END:VCARD",
    ""
  ].join("\n")).join(""));
}

function person(id: string, displayName: string): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: fixedNow,
    updatedAt: fixedNow
  };
}

function affiliation(id: string, personId: string, organisationName: string): OrganisationAffiliation {
  return {
    id,
    revision: 1,
    personId,
    organisationName,
    isCurrent: true,
    createdAt: fixedNow,
    updatedAt: fixedNow
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("reviewed contact import", () => {
  it("prepares stable, normalized rows without writing preview data", async () => {
    const db = await openDatabase("preview");
    const revisionBefore = await db.get("metadata", "app");
    const session = await prepareContactImport(db, vcard([
      "FN:Aaron Patel\nTEL;TYPE=CELL:07900 123456\nEMAIL;TYPE=WORK:Aaron@Example.COM\nORG:NHS England\nTITLE:Fellow",
      "FN:Name only"
    ]), "people.vcf", "GB", { now: fixedNow, idFactory: stableIds() });

    expect(session.rows).toHaveLength(2);
    expect(session).toMatchObject({ sourceKind: "vcard", fileName: "people.vcf" });
    expect(session.rows.map((row) => row.status)).toEqual(["ready", "ready"]);
    expect(session.rows[0].prepared?.contactMethods).toMatchObject([
      { kind: "phone", canonicalValue: "+447900123456" },
      { kind: "email", canonicalValue: "aaron@example.com" }
    ]);
    expect(new Set([
      session.rows[0].draft.personId,
      ...session.rows[0].draft.contactMethods.map((record) => record.id),
      session.rows[0].id
    ]).size).toBe(4);
    expect(await db.count("people")).toBe(0);
    expect(await db.count("contactMethods")).toBe(0);
    expect(await db.get("metadata", "app")).toEqual(revisionBefore);
  });

  it("prepares ordered Apple-selected contacts through the same reviewed import pipeline", async () => {
    const db = await openDatabase("selected-contacts");
    const revisionBefore = await db.get("metadata", "app");
    const session = await prepareContactImportFromSelectedContacts(db, [{
      displayName: "Sarah Ahmed",
      phoneNumbers: [
        { value: "07900 123456", label: "Mobile" },
        { value: "+44 20 7946 0018", label: "Work" }
      ],
      emailAddresses: [
        { value: "sarah@example.com", label: "Personal" },
        { value: "sarah@peopleos.test", label: "Work" }
      ],
      organisation: "PeopleOS",
      jobTitle: "Founder"
    }, {
      displayName: "Dad",
      phoneNumbers: [],
      emailAddresses: []
    }], "GB", { now: fixedNow, idFactory: stableIds() });

    expect(session).toMatchObject({
      sourceKind: "iphone_contacts",
      fileName: "iPhone Contacts"
    });
    expect(session.rows).toHaveLength(2);
    expect(session.rows.map((row) => row.sourceIndex)).toEqual([0, 1]);
    expect(session.rows.map((row) => row.status)).toEqual(["ready", "ready"]);
    expect(session.rows[0].draft.contactMethods.map(({ kind, value, label }) => ({ kind, value, label }))).toEqual([
      { kind: "phone", value: "07900 123456", label: "Mobile" },
      { kind: "phone", value: "+44 20 7946 0018", label: "Work" },
      { kind: "email", value: "sarah@example.com", label: "Personal" },
      { kind: "email", value: "sarah@peopleos.test", label: "Work" }
    ]);
    expect(session.rows[0].prepared?.contactMethods.map(({ kind, isPreferred }) => ({ kind, isPreferred }))).toEqual([
      { kind: "phone", isPreferred: true },
      { kind: "phone", isPreferred: false },
      { kind: "email", isPreferred: true },
      { kind: "email", isPreferred: false }
    ]);
    expect(session.rows[0].prepared?.affiliation).toMatchObject({
      organisationName: "PeopleOS",
      role: "Founder"
    });
    expect(session.rows[1].prepared).toMatchObject({
      person: { displayName: "Dad" },
      contactMethods: []
    });
    expect(await db.count("people")).toBe(0);
    expect(await db.count("contactMethods")).toBe(0);
    expect(await db.get("metadata", "app")).toEqual(revisionBefore);
  });

  it("accepts a selected contact without a name when it has a phone or email identity", async () => {
    const db = await openDatabase("selected-contact-identifiers");
    const session = await prepareContactImportFromSelectedContacts(db, [{
      displayName: "",
      phoneNumbers: [{ value: "07912 345678", label: "Mobile" }],
      emailAddresses: [{ value: "bibi@example.com" }]
    }, {
      displayName: "",
      phoneNumbers: [],
      emailAddresses: [{ value: "email-only@example.com" }]
    }], "GB", { now: fixedNow, idFactory: stableIds() });

    expect(session.rows.map((row) => row.status)).toEqual(["ready", "ready"]);
    expect(session.rows[0].prepared?.person.displayName).toBe("07912 345678");
    expect(session.rows[0].prepared?.contactMethods).toMatchObject([
      { kind: "phone", canonicalValue: "+447912345678" },
      { kind: "email", canonicalValue: "bibi@example.com" }
    ]);
    expect(session.rows[1].prepared?.person.displayName).toBe("email-only@example.com");
  });

  it("requires at least one name, phone or email identity in an imported row", async () => {
    const db = await openDatabase("selected-contact-blank");
    const session = await prepareContactImportFromSelectedContacts(db, [{
      displayName: "",
      phoneNumbers: [],
      emailAddresses: []
    }], "GB", { now: fixedNow, idFactory: stableIds() });

    expect(session.rows[0]).toMatchObject({
      status: "needs_review",
      prepared: undefined,
      issues: [{ field: "displayName", message: "Add a name, mobile number or email address." }]
    });
  });

  it("shortlists exact full names conservatively while ignoring a first name alone", async () => {
    const db = await openDatabase("selected-contact-full-name");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-sarah-jones", "Sarah Jones"));
    await repositories.people.create(person("person-bibi", "Bibi"));

    const session = await prepareContactImportFromSelectedContacts(db, [{
      displayName: " SÁRAH—JONES ",
      phoneNumbers: [],
      emailAddresses: []
    }, {
      displayName: "bibi",
      phoneNumbers: [],
      emailAddresses: []
    }], "GB", { now: fixedNow, idFactory: stableIds() });

    expect(session.rows[0]).toMatchObject({
      status: "needs_review",
      duplicateMatches: [{
        person: { id: "person-sarah-jones" },
        strength: "review",
        evidence: [{ code: "same_full_name" }]
      }]
    });
    expect(session.rows[1]).toMatchObject({ status: "ready", duplicateMatches: [] });
  });

  it("reconciles equivalent UK phone formats through the existing canonical duplicate path", async () => {
    const db = await openDatabase("selected-contact-equivalent-phone");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-existing-phone", "Existing person"));
    await repositories.contactMethods.create({
      id: "contact-existing-phone",
      revision: 1,
      personId: "person-existing-phone",
      kind: "phone",
      rawValue: "07912 345678",
      canonicalValue: "+447912345678",
      region: "GB",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });

    const session = await prepareContactImportFromSelectedContacts(db, [{
      displayName: "Different name",
      phoneNumbers: [{ value: "+44 7912 345678" }],
      emailAddresses: []
    }], "GB", { now: fixedNow, idFactory: stableIds() });

    expect(session.rows[0]).toMatchObject({
      status: "needs_review",
      duplicateMatches: [{
        person: { id: "person-existing-phone" },
        strength: "strong",
        evidence: [{ code: "same_phone", canonicalValue: "+447912345678" }]
      }]
    });
  });

  it("detects duplicates inside one Apple contact selection without preview writes", async () => {
    const db = await openDatabase("selected-duplicates");
    const session = await prepareContactImportFromSelectedContacts(db, [{
      displayName: "First",
      phoneNumbers: [],
      emailAddresses: [{ value: "shared@example.com" }]
    }, {
      displayName: "Second",
      phoneNumbers: [],
      emailAddresses: [{ value: "Shared@Example.com" }]
    }], "GB", { now: fixedNow, idFactory: stableIds() });

    expect(session.rows.map((row) => row.status)).toEqual(["ready", "needs_review"]);
    expect(session.rows[1].duplicateMatches).toMatchObject([{
      source: "import",
      person: { id: session.rows[0].draft.personId },
      evidence: [expect.objectContaining({ code: "same_email" })]
    }]);
    expect(await db.count("people")).toBe(0);
  });

  it("treats cancelling the Apple contact picker as a no-op", async () => {
    const db = await openDatabase("picker-cancel");
    const revisionBefore = await db.get("metadata", "app");

    await expect(prepareContactImportFromPickerResult(
      db,
      { status: "cancelled", contacts: [] },
      "GB",
      { now: fixedNow, idFactory: stableIds() }
    )).resolves.toBeNull();

    expect(await db.count("people")).toBe(0);
    expect(await db.count("contactMethods")).toBe(0);
    expect(await db.get("metadata", "app")).toEqual(revisionBefore);
  });

  it("reviews later rows against earlier rows in the same file without preview writes", async () => {
    const db = await openDatabase("same-file-duplicates");
    const revisionBefore = await db.get("metadata", "app");
    const input = vcard([
      "FN:First person\nEMAIL:shared@example.com",
      "FN:Second person\nEMAIL:shared@example.com",
      "FN:Third person\nEMAIL:shared@example.com"
    ]);
    const session = await prepareContactImport(db, input, "same-file.vcf", "GB", {
      now: fixedNow,
      idFactory: stableIds()
    });

    expect(session.rows.map((row) => ({ sourceIndex: row.sourceIndex, status: row.status }))).toEqual([
      { sourceIndex: 0, status: "ready" },
      { sourceIndex: 1, status: "needs_review" },
      { sourceIndex: 2, status: "needs_review" }
    ]);
    expect(session.rows[1].duplicateMatches.map((match) => match.person.id)).toEqual([
      session.rows[0].prepared?.person.id
    ]);
    expect(session.rows[1].duplicateMatches.map((match) => match.source)).toEqual(["import"]);
    expect(session.rows[2].duplicateMatches.map((match) => match.person.id)).toEqual([
      session.rows[0].prepared?.person.id,
      session.rows[1].prepared?.person.id
    ]);
    expect(session.rows[2].duplicateMatches.map((match) => match.evidence[0].code)).toEqual([
      "same_email",
      "same_email"
    ]);
    expect(await db.count("people")).toBe(0);
    expect(await db.count("contactMethods")).toBe(0);
    expect(await db.get("metadata", "app")).toEqual(revisionBefore);

    const repeated = await prepareContactImport(db, input, "same-file.vcf", "GB", {
      now: fixedNow,
      idFactory: stableIds()
    });
    expect(repeated).toEqual(session);
  });

  it("rechecks edited rows and invalidates stale same-file decisions downstream", async () => {
    const db = await openDatabase("same-file-edit");
    const session = await prepareContactImport(db, vcard([
      "FN:First person\nEMAIL:first@example.com",
      "FN:Second person\nEMAIL:second@example.com"
    ]), "edited.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    const first = session.rows[0];
    const editedFirst = {
      ...first,
      draft: {
        ...first.draft,
        contactMethods: first.draft.contactMethods.map((contact) => ({
          ...contact,
          value: "second@example.com"
        }))
      },
      prepared: undefined,
      decision: undefined,
      selected: false,
      status: "needs_review" as const
    };

    const rechecked = await reviewContactImportSessionFromRow(db, session, editedFirst);
    expect(rechecked.rows[0]).toMatchObject({ status: "ready", selected: true });
    expect(rechecked.rows[1]).toMatchObject({ status: "needs_review", selected: false });
    expect(rechecked.rows[1].duplicateMatches).toMatchObject([
      { source: "import", person: { id: rechecked.rows[0].draft.personId } }
    ]);
    expect(await db.count("people")).toBe(0);
    expect(await db.count("contactMethods")).toBe(0);
  });

  it("keeps invalid optional methods visible until the user removes or corrects them", async () => {
    const db = await openDatabase("invalid-method");
    const session = await prepareContactImport(db, vcard([
      "FN:Usable name\nEMAIL:not-an-email\nTEL:123"
    ]), "invalid.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    const row = session.rows[0];

    expect(row.status).toBe("needs_review");
    expect(row.issues.map((issue) => issue.contactMethodId)).toEqual(row.draft.contactMethods.map((contact) => contact.id));
    expect(row.draft.contactMethods.map((contact) => contact.value)).toEqual(["123", "not-an-email"]);

    const corrected = await reviewContactImportRow(db, {
      ...row,
      draft: { ...row.draft, contactMethods: [] }
    }, "GB");
    expect(corrected).toMatchObject({ status: "ready", selected: true, issues: [] });
    expect(corrected.prepared?.contactMethods).toEqual([]);
  });

  it("classifies exact contact and name-plus-organisation evidence without fuzzy matching", async () => {
    const db = await openDatabase("duplicates");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-sarah", "Sarah Jones"));
    await repositories.contactMethods.create({
      id: "contact-sarah",
      revision: 1,
      personId: "person-sarah",
      kind: "email",
      rawValue: "sarah@example.com",
      canonicalValue: "sarah@example.com",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await repositories.affiliations.create(affiliation("affiliation-sarah", "person-sarah", "NHS England"));

    const session = await prepareContactImport(db, vcard([
      "FN:Different name\nEMAIL:Sarah@Example.com",
      "FN:SÁRAH—JONES\nORG:nhs england",
      "FN:Sara Jones\nORG:NHS England"
    ]), "duplicates.vcf", "GB", { now: fixedNow, idFactory: stableIds() });

    expect(session.rows[0].duplicateMatches[0]).toMatchObject({ strength: "strong" });
    expect(session.rows[0].duplicateMatches[0].source).toBe("stored");
    expect(session.rows[0].duplicateMatches[0].evidence[0].code).toBe("same_email");
    expect(session.rows[1].duplicateMatches[0].evidence.map((evidence) => evidence.code)).toEqual([
      "same_full_name",
      "similar_name_same_organisation"
    ]);
    expect(session.rows[2].status).toBe("ready");
  });

  it("creates each selected Person atomically and creates no later-package records", async () => {
    const db = await openDatabase("create");
    const session = await prepareContactImport(db, vcard([
      "FN:Aaron\nTEL:07900 123456\nORG:PeopleOS\nTITLE:Founder",
      "FN:Simon\nEMAIL:simon@example.com"
    ]), "create.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    const revisionBefore = (await db.get("metadata", "app"))?.datasetRevision ?? 0;
    const result = await importSelectedContacts(db, session);
    const data = await readAllData(db);

    expect(contactImportCounts(result)).toEqual({ created: 2, addedDetails: 0, skipped: 0, failed: 0 });
    expect(data.people).toHaveLength(2);
    expect(data.contactMethods).toHaveLength(2);
    expect(data.affiliations).toHaveLength(1);
    expect(data.interactions).toEqual([]);
    expect(data.events).toEqual([]);
    expect(data.followUps).toEqual([]);
    expect(data.reachOutEntries).toEqual([]);
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(revisionBefore + 2);
  });

  it("allows sibling success, rolls back a failed row, and retries with the same IDs", async () => {
    const db = await openDatabase("partial");
    const session = await prepareContactImport(db, vcard([
      "FN:Works\nEMAIL:works@example.com",
      "FN:Retry me\nEMAIL:retry@example.com\nORG:Retry Org"
    ]), "partial.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    const retryPersonId = session.rows[1].draft.personId;
    const retryContactId = session.rows[1].draft.contactMethods[0].id;
    const first = await importSelectedContacts(db, session, {
      beforeRowCommit: (row) => {
        if (row.draft.displayName === "Retry me") throw new Error("injected row failure");
      }
    });

    expect(first.rows.map((row) => row.status)).toEqual(["created", "failed"]);
    expect(await db.count("people")).toBe(1);
    expect(await db.get("people", retryPersonId)).toBeUndefined();
    expect(await db.get("contactMethods", retryContactId)).toBeUndefined();
    expect(await db.count("affiliations")).toBe(0);

    const retriable: ContactImportSession = {
      ...first,
      rows: first.rows.map((row) => row.id === first.rows[1].id ? { ...row, selected: true } : row)
    };
    const second = await importSelectedContacts(db, retriable);
    const third = await importSelectedContacts(db, second);
    expect(second.rows.map((row) => row.status)).toEqual(["created", "created"]);
    expect(third).toEqual(second);
    expect((await db.get("people", retryPersonId))?.id).toBe(retryPersonId);
    expect((await db.get("contactMethods", retryContactId))?.personId).toBe(retryPersonId);
    expect(await db.count("people")).toBe(2);
  });

  it("links only confirmed new details, creates no candidate Person, and records explicit skips", async () => {
    const db = await openDatabase("link");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-existing", "Aaron Patel"));
    await repositories.contactMethods.create({
      id: "contact-existing-phone",
      revision: 1,
      personId: "person-existing",
      kind: "phone",
      rawValue: "07900 123456",
      canonicalValue: "+447900123456",
      region: "GB",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const session = await prepareContactImport(db, vcard([
      "FN:Aaron Patel\nTEL:07900 123456\nEMAIL:aaron@example.com\nORG:NHS England",
      "FN:Skip me"
    ]), "link.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    const duplicate = session.rows[0];
    const match = duplicate.duplicateMatches[0];
    const emailId = duplicate.prepared?.contactMethods.find((contact) => contact.kind === "email")?.id ?? "";
    const reviewed: ContactImportSession = {
      ...session,
      rows: [
        chooseLinkDetails(duplicate, match, [emailId], true),
        skipContactImportRow(session.rows[1])
      ]
    };
    const result = await importSelectedContacts(db, reviewed);
    const data = await readAllData(db);

    expect(contactImportCounts(result)).toEqual({ created: 0, addedDetails: 1, skipped: 1, failed: 0 });
    expect(data.people.map((record) => record.id)).toEqual(["person-existing"]);
    expect(data.contactMethods.find((record) => record.id === emailId)).toMatchObject({ personId: "person-existing" });
    expect(data.affiliations).toHaveLength(1);
    expect(data.interactions).toEqual([]);
  });

  it("enriches an explicitly opened name-only Person without creating the picker candidate or other selected contacts", async () => {
    const db = await openDatabase("profile-link");
    const repositories = createRepositories(db);
    const target = person("person-sarah", "Sarah");
    await repositories.people.create(target);
    const session = await prepareContactImportFromSelectedContacts(db, [{
      displayName: "Sarah Jones",
      phoneNumbers: [
        { value: "+44 7900 123456", label: "Mobile" },
        { value: "+44 20 7946 0111", label: "Home" }
      ],
      emailAddresses: [{ value: "sarah@example.com", label: "Personal" }],
      organisation: "PeopleOS",
      jobTitle: "Founder"
    }, {
      displayName: "Someone else",
      phoneNumbers: [{ value: "+44 7900 999999" }],
      emailAddresses: []
    }], "GB", { now: fixedNow, idFactory: stableIds() });
    const selected = session.rows[0];

    expect(selected.duplicateMatches).toEqual([]);
    expect(selected.prepared).toBeDefined();
    const linked: ContactImportSession = {
      ...session,
      rows: [
        chooseLinkDetailsForExistingPerson(
          selected,
          target,
          selected.prepared?.contactMethods.map((contact) => contact.id) ?? [],
          true
        ),
        skipContactImportRow(session.rows[1])
      ]
    };

    const result = await importSelectedContacts(db, linked);
    const data = await readAllData(db);

    expect(result.rows.map((row) => row.status)).toEqual(["added_details", "skipped"]);
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({ id: target.id, displayName: "Sarah", revision: 2 });
    expect(data.contactMethods).toHaveLength(3);
    expect(data.contactMethods.every((contact) => contact.personId === target.id)).toBe(true);
    expect(data.contactMethods.map((contact) => contact.canonicalValue).sort()).toEqual([
      "+442079460111",
      "+447900123456",
      "sarah@example.com"
    ]);
    expect(data.affiliations).toMatchObject([{
      personId: target.id,
      organisationName: "PeopleOS",
      role: "Founder"
    }]);
    expect(data.interactions).toEqual([]);
    expect(data.followUps).toEqual([]);
  });

  it("can explicitly enrich a phone-only Person with the reviewed iPhone contact name", async () => {
    const db = await openDatabase("picker-name-enrichment");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-existing", "07900 123456"));
    await repositories.contactMethods.create({
      id: "contact-existing-phone",
      revision: 1,
      personId: "person-existing",
      kind: "phone",
      rawValue: "07900 123456",
      canonicalValue: "+447900123456",
      region: "GB",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const session = await prepareContactImportFromSelectedContacts(db, [{
      displayName: "Bibi Jones",
      phoneNumbers: [{ value: "+44 7900 123456", label: "Mobile" }],
      emailAddresses: []
    }], "GB", { now: fixedNow, idFactory: stableIds() });
    const row = session.rows[0];
    const match = row.duplicateMatches[0];
    expect(match).toMatchObject({ person: { id: "person-existing" }, strength: "strong" });

    const result = await importSelectedContacts(db, {
      ...session,
      rows: [chooseLinkDetails(row, match, [], false, true)]
    });

    expect(result.rows[0]).toMatchObject({
      status: "added_details",
      resultPersonId: "person-existing"
    });
    expect(await db.count("people")).toBe(1);
    expect(await db.count("contactMethods")).toBe(1);
    expect(await db.get("people", "person-existing")).toMatchObject({
      displayName: "Bibi Jones",
      revision: 2
    });
  });

  it("reruns detection before create unless the user explicitly chose Create separate", async () => {
    const db = await openDatabase("stale-duplicate");
    const repositories = createRepositories(db);
    const session = await prepareContactImport(db, vcard([
      "FN:Candidate\nEMAIL:same@example.com"
    ]), "stale.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    await repositories.people.create(person("person-concurrent", "Concurrent"));
    await repositories.contactMethods.create({
      id: "contact-concurrent",
      revision: 1,
      personId: "person-concurrent",
      kind: "email",
      rawValue: "same@example.com",
      canonicalValue: "same@example.com",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const stopped = await importSelectedContacts(db, session);
    expect(stopped.rows[0]).toMatchObject({ status: "failed", selected: false });
    expect(stopped.rows[0].duplicateMatches[0].person.id).toBe("person-concurrent");
    expect(await db.get("people", session.rows[0].draft.personId)).toBeUndefined();

    const separate = {
      ...stopped,
      rows: [chooseCreateSeparate({ ...stopped.rows[0], status: "needs_review" })]
    } satisfies ContactImportSession;
    const created = await importSelectedContacts(db, separate);
    expect(created.rows[0].status).toBe("created");
    expect(await db.count("people")).toBe(2);
  });

  it("requires another review when a new duplicate appears after Create separate", async () => {
    const db = await openDatabase("new-duplicate-after-review");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-reviewed", "Reviewed match"));
    await repositories.contactMethods.create({
      id: "contact-reviewed",
      revision: 1,
      personId: "person-reviewed",
      kind: "email",
      rawValue: "same@example.com",
      canonicalValue: "same@example.com",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const session = await prepareContactImport(db, vcard([
      "FN:Candidate\nEMAIL:same@example.com"
    ]), "concurrent.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    expect(session.rows[0].duplicateMatches.map((match) => match.person.id)).toEqual(["person-reviewed"]);

    const reviewed: ContactImportSession = {
      ...session,
      rows: [chooseCreateSeparate(session.rows[0])]
    };
    await repositories.people.create(person("person-new", "New match"));
    await repositories.contactMethods.create({
      id: "contact-new",
      revision: 1,
      personId: "person-new",
      kind: "email",
      rawValue: "same@example.com",
      canonicalValue: "same@example.com",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });

    const stopped = await importSelectedContacts(db, reviewed);
    expect(stopped.rows[0]).toMatchObject({ status: "failed", selected: false });
    expect(stopped.rows[0].duplicateMatches.map((match) => match.person.id)).toEqual([
      "person-reviewed",
      "person-new"
    ]);
    expect(stopped.rows[0].duplicateMatches.every((match) => match.source === "stored")).toBe(true);
    expect(await db.get("people", session.rows[0].draft.personId)).toBeUndefined();

    const rereviewed: ContactImportSession = {
      ...stopped,
      rows: [chooseCreateSeparate(stopped.rows[0])]
    };
    const created = await importSelectedContacts(db, rereviewed);
    expect(created.rows[0].status).toBe("created");
    expect(await db.count("people")).toBe(3);
  });

  it("reports a reviewed add-details no-op as skipped instead of added", async () => {
    const db = await openDatabase("link-no-op");
    const repositories = createRepositories(db);
    await repositories.people.create(person("person-existing", "Existing"));
    await repositories.contactMethods.create({
      id: "contact-existing",
      revision: 1,
      personId: "person-existing",
      kind: "email",
      rawValue: "same@example.com",
      canonicalValue: "same@example.com",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const session = await prepareContactImport(db, vcard([
      "FN:Candidate\nEMAIL:same@example.com"
    ]), "no-op.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    const row = session.rows[0];
    const candidateContactId = row.prepared?.contactMethods[0].id ?? "";
    const linked: ContactImportSession = {
      ...session,
      rows: [chooseLinkDetails(row, row.duplicateMatches[0], [candidateContactId], false)]
    };

    const result = await importSelectedContacts(db, linked);
    expect(result.rows[0]).toMatchObject({
      status: "skipped",
      selected: false,
      resultPersonId: "person-existing",
      error: "No details were added because this person already has the selected information."
    });
    expect(contactImportCounts(result)).toEqual({ created: 0, addedDetails: 0, skipped: 1, failed: 0 });
    expect(await db.count("people")).toBe(1);
    expect(await db.count("contactMethods")).toBe(1);
  });

  it("round-trips imported records through backup and restore", async () => {
    const source = await openDatabase("backup-source");
    const session = await prepareContactImport(source, vcard([
      "FN:Backup person\nEMAIL:backup@example.com\nORG:PeopleOS"
    ]), "backup.vcf", "GB", { now: fixedNow, idFactory: stableIds() });
    const imported = await importSelectedContacts(source, session);
    const backup = await generateBackup(source, fixedNow);
    const target = await openDatabase("backup-target");
    await restoreBackup(target, previewBackup(backup.json), fixedNow);

    const personId = imported.rows[0].resultPersonId ?? "";
    expect(await target.get("people", personId)).toEqual(await source.get("people", personId));
    expect(await target.getAllFromIndex("contactMethods", "by-person", personId)).toEqual(
      await source.getAllFromIndex("contactMethods", "by-person", personId)
    );
    expect(await target.getAllFromIndex("affiliations", "by-person", personId)).toEqual(
      await source.getAllFromIndex("affiliations", "by-person", personId)
    );
  });
});
