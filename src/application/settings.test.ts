import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import { StaleRevisionError } from "../data/repositories";
import { DEFAULT_CONVERSATION_STARTERS } from "../domain/schema";
import { ValidationError } from "../domain/validation";
import { fixedNow } from "../test/fixtures";
import {
  updateAlreadyContactedDefault,
  updateConversationStarters,
  updateTodaySummaryNotificationSettings
} from "./settings";

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

describe("MVP Today notification Settings command", () => {
  it("updates enabled intent and time atomically", async () => {
    const db = await openDatabase("notification-update");
    const metadataBefore = await db.get("metadata", "app");
    const saved = await updateTodaySummaryNotificationSettings(db, {
      expectedRevision: 1,
      enabled: true,
      time: "08:45",
      occurredAt: "2026-08-02T10:00:00.000Z"
    });
    expect(saved).toMatchObject({
      todaySummaryNotificationsEnabled: true,
      todaySummaryNotificationTime: "08:45",
      revision: 2
    });
    expect((await db.get("metadata", "app"))?.datasetRevision)
      .toBe((metadataBefore?.datasetRevision ?? 0) + 1);
  });

  it("treats an exact retry as a no-op", async () => {
    const db = await openDatabase("notification-retry");
    const command = {
      expectedRevision: 1,
      enabled: true,
      time: "12:30",
      occurredAt: "2026-08-02T10:00:00.000Z"
    };
    const first = await updateTodaySummaryNotificationSettings(db, command);
    const metadata = await db.get("metadata", "app");
    await expect(updateTodaySummaryNotificationSettings(db, command)).resolves.toEqual(first);
    expect(await db.get("metadata", "app")).toEqual(metadata);
  });

  it("rejects an invalid time and stale revision without writing", async () => {
    const db = await openDatabase("notification-validation");
    const before = await db.get("appSettings", "app");
    await expect(updateTodaySummaryNotificationSettings(db, {
      expectedRevision: 1,
      enabled: true,
      time: "24:00",
      occurredAt: "2026-08-02T10:00:00.000Z"
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateTodaySummaryNotificationSettings(db, {
      expectedRevision: 2,
      enabled: true,
      time: "12:00",
      occurredAt: "2026-08-02T10:00:00.000Z"
    })).rejects.toBeInstanceOf(StaleRevisionError);
    expect(await db.get("appSettings", "app")).toEqual(before);
  });

  it("rolls Settings and metadata back together", async () => {
    const db = await openDatabase("notification-rollback");
    const beforeSettings = await db.get("appSettings", "app");
    const beforeMetadata = await db.get("metadata", "app");
    await expect(updateTodaySummaryNotificationSettings(db, {
      expectedRevision: 1,
      enabled: true,
      time: "12:00",
      occurredAt: "2026-08-02T10:00:00.000Z"
    }, { beforeCommit: () => { throw new Error("Injected failure"); } }))
      .rejects.toThrow("Injected failure");
    expect(await db.get("appSettings", "app")).toEqual(beforeSettings);
    expect(await db.get("metadata", "app")).toEqual(beforeMetadata);
  });
});

describe("Conversation starter Settings command", () => {
  const customBank = [
    { id: "personal-one", template: "Thinking of you, {name}.", relationshipMode: "personal" as const },
    { id: "professional-one", template: "How is the work going, {name}?", relationshipMode: "professional" as const },
    { id: "shared-one", template: "How are things, {name}?", relationshipMode: "both" as const }
  ];

  it("updates the bank once and treats an exact retry as a no-op", async () => {
    const db = await openDatabase("starter-update");
    expect((await db.get("appSettings", "app"))?.conversationStarters)
      .toEqual(DEFAULT_CONVERSATION_STARTERS);
    const command = {
      expectedRevision: 1,
      starters: customBank,
      occurredAt: "2026-08-02T11:00:00.000Z"
    };

    const saved = await updateConversationStarters(db, command);
    const metadataAfterFirst = await db.get("metadata", "app");
    expect(saved).toMatchObject({ conversationStarters: customBank, revision: 2 });
    await expect(updateConversationStarters(db, command)).resolves.toEqual(saved);
    expect(await db.get("metadata", "app")).toEqual(metadataAfterFirst);
  });

  it("rejects invalid and stale updates without changing Settings", async () => {
    const db = await openDatabase("starter-validation");
    const before = await db.get("appSettings", "app");
    await expect(updateConversationStarters(db, {
      expectedRevision: 1,
      starters: [{ id: "invalid", template: "No name token", relationshipMode: "both" }],
      occurredAt: "2026-08-02T11:00:00.000Z"
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateConversationStarters(db, {
      expectedRevision: 2,
      starters: customBank,
      occurredAt: "2026-08-02T11:00:00.000Z"
    })).rejects.toBeInstanceOf(StaleRevisionError);
    expect(await db.get("appSettings", "app")).toEqual(before);
  });
});
