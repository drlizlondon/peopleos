import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { createAppendOnlyRecord, createRepositories, StaleRevisionError } from "../data/repositories";
import { generateBackup } from "../data/backup";
import type { FollowUp, Interaction, Person, ReachOutEntry } from "../domain/schema";
import { ValidationError, validatePeopleOsData } from "../domain/validation";
import { archivePerson, restorePerson, updatePerson } from "./personLifecycle";

const now = "2026-07-23T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-person-lifecycle-${label}-${crypto.randomUUID()}`;
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
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("V1-11 Person lifecycle commands", () => {
  it("updates only Person-level preferences with stable identity and one revision", async () => {
    const db = await openDatabase("update");
    const repositories = createRepositories(db);
    const original = person();
    await repositories.people.create(original);
    const metadataBefore = await db.get("metadata", "app");

    const saved = await updatePerson(db, {
      personId: original.id,
      expectedRevision: original.revision,
      draft: {
        displayName: "  Sarah J.  ",
        importance: "high",
        tags: [" mentor ", "NHS"],
        contactCadenceDays: 90
      },
      occurredAt: "2026-07-23T10:00:00.000Z"
    });

    expect(saved).toMatchObject({
      id: original.id,
      revision: 2,
      displayName: "Sarah J.",
      importance: "high",
      tags: ["mentor", "NHS"],
      contactCadenceDays: 90,
      createdAt: original.createdAt,
      updatedAt: "2026-07-23T10:00:00.000Z"
    });
    expect((await db.get("metadata", "app"))?.datasetRevision)
      .toBe((metadataBefore?.datasetRevision ?? 0) + 1);
  });

  it("rejects invalid or stale edits without changing the Person", async () => {
    const db = await openDatabase("invalid");
    const repositories = createRepositories(db);
    const original = person();
    await repositories.people.create(original);

    await expect(updatePerson(db, {
      personId: original.id,
      expectedRevision: original.revision,
      draft: { displayName: " ", importance: "normal", tags: [] },
      occurredAt: "2026-07-23T10:00:00.000Z"
    })).rejects.toBeInstanceOf(ValidationError);

    const first = await updatePerson(db, {
      personId: original.id,
      expectedRevision: original.revision,
      draft: { displayName: "Sarah", importance: "normal", tags: [] },
      occurredAt: "2026-07-23T10:00:00.000Z"
    });
    await expect(updatePerson(db, {
      personId: original.id,
      expectedRevision: original.revision,
      draft: { displayName: "Different", importance: "normal", tags: [] },
      occurredAt: "2026-07-23T10:01:00.000Z"
    })).rejects.toBeInstanceOf(StaleRevisionError);
    expect(await db.get("people", original.id)).toEqual(first);
  });

  it("makes an exact uncertain update retry idempotent", async () => {
    const db = await openDatabase("update-retry");
    const repositories = createRepositories(db);
    const original = person();
    await repositories.people.create(original);
    const command = {
      personId: original.id,
      expectedRevision: original.revision,
      draft: { displayName: "Sarah", importance: "high" as const, tags: ["mentor"] },
      occurredAt: "2026-07-23T10:00:00.000Z"
    };
    const first = await updatePerson(db, command);
    const metadata = await db.get("metadata", "app");
    await expect(updatePerson(db, command)).resolves.toEqual(first);
    expect(await db.get("metadata", "app")).toEqual(metadata);
  });

  it("clears an existing cadence and makes the exact clear retry idempotent", async () => {
    const db = await openDatabase("clear-cadence-retry");
    const repositories = createRepositories(db);
    const original = person({ contactCadenceDays: 90 });
    await repositories.people.create(original);
    const command = {
      personId: original.id,
      expectedRevision: original.revision,
      draft: { displayName: original.displayName, importance: original.importance, tags: original.tags },
      occurredAt: "2026-07-23T10:00:00.000Z"
    };

    const first = await updatePerson(db, command);
    expect(first).not.toHaveProperty("contactCadenceDays");
    const metadata = await db.get("metadata", "app");
    await expect(updatePerson(db, command)).resolves.toEqual(first);
    expect(await db.get("metadata", "app")).toEqual(metadata);
  });

  it("archives and restores only the Person while retaining all relationship history and plan state", async () => {
    const db = await openDatabase("archive");
    const repositories = createRepositories(db);
    const original = person();
    await repositories.people.create(original);
    const interaction: Interaction = {
      id: "interaction-one", revision: 1, personId: original.id, kind: "meeting",
      occurredAt: now, summary: "Coffee at the fellowship",
      createdAt: now, updatedAt: now
    };
    const followUp: FollowUp = {
      id: "follow-up-one", revision: 1, personId: original.id,
      reason: "Send the update", actionType: "send_update", dueDate: "2026-08-01",
      status: "pending", createdAt: now, updatedAt: now
    };
    const reachOut: ReachOutEntry = {
      id: "reach-out-one", revision: 1, personId: original.id,
      reason: "Reconnect", intentStatus: "active", contextIds: [], addedAt: now,
      createdAt: now, updatedAt: now
    };
    await repositories.interactions.create(interaction);
    await repositories.followUps.create(followUp);
    await createAppendOnlyRecord(db, "followUpEvents", {
      id: "follow-up-event-created",
      followUpId: followUp.id,
      personId: original.id,
      kind: "created",
      occurredAt: now,
      toDate: followUp.dueDate
    });
    await repositories.reachOutEntries.create(reachOut);
    await createAppendOnlyRecord(db, "reachOutEvents", {
      id: "reach-out-event-added",
      reachOutEntryId: reachOut.id,
      kind: "added",
      occurredAt: now
    });

    const archived = await archivePerson(db, {
      personId: original.id,
      expectedRevision: original.revision,
      occurredAt: "2026-07-23T11:00:00.000Z"
    });
    expect(archived).toMatchObject({ revision: 2, archivedAt: "2026-07-23T11:00:00.000Z" });
    const afterArchive = await readAllData(db);
    expect(afterArchive.interactions).toEqual([interaction]);
    expect(afterArchive.followUps).toEqual([followUp]);
    expect(afterArchive.reachOutEntries).toEqual([reachOut]);
    expect(() => validatePeopleOsData(afterArchive)).not.toThrow();
    await expect(generateBackup(db, "2026-07-23T11:01:00.000Z")).resolves.toMatchObject({
      json: expect.stringContaining("\"product\": \"peopleos\"")
    });

    const restored = await restorePerson(db, {
      personId: original.id,
      expectedRevision: archived.revision,
      occurredAt: "2026-07-23T12:00:00.000Z"
    });
    expect(restored).toMatchObject({ id: original.id, revision: 3 });
    expect(restored.archivedAt).toBeUndefined();
    const afterRestore = await readAllData(db);
    expect(afterRestore.interactions).toEqual([interaction]);
    expect(afterRestore.followUps).toEqual([followUp]);
    expect(afterRestore.reachOutEntries).toEqual([reachOut]);
    expect(() => validatePeopleOsData(afterRestore)).not.toThrow();
  });

  it("makes archive and restore retries idempotent", async () => {
    const db = await openDatabase("archive-retry");
    const repositories = createRepositories(db);
    const original = person();
    await repositories.people.create(original);
    const archiveCommand = {
      personId: original.id,
      expectedRevision: 1,
      occurredAt: "2026-07-23T11:00:00.000Z"
    };
    const archived = await archivePerson(db, archiveCommand);
    const metadataAfterArchive = await db.get("metadata", "app");
    await expect(archivePerson(db, archiveCommand)).resolves.toEqual(archived);
    expect(await db.get("metadata", "app")).toEqual(metadataAfterArchive);

    const restoreCommand = {
      personId: original.id,
      expectedRevision: archived.revision,
      occurredAt: "2026-07-23T12:00:00.000Z"
    };
    const restored = await restorePerson(db, restoreCommand);
    const metadataAfterRestore = await db.get("metadata", "app");
    await expect(restorePerson(db, restoreCommand)).resolves.toEqual(restored);
    expect(await db.get("metadata", "app")).toEqual(metadataAfterRestore);
  });
});
