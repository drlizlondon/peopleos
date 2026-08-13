import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { createRepositories, StaleRevisionError } from "../data/repositories";
import type { FollowUp, Person, ReachOutEntry } from "../domain/schema";
import { RELATIONSHIP_ENGINE_POLICY_VERSION } from "../relationship-engine";
import { bringToToday } from "./bringToToday";
import { recordConversationStarterUse } from "./conversationStarterHistory";
import {
  alreadyContacted,
  prepareAlreadyContactedCommand
} from "./todayActions";
import {
  createTodayCompletionReceipt,
  undoAlreadyContacted
} from "./todayCompletionUndo";
import { getTodayActionContext } from "./todayQueries";

const completedAt = "2026-08-14T12:00:00.000Z";
const undoAt = "2026-08-14T12:01:00.000Z";
const clock = {
  now: completedAt,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
} as const;
const databases: Array<{ name: string; db: PeopleOsDatabase }> = [];

function person(patch: Partial<Person> = {}): Person {
  return {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Ahmed",
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    ...patch
  };
}

function followUp(patch: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "follow-up-primary",
    revision: 1,
    personId: "person-sarah",
    dueDate: "2026-08-14",
    reason: "Send the pilot update",
    actionType: "message",
    status: "pending",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...patch
  };
}

function reachOutEntry(patch: Partial<ReachOutEntry> = {}): ReachOutEntry {
  return {
    id: "reach-out-sarah",
    revision: 1,
    personId: "person-sarah",
    reason: "Send the pilot update",
    intendedActionType: "message",
    intentStatus: "active",
    currentFollowUpId: "follow-up-primary",
    contextIds: [],
    addedAt: "2026-08-01T12:00:00.000Z",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...patch
  };
}

