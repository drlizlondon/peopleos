import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { StaleRevisionError } from "../data/repositories";
import type {
  FollowUp,
  Interaction,
  Person,
  ReachOutEntry
} from "../domain/schema";
import { RELATIONSHIP_ENGINE_POLICY_VERSION } from "../relationship-engine";
import { notToday } from "./followUps";
import {
  alreadyContacted,
  pauseToday,
  prepareAlreadyContactedCommand,
  preparePauseTodayCommand,
  prepareNotTodayFromContext
} from "./todayActions";
import { getTodayActionContext, getTodayScreenProjection } from "./todayQueries";

const now = "2026-08-14T12:00:00.000Z";
const clock = {
  now,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
} as const;
const databaseNames: string[] = [];

function makePerson(patch: Partial<Person> = {}): Person {
  return {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Ahmed",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: "2025-01-01T12:00:00.000Z",
    updatedAt: "2025-01-01T12:00:00.000Z",
    ...patch
  };
}

function makeFollowUp(patch: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "follow-up-primary",
    revision: 1,
    personId: "person-sarah",
    dueDate: "2026-08-14",
    reason: "Send the pilot update",
    actionType: "send_update",
    status: "pending",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...patch
  };
}

function makeEntry(patch: Partial<ReachOutEntry> = {}): ReachOutEntry {
  return {
    id: "reach-out-sarah",
    revision: 1,
    personId: "person-sarah",
    reason: "Share the NHS AI pilot update",
    intendedActionType: "send_update",
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
  return () => `id-${++value}`;
}

async function openDatabase(): Promise<PeopleOsDatabase> {
  const name = `peopleos-v110-actions-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return openPeopleOsDatabase(name, now);
}

async function setDatasetRevision(db: PeopleOsDatabase, revision: number): Promise<void> {
  const metadata = await db.get("metadata", "app");
  await db.put("metadata", { ...metadata!, datasetRevision: revision, updatedAt: now });
}

async function seedExplicit(
  db: PeopleOsDatabase,
  options: { reachOut?: boolean; includeAdditional?: boolean } = {}
): Promise<{ person: Person; primary: FollowUp; additional?: FollowUp; entry?: ReachOutEntry }> {
  const person = makePerson();
  const primary = makeFollowUp(options.reachOut ? { reachOutEntryId: "reach-out-sarah" } : {});
  const additional = options.includeAdditional ? makeFollowUp({
    id: "follow-up-additional",
    reason: "Arrange coffee",
    actionType: "arrange_meeting",
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z"
  }) : undefined;
  const entry = options.reachOut ? makeEntry() : undefined;
  const tx = db.transaction(["people", "followUps", "reachOutEntries"], "readwrite");
  await tx.objectStore("people").add(person);
  await tx.objectStore("followUps").add(primary);
  if (additional) await tx.objectStore("followUps").add(additional);
  if (entry) await tx.objectStore("reachOutEntries").add(entry);
  await tx.done;
  await setDatasetRevision(db, 10);
  return { person, primary, ...(additional ? { additional } : {}), ...(entry ? { entry } : {}) };
}

async function actionContext(db: PeopleOsDatabase, personId = "person-sarah") {
  const context = await getTodayActionContext(db, personId, clock);
  if (!context) throw new Error("Expected a Today action context");
  return context;
}

afterEach(async () => {
  for (const name of databaseNames.splice(0)) await deletePeopleOsDatabase(name);
});

describe("V1-10 Already contacted command", () => {
  it("completes only the primary plan, records contact and creates one copied next plan atomically", async () => {
    const db = await openDatabase();
    const { primary, additional } = await seedExplicit(db, { includeAdditional: true });
    const context = await actionContext(db);
    expect(context.card.item.additionalDueFollowUpIds).toEqual([additional!.id]);
    const command = prepareAlreadyContactedCommand(context, "2026-08-28", {
      now,
      idFactory: sequenceIdFactory()
    });
    const result = await alreadyContacted(db, command);
    expect(result.interaction).toMatchObject({
      kind: "contacted",
      occurredAt: now,
      followUpId: primary.id
    });
    expect(result.completedPrimaryFollowUp).toMatchObject({
      id: primary.id,
      status: "completed",
      completedAt: now,
      revision: 2
    });
    expect(result.nextFollowUp).toMatchObject({
      dueDate: "2026-08-28",
      reason: primary.reason,
      actionType: primary.actionType,
      status: "pending"
    });
    expect(await db.get("followUps", additional!.id)).toEqual(additional);
    expect(await db.get("todaySkips", "person-sarah:2026-08-14")).toEqual(result.todaySkip);
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(11);
    expect((await getTodayScreenProjection(db, clock)).result.totalCount).toBe(0);
    db.close();
  });

  it("is exactly idempotent on retry and increments the dataset revision once", async () => {
    const db = await openDatabase();
    await seedExplicit(db);
    const command = prepareAlreadyContactedCommand(await actionContext(db), "2026-08-21", {
      now,
      idFactory: sequenceIdFactory()
    });
    const first = await alreadyContacted(db, command);
    const retry = await alreadyContacted(db, command);
    expect(retry).toEqual(first);
    expect(await db.count("interactions")).toBe(1);
    expect(await db.count("followUps")).toBe(2);
    expect(await db.count("followUpEvents")).toBe(2);
    expect(await db.count("todaySkips")).toBe(1);
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(11);
    db.close();
  });

  it("creates the rule-owned next plan for a New relationship without inventing a channel", async () => {
    const db = await openDatabase();
    const person = makePerson();
    const interaction: Interaction = {
      id: "interaction-met",
      revision: 1,
      personId: person.id,
      kind: "met",
      occurredAt: "2026-08-06T12:00:00.000Z",
      createdAt: "2026-08-06T12:00:00.000Z",
      updatedAt: "2026-08-06T12:00:00.000Z"
    };
    const tx = db.transaction(["people", "interactions"], "readwrite");
    await tx.objectStore("people").add(person);
    await tx.objectStore("interactions").add(interaction);
    await tx.done;
    await setDatasetRevision(db, 6);
    const context = await actionContext(db);
    expect(context.card.item.eligibilityCode).toBe("new_relationship");
    const result = await alreadyContacted(db, prepareAlreadyContactedCommand(
      context,
      "2026-08-16",
      { now, idFactory: sequenceIdFactory() }
    ));
    expect(result.interaction).not.toHaveProperty("followUpId");
    expect(result.nextFollowUp).toMatchObject({
      reason: "Reconnect with Sarah Ahmed",
      actionType: "other",
      suggestedByRule: "today_already_contacted"
    });
    expect(result.completedPrimaryFollowUp).toBeUndefined();
    expect(await db.count("followUpEvents")).toBe(1);
    db.close();
  });

  it("keeps a generated regular schedule identifiable without marking manual plans", async () => {
    const db = await openDatabase();
    await seedExplicit(db);
    const manualResult = await alreadyContacted(db, prepareAlreadyContactedCommand(
      await actionContext(db),
      "2026-08-21",
      { now, idFactory: sequenceIdFactory() }
    ));
    expect(manualResult.nextFollowUp).not.toHaveProperty("suggestedByRule");
    db.close();

    const generatedDb = await openDatabase();
    await seedExplicit(generatedDb);
    const generatedPrimary = await generatedDb.get("followUps", "follow-up-primary");
    await generatedDb.put("followUps", { ...generatedPrimary!, suggestedByRule: "initial_schedule" });
    const generatedResult = await alreadyContacted(generatedDb, prepareAlreadyContactedCommand(
      await actionContext(generatedDb),
      "2026-08-21",
      { now, idFactory: sequenceIdFactory() }
    ));
    expect(generatedResult.nextFollowUp).toMatchObject({ suggestedByRule: "today_already_contacted" });
    generatedDb.close();
  });

  it("completes and reciprocally relinks the same Reach Out entry before writing the primary completion", async () => {
    const db = await openDatabase();
    const { primary, entry } = await seedExplicit(db, { reachOut: true, includeAdditional: true });
    const command = prepareAlreadyContactedCommand(await actionContext(db), "2026-08-30", {
      now,
      idFactory: sequenceIdFactory()
    });
    const first = await alreadyContacted(db, command);
    const nextFollowUp = first.nextFollowUp;
    if (!nextFollowUp) throw new Error("Expected Reach Out to create its next follow-up");
    expect(first.completedPrimaryFollowUp).toMatchObject({ id: primary.id, status: "completed" });
    expect(first.nextFollowUp).toMatchObject({
      reachOutEntryId: entry!.id,
      dueDate: "2026-08-30",
      reason: primary.reason,
      actionType: primary.actionType
    });
    expect(first.reachOutEntry).toMatchObject({
      id: entry!.id,
      revision: 2,
      intentStatus: "active",
      currentFollowUpId: nextFollowUp.id,
      lastCompletedAt: now
    });
    expect(first.reachOutCompletionEvent).toMatchObject({
      kind: "completed",
      followUpId: primary.id,
      interactionId: first.interaction.id,
      commandFingerprint: command.commandFingerprint
    });
    expect(first.reachOutLinkedEvent).toMatchObject({
      kind: "follow_up_linked",
      followUpId: nextFollowUp.id
    });
    expect(await alreadyContacted(db, command)).toEqual(first);
    expect(await db.count("reachOutEntries")).toBe(1);
    expect(await db.count("reachOutEvents")).toBe(2);
    expect((await db.getAllFromIndex("followUps", "by-reach-out", entry!.id))
      .filter((followUp) => followUp.status === "pending")
      .map((followUp) => followUp.id)).toEqual([nextFollowUp.id]);
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(11);
    db.close();
  });

  it("completes a one-off Reach Out without creating a replacement reminder and is idempotent on retry", async () => {
    const db = await openDatabase();
    const { primary, entry } = await seedExplicit(db, { reachOut: true });
    const command = prepareAlreadyContactedCommand(await actionContext(db), "2026-08-30", {
      now,
      idFactory: sequenceIdFactory(),
      suppressNextFollowUp: true
    });

    const first = await alreadyContacted(db, command);

    expect(first.interaction).toMatchObject({
      kind: "contacted",
      followUpId: primary.id
    });
    expect(first.completedPrimaryFollowUp).toMatchObject({
      id: primary.id,
      status: "completed"
    });
    expect(first.reachOutEntry).toMatchObject({
      id: entry!.id,
      revision: 2,
      intentStatus: "completed",
      lastCompletedAt: now
    });
    expect(first.reachOutEntry).not.toHaveProperty("currentFollowUpId");
    expect(first.reachOutCompletionEvent).toMatchObject({
      kind: "completed",
      followUpId: primary.id,
      interactionId: first.interaction.id,
      commandFingerprint: command.commandFingerprint
    });
    expect(first.nextFollowUp).toBeUndefined();
    expect(first.nextFollowUpEvent).toBeUndefined();
    expect(first.reachOutLinkedEvent).toBeUndefined();

    expect(await alreadyContacted(db, command)).toEqual(first);
    expect(await db.count("interactions")).toBe(1);
    expect(await db.count("followUps")).toBe(1);
    expect(await db.count("followUpEvents")).toBe(1);
    expect(await db.count("reachOutEvents")).toBe(1);
    expect((await db.getAllFromIndex("followUps", "by-reach-out", entry!.id))
      .filter((followUp) => followUp.status === "pending")).toEqual([]);
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(11);
    db.close();
  });

  it("restarts a paused Keep in touch interval from a genuine Contacted action", async () => {
    const db = await openDatabase();
    const person = makePerson({
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-08-01",
      contactCadenceDeferredUntilDate: "2026-09-30",
      contactCadencePausedAt: "2026-08-01T12:00:00.000Z"
    });
    const primary = makeFollowUp();
    const tx = db.transaction(["people", "followUps"], "readwrite");
    await tx.objectStore("people").add(person);
    await tx.objectStore("followUps").add(primary);
    await tx.done;
    await setDatasetRevision(db, 10);
    const command = prepareAlreadyContactedCommand(await actionContext(db), "2026-08-28", {
      now,
      idFactory: sequenceIdFactory(),
      suppressNextFollowUp: true
    });

    await alreadyContacted(db, command);

    const saved = await db.get("people", person.id);
    expect(saved).toMatchObject({
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-08-01",
      revision: 2,
      updatedAt: now
    });
    expect(saved).not.toHaveProperty("contactCadenceDeferredUntilDate");
    expect(saved).not.toHaveProperty("contactCadencePausedAt");
    const afterContact = await getTodayScreenProjection(db, clock);
    expect(afterContact.result.totalCount).toBe(0);
    const nextInterval = await getTodayScreenProjection(db, {
      ...clock,
      now: "2026-08-28T12:00:00.000Z"
    });
    expect(nextInterval.cards.map((card) => card.person.id)).toEqual([person.id]);

    expect(await alreadyContacted(db, command)).toEqual(expect.objectContaining({
      interaction: expect.objectContaining({ kind: "contacted" })
    }));
    expect((await db.get("people", person.id))?.revision).toBe(2);
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(11);
    db.close();
  });

  it("rolls back every generic artifact and retains no partial history on failure", async () => {
    const db = await openDatabase();
    await seedExplicit(db, { includeAdditional: true });
    const before = await readAllData(db);
    const metadataBefore = await db.get("metadata", "app");
    const command = prepareAlreadyContactedCommand(await actionContext(db), "2026-08-21", {
      now,
      idFactory: sequenceIdFactory()
    });
    await expect(alreadyContacted(db, command, {
      beforeCommit: () => { throw new Error("injected failure"); }
    })).rejects.toThrow("injected failure");
    expect(await readAllData(db)).toEqual(before);
    expect(await db.get("metadata", "app")).toEqual(metadataBefore);
    db.close();
  });

  it("rolls back the Reach Out completion and reciprocal replacement together", async () => {
    const db = await openDatabase();
    await seedExplicit(db, { reachOut: true });
    const before = await readAllData(db);
    const metadataBefore = await db.get("metadata", "app");
    const command = prepareAlreadyContactedCommand(await actionContext(db), "2026-08-21", {
      now,
      idFactory: sequenceIdFactory()
    });
    await expect(alreadyContacted(db, command, {
      beforeCommit: () => { throw new Error("injected linked failure"); }
    })).rejects.toThrow("injected linked failure");
    expect(await readAllData(db)).toEqual(before);
    expect(await db.get("metadata", "app")).toEqual(metadataBefore);
    db.close();
  });

  it("rejects a stale snapshot without writing any action artifact", async () => {
    const db = await openDatabase();
    await seedExplicit(db);
    const command = prepareAlreadyContactedCommand(await actionContext(db), "2026-08-21", {
      now,
      idFactory: sequenceIdFactory()
    });
    await setDatasetRevision(db, 11);
    await expect(alreadyContacted(db, command)).rejects.toBeInstanceOf(StaleRevisionError);
    expect(await db.count("interactions")).toBe(0);
    expect(await db.count("followUpEvents")).toBe(0);
    expect(await db.count("todaySkips")).toBe(0);
    db.close();
  });

  it("prepares the V1-07 Not today primitive from the same fresh Today context", async () => {
    const db = await openDatabase();
    const { primary, additional } = await seedExplicit(db, { includeAdditional: true });
    const command = prepareNotTodayFromContext(await actionContext(db), {
      now,
      idFactory: sequenceIdFactory()
    });
    expect(command).toMatchObject({
      eligibilityCode: "explicit_follow_up",
      primaryFollowUpId: primary.id,
      expectedDatasetRevision: 10,
      localDate: "2026-08-14",
      tomorrowDate: "2026-08-15"
    });
    await notToday(db, command);
    expect(await db.get("followUps", primary.id)).toMatchObject({
      snoozedUntilDate: "2026-08-15",
      status: "pending"
    });
    expect(await db.get("followUps", additional!.id)).toEqual(additional);
    expect(await db.count("interactions")).toBe(0);
    db.close();
  });

  it("pauses the whole Person until the chosen date without changing frequency or contact history", async () => {
    const db = await openDatabase();
    const { person, primary, additional } = await seedExplicit(db, { includeAdditional: true });
    await db.put("people", { ...person, contactCadence: { value: 1, unit: "weeks" } });
    const beforeFollowUps = await db.getAllFromIndex("followUps", "by-person", person.id);
    const command = preparePauseTodayCommand(await actionContext(db), "2026-08-21", { now });

    const first = await pauseToday(db, command);
    expect(await pauseToday(db, command)).toEqual(first);
    expect(first.person).toMatchObject({
      id: person.id,
      revision: 2,
      contactCadence: { value: 1, unit: "weeks" },
      todayPausedUntilDate: "2026-08-21"
    });
    expect(first.todaySkip).toMatchObject({
      id: "person-sarah:2026-08-14",
      personId: person.id,
      localDate: "2026-08-14"
    });
    expect(await db.getAllFromIndex("followUps", "by-person", person.id)).toEqual(beforeFollowUps);
    expect(await db.get("followUps", primary.id)).toEqual(primary);
    expect(await db.get("followUps", additional!.id)).toEqual(additional);
    expect(await db.count("followUpEvents")).toBe(0);
    expect(await db.count("interactions")).toBe(0);
    expect((await db.get("metadata", "app"))?.datasetRevision).toBe(11);

    expect((await getTodayScreenProjection(db, clock)).result.totalCount).toBe(0);
    expect((await getTodayScreenProjection(db, {
      ...clock,
      now: "2026-08-20T12:00:00.000Z"
    })).result.totalCount).toBe(0);
    expect((await getTodayScreenProjection(db, {
      ...clock,
      now: "2026-08-21T12:00:00.000Z"
    })).cards.map((card) => card.person.id)).toEqual([person.id]);
    db.close();
  });

  it("validates the Pause date and rolls back the Person, skip and metadata together", async () => {
    const db = await openDatabase();
    await seedExplicit(db);
    const context = await actionContext(db);
    expect(() => preparePauseTodayCommand(context, "2026-08-14", { now })).toThrow("Choose a date after today.");

    const before = await readAllData(db);
    const metadataBefore = await db.get("metadata", "app");
    const command = preparePauseTodayCommand(context, "2026-08-21", { now });
    await expect(pauseToday(db, command, {
      beforeCommit: () => { throw new Error("injected pause failure"); }
    })).rejects.toThrow("injected pause failure");
    expect(await readAllData(db)).toEqual(before);
    expect(await db.get("metadata", "app")).toEqual(metadataBefore);
    db.close();
  });
});
