import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { contactCadenceInDays, contactCadenceOf } from "../domain/cadence";
import { addDaysToLocalDate } from "../domain/followUpPolicy";
import type { FollowUp, FollowUpEvent, Interaction, Person } from "../domain/schema";
import {
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  type RelationshipClock
} from "../relationship-engine";
import { bringToToday } from "./bringToToday";
import {
  alreadyContacted,
  prepareAlreadyContactedCommand
} from "./todayActions";
import { getTodayActionContext, getTodayScreenProjection } from "./todayQueries";
import { getUpcomingPeopleProjection } from "./upcomingQueries";

const broughtAt = "2026-08-14T09:00:00.000Z";
const broughtDate = "2026-08-14";
const originalDate = "2026-08-20";
const bringClock: RelationshipClock = {
  now: broughtAt,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
};
const nextDayClock: RelationshipClock = {
  ...bringClock,
  now: "2026-08-15T09:00:00.000Z"
};
const databases: Array<{ name: string; db: PeopleOsDatabase }> = [];

function person(): Person {
  return {
    id: "person-lizzie",
    revision: 1,
    displayName: "Elizabeth Soyode",
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    contactCadence: { value: 2, unit: "weeks" },
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z"
  };
}

function interaction(): Interaction {
  return {
    id: "interaction-existing",
    revision: 1,
    personId: "person-lizzie",
    kind: "contacted",
    occurredAt: "2026-08-01T12:00:00.000Z",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z"
  };
}

function followUp(): FollowUp {
  return {
    id: "follow-up-original",
    revision: 1,
    personId: "person-lizzie",
    dueDate: originalDate,
    reason: "Keep in touch",
    actionType: "message",
    suggestedByRule: "initial_schedule",
    status: "pending",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z"
  };
}

function followUpEvent(): FollowUpEvent {
  return {
    id: "follow-up-event-original",
    followUpId: "follow-up-original",
    personId: "person-lizzie",
    kind: "created",
    occurredAt: "2026-08-01T12:00:00.000Z",
    toDate: originalDate
  };
}

