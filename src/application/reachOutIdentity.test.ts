import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { createRepositories, RecordConflictError, StaleRevisionError } from "../data/repositories";
import type { ContactMethod, MemoryFact, Person } from "../domain/schema";
import { validatePeopleOsData } from "../domain/validation";
import { commandFingerprint } from "../domain/commandFingerprint";
import type { AffiliationDraft } from "./affiliations";
import type { ContactMethodDraft } from "./contactMethods";
import { createReachOut, prepareCreateReachOutCommand } from "./reachOut";
import {
  completeProvisionalPerson,
  getProvisionalResolutionPreview,
  linkProvisionalPerson,
  prepareCompleteProvisionalPersonCommand,
  prepareLinkProvisionalPersonCommand
} from "./reachOutIdentity";

const now = "2026-08-01T09:00:00.000Z";
const later = "2026-08-02T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(id: string, displayName: string, identityStatus: Person["identityStatus"]): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus,
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now
  };
}

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-reach-out-identity-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, now);
  connections.add(db);
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("provisional Reach Out identity resolution", () => {
  it("completes identity in place and preserves the permanent Person ID", async () => {
    const db = await openDatabase("complete");
    const provisional = person("person-provisional", "Hackathon organiser", "provisional");
    await createRepositories(db).people.create(provisional);
    const contact: ContactMethodDraft = {
      id: "contact-complete",
      personId: provisional.id,
      kind: "email",
      value: " alex@example.com ",
      label: "Work email",
      createdAt: later
    };
    const affiliation: AffiliationDraft = {
      id: "affiliation-complete",
      personId: provisional.id,
      organisationName: "Watford Health",
      role: "Chief Information Officer",
      isCurrent: true,
      createdAt: later
    };
    const command = prepareCompleteProvisionalPersonCommand(provisional, "Alex Morgan", later, {
      contactMethods: [contact],
      defaultPhoneRegion: "GB",
      affiliation
    });

    const first = await completeProvisionalPerson(db, command);
    const retry = await completeProvisionalPerson(db, command);

    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      id: provisional.id,
      displayName: "Alex Morgan",
      conversationalName: "Alex",
      identityStatus: "confirmed",
      identityCompletionFingerprint: command.commandFingerprint,
      revision: 2
    });
    expect(await db.count("people")).toBe(1);
    expect(await db.get("contactMethods", contact.id)).toMatchObject({
      personId: provisional.id,
      canonicalValue: "alex@example.com",
      isPreferred: true
    });
    expect(await db.get("affiliations", affiliation.id)).toMatchObject({
      personId: provisional.id,
      organisationName: "Watford Health"
    });
  });

  it("preserves a custom familiar name when completing a provisional identity", async () => {
    const db = await openDatabase("complete-custom-name");
    const provisional = {
      ...person("person-custom", "Woman from fellowship", "provisional"),
      conversationalName: "Auntie"
    };
    await createRepositories(db).people.create(provisional);

    const saved = await completeProvisionalPerson(
      db,
      prepareCompleteProvisionalPersonCommand(provisional, "Aisha Khan", later)
    );

    expect(saved).toMatchObject({ displayName: "Aisha Khan", conversationalName: "Auntie" });
  });

  it("rejects valid alternate completion commands that reuse the same name and timestamp", async () => {
    const db = await openDatabase("complete-collision");
    const provisional = person("person-provisional", "Watford CIO", "provisional");
    await createRepositories(db).people.create(provisional);
    const command = prepareCompleteProvisionalPersonCommand(provisional, "Alex Morgan", later, {
      contactMethods: [{
        id: "contact-complete-collision",
        personId: provisional.id,
        kind: "email",
        value: "alex@example.com",
        createdAt: later
      }]
    });
    await completeProvisionalPerson(db, command);

    const { commandFingerprint: _fingerprint, ...material } = command;
    const omittedMaterial = { ...material, contactMethods: [] };
    const omitted = { ...omittedMaterial, commandFingerprint: commandFingerprint(omittedMaterial) };
    await expect(completeProvisionalPerson(db, omitted)).rejects.toBeInstanceOf(RecordConflictError);

    const changedMaterial = {
      ...material,
      contactMethods: material.contactMethods.map((contact) => ({ ...contact, value: "other@example.com" }))
    };
    const changed = { ...changedMaterial, commandFingerprint: commandFingerprint(changedMaterial) };
    await expect(completeProvisionalPerson(db, changed)).rejects.toBeInstanceOf(RecordConflictError);

    expect(await db.get("people", provisional.id)).toMatchObject({
      displayName: "Alex Morgan",
      identityCompletionFingerprint: command.commandFingerprint
    });
    expect(await db.get("contactMethods", "contact-complete-collision"))
      .toMatchObject({ canonicalValue: "alex@example.com" });
  });

  it("rolls the Person, contact methods, affiliation and metadata back together", async () => {
    const db = await openDatabase("complete-rollback");
    const provisional = person("person-provisional", "Watford CIO", "provisional");
    await createRepositories(db).people.create(provisional);
    const command = prepareCompleteProvisionalPersonCommand(provisional, "Alex Morgan", later, {
      contactMethods: [{
        id: "contact-rollback",
        personId: provisional.id,
        kind: "phone",
        value: "07900 123456",
        createdAt: later
      }],
      defaultPhoneRegion: "GB",
      affiliation: {
        id: "affiliation-rollback",
        personId: provisional.id,
        organisationName: "Watford Health",
        isCurrent: true,
        createdAt: later
      }
    });
    const before = await readAllData(db);

    await expect(completeProvisionalPerson(db, command, {
      beforeCommit: () => { throw new Error("complete rollback"); }
    })).rejects.toThrow("complete rollback");

    expect(await readAllData(db)).toEqual(before);
    expect(await db.get("people", provisional.id)).toEqual({ ...provisional, relationshipMode: "personal" });
    expect(await db.count("contactMethods")).toBe(0);
    expect(await db.count("affiliations")).toBe(0);
  });

  it("previews and atomically moves owned history while preserving stable child IDs", async () => {
    const db = await openDatabase("link");
    const repositories = createRepositories(db);
    const provisional = person("person-provisional", "Simon from the digital team", "provisional");
    const target = person("person-target", "Simon Jones", "confirmed");
    await repositories.people.create(provisional);
    await repositories.people.create(target);
    const sourceReachOut = await createReachOut(db, prepareCreateReachOutCommand({
      person: provisional,
      reason: "Reconnect after the fellowship",
      reminderDate: "2026-08-08",
      newContexts: [{ kind: "fellowship", label: "Digital fellowship" }]
    }, { now, localDate: "2026-08-01", idFactory: sequence("reach") }));

    const sourcePhone: ContactMethod = {
      id: "source-phone",
      revision: 1,
      personId: provisional.id,
      kind: "phone",
      label: "Work mobile",
      rawValue: "07900 123456",
      canonicalValue: "+447900123456",
      region: "GB",
      isPreferred: true,
      createdAt: now,
      updatedAt: now
    };
    const targetPhone: ContactMethod = {
      ...sourcePhone,
      id: "target-phone",
      personId: target.id,
      label: "Personal mobile",
      rawValue: "07800 123456",
      canonicalValue: "+447800123456"
    };
    await repositories.contactMethods.create(sourcePhone);
    await repositories.contactMethods.create(targetPhone);
    const selfFact: MemoryFact = {
      id: "fact-introduced-by-target",
      revision: 1,
      personId: provisional.id,
      kind: "introduced_by",
      value: "Introduced by Simon Jones",
      relatedPersonId: target.id,
      showAsMemoryCue: true,
      createdAt: now,
      updatedAt: now
    };
    await repositories.memoryFacts.create(selfFact);

    const preview = await getProvisionalResolutionPreview(db, provisional.id, target.id);
    expect(preview).toMatchObject({
      sourceCurrentReachOut: { id: sourceReachOut.entry.id },
      preferredContactConflicts: [{ kind: "phone", sourceContactId: sourcePhone.id, targetContactId: targetPhone.id }],
      mustKeepMemoryFactIds: [selfFact.id],
      counts: {
        reachOutContexts: 1,
        reachOutEvents: 2,
        followUpEvents: 1
      },
      records: {
        reachOutContexts: [{ label: "Digital fellowship" }]
      }
    });
    expect(preview.records.reachOutEvents.map((event) => event.kind)).toEqual(expect.arrayContaining(["added", "follow_up_linked"]));
    expect(preview.records.followUpEvents.map((event) => event.kind)).toEqual(["created"]);
    const command = prepareLinkProvisionalPersonCommand(preview, {
      preferredContactResolutions: { phone: "keep_target" },
      now: later
    });
    const first = await linkProvisionalPerson(db, command);
    const retry = await linkProvisionalPerson(db, command);

    expect(retry.source).toEqual(first.source);
    expect(first.source).toMatchObject({ identityStatus: "merged", mergedIntoPersonId: target.id });
    expect((await db.get("reachOutEntries", sourceReachOut.entry.id))?.personId).toBe(target.id);
    expect((await db.get("followUps", sourceReachOut.followUp!.id))?.personId).toBe(target.id);
    expect((await db.getAllFromIndex("followUpEvents", "by-follow-up", sourceReachOut.followUp!.id))[0]?.personId).toBe(target.id);
    expect(await db.get("memoryFacts", selfFact.id)).toMatchObject({ personId: provisional.id });
    expect(await db.get("contactMethods", sourcePhone.id)).toMatchObject({ personId: target.id, isPreferred: false });
    expect(await db.get("contactMethods", targetPhone.id)).toMatchObject({ personId: target.id, isPreferred: true });
    expect(validatePeopleOsData(await readAllData(db))).toBeTruthy();
  });

  it("blocks linking when both People have current Reach Out intentions", async () => {
    const db = await openDatabase("dual-current");
    const repositories = createRepositories(db);
    const provisional = person("person-provisional", "Potential mentor", "provisional");
    const target = person("person-target", "Dr Priya Shah", "confirmed");
    await repositories.people.create(provisional);
    await repositories.people.create(target);
    await createReachOut(db, prepareCreateReachOutCommand({ person: provisional }, {
      now, localDate: "2026-08-01", idFactory: sequence("source")
    }));
    await createReachOut(db, prepareCreateReachOutCommand({ person: target }, {
      now, localDate: "2026-08-01", idFactory: sequence("target")
    }));
    const preview = await getProvisionalResolutionPreview(db, provisional.id, target.id);
    expect(() => prepareLinkProvisionalPersonCommand(preview, { now: later }))
      .toThrow(RecordConflictError);
    expect((await db.get("people", provisional.id))?.identityStatus).toBe("provisional");
  });

  it("rejects stale targets and rolls every moved record back on failure", async () => {
    const db = await openDatabase("rollback");
    const repositories = createRepositories(db);
    const provisional = person("person-provisional", "Woman from the fellowship", "provisional");
    const target = person("person-target", "Aisha Khan", "confirmed");
    await repositories.people.create(provisional);
    await repositories.people.create(target);
    await createReachOut(db, prepareCreateReachOutCommand({ person: provisional }, {
      now, localDate: "2026-08-01", idFactory: sequence("reach")
    }));
    const preview = await getProvisionalResolutionPreview(db, provisional.id, target.id);
    const command = prepareLinkProvisionalPersonCommand(preview, { now: later });
    const staleTarget = { ...target, revision: 2, updatedAt: later };
    await db.put("people", staleTarget);
    await expect(linkProvisionalPerson(db, command)).rejects.toBeInstanceOf(StaleRevisionError);
    await db.put("people", target);

    const before = await readAllData(db);
    await expect(linkProvisionalPerson(db, command, {
      beforeCommit: () => { throw new Error("identity rollback"); }
    })).rejects.toThrow("identity rollback");
    expect(await readAllData(db)).toEqual(before);
  });

  it("rejects graph changes after preview and tampered retry commands", async () => {
    const db = await openDatabase("preview-revision");
    const repositories = createRepositories(db);
    const provisional = person("person-provisional", "Potential mentor", "provisional");
    const target = person("person-target", "Priya Shah", "confirmed");
    await repositories.people.create(provisional);
    await repositories.people.create(target);
    const preview = await getProvisionalResolutionPreview(db, provisional.id, target.id);
    const stale = prepareLinkProvisionalPersonCommand(preview, { now: later });
    await repositories.memoryFacts.create({
      id: "late-fact", revision: 1, personId: provisional.id, kind: "interest", value: "Simulation",
      showAsMemoryCue: true, createdAt: later, updatedAt: later
    });
    await expect(linkProvisionalPerson(db, stale)).rejects.toBeInstanceOf(StaleRevisionError);

    const fresh = prepareLinkProvisionalPersonCommand(
      await getProvisionalResolutionPreview(db, provisional.id, target.id),
      { now: "2026-08-03T09:00:00.000Z" }
    );
    await linkProvisionalPerson(db, fresh);
    await expect(linkProvisionalPerson(db, { ...fresh, keepMemoryFactIds: ["late-fact"] }))
      .rejects.toBeInstanceOf(RecordConflictError);
  });
});
