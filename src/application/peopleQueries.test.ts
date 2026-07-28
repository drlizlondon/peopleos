import { afterEach, describe, expect, it } from "vitest";
import { deletePeopleOsDatabase, openPeopleOsDatabase, type PeopleOsDatabase } from "../data/database";
import { fixedNow } from "../test/fixtures";
import { createRepositories } from "../data/repositories";
import { captureManualPerson, createManualPersonCaptureDraft } from "./manualPersonCapture";
import { getAppSettings, getPersonSummary, listPeopleSummaries, selectDisplayAffiliation } from "./peopleQueries";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function databaseName(): string {
  const name = `peopleos-queries-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

async function openDatabase(): Promise<PeopleOsDatabase> {
  const db = await openPeopleOsDatabase(databaseName(), fixedNow);
  connections.add(db);
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("V1-03 Person queries", () => {
  it("returns the application settings singleton without exposing storage to UI", async () => {
    const db = await openDatabase();
    await expect(getAppSettings(db)).resolves.toMatchObject({
      id: "app",
      defaultPhoneRegion: expect.any(String),
      captureMode: "standard"
    });
    db.close();
  });

  it("returns the basic saved recognition context without later relationship projections", async () => {
    const db = await openDatabase();
    const draft = createManualPersonCaptureDraft({ now: fixedNow, idFactory: () => crypto.randomUUID() });
    draft.displayName = "Aaron from the hackathon";
    draft.identityStatus = "provisional";
    draft.organisationName = "Watford Health";
    draft.role = "Digital lead";
    draft.whereMet = "NHS hackathon";
    draft.contactMethods = [
      { id: "phone-aaron", kind: "phone", value: "07900 123456" },
      { id: "phone-aaron-work", kind: "phone", value: "+44 7912 123456" },
      { id: "email-aaron", kind: "email", value: "aaron@example.com" }
    ];
    const capture = await captureManualPerson(db, draft, "GB");

    const summary = await getPersonSummary(db, capture.person.id);
    expect(summary).toMatchObject({
      person: { displayName: "Aaron from the hackathon", identityStatus: "provisional" },
      currentAffiliation: { organisationName: "Watford Health", role: "Digital lead" },
      latestMetInteraction: { summary: "NHS hackathon" }
    });
    expect(summary?.activeContactMethods.map((contact) => contact.id)).toEqual([
      "phone-aaron",
      "email-aaron",
      "phone-aaron-work"
    ]);
    expect((await listPeopleSummaries(db)).map((item) => item.person.id)).toEqual([capture.person.id]);
    db.close();
  });

  it("selects the display affiliation by documented stable rules", () => {
    const base = {
      revision: 1,
      personId: "person-one",
      organisationName: "One",
      isCurrent: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    };
    expect(selectDisplayAffiliation([
      { ...base, id: "affiliation-b", startedOn: "2025-01-01" },
      { ...base, id: "affiliation-a", startedOn: "2026-01-01" },
      { ...base, id: "affiliation-z", startedOn: "2027-01-01", archivedAt: fixedNow }
    ])?.id).toBe("affiliation-a");
  });

  it("filters one canonical people database by relationship mode and shows Both in either mode", async () => {
    const db = await openDatabase();
    const base = {
      revision: 1,
      identityStatus: "confirmed" as const,
      importance: "normal" as const,
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    };
    await createRepositories(db).people.create({ ...base, id: "personal", displayName: "Personal", relationshipMode: "personal" });
    await createRepositories(db).people.create({ ...base, id: "professional", displayName: "Professional", relationshipMode: "professional" });
    await createRepositories(db).people.create({ ...base, id: "both", displayName: "Both", relationshipMode: "both" });

    expect((await listPeopleSummaries(db, "personal")).map((item) => item.person.id).sort()).toEqual(["both", "personal"]);
    expect((await listPeopleSummaries(db, "professional")).map((item) => item.person.id).sort()).toEqual(["both", "professional"]);
    db.close();
  });
});
