import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import { StaleRevisionError } from "../data/repositories";
import { ValidationError } from "../domain/validation";
import { fixedNow } from "../test/fixtures";
import { updateAlreadyContactedDefault, updateConversationStarters } from "./settings";

const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-settings-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("V1-10 Settings command", () => {
  it("adds, edits and deletes name-aware conversation starters", async () => {
    const db = await openDatabase("starters");
    const initial = await db.get("appSettings", "app");
    expect(initial?.conversationStarters?.length).toBeGreaterThan(0);
    const added = { id: "starter-custom", template: "Hello {name}, congratulations!", relationshipMode: "both" as const };
    const saved = await updateConversationStarters(db, [added], "2026-08-02T09:00:00.000Z");
    expect(saved.conversationStarters).toEqual([added]);
    await expect(updateConversationStarters(db, [{ ...added, template: "Hello there" }], "2026-08-02T09:01:00.000Z"))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(updateConversationStarters(db, [], "2026-08-02T09:02:00.000Z")).rejects.toBeInstanceOf(ValidationError);
  });
  it("updates the default interval and increments the dataset revision once", async () => {
    const db = await openDatabase("update");
    const metadataBefore = await db.get("metadata", "app");
    const saved = await updateAlreadyContactedDefault(db, {
      expectedRevision: 1,
      days: 30,
      occurredAt: "2026-08-02T09:00:00.000Z"
    });

    expect(saved).toMatchObject({
      alreadyContactedDefaultReminderDays: 30,
      revision: 2,
      updatedAt: "2026-08-02T09:00:00.000Z"
    });
    expect((await db.get("metadata", "app"))?.datasetRevision)
      .toBe((metadataBefore?.datasetRevision ?? 0) + 1);
  });

  it("treats an exact command retry as a no-op", async () => {
    const db = await openDatabase("retry");
    const command = {
      expectedRevision: 1,
      days: 7,
      occurredAt: "2026-08-02T09:00:00.000Z"
    };
    const first = await updateAlreadyContactedDefault(db, command);
    const metadataAfterFirst = await db.get("metadata", "app");
    const retried = await updateAlreadyContactedDefault(db, command);

    expect(retried).toEqual(first);
    expect(await db.get("metadata", "app")).toEqual(metadataAfterFirst);
  });

  it("rejects stale and invalid commands without changing Settings", async () => {
    const db = await openDatabase("validation");
    const before = await db.get("appSettings", "app");
    await expect(updateAlreadyContactedDefault(db, {
      expectedRevision: 2,
      days: 2,
      occurredAt: "2026-08-02T09:00:00.000Z"
    })).rejects.toBeInstanceOf(StaleRevisionError);
    await expect(updateAlreadyContactedDefault(db, {
      expectedRevision: 1,
      days: 0,
      occurredAt: "2026-08-02T09:00:00.000Z"
    })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.get("appSettings", "app")).toEqual(before);
  });

  it("rolls back Settings and metadata together when commit fails", async () => {
    const db = await openDatabase("rollback");
    const beforeSettings = await db.get("appSettings", "app");
    const beforeMetadata = await db.get("metadata", "app");
    await expect(updateAlreadyContactedDefault(db, {
      expectedRevision: 1,
      days: 14,
      occurredAt: "2026-08-02T09:00:00.000Z"
    }, { beforeCommit: () => { throw new Error("Injected failure"); } }))
      .rejects.toThrow("Injected failure");
    expect(await db.get("appSettings", "app")).toEqual(beforeSettings);
    expect(await db.get("metadata", "app")).toEqual(beforeMetadata);
  });
});
