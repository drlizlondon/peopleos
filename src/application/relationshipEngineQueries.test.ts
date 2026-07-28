import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { DATA_STORE_NAMES, type PeopleOsData } from "../domain/schema";
import { RELATIONSHIP_ENGINE_POLICY_VERSION } from "../relationship-engine";
import {
  assessRelationshipsFromData,
  buildTodayFromData,
  createRelationshipClock,
  getRelationshipAssessment,
  getTodayResult
} from "./relationshipEngineQueries";

const databaseNames: string[] = [];
const now = "2026-08-14T12:00:00.000Z";
const clock = {
  now,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
} as const;

async function openDatabase(): Promise<PeopleOsDatabase> {
  const name = `peopleos-v109-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return openPeopleOsDatabase(name, now);
}

async function seed(db: PeopleOsDatabase): Promise<void> {
  const tx = db.transaction(["people", "interactions", "followUps", "memoryFacts"], "readwrite");
  await tx.objectStore("people").add({
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Ahmed",
    identityStatus: "confirmed",
    importance: "high",
    tags: [],
    contactCadenceDays: 90,
    createdAt: "2025-01-01T12:00:00.000Z",
    updatedAt: "2025-01-01T12:00:00.000Z"
  });
  await tx.objectStore("interactions").add({
    id: "interaction-sarah",
    revision: 1,
    personId: "person-sarah",
    kind: "email",
    occurredAt: "2026-08-01T12:00:00.000Z",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z"
  });
  await tx.objectStore("followUps").add({
    id: "follow-up-sarah",
    revision: 1,
    personId: "person-sarah",
    dueDate: "2026-08-14",
    reason: "Send the pilot update",
    actionType: "send_update",
    status: "pending",
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z"
  });
  await tx.objectStore("memoryFacts").add({
    id: "fact-sarah",
    revision: 1,
    personId: "person-sarah",
    kind: "seeking",
    value: "Looking for pilot sites",
    showAsMemoryCue: true,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z"
  });
  await tx.done;
}

afterEach(async () => {
  for (const name of databaseNames.splice(0)) await deletePeopleOsDatabase(name);
});

describe("Relationship Engine application queries", () => {
  it("creates an explicit, fixed-version clock at the application boundary", () => {
    expect(createRelationshipClock({ now, timeZone: "Europe/London" })).toEqual(clock);
  });

  it("loads one Person assessment and the complete Today result from persisted records", async () => {
    const db = await openDatabase();
    await seed(db);
    const assessment = await getRelationshipAssessment(db, "person-sarah", clock);
    expect(assessment).toMatchObject({
      personId: "person-sarah",
      policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION,
      today: {
        eligibilityCode: "explicit_follow_up",
        primaryFollowUpId: "follow-up-sarah"
      },
      memoryCue: { source: "follow_up", sourceId: "follow-up-sarah" },
      searchContextCue: { source: "memory_fact", sourceId: "fact-sarah" }
    });
    const today = await getTodayResult(db, clock);
    expect(today.orderedItems.map((item) => item.personId)).toEqual(["person-sarah"]);
    expect(today.totalCount).toBe(1);
    db.close();
  });

  it("returns undefined for a missing Person", async () => {
    const db = await openDatabase();
    expect(await getRelationshipAssessment(db, "missing", clock)).toBeUndefined();
    db.close();
  });

  it("is calculate-on-read and leaves every domain store and metadata byte-equivalent", async () => {
    const db = await openDatabase();
    await seed(db);
    const before = await readAllData(db);
    const metadataBefore = await db.get("metadata", "app");
    await getRelationshipAssessment(db, "person-sarah", clock);
    await getTodayResult(db, clock);
    expect(await readAllData(db)).toEqual(before);
    expect(await db.get("metadata", "app")).toEqual(metadataBefore);
    db.close();
  });

  it("does not accept AppSettings as an input or let settings change output", async () => {
    const db = await openDatabase();
    await seed(db);
    const before = await getTodayResult(db, clock);
    const settings = await db.get("appSettings", "app");
    await db.put("appSettings", {
      ...settings!,
      captureMode: "networking",
      reachOutDefaultReminderDays: 30,
      revision: settings!.revision + 1,
      updatedAt: now
    });
    expect(await getTodayResult(db, clock)).toEqual(before);
    db.close();
  });

  it("produces stable per-Person assessments and Today order from shuffled snapshots", () => {
    const empty = (): PeopleOsData => ({
      people: [], contactMethods: [], externalIdentities: [], affiliations: [], interactions: [], events: [], memoryFacts: [],
      followUps: [], followUpEvents: [], todaySkips: [], reachOutEntries: [], reachOutEvents: [],
      reachOutContexts: [], appSettings: []
    });
    const data = empty();
    data.people = [
      {
        id: "person-z", revision: 1, displayName: "Zed", identityStatus: "confirmed", importance: "normal",
        tags: [], createdAt: now, updatedAt: now
      },
      {
        id: "person-a", revision: 1, displayName: "Amy", identityStatus: "confirmed", importance: "high",
        tags: [], createdAt: now, updatedAt: now
      }
    ];
    data.followUps = data.people.map((candidate, index) => ({
      id: `follow-up-${candidate.id}`,
      revision: 1,
      personId: candidate.id,
      dueDate: "2026-08-14",
      reason: "Reconnect",
      actionType: "message" as const,
      status: "pending" as const,
      createdAt: `2026-08-0${index + 1}T12:00:00.000Z`,
      updatedAt: `2026-08-0${index + 1}T12:00:00.000Z`
    }));
    const expectedAssessments = assessRelationshipsFromData(data, clock);
    const expectedToday = buildTodayFromData(data, clock);
    const shuffled: PeopleOsData = {
      ...data,
      people: [...data.people].reverse(),
      followUps: [...data.followUps].reverse()
    };
    expect(assessRelationshipsFromData(shuffled, clock)).toEqual(expectedAssessments);
    expect(buildTodayFromData(shuffled, clock)).toEqual(expectedToday);
    expect(expectedToday.orderedItems.map((item) => item.personId)).toEqual(["person-a", "person-z"]);
  });

  it("keeps the schema/store surface unchanged", () => {
    expect(DATA_STORE_NAMES).not.toContain("relationshipAssessments");
    expect(DATA_STORE_NAMES).not.toContain("todayQueue");
  });
});
