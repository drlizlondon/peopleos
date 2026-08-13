import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { generateBackup, previewBackup, restoreBackup } from "../data/backup";
import { createRepositories, RecordConflictError, StaleRevisionError } from "../data/repositories";
import type { FollowUp, Person, TodaySkip } from "../domain/schema";
import { ValidationError } from "../domain/validation";
import {
  ReachOutOwnedFollowUpError,
  cancelFollowUp,
  completeFollowUpWithContact,
  completeFollowUpWithoutContact,
  createCancelFollowUpCommand,
  createCompleteFollowUpWithContactCommand,
  createCompleteFollowUpWithoutContactCommand,
  createFollowUp,
  createFollowUpDraft,
  createNotTodayCommand,
  createRescheduleFollowUpCommand,
  createSnoozeFollowUpCommand,
  notToday,
  rescheduleFollowUp,
  snoozeFollowUp,
  updateContactCadence,
  type FollowUpDraft
} from "./followUps";

const fixedNow = "2026-08-01T09:00:00.000Z";
const later = "2026-08-02T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-one",
    revision: 1,
    displayName: "Sarah Ahmed",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides
  };
}

function sequence(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `extra-${index}`;
}

async function openDatabase(label: string, personOverrides: Partial<Person> = {}): Promise<PeopleOsDatabase> {
  const name = `peopleos-follow-ups-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  await createRepositories(db).people.create(person(personOverrides));
  return db;
}

function draft(overrides: Partial<FollowUpDraft> = {}): FollowUpDraft {
  return {
    id: "follow-up-one",
    createdEventId: "follow-up-event-created-one",
    personId: "person-one",
    reason: "Send the pilot update",
    actionType: "send_update",
    dueDate: "2026-08-08",
    createdAt: fixedNow,
    ...overrides
  };
}

async function storedFollowUp(db: PeopleOsDatabase, overrides: Partial<FollowUpDraft> = {}): Promise<FollowUp> {
  return createFollowUp(db, draft(overrides), { localDate: "2026-08-01" });
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("Follow-up commands", () => {
  it("creates a plan and lifecycle event atomically, trims its reason, and makes exact retry a no-op", async () => {
    const db = await openDatabase("create-retry");
    const generated = createFollowUpDraft("person-one", {
      now: fixedNow,
      dueDate: "2026-08-08",
      idFactory: sequence("draft", "draft-created")
    });
    expect(generated).toMatchObject({
      id: "follow-up-draft",
      createdEventId: "follow-up-event-draft-created",
      personId: "person-one"
    });
    const stable = draft({ reason: "  Send the pilot update  ", actionType: "research_contact_route" });
    const before = (await db.get("metadata", "app"))!.datasetRevision;

    const first = await createFollowUp(db, stable, { localDate: "2026-08-01" });
    const retry = await createFollowUp(db, stable, { localDate: "2026-08-01" });

    expect(retry).toEqual(first);
    expect(first).toMatchObject({ reason: "Send the pilot update", actionType: "research_contact_route" });
    expect(await db.getAll("followUpEvents")).toEqual([expect.objectContaining({
      kind: "created", toDate: "2026-08-08", followUpId: first.id
    })]);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(before + 1);
  });

  it("derives fallback dates in the injected local timezone", async () => {
    const nearMidnight = "2026-03-29T23:30:00.000Z";
    const generated = createFollowUpDraft("person-one", {
      now: nearMidnight,
      timeZone: "Europe/London",
      idFactory: sequence("local-draft", "local-event")
    });
    expect(generated.dueDate).toBe("2026-03-30");

    const db = await openDatabase("local-date");
    await expect(createFollowUp(db, {
      ...generated,
      reason: "Reconnect after midnight",
      dueDate: "2026-03-29"
    }, { timeZone: "Europe/London" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps an exact create retry idempotent after the FollowUp advances", async () => {
    const db = await openDatabase("create-late-retry");
    const stable = draft();
    const created = await createFollowUp(db, stable, { localDate: "2026-08-01" });
    const snoozed = await snoozeFollowUp(db, createSnoozeFollowUpCommand(created, "2026-08-10", {
      now: later,
      idFactory: () => "later-snooze"
    }));
    const beforeRetry = (await db.get("metadata", "app"))!.datasetRevision;

    expect(await createFollowUp(db, stable, { localDate: "2026-08-01" })).toEqual(snoozed);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(beforeRetry);
    expect(await db.count("followUpEvents")).toBe(2);
  });

  it("rejects incomplete, overlong, past, colliding, archived-owner and invalid action creates", async () => {
    const db = await openDatabase("create-validation");
    const invalid = [
      draft({ id: "blank", createdEventId: "event-blank", reason: "   " }),
      draft({ id: "long", createdEventId: "event-long", reason: "x".repeat(241) }),
      draft({ id: "past", createdEventId: "event-past", dueDate: "2026-07-31" }),
      draft({ id: "action", createdEventId: "event-action", actionType: "unsupported" as never })
    ];
    for (const value of invalid) {
      await expect(createFollowUp(db, value, { localDate: "2026-08-01" })).rejects.toBeInstanceOf(ValidationError);
    }
    await createFollowUp(db, draft(), { localDate: "2026-08-01" });
    await expect(createFollowUp(db, draft({ reason: "A different command" }), { localDate: "2026-08-01" }))
      .rejects.toBeInstanceOf(RecordConflictError);

    const archived = await openDatabase("archived", { archivedAt: fixedNow });
    await expect(createFollowUp(archived, draft(), { localDate: "2026-08-01" }))
      .rejects.toBeInstanceOf(RecordConflictError);
  });

  it("rolls back a compound create without orphaned events when commit fails", async () => {
    const db = await openDatabase("create-rollback");
    await expect(createFollowUp(db, draft(), {
      localDate: "2026-08-01",
      beforeCommit: () => { throw new Error("forced rollback"); }
    })).rejects.toThrow("forced rollback");
    expect(await db.count("followUps")).toBe(0);
    expect(await db.count("followUpEvents")).toBe(0);
  });

  it("snoozes the same record, preserves its original date, and retries without another event", async () => {
    const db = await openDatabase("snooze");
    const followUp = await storedFollowUp(db);
    const command = createSnoozeFollowUpCommand(followUp, "2026-08-10", {
      now: later, idFactory: () => "snooze"
    });
    const moved = await snoozeFollowUp(db, command);
    const retry = await snoozeFollowUp(db, command);

    expect(retry).toEqual(moved);
    expect(moved).toMatchObject({ id: followUp.id, dueDate: "2026-08-08", snoozedUntilDate: "2026-08-10", revision: 2 });
    expect((await db.getAllFromIndex("followUpEvents", "by-follow-up", followUp.id))
      .filter((event) => event.kind === "snoozed")).toHaveLength(1);
    await expect(snoozeFollowUp(db, { ...command, toDate: "2026-08-11" }))
      .rejects.toBeInstanceOf(RecordConflictError);
    await expect(snoozeFollowUp(db, { ...command, eventId: "another-event", expectedRevision: 1 }))
      .rejects.toBeInstanceOf(StaleRevisionError);
  });

  it("rolls back snooze without changing the snapshot or appending history", async () => {
    const db = await openDatabase("snooze-rollback");
    const followUp = await storedFollowUp(db);
    const command = createSnoozeFollowUpCommand(followUp, "2026-08-10", {
      now: later,
      idFactory: () => "snooze-rollback"
    });

    await expect(snoozeFollowUp(db, command, {
      beforeCommit: () => { throw new Error("snooze rollback"); }
    })).rejects.toThrow("snooze rollback");
    expect(await db.get("followUps", followUp.id)).toEqual(followUp);
    expect((await db.getAllFromIndex("followUpEvents", "by-follow-up", followUp.id))
      .map((event) => event.kind)).toEqual(["created"]);
  });

  it("retains each lifecycle event across two successive snoozes without changing the original due date", async () => {
    const db = await openDatabase("successive-snoozes");
    const original = await storedFollowUp(db);
    const first = await snoozeFollowUp(db, createSnoozeFollowUpCommand(original, "2026-08-10", {
      now: later, idFactory: () => "first-snooze"
    }));
    const second = await snoozeFollowUp(db, createSnoozeFollowUpCommand(first, "2026-08-12", {
      now: "2026-08-03T09:00:00.000Z", idFactory: () => "second-snooze"
    }));
    const events = (await db.getAllFromIndex("followUpEvents", "by-follow-up", original.id))
      .filter((event) => event.kind === "snoozed");
    expect(second).toMatchObject({ dueDate: "2026-08-08", snoozedUntilDate: "2026-08-12", revision: 3 });
    expect(events).toEqual([
      expect.objectContaining({ fromDate: "2026-08-08", toDate: "2026-08-10" }),
      expect.objectContaining({ fromDate: "2026-08-10", toDate: "2026-08-12" })
    ]);
  });

  it("reschedules by superseding the original and creating one reciprocal replacement", async () => {
    const db = await openDatabase("reschedule");
    const followUp = await storedFollowUp(db);
    const command = createRescheduleFollowUpCommand(followUp, {
      dueDate: "2026-08-20",
      reason: "Arrange the pilot meeting",
      actionType: "arrange_meeting"
    }, { now: later, idFactory: sequence("event-reschedule", "replacement") });
    const first = await rescheduleFollowUp(db, command, { localDate: "2026-08-01" });
    const retry = await rescheduleFollowUp(db, command, { localDate: "2026-08-01" });

    expect(retry).toEqual(first);
    expect(first.original).toMatchObject({ status: "superseded", supersededByFollowUpId: "follow-up-replacement" });
    expect(first.replacement).toMatchObject({ status: "pending", supersedesFollowUpId: followUp.id, dueDate: "2026-08-20" });
    expect((await db.getAllFromIndex("followUpEvents", "by-follow-up", first.replacement.id))).toHaveLength(0);
    expect((await db.getAllFromIndex("followUpEvents", "by-follow-up", followUp.id))
      .filter((event) => event.kind === "rescheduled")).toHaveLength(1);
    await expect(rescheduleFollowUp(db, {
      ...command,
      replacement: { ...command.replacement, dueDate: "2026-08-21" }
    }, { localDate: "2026-08-01" })).rejects.toBeInstanceOf(RecordConflictError);
  });

  it("rejects a stale reschedule without creating a replacement", async () => {
    const db = await openDatabase("reschedule-stale");
    const original = await storedFollowUp(db);
    const stale = createRescheduleFollowUpCommand(original, { dueDate: "2026-08-20" }, {
      now: "2026-08-03T09:00:00.000Z",
      idFactory: sequence("stale-reschedule", "stale-replacement")
    });
    await snoozeFollowUp(db, createSnoozeFollowUpCommand(original, "2026-08-10", {
      now: later,
      idFactory: () => "prior-snooze"
    }));

    await expect(rescheduleFollowUp(db, stale, { localDate: "2026-08-01" }))
      .rejects.toBeInstanceOf(StaleRevisionError);
    expect(await db.get("followUps", "follow-up-stale-replacement")).toBeUndefined();
  });

  it("rolls back reschedule and completion compound writes after an injected failure", async () => {
    const rescheduleDb = await openDatabase("reschedule-rollback");
    const original = await storedFollowUp(rescheduleDb);
    const reschedule = createRescheduleFollowUpCommand(original, { dueDate: "2026-08-20" }, {
      now: later, idFactory: sequence("rollback-reschedule", "rollback-replacement")
    });
    await expect(rescheduleFollowUp(rescheduleDb, reschedule, {
      localDate: "2026-08-01",
      beforeCommit: () => { throw new Error("reschedule rollback"); }
    })).rejects.toThrow("reschedule rollback");
    expect(await rescheduleDb.get("followUps", original.id)).toEqual(original);
    expect(await rescheduleDb.get("followUps", "follow-up-rollback-replacement")).toBeUndefined();
    expect((await rescheduleDb.getAllFromIndex("followUpEvents", "by-follow-up", original.id))
      .map((event) => event.kind)).toEqual(["created"]);

    const completionDb = await openDatabase("completion-rollback");
    const pending = await storedFollowUp(completionDb);
    const completion = createCompleteFollowUpWithContactCommand(pending, { kind: "phone_call" }, {
      now: later, idFactory: sequence("rollback-complete", "rollback-interaction")
    });
    await expect(completeFollowUpWithContact(completionDb, completion, {
      beforeCommit: () => { throw new Error("completion rollback"); }
    })).rejects.toThrow("completion rollback");
    expect(await completionDb.get("followUps", pending.id)).toEqual(pending);
    expect(await completionDb.count("interactions")).toBe(0);
    expect((await completionDb.getAllFromIndex("followUpEvents", "by-follow-up", pending.id))
      .map((event) => event.kind)).toEqual(["created"]);

    const withoutContactDb = await openDatabase("completion-without-rollback");
    const withoutContactPending = await storedFollowUp(withoutContactDb);
    const withoutContactCommand = createCompleteFollowUpWithoutContactCommand(withoutContactPending, {
      now: later,
      idFactory: sequence("rollback-without", "rollback-without-interaction")
    });
    await expect(completeFollowUpWithoutContact(withoutContactDb, withoutContactCommand, {
      beforeCommit: () => { throw new Error("without-contact rollback"); }
    })).rejects.toThrow("without-contact rollback");
    expect(await withoutContactDb.get("followUps", withoutContactPending.id)).toEqual(withoutContactPending);
    expect(await withoutContactDb.count("interactions")).toBe(0);
    expect((await withoutContactDb.getAllFromIndex("followUpEvents", "by-follow-up", withoutContactPending.id))
      .map((event) => event.kind)).toEqual(["created"]);
  });

  it("cancels once and makes terminal records read-only", async () => {
    const db = await openDatabase("cancel");
    const followUp = await storedFollowUp(db);
    const command = createCancelFollowUpCommand(followUp, { now: later, idFactory: () => "cancel" });
    const cancelled = await cancelFollowUp(db, command);
    expect(await cancelFollowUp(db, command)).toEqual(cancelled);
    expect(cancelled.status).toBe("cancelled");
    await expect(cancelFollowUp(db, { ...command, occurredAt: "2026-08-03T09:00:00.000Z" }))
      .rejects.toBeInstanceOf(RecordConflictError);
    await expect(snoozeFollowUp(db, createSnoozeFollowUpCommand(cancelled, "2026-08-20", {
      now: "2026-08-03T09:00:00.000Z", idFactory: () => "terminal"
    }))).rejects.toBeInstanceOf(RecordConflictError);
  });

  it("rejects stale cancellation and rolls back an interrupted cancellation", async () => {
    const staleDb = await openDatabase("cancel-stale");
    const staleOriginal = await storedFollowUp(staleDb);
    const staleCommand = createCancelFollowUpCommand(staleOriginal, {
      now: "2026-08-03T09:00:00.000Z",
      idFactory: () => "stale-cancel"
    });
    await snoozeFollowUp(staleDb, createSnoozeFollowUpCommand(staleOriginal, "2026-08-10", {
      now: later,
      idFactory: () => "cancel-prior-snooze"
    }));
    await expect(cancelFollowUp(staleDb, staleCommand)).rejects.toBeInstanceOf(StaleRevisionError);

    const rollbackDb = await openDatabase("cancel-rollback");
    const rollbackOriginal = await storedFollowUp(rollbackDb);
    const rollbackCommand = createCancelFollowUpCommand(rollbackOriginal, {
      now: later,
      idFactory: () => "rollback-cancel"
    });
    await expect(cancelFollowUp(rollbackDb, rollbackCommand, {
      beforeCommit: () => { throw new Error("cancel rollback"); }
    })).rejects.toThrow("cancel rollback");
    expect(await rollbackDb.get("followUps", rollbackOriginal.id)).toEqual(rollbackOriginal);
    expect((await rollbackDb.getAllFromIndex("followUpEvents", "by-follow-up", rollbackOriginal.id))
      .map((event) => event.kind)).toEqual(["created"]);
  });

  it("completes with contact using one linked contact-counting Interaction", async () => {
    const db = await openDatabase("complete-contact");
    const followUp = await storedFollowUp(db);
    const command = createCompleteFollowUpWithContactCommand(followUp, {
      kind: "email",
      occurredAt: "2026-08-02T08:30:00.000Z",
      summary: "  Shared the update  "
    }, { now: later, idFactory: sequence("complete", "contact") });
    const first = await completeFollowUpWithContact(db, command);
    const retry = await completeFollowUpWithContact(db, command);

    expect(retry).toEqual(first);
    expect(first.followUp).toMatchObject({ status: "completed", completedAt: later });
    expect(first.interaction).toMatchObject({
      id: "interaction-contact", kind: "email", followUpId: followUp.id, summary: "Shared the update"
    });
    expect(first.event).toMatchObject({ kind: "completed_with_contact", interactionId: first.interaction.id });
    expect(await db.count("interactions")).toBe(1);
    await expect(completeFollowUpWithContact(db, { ...command, summary: "Different retry payload" }))
      .rejects.toBeInstanceOf(RecordConflictError);
    await expect(completeFollowUpWithContact(db, {
      ...command,
      eventId: "other-event",
      interactionId: "other-interaction",
      interactionKind: "introduction_made"
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it("completes without contact using one non-contact Interaction", async () => {
    const db = await openDatabase("complete-without-contact");
    const followUp = await storedFollowUp(db);
    const command = createCompleteFollowUpWithoutContactCommand(followUp, {
      now: later, idFactory: sequence("complete-without", "system")
    });
    const result = await completeFollowUpWithoutContact(db, command);
    const retry = await completeFollowUpWithoutContact(db, command);

    expect(retry).toEqual(result);
    expect(result.followUp.status).toBe("completed");
    expect(result.interaction).toMatchObject({ kind: "follow_up_completed", followUpId: followUp.id });
    expect(result.event.kind).toBe("completed_without_contact");
    await expect(completeFollowUpWithoutContact(db, {
      ...command,
      occurredAt: "2026-08-03T09:00:00.000Z"
    })).rejects.toBeInstanceOf(RecordConflictError);
  });

  it("rejects a stale completion without creating an Interaction", async () => {
    const db = await openDatabase("completion-stale");
    const original = await storedFollowUp(db);
    const command = createCompleteFollowUpWithoutContactCommand(original, {
      now: "2026-08-03T09:00:00.000Z",
      idFactory: sequence("stale-completion", "stale-completion-interaction")
    });
    await snoozeFollowUp(db, createSnoozeFollowUpCommand(original, "2026-08-10", {
      now: later,
      idFactory: () => "completion-prior-snooze"
    }));

    await expect(completeFollowUpWithoutContact(db, command)).rejects.toBeInstanceOf(StaleRevisionError);
    expect(await db.count("interactions")).toBe(0);
  });

  it("requires a real or scheduled anchor before the legacy cadence command can enable Regular contact", async () => {
    const db = await openDatabase("cadence");
    const current = (await db.get("people", "person-one"))!;
    const command = { personId: current.id, expectedRevision: current.revision, cadenceDays: 90, occurredAt: later };
    await expect(updateContactCadence(db, command)).rejects.toThrow(/Today or Tomorrow to start regular contact/);
    expect((await db.get("people", current.id))?.contactCadence).toBeUndefined();

    await createRepositories(db).interactions.create({
      id: "interaction-cadence-anchor",
      revision: 1,
      personId: current.id,
      kind: "contacted",
      occurredAt: fixedNow,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const updated = await updateContactCadence(db, command);
    expect(await updateContactCadence(db, command)).toEqual(updated);
    expect(updated).toMatchObject({ contactCadence: { value: 90, unit: "days" }, revision: current.revision + 1 });
    expect(updated.contactCadenceDays).toBeUndefined();
    expect(await db.count("followUps")).toBe(0);

    const removed = await updateContactCadence(db, {
      personId: current.id,
      expectedRevision: updated.revision,
      cadenceDays: undefined,
      occurredAt: "2026-08-03T09:00:00.000Z"
    });
    expect(removed.contactCadence).toBeUndefined();
    expect(removed.contactCadenceDays).toBeUndefined();
    const custom = await updateContactCadence(db, {
      personId: current.id, expectedRevision: removed.revision, cadence: { value: 4, unit: "weeks" },
      occurredAt: "2026-08-04T09:00:00.000Z"
    });
    expect(custom.contactCadence).toEqual({ value: 4, unit: "weeks" });
    expect(custom.contactCadenceDays).toBeUndefined();
    await expect(updateContactCadence(db, {
      personId: current.id, expectedRevision: custom.revision, cadenceDays: 3_651, occurredAt: later
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateContactCadence(db, {
      personId: current.id, expectedRevision: custom.revision, cadenceDays: 0, occurredAt: later
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it("Not today snoozes only the named due FollowUp, writes one day skip, and is idempotent", async () => {
    const db = await openDatabase("not-today-explicit");
    const due = await storedFollowUp(db, { dueDate: "2026-08-01" });
    const other = await storedFollowUp(db, {
      id: "follow-up-other",
      createdEventId: "follow-up-event-created-other",
      dueDate: "2026-08-01",
      reason: "Another independent promise"
    });
    const currentPerson = (await db.get("people", "person-one"))!;
    const metadata = (await db.get("metadata", "app"))!;
    const command = createNotTodayCommand(currentPerson, {
      localDate: "2026-08-01",
      eligibilityCode: "explicit_follow_up",
      primaryFollowUp: due,
      expectedDatasetRevision: metadata.datasetRevision,
      now: fixedNow,
      idFactory: () => "not-today"
    });
    const result = await notToday(db, command);
    expect(await notToday(db, command)).toEqual(result);
    expect(result.followUp).toMatchObject({ id: due.id, snoozedUntilDate: "2026-08-02" });
    expect(result.todaySkip.id).toBe("person-one:2026-08-01");
    expect(await db.get("followUps", other.id)).toEqual(other);
    expect(await db.count("interactions")).toBe(0);
    await expect(notToday(db, { ...command, occurredAt: "2026-08-01T10:00:00.000Z" }))
      .rejects.toBeInstanceOf(RecordConflictError);
  });

  it("Not today reuses an existing valid skip while adding its plan and history", async () => {
    const db = await openDatabase("not-today-reuse-skip");
    const existingSkip: TodaySkip = {
      id: "person-one:2026-08-01",
      personId: "person-one",
      localDate: "2026-08-01",
      createdAt: "2026-08-01T08:00:00.000Z"
    };
    await db.add("todaySkips", existingSkip);
    const currentPerson = (await db.get("people", "person-one"))!;
    const metadata = (await db.get("metadata", "app"))!;
    const command = createNotTodayCommand(currentPerson, {
      localDate: "2026-08-01",
      eligibilityCode: "new_relationship",
      expectedDatasetRevision: metadata.datasetRevision,
      now: fixedNow,
      idFactory: sequence("event", "new-plan")
    });
    const result = await notToday(db, command);
    expect(result.todaySkip).toEqual(existingSkip);
    expect(result.followUp).toMatchObject({
      id: "follow-up-new-plan",
      dueDate: "2026-08-02",
      reason: "Reconnect with Sarah Ahmed",
      actionType: "other",
      suggestedByRule: "today_not_today"
    });
    expect(await db.count("todaySkips")).toBe(1);
  });

  it("keeps old Not today retries idempotent after their FollowUp advances", async () => {
    const db = await openDatabase("not-today-late-retry");
    const currentPerson = (await db.get("people", "person-one"))!;
    const metadata = (await db.get("metadata", "app"))!;
    const command = createNotTodayCommand(currentPerson, {
      localDate: "2026-08-01",
      eligibilityCode: "new_relationship",
      expectedDatasetRevision: metadata.datasetRevision,
      now: fixedNow,
      idFactory: sequence("late-retry-event", "late-retry-plan")
    });
    const first = await notToday(db, command);
    const advanced = await snoozeFollowUp(db, createSnoozeFollowUpCommand(first.followUp, "2026-08-03", {
      now: later,
      idFactory: () => "advance"
    }));
    const beforeRetry = (await db.get("metadata", "app"))!.datasetRevision;
    const retry = await notToday(db, command);

    expect(retry.followUp).toEqual(advanced);
    expect(retry.todaySkip).toEqual(first.todaySkip);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(beforeRetry);
    expect(await db.count("todaySkips")).toBe(1);
    expect(await db.count("followUpEvents")).toBe(2);
  });

  it("Not today defers a due Keep in touch reminder without changing its interval or recording contact", async () => {
    const db = await openDatabase("not-today-cadence");
    const currentPerson = (await db.get("people", "person-one"))!;
    const cadencePerson = {
      ...currentPerson,
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-08-01"
    };
    await db.put("people", cadencePerson);
    const metadata = (await db.get("metadata", "app"))!;
    const command = createNotTodayCommand(cadencePerson, {
      localDate: "2026-08-01",
      eligibilityCode: "cadence_due",
      expectedDatasetRevision: metadata.datasetRevision,
      now: fixedNow,
      idFactory: sequence("cadence-event", "cadence-plan")
    });

    const result = await notToday(db, command);

    expect(result.followUp).toMatchObject({ dueDate: "2026-08-02", status: "pending" });
    expect(await db.get("people", cadencePerson.id)).toMatchObject({
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-08-01"
    });
    expect(await db.count("interactions")).toBe(0);
  });

  it("Not today rejects stale assessment and rolls every child back on failure", async () => {
    const db = await openDatabase("not-today-freshness");
    const currentPerson = (await db.get("people", "person-one"))!;
    const metadata = (await db.get("metadata", "app"))!;
    const stale = createNotTodayCommand(currentPerson, {
      localDate: "2026-08-01",
      eligibilityCode: "cadence_due",
      expectedDatasetRevision: metadata.datasetRevision - 1,
      now: fixedNow,
      idFactory: sequence("stale-event", "stale-plan")
    });
    await expect(notToday(db, stale)).rejects.toBeInstanceOf(StaleRevisionError);

    const command = createNotTodayCommand(currentPerson, {
      localDate: "2026-08-01",
      eligibilityCode: "cadence_due",
      expectedDatasetRevision: metadata.datasetRevision,
      now: fixedNow,
      idFactory: sequence("rollback-event", "rollback-plan")
    });
    await expect(notToday(db, command, {
      beforeCommit: () => { throw new Error("forced rollback"); }
    })).rejects.toThrow("forced rollback");
    expect(await db.count("followUps")).toBe(0);
    expect(await db.count("followUpEvents")).toBe(0);
    expect(await db.count("todaySkips")).toBe(0);
  });

  it("permits linked snooze but guards linked replace, cancel and completion until Reach Out owns them", async () => {
    const db = await openDatabase("reach-out-guard");
    const unlinked = await storedFollowUp(db);
    const linked = { ...unlinked, reachOutEntryId: "reach-out-one" };
    await db.put("followUps", linked);
    const snoozed = await snoozeFollowUp(db, createSnoozeFollowUpCommand(linked, "2026-08-10", {
      now: later, idFactory: () => "linked-snooze"
    }));
    expect(snoozed.snoozedUntilDate).toBe("2026-08-10");

    await expect(rescheduleFollowUp(db, createRescheduleFollowUpCommand(snoozed, {
      dueDate: "2026-08-20"
    }, { now: "2026-08-03T09:00:00.000Z", idFactory: sequence("linked-reschedule", "linked-replacement") }), {
      localDate: "2026-08-01"
    })).rejects.toBeInstanceOf(ReachOutOwnedFollowUpError);
    await expect(cancelFollowUp(db, createCancelFollowUpCommand(snoozed, {
      now: "2026-08-03T09:00:00.000Z", idFactory: () => "linked-cancel"
    }))).rejects.toBeInstanceOf(ReachOutOwnedFollowUpError);
    await expect(completeFollowUpWithoutContact(db, createCompleteFollowUpWithoutContactCommand(snoozed, {
      now: "2026-08-03T09:00:00.000Z", idFactory: sequence("linked-complete", "linked-interaction")
    }))).rejects.toBeInstanceOf(ReachOutOwnedFollowUpError);
  });

  it("round-trips every V1-07 FollowUp lifecycle state through backup and restore", async () => {
    const source = await openDatabase("backup-source");
    const snoozedBase = await storedFollowUp(source, {
      id: "pending-snoozed", createdEventId: "event-pending-snoozed", dueDate: "2026-08-08"
    });
    await snoozeFollowUp(source, createSnoozeFollowUpCommand(snoozedBase, "2026-08-10", {
      now: later, idFactory: () => "backup-snooze"
    }));

    const withContact = await storedFollowUp(source, {
      id: "complete-with-contact", createdEventId: "event-complete-with-contact", dueDate: "2026-08-09"
    });
    await completeFollowUpWithContact(source, createCompleteFollowUpWithContactCommand(withContact, {
      kind: "email"
    }, { now: later, idFactory: sequence("backup-contact-complete", "backup-contact") }));

    const withoutContact = await storedFollowUp(source, {
      id: "complete-without-contact", createdEventId: "event-complete-without-contact", dueDate: "2026-08-10"
    });
    await completeFollowUpWithoutContact(source, createCompleteFollowUpWithoutContactCommand(withoutContact, {
      now: later, idFactory: sequence("backup-without-complete", "backup-without")
    }));

    const cancellable = await storedFollowUp(source, {
      id: "cancelled", createdEventId: "event-cancelled", dueDate: "2026-08-11"
    });
    await cancelFollowUp(source, createCancelFollowUpCommand(cancellable, {
      now: later, idFactory: () => "backup-cancel"
    }));

    const original = await storedFollowUp(source, {
      id: "superseded", createdEventId: "event-superseded", dueDate: "2026-08-12"
    });
    await rescheduleFollowUp(source, createRescheduleFollowUpCommand(original, {
      dueDate: "2026-08-20"
    }, { now: later, idFactory: sequence("backup-reschedule", "backup-replacement") }), {
      localDate: "2026-08-01"
    });

    const generated = await generateBackup(source, "2026-08-03T09:00:00.000Z");
    const target = await openDatabase("backup-target");
    await restoreBackup(target, previewBackup(generated.json), "2026-08-04T09:00:00.000Z");
    expect(await readAllData(target)).toEqual(generated.envelope.data);
    expect(generated.envelope.data.followUps.map((record) => record.status).sort()).toEqual([
      "cancelled", "completed", "completed", "pending", "pending", "superseded"
    ]);
  });
});
