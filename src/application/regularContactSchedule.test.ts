import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import type { Interaction, Person } from "../domain/schema";
import {
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  resolveRelationshipScheduleState,
  type RelationshipClock
} from "../relationship-engine";
import { relationshipBundleFromData } from "./relationshipEngineQueries";
import {
  getRegularContactStartRequirement,
  initialiseRegularContactSchedule
} from "./regularContactSchedule";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();
const now = "2026-08-14T12:00:00.000Z";
const clock: RelationshipClock = {
  now,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
};

function databaseName(label: string): string {
  const name = `peopleos-regular-schedule-${label}-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

async function open(name: string): Promise<PeopleOsDatabase> {
  const db = await openPeopleOsDatabase(name, now);
  connections.add(db);
  return db;
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-one",
    revision: 1,
    displayName: "Sarah",
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    contactCadence: { value: 1, unit: "days" },
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides
  };
}

function command(startDate = "2026-08-14", suffix = "one") {
  return {
    personId: "person-one",
    startDate,
    followUpId: `follow-up-${suffix}`,
    followUpEventId: `follow-up-event-${suffix}`,
    occurredAt: now
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("initialiseRegularContactSchedule", () => {
  it.each([
    ["2026-08-14", "2026-08-14"],
    ["2026-08-15", "2026-08-15"]
  ])("atomically repairs a legacy record starting on %s without a fake contact", async (startDate, expectedDate) => {
    const db = await open(databaseName(`repair-${startDate}`));
    await db.put("people", person());

    const result = await initialiseRegularContactSchedule(db, command(startDate));
    const data = await readAllData(db);

    expect(result).toMatchObject({
      outcome: "created",
      followUp: { dueDate: startDate, suggestedByRule: "initial_schedule", status: "pending" },
      followUpEvent: { kind: "created", toDate: startDate }
    });
    expect(data.interactions).toEqual([]);
    expect(data.followUps).toHaveLength(1);
    expect(data.followUpEvents).toHaveLength(1);
    expect(resolveRelationshipScheduleState(
      relationshipBundleFromData(data, data.people[0]),
      clock
    )).toEqual({ kind: "scheduled", localDate: expectedDate });
  });

  it("is idempotent after closing and reopening the database", async () => {
    const name = databaseName("reload");
    const firstDb = await open(name);
    await firstDb.put("people", person());
    expect((await initialiseRegularContactSchedule(firstDb, command())).outcome).toBe("created");
    firstDb.close();
    connections.delete(firstDb);

    const reopened = await open(name);
    const metadataBeforeRetry = await reopened.get("metadata", "app");
    const retry = await initialiseRegularContactSchedule(reopened, command());

    expect(retry.outcome).toBe("already_scheduled");
    expect(await reopened.count("followUps")).toBe(1);
    expect(await reopened.count("followUpEvents")).toBe(1);
    expect(await reopened.count("interactions")).toBe(0);
    expect(await reopened.get("metadata", "app")).toEqual(metadataBeforeRetry);
    const data = await readAllData(reopened);
    expect(resolveRelationshipScheduleState(
      relationshipBundleFromData(data, data.people[0]),
      clock
    )).toEqual({ kind: "scheduled", localDate: "2026-08-14" });
  });

  it("serializes concurrent repair commands so only one initial schedule is created", async () => {
    const db = await open(databaseName("concurrent"));
    await db.put("people", person());

    const results = await Promise.all([
      initialiseRegularContactSchedule(db, command("2026-08-14", "first")),
      initialiseRegularContactSchedule(db, command("2026-08-15", "second"))
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "already_scheduled",
      "created"
    ]);
    expect(await db.count("followUps")).toBe(1);
    expect(await db.count("followUpEvents")).toBe(1);
    expect(await db.count("interactions")).toBe(0);
  });

  it("does not create an initial schedule when a genuine contact already anchors recurrence", async () => {
    const db = await open(databaseName("real-contact"));
    await db.put("people", person());
    const interaction: Interaction = {
      id: "contact-one",
      revision: 1,
      personId: "person-one",
      kind: "contacted",
      occurredAt: "2026-08-13T12:00:00.000Z",
      createdAt: "2026-08-13T12:00:00.000Z",
      updatedAt: "2026-08-13T12:00:00.000Z"
    };
    await db.put("interactions", interaction);

    expect(await getRegularContactStartRequirement(db, "person-one")).toBe("existing_anchor");
    expect(await initialiseRegularContactSchedule(db, command())).toMatchObject({
      outcome: "already_scheduled"
    });
    expect(await db.count("followUps")).toBe(0);
    expect(await db.count("followUpEvents")).toBe(0);
    expect(await db.count("interactions")).toBe(1);
  });

  it("keeps an origin/main indefinite pause inactive until an explicit start choice resumes it", async () => {
    const db = await open(databaseName("legacy-indefinite-pause"));
    await db.put("people", person({
      revision: 4,
      contactCadenceDays: 1,
      contactCadencePausedAt: "2026-08-10T09:00:00.000Z"
    }));
    const interaction: Interaction = {
      id: "contact-before-pause",
      revision: 1,
      personId: "person-one",
      kind: "contacted",
      occurredAt: "2026-08-09T12:00:00.000Z",
      createdAt: "2026-08-09T12:00:00.000Z",
      updatedAt: "2026-08-09T12:00:00.000Z"
    };
    await db.put("interactions", interaction);

    expect(await getRegularContactStartRequirement(db, "person-one")).toBe("start_required");
    const before = await readAllData(db);
    expect(resolveRelationshipScheduleState(
      relationshipBundleFromData(before, before.people[0]),
      clock
    )).toEqual({ kind: "incomplete_regular_schedule" });

    const result = await initialiseRegularContactSchedule(
      db,
      command("2026-08-15", "resume-paused")
    );
    expect(result).toMatchObject({
      outcome: "created",
      person: { revision: 5 },
      followUp: { dueDate: "2026-08-15", suggestedByRule: "initial_schedule" }
    });
    expect(result.person).not.toHaveProperty("contactCadencePausedAt");
    expect(await db.count("interactions")).toBe(1);
    const after = await readAllData(db);
    expect(resolveRelationshipScheduleState(
      relationshipBundleFromData(after, after.people[0]),
      clock
    )).toEqual({ kind: "scheduled", localDate: "2026-08-15" });
  });

  it("reports that a cadence-only compatibility record needs a start choice", async () => {
    const db = await open(databaseName("start-requirement"));
    await db.put("people", person());

    expect(await getRegularContactStartRequirement(db, "person-one")).toBe("start_required");
  });

  it("does not treat an unrelated pending follow-up as a real anchor when Regular contact is first enabled", async () => {
    const db = await open(databaseName("pending-before-enable"));
    const withoutCadence = person();
    delete withoutCadence.contactCadence;
    await db.put("people", withoutCadence);
    await db.put("followUps", {
      id: "legacy-manual-follow-up",
      revision: 1,
      personId: withoutCadence.id,
      dueDate: "2026-08-20",
      reason: "Legacy plan",
      actionType: "other",
      status: "pending",
      createdAt: now,
      updatedAt: now
    });

    expect(await getRegularContactStartRequirement(db, withoutCadence.id)).toBe("start_required");
  });
});
