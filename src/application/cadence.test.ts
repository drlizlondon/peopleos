import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import { createRepositories } from "../data/repositories";
import type { Interaction, Person, ReachOutEntry } from "../domain/schema";
import { ValidationError } from "../domain/validation";
import { deferRegularReminder, resumeRegularReminder } from "./cadence";

const now = "2026-08-03T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-cadence-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, now);
  connections.add(db);
  return db;
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-one",
    revision: 1,
    displayName: "Sarah Jones",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    contactCadenceDays: 14,
    contactCadenceFirstDueDate: "2026-07-20",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function interaction(): Interaction {
  return {
    id: "interaction-one",
    revision: 1,
    personId: "person-one",
    kind: "contacted",
    occurredAt: "2026-07-20T10:00:00.000Z",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z"
  };
}

function reachOutEntry(): ReachOutEntry {
  return {
    id: "reach-out-one",
    revision: 1,
    personId: "person-one",
    reason: "Send the article",
    intentStatus: "active",
    contextIds: [],
    addedAt: "2026-07-22T09:00:00.000Z",
    createdAt: "2026-07-22T09:00:00.000Z",
    updatedAt: "2026-07-22T09:00:00.000Z"
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("regular reminder pause commands", () => {
  it("defers only Keep in touch until the resume date", async () => {
    const db = await openDatabase("defer");
    const repositories = createRepositories(db);
    const original = person({ contactCadencePausedAt: "2026-07-30T09:00:00.000Z" });
    const existingInteraction = interaction();
    const existingReachOut = reachOutEntry();
    await repositories.people.create(original);
    await repositories.interactions.create(existingInteraction);
    await repositories.reachOutEntries.create(existingReachOut);

    const saved = await deferRegularReminder(
      db,
      original.id,
      "2026-09-14",
      "2026-08-03T10:00:00.000Z"
    );

    expect(saved).toMatchObject({
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-07-20",
      contactCadenceDeferredUntilDate: "2026-09-14",
      revision: 2,
      updatedAt: "2026-08-03T10:00:00.000Z"
    });
    expect(saved).not.toHaveProperty("contactCadencePausedAt");
    expect(await repositories.interactions.list()).toEqual([existingInteraction]);
    expect(await repositories.reachOutEntries.list()).toEqual([existingReachOut]);
  });

  it("resumes by clearing finite and legacy indefinite pauses only", async () => {
    const db = await openDatabase("resume");
    const repositories = createRepositories(db);
    const original = person({
      contactCadenceDeferredUntilDate: "2026-09-14",
      contactCadencePausedAt: "2026-07-30T09:00:00.000Z"
    });
    const existingInteraction = interaction();
    const existingReachOut = reachOutEntry();
    await repositories.people.create(original);
    await repositories.interactions.create(existingInteraction);
    await repositories.reachOutEntries.create(existingReachOut);

    const saved = await resumeRegularReminder(
      db,
      original.id,
      "2026-08-03T10:00:00.000Z"
    );

    expect(saved).toMatchObject({
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-07-20",
      revision: 2,
      updatedAt: "2026-08-03T10:00:00.000Z"
    });
    expect(saved).not.toHaveProperty("contactCadenceDeferredUntilDate");
    expect(saved).not.toHaveProperty("contactCadencePausedAt");
    expect(await repositories.interactions.list()).toEqual([existingInteraction]);
    expect(await repositories.reachOutEntries.list()).toEqual([existingReachOut]);
  });

  it("rejects a finite pause when Keep in touch is off or the date is invalid", async () => {
    const db = await openDatabase("validation");
    const repositories = createRepositories(db);
    const noCadence = person();
    delete noCadence.contactCadenceDays;
    delete noCadence.contactCadenceFirstDueDate;
    await repositories.people.create(noCadence);

    await expect(deferRegularReminder(
      db,
      noCadence.id,
      "2026-09-14",
      "2026-08-03T10:00:00.000Z"
    )).rejects.toBeInstanceOf(ValidationError);

    const withCadence = person({ id: "person-two" });
    await repositories.people.create(withCadence);
    await expect(deferRegularReminder(
      db,
      withCadence.id,
      "2026-02-30",
      "2026-08-03T10:00:00.000Z"
    )).rejects.toBeInstanceOf(ValidationError);
  });
});