function sequenceIdFactory(): () => string {
  let value = 0;
  return () => `undo-${++value}`;
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-today-undo-${label}-${crypto.randomUUID()}`;
  const db = await openPeopleOsDatabase(name, completedAt);
  databases.push({ name, db });
  return db;
}

async function setDatasetRevision(db: PeopleOsDatabase, revision: number): Promise<void> {
  const metadata = await db.get("metadata", "app");
  await db.put("metadata", {
    ...metadata!,
    datasetRevision: revision,
    updatedAt: completedAt
  });
}

async function seedExplicit(
  db: PeopleOsDatabase,
  options: { reachOut?: boolean; future?: boolean } = {}
): Promise<{ person: Person; primary: FollowUp; entry?: ReachOutEntry }> {
  const savedPerson = person(options.future ? {
    contactCadence: { value: 2, unit: "weeks" }
  } : {});
  const primary = followUp({
    ...(options.future ? {
      dueDate: "2026-08-20",
      suggestedByRule: "initial_schedule"
    } : {}),
    ...(options.reachOut ? { reachOutEntryId: "reach-out-sarah" } : {})
  });
  const entry = options.reachOut ? reachOutEntry() : undefined;
  const tx = db.transaction(["people", "followUps", "reachOutEntries"], "readwrite");
  await tx.objectStore("people").add(savedPerson);
  await tx.objectStore("followUps").add(primary);
  if (entry) await tx.objectStore("reachOutEntries").add(entry);
  await tx.done;
  await setDatasetRevision(db, 10);
  return { person: savedPerson, primary, ...(entry ? { entry } : {}) };
}

async function context(db: PeopleOsDatabase) {
  const result = await getTodayActionContext(db, "person-sarah", clock, "all");
  if (!result) throw new Error("Expected a Today action context");
  return result;
}

afterEach(async () => {
  for (const { name, db } of databases.splice(0)) {
    db.close();
    await deletePeopleOsDatabase(name);
  }
});

describe("Today completion Undo", () => {
  it("restores a regular completion exactly while preserving unrelated starter history", async () => {
    const db = await openDatabase("regular");
    const { person: personBefore, primary } = await seedExplicit(db);
    const itemBefore = (await context(db)).card.item;
    const command = prepareAlreadyContactedCommand(await context(db), "2026-08-28", {
      now: completedAt,
      idFactory: sequenceIdFactory()
    });
    const result = await alreadyContacted(db, command);
    const receipt = createTodayCompletionReceipt(command, result, personBefore);

    await recordConversationStarterUse(db, {
      id: "starter-use-unrelated",
      personId: personBefore.id,
      starterId: "starter-recent",
      starterTemplate: "Hi {name}, how did the pilot go?",
      occurredAt: "2026-08-14T12:00:30.000Z"
    });
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(12);

    const undone = await undoAlreadyContacted(db, receipt, { now: undoAt });

    expect(undone).toMatchObject({ alreadyUndone: false, person: personBefore });
    expect(undone.primaryFollowUp).toEqual({
      ...primary,
      revision: 3,
      updatedAt: undoAt
    });
    expect((await context(db)).card.item).toEqual(itemBefore);
    expect(await db.get("conversationStarterUses", "starter-use-unrelated"))
      .toBeDefined();
    expect(await db.get("interactions", command.interactionId)).toBeUndefined();
    expect(await db.get("followUps", command.nextFollowUpId)).toBeUndefined();
    expect(await db.get("followUpEvents", command.followUpCompletionEventId)).toBeUndefined();
    expect(await db.get("todaySkips", result.todaySkip.id)).toBeUndefined();
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(13);

    const metadataAfterUndo = await db.get("metadata", "app");
    await expect(undoAlreadyContacted(db, receipt, {
      now: "2026-08-14T12:02:00.000Z"
    })).resolves.toMatchObject({ alreadyUndone: true });
    expect(await db.get("metadata", "app")).toEqual(metadataAfterUndo);
  });

  it("restores a brought-to-Today early plan and bring marker with forward revisions", async () => {
    const db = await openDatabase("brought");
    const { primary } = await seedExplicit(db, { future: true });
    const personBefore = await bringToToday(db, "person-sarah", clock);
    const contextBefore = await context(db);
    expect(contextBefore.card.item).toMatchObject({
      eligibilityCode: "brought_to_today",
      primaryFollowUpId: primary.id
    });
    const command = prepareAlreadyContactedCommand(contextBefore, "2026-08-28", {
      now: completedAt,
      idFactory: sequenceIdFactory()
    });
    const result = await alreadyContacted(db, command);
    const receipt = createTodayCompletionReceipt(command, result, personBefore);

    const undone = await undoAlreadyContacted(db, receipt, { now: undoAt });

    expect(undone.person).toEqual({
      ...personBefore,
      revision: 4,
      updatedAt: undoAt
    });
    expect(undone.primaryFollowUp).toEqual({
      ...primary,
      revision: 3,
      updatedAt: undoAt
    });
    expect((await context(db)).card.item).toEqual(contextBefore.card.item);
    expect(await db.get("followUps", command.nextFollowUpId)).toBeUndefined();
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(13);
  });

  it("restores a one-off Reach Out completion without creating scheduling side effects", async () => {
    const db = await openDatabase("reach-out");
    const { person: personBefore, primary, entry } = await seedExplicit(db, { reachOut: true });
    const command = prepareAlreadyContactedCommand(await context(db), "2026-08-28", {
      now: completedAt,
      idFactory: sequenceIdFactory(),
      suppressNextFollowUp: true
    });
    const result = await alreadyContacted(db, command);
    const receipt = createTodayCompletionReceipt(command, result, personBefore);

    const undone = await undoAlreadyContacted(db, receipt, { now: undoAt });

    expect(undone.primaryFollowUp).toEqual({
      ...primary,
      revision: 3,
      updatedAt: undoAt
    });
    expect(undone.reachOutEntry).toEqual({
      ...entry!,
      revision: 3,
      updatedAt: undoAt
    });
    expect(await db.get("followUps", command.nextFollowUpId)).toBeUndefined();
    expect(await db.get("followUpEvents", command.nextFollowUpEventId)).toBeUndefined();
    expect(await db.get("reachOutEvents", command.reachOutCompletionEventId)).toBeUndefined();
    expect(await db.get("reachOutEvents", command.reachOutLinkedEventId)).toBeUndefined();
    expect((await db.getAllFromIndex("followUps", "by-reach-out", entry!.id))
      .filter((candidate) => candidate.status === "pending")).toEqual([
      { ...primary, revision: 3, updatedAt: undoAt }
    ]);
  });

  it("rejects a stale affected record without changing any completion state", async () => {
    const db = await openDatabase("stale");
    const { person: personBefore } = await seedExplicit(db);
    const command = prepareAlreadyContactedCommand(await context(db), "2026-08-28", {
      now: completedAt,
      idFactory: sequenceIdFactory()
    });
    const result = await alreadyContacted(db, command);
    const receipt = createTodayCompletionReceipt(command, result, personBefore);
    const completedPrimary = await db.get("followUps", "follow-up-primary");
    await createRepositories(db).followUps.update({
      ...completedPrimary!,
      reason: "Changed after completion"
    }, completedPrimary!.revision, "2026-08-14T12:00:30.000Z");
    const beforeUndo = await readAllData(db);
    const metadataBeforeUndo = await db.get("metadata", "app");

    await expect(undoAlreadyContacted(db, receipt, { now: undoAt }))
      .rejects.toBeInstanceOf(StaleRevisionError);
    expect(await readAllData(db)).toEqual(beforeUndo);
    expect(await db.get("metadata", "app")).toEqual(metadataBeforeUndo);
  });

  it("does not restore a completed Today card after its local day has ended", async () => {
    const db = await openDatabase("next-day");
    const { person: personBefore } = await seedExplicit(db);
    const command = prepareAlreadyContactedCommand(await context(db), "2026-08-28", {
      now: completedAt,
      idFactory: sequenceIdFactory()
    });
    const result = await alreadyContacted(db, command);
    const receipt = createTodayCompletionReceipt(command, result, personBefore);
    const completionState = await readAllData(db);

    await expect(undoAlreadyContacted(db, receipt, { now: "2026-08-15T00:01:00.000Z" }))
      .rejects.toThrow("only available on the day");
    expect(await readAllData(db)).toEqual(completionState);
  });

  it("rejects Undo when later records depend on history it would delete", async () => {
    const db = await openDatabase("dependent");
    const { person: personBefore } = await seedExplicit(db);
    const command = prepareAlreadyContactedCommand(await context(db), "2026-08-28", {
      now: completedAt,
      idFactory: sequenceIdFactory()
    });
    const result = await alreadyContacted(db, command);
    const receipt = createTodayCompletionReceipt(command, result, personBefore);
    await createRepositories(db).memoryFacts.create({
      id: "fact-from-completion",
      revision: 1,
      personId: personBefore.id,
      kind: "interest",
      value: "Pilot update sent",
      showAsMemoryCue: true,
      sourceInteractionId: command.interactionId,
      createdAt: "2026-08-14T12:00:30.000Z",
      updatedAt: "2026-08-14T12:00:30.000Z"
    });
    const beforeUndo = await readAllData(db);

    await expect(undoAlreadyContacted(db, receipt, { now: undoAt }))
      .rejects.toBeInstanceOf(StaleRevisionError);
    expect(await readAllData(db)).toEqual(beforeUndo);
  });

  it("rejects a changed Reach Out dependency topology", async () => {
    const db = await openDatabase("reach-out-dependent");
    const { person: personBefore, entry } = await seedExplicit(db, { reachOut: true });
    const command = prepareAlreadyContactedCommand(await context(db), "2026-08-28", {
      now: completedAt,
      idFactory: sequenceIdFactory()
    });
    const result = await alreadyContacted(db, command);
    const receipt = createTodayCompletionReceipt(command, result, personBefore);
    await createRepositories(db).followUps.create(followUp({
      id: "follow-up-foreign",
      revision: 1,
      reachOutEntryId: entry!.id,
      dueDate: "2026-09-01",
      createdAt: "2026-08-14T12:00:30.000Z",
      updatedAt: "2026-08-14T12:00:30.000Z"
    }));
    const beforeUndo = await readAllData(db);

    await expect(undoAlreadyContacted(db, receipt, { now: undoAt }))
      .rejects.toBeInstanceOf(StaleRevisionError);
    expect(await readAllData(db)).toEqual(beforeUndo);
  });

  it("rolls every restoration and deletion back when Undo cannot commit", async () => {
    const db = await openDatabase("rollback");
    const { person: personBefore } = await seedExplicit(db);
    const command = prepareAlreadyContactedCommand(await context(db), "2026-08-28", {
      now: completedAt,
      idFactory: sequenceIdFactory()
    });
    const result = await alreadyContacted(db, command);
    const receipt = createTodayCompletionReceipt(command, result, personBefore);
    const completionState = await readAllData(db);
    const completionMetadata = await db.get("metadata", "app");

    await expect(undoAlreadyContacted(db, receipt, {
      now: undoAt,
      beforeCommit: () => { throw new Error("injected Undo failure"); }
    })).rejects.toThrow("injected Undo failure");
    expect(await readAllData(db)).toEqual(completionState);
    expect(await db.get("metadata", "app")).toEqual(completionMetadata);

    await expect(undoAlreadyContacted(db, receipt, { now: undoAt }))
      .resolves.toMatchObject({ alreadyUndone: false });
  });
});