function sequenceIdFactory(): () => string {
  let value = 0;
  return () => `bring-to-today-${++value}`;
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-bring-to-today-${label}-${crypto.randomUUID()}`;
  const db = await openPeopleOsDatabase(name, broughtAt);
  databases.push({ name, db });
  return db;
}

async function seed(db: PeopleOsDatabase): Promise<void> {
  const tx = db.transaction(["people", "interactions", "followUps", "followUpEvents"], "readwrite");
  await tx.objectStore("people").add(person());
  await tx.objectStore("interactions").add(interaction());
  await tx.objectStore("followUps").add(followUp());
  await tx.objectStore("followUpEvents").add(followUpEvent());
  await tx.done;
}

afterEach(async () => {
  for (const { name, db } of databases.splice(0)) {
    db.close();
    await deletePeopleOsDatabase(name);
  }
});

describe("Bring to Today", () => {
  it("makes an Upcoming person immediately eligible without changing their contact history or schedule", async () => {
    const db = await openDatabase("immediate");
    await seed(db);
    const before = await readAllData(db);

    const updated = await bringToToday(db, "person-lizzie", bringClock);
    const after = await readAllData(db);
    const today = await getTodayScreenProjection(db, bringClock, "all");

    expect(updated).toMatchObject({
      id: "person-lizzie",
      revision: 2,
      broughtToTodayDate: broughtDate,
      contactCadence: { value: 2, unit: "weeks" }
    });
    expect(today.cards).toHaveLength(1);
    expect(today.cards[0]).toMatchObject({
      person: { id: "person-lizzie" },
      item: {
        eligibilityCode: "brought_to_today",
        relevantDate: broughtDate,
        primaryFollowUpId: "follow-up-original"
      },
      primaryFollowUp: { id: "follow-up-original", dueDate: originalDate, status: "pending" }
    });
    expect((await getUpcomingPeopleProjection(db, bringClock, "all")).people).toEqual([]);
    expect(after.interactions).toEqual(before.interactions);
    expect(after.followUps).toEqual(before.followUps);
    expect(after.followUpEvents).toEqual(before.followUpEvents);
    expect(after.people[0]?.contactCadence).toEqual(before.people[0]?.contactCadence);
  });

  it("restores the unchanged original Upcoming date on the next day when no contact is recorded", async () => {
    const db = await openDatabase("resume");
    await seed(db);
    const before = await readAllData(db);

    await bringToToday(db, "person-lizzie", bringClock);

    expect((await getTodayScreenProjection(db, nextDayClock, "all")).result.totalCount).toBe(0);
    const upcoming = await getUpcomingPeopleProjection(db, nextDayClock, "all");
    expect(upcoming.people).toHaveLength(1);
    expect(upcoming.people[0]).toMatchObject({
      person: { id: "person-lizzie" },
      date: originalDate
    });
    const after = await readAllData(db);
    expect(after.interactions).toEqual(before.interactions);
    expect(after.followUps).toEqual(before.followUps);
    expect(after.followUpEvents).toEqual(before.followUpEvents);
    expect(after.people[0]?.contactCadence).toEqual({ value: 2, unit: "weeks" });
  });

  it("is idempotent and rolls every write back when the transaction fails", async () => {
    const idempotentDb = await openDatabase("idempotent");
    await seed(idempotentDb);

    const first = await bringToToday(idempotentDb, "person-lizzie", bringClock);
    const metadataAfterFirst = await idempotentDb.get("metadata", "app");
    const retry = await bringToToday(idempotentDb, "person-lizzie", bringClock);

    expect(retry).toEqual(first);
    expect(await idempotentDb.get("people", "person-lizzie")).toEqual(first);
    expect((await idempotentDb.get("people", "person-lizzie"))?.revision).toBe(2);
    expect(await idempotentDb.get("metadata", "app")).toEqual(metadataAfterFirst);
    expect(metadataAfterFirst?.datasetRevision).toBe(2);

    await idempotentDb.put("todaySkips", {
      id: "person-lizzie:2026-08-14",
      personId: "person-lizzie",
      localDate: "2026-08-14",
      createdAt: broughtAt
    });
    await bringToToday(idempotentDb, "person-lizzie", bringClock);
    expect(await idempotentDb.get("todaySkips", "person-lizzie:2026-08-14")).toBeUndefined();
    const metadataAfterSkipRepair = await idempotentDb.get("metadata", "app");
    expect(metadataAfterSkipRepair?.datasetRevision).toBe(metadataAfterFirst!.datasetRevision + 1);
    await bringToToday(idempotentDb, "person-lizzie", bringClock);
    expect(await idempotentDb.get("metadata", "app")).toEqual(metadataAfterSkipRepair);

    const rollbackDb = await openDatabase("rollback");
    await seed(rollbackDb);
    const before = await readAllData(rollbackDb);
    const metadataBefore = await rollbackDb.get("metadata", "app");

    await expect(bringToToday(rollbackDb, "person-lizzie", bringClock, {
      beforeCommit: () => { throw new Error("injected Bring to Today failure"); }
    })).rejects.toThrow("injected Bring to Today failure");
    expect(await readAllData(rollbackDb)).toEqual(before);
    expect(await rollbackDb.get("metadata", "app")).toEqual(metadataBefore);
  });

  it("completes an early contact and recalculates the next reminder from Today using the normal cadence", async () => {
    const db = await openDatabase("early-done");
    await seed(db);
    await bringToToday(db, "person-lizzie", bringClock);

    const context = await getTodayActionContext(db, "person-lizzie", bringClock, "all");
    if (!context) throw new Error("Expected the brought person to have a Today action context");
    const cadence = contactCadenceOf(context.card.person);
    if (!cadence) throw new Error("Expected a recurring cadence");
    const nextDate = addDaysToLocalDate(
      context.projection.result.localDate,
      contactCadenceInDays(cadence)
    );
    const result = await alreadyContacted(db, prepareAlreadyContactedCommand(context, nextDate, {
      now: broughtAt,
      idFactory: sequenceIdFactory()
    }));

    expect(nextDate).toBe("2026-08-28");
    expect(result.interaction).toMatchObject({
      personId: "person-lizzie",
      kind: "contacted",
      occurredAt: broughtAt,
      followUpId: "follow-up-original"
    });
    expect(result.completedPrimaryFollowUp).toMatchObject({
      id: "follow-up-original",
      dueDate: originalDate,
      status: "completed",
      completedAt: broughtAt
    });
    expect(result.nextFollowUp).toMatchObject({
      dueDate: "2026-08-28",
      status: "pending",
      suggestedByRule: "today_already_contacted"
    });
    expect(await db.get("people", "person-lizzie")).toMatchObject({
      revision: 3,
      contactCadence: { value: 2, unit: "weeks" }
    });
    expect(await db.get("people", "person-lizzie")).not.toHaveProperty("broughtToTodayDate");
    expect((await getTodayScreenProjection(db, bringClock, "all")).result.totalCount).toBe(0);
    expect((await getUpcomingPeopleProjection(db, nextDayClock, "all")).people[0]).toMatchObject({
      person: { id: "person-lizzie" },
      date: "2026-08-28"
    });
  });
});
