import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  readAllData,
  type PeopleOsDatabase
} from "../data/database";
import { createRepositories, RecordConflictError, StaleRevisionError } from "../data/repositories";
import { deriveLastContact } from "../domain/timeline";
import type { Person } from "../domain/schema";
import { validatePeopleOsData, ValidationError } from "../domain/validation";
import {
  completeReachOut,
  createReachOut,
  moveReachOutToDormant,
  prepareCompleteReachOutCommand,
  prepareCreateReachOutCommand,
  prepareReachOutStatusCommand,
  prepareUpdateReachOutPlanCommand,
  reactivateReachOut,
  reminderDateFromDefault,
  removeReachOut,
  updateReachOutPlan
} from "./reachOut";

const now = "2026-08-01T09:00:00.000Z";
const later = "2026-08-02T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Ahmed",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

async function openDatabase(label: string, seedPerson = true): Promise<PeopleOsDatabase> {
  const name = `peopleos-reach-out-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, now);
  connections.add(db);
  if (seedPerson) await createRepositories(db).people.create(person());
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("Reach Out aggregate commands", () => {
  it("adds an existing Person without duplicating identity and links exactly one reminder", async () => {
    const db = await openDatabase("existing");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const command = prepareCreateReachOutCommand({
      person: currentPerson,
      intendedActionType: "research_contact_route",
      reminderDate: "2026-08-08",
      newContexts: [{ kind: "fellowship", label: "AI Fellowship" }]
    }, { now, localDate: "2026-08-01", idFactory: sequence("existing") });
    const before = (await db.get("metadata", "app"))!.datasetRevision;

    const created = await createReachOut(db, command);
    const retry = await createReachOut(db, command);

    expect(retry.entry).toEqual(created.entry);
    expect(await db.count("people")).toBe(1);
    expect(created.entry).toMatchObject({
      personId: currentPerson.id,
      intentStatus: "active",
      currentFollowUpId: created.followUp!.id
    });
    expect(created.entry.reason).toBeUndefined();
    expect(created.followUp).toMatchObject({
      personId: currentPerson.id,
      reachOutEntryId: created.entry.id,
      reason: "Reach out to Sarah Ahmed",
      actionType: "research_contact_route",
      status: "pending"
    });
    expect(await db.count("reachOutEvents")).toBe(2);
    expect(await db.count("followUpEvents")).toBe(1);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(before + 1);
    expect(validatePeopleOsData(await readAllData(db))).toBeTruthy();
  });

  it("creates a label-only provisional Person atomically and keeps an exact retry idempotent", async () => {
    const db = await openDatabase("provisional", false);
    const command = prepareCreateReachOutCommand({
      person: { provisionalLabel: " Chief Information Officer at Watford " }
    }, { now, localDate: "2026-08-01", idFactory: sequence("provisional") });
    const first = await createReachOut(db, command);
    const retry = await createReachOut(db, command);

    expect(retry).toEqual(first);
    expect(first.person).toMatchObject({
      id: first.entry.personId,
      displayName: "Chief Information Officer at Watford",
      identityStatus: "provisional"
    });
    expect(first.followUp).toBeUndefined();
    expect(await db.count("people")).toBe(1);
    expect(await db.count("reachOutEntries")).toBe(1);
  });

  it("rolls back provisional Person, context, entry and reminder together", async () => {
    const db = await openDatabase("rollback", false);
    const command = prepareCreateReachOutCommand({
      person: { provisionalLabel: "Hackathon organiser" },
      reason: "Thank them for the event",
      reminderDate: "2026-08-08",
      newContexts: [{ kind: "event", label: "Health hackathon" }]
    }, { now, localDate: "2026-08-01", idFactory: sequence("rollback") });
    await expect(createReachOut(db, command, {
      beforeCommit: () => { throw new Error("forced rollback"); }
    })).rejects.toThrow("forced rollback");
    expect(await db.count("people")).toBe(0);
    expect(await db.count("reachOutEntries")).toBe(0);
    expect(await db.count("reachOutContexts")).toBe(0);
    expect(await db.count("followUps")).toBe(0);
    expect(await db.count("reachOutEvents")).toBe(0);
  });

  it("enforces one current entry and validates quick-capture boundaries", async () => {
    const db = await openDatabase("current-entry");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    await createReachOut(db, prepareCreateReachOutCommand({ person: currentPerson }, {
      now, localDate: "2026-08-01", idFactory: sequence("first")
    }));
    await expect(createReachOut(db, prepareCreateReachOutCommand({ person: currentPerson }, {
      now: later, localDate: "2026-08-02", idFactory: sequence("second")
    }))).rejects.toBeInstanceOf(RecordConflictError);

    expect(() => prepareCreateReachOutCommand({ person: { provisionalLabel: " " } }, { now, localDate: "2026-08-01" }))
      .toThrow(ValidationError);
    expect(() => prepareCreateReachOutCommand({ person: currentPerson, reason: "x".repeat(241) }, { now, localDate: "2026-08-01" }))
      .toThrow(ValidationError);
    expect(() => prepareCreateReachOutCommand({ person: currentPerson, notes: "x".repeat(5_001) }, { now, localDate: "2026-08-01" }))
      .toThrow(ValidationError);
    expect(() => prepareCreateReachOutCommand({ person: currentPerson, reminderDate: "2026-07-31" }, { now, localDate: "2026-08-01" }))
      .toThrow(ValidationError);
  });

  it("rejects command-ID reuse with different capture input", async () => {
    const db = await openDatabase("capture-collision");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const first = prepareCreateReachOutCommand({ person: currentPerson, reason: "Original reason" }, {
      now, localDate: "2026-08-01", idFactory: sequence("collision")
    });
    await createReachOut(db, first);
    const conflicting = prepareCreateReachOutCommand({ person: currentPerson, reason: "Different reason" }, {
      now, localDate: "2026-08-01", idFactory: sequence("collision")
    });
    await expect(createReachOut(db, conflicting)).rejects.toBeInstanceOf(RecordConflictError);
    await expect(createReachOut(db, { ...first, entry: { ...first.entry, reason: "Tampered" } }))
      .rejects.toBeInstanceOf(RecordConflictError);
  });

  it("maps every reminder default by local calendar days without creating data", () => {
    expect(reminderDateFromDefault("2026-03-28", undefined)).toBeUndefined();
    expect(reminderDateFromDefault("2026-03-28", 1)).toBe("2026-03-29");
    expect(reminderDateFromDefault("2026-03-28", 7)).toBe("2026-04-04");
    expect(reminderDateFromDefault("2026-03-28", 14)).toBe("2026-04-11");
    expect(reminderDateFromDefault("2026-03-28", 30)).toBe("2026-04-27");
  });

  it("adds, edits, reschedules and clears the one reciprocal linked reminder", async () => {
    const db = await openDatabase("edit-reminder");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reason: "Share the update"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));

    const added = await updateReachOutPlan(db, prepareUpdateReachOutPlanCommand(
      created.entry,
      currentPerson,
      undefined,
      { reason: "Share the update", intendedActionType: "send_update", contextIds: [], reminderDate: "2026-08-08" },
      { now: later, localDate: "2026-08-02", idFactory: sequence("add") }
    ));
    expect(added.entry.currentFollowUpId).toBe(added.currentFollowUp?.id);

    const rescheduled = await updateReachOutPlan(db, prepareUpdateReachOutPlanCommand(
      added.entry,
      currentPerson,
      added.currentFollowUp,
      { reason: "Share the revised update", intendedActionType: "send_update", contextIds: [], reminderDate: "2026-08-10" },
      { now: "2026-08-03T09:00:00.000Z", localDate: "2026-08-03", idFactory: sequence("reschedule") }
    ));
    expect((await db.get("followUps", added.currentFollowUp!.id))?.status).toBe("superseded");
    expect(rescheduled.currentFollowUp).toMatchObject({
      supersedesFollowUpId: added.currentFollowUp!.id,
      reachOutEntryId: created.entry.id,
      dueDate: "2026-08-10"
    });

    const cleared = await updateReachOutPlan(db, prepareUpdateReachOutPlanCommand(
      rescheduled.entry,
      currentPerson,
      rescheduled.currentFollowUp,
      { reason: "Share the revised update", intendedActionType: "send_update", contextIds: [] },
      { now: "2026-08-04T09:00:00.000Z", localDate: "2026-08-04", idFactory: sequence("clear") }
    ));
    expect(cleared.entry.currentFollowUpId).toBeUndefined();
    expect((await db.get("followUps", rescheduled.currentFollowUp!.id))?.status).toBe("cancelled");
    expect(validatePeopleOsData(await readAllData(db))).toBeTruthy();
  });

  it("fingerprints plan edits, permits only an unchanged overdue date, and verifies retry history", async () => {
    const db = await openDatabase("edit-command-guards");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reason: "Share the update",
      reminderDate: "2026-08-08"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));

    expect(() => prepareUpdateReachOutPlanCommand(created.entry, currentPerson, created.followUp, {
      reason: "Share the revised update",
      contextIds: [],
      reminderDate: "2026-08-08"
    }, { now: "2026-08-10T09:00:00.000Z", localDate: "2026-08-10" })).not.toThrow();
    expect(() => prepareUpdateReachOutPlanCommand(created.entry, currentPerson, created.followUp, {
      contextIds: [],
      reminderDate: "2026-08-07"
    }, { now: "2026-08-10T09:00:00.000Z", localDate: "2026-08-10" })).toThrow(/past/);

    const command = prepareUpdateReachOutPlanCommand(created.entry, currentPerson, created.followUp, {
      reason: "Share the revised update",
      intendedActionType: "send_update",
      contextIds: [],
      reminderDate: "2026-08-12"
    }, { now: later, localDate: "2026-08-02", idFactory: sequence("reschedule") });
    await expect(updateReachOutPlan(db, { ...command, desiredFollowUpReason: "Tampered reason" }))
      .rejects.toBeInstanceOf(RecordConflictError);
    await updateReachOutPlan(db, command);
    await db.delete("reachOutEvents", command.reachOutEventId);
    await expect(updateReachOutPlan(db, command)).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it("rolls replacement, clear, and status cancellation mutations back byte-for-byte", async () => {
    const db = await openDatabase("update-status-rollback");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reminderDate: "2026-08-08"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));

    const reschedule = prepareUpdateReachOutPlanCommand(created.entry, currentPerson, created.followUp, {
      contextIds: [], reminderDate: "2026-08-12"
    }, { now: later, localDate: "2026-08-02", idFactory: sequence("reschedule") });
    const beforeReschedule = await readAllData(db);
    await expect(updateReachOutPlan(db, reschedule, {
      beforeCommit: () => { throw new Error("reschedule rollback"); }
    })).rejects.toThrow("reschedule rollback");
    expect(await readAllData(db)).toEqual(beforeReschedule);

    const clear = prepareUpdateReachOutPlanCommand(created.entry, currentPerson, created.followUp, {
      contextIds: []
    }, { now: later, localDate: "2026-08-02", idFactory: sequence("clear") });
    await expect(updateReachOutPlan(db, clear, {
      beforeCommit: () => { throw new Error("clear rollback"); }
    })).rejects.toThrow("clear rollback");
    expect(await readAllData(db)).toEqual(beforeReschedule);

    const dormant = prepareReachOutStatusCommand(
      created.entry, currentPerson, created.followUp, "moved_to_dormant",
      { now: later, idFactory: sequence("dormant") }
    );
    await expect(removeReachOut(db, dormant)).rejects.toBeInstanceOf(RecordConflictError);
    await expect(moveReachOutToDormant(db, dormant, {
      beforeCommit: () => { throw new Error("status rollback"); }
    })).rejects.toThrow("status rollback");
    expect(await readAllData(db)).toEqual(beforeReschedule);
  });

  it("completes without user-logged contact and preserves last contact", async () => {
    const db = await openDatabase("complete-without-contact");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reason: "Research their contact route",
      reminderDate: "2026-08-01"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));
    const result = await completeReachOut(db, prepareCompleteReachOutCommand(
      created.entry,
      currentPerson,
      created.followUp,
      {},
      { now: later, localDate: "2026-08-02", idFactory: sequence("complete") }
    ));

    expect(result.entry).toMatchObject({ intentStatus: "completed", lastCompletedAt: later });
    expect(result.entry.currentFollowUpId).toBeUndefined();
    expect(result.completedFollowUp?.status).toBe("completed");
    expect(result.interaction?.kind).toBe("follow_up_completed");
    expect(result.completionEvent.interactionId).toBeUndefined();
    expect(deriveLastContact(await db.getAll("interactions"))).toBeUndefined();
    expect(validatePeopleOsData(await readAllData(db))).toBeTruthy();
  });

  it("records contact once and keeps the same active entry when another follow-up is accepted", async () => {
    const db = await openDatabase("complete-and-relink");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reason: "Share the pilot update",
      intendedActionType: "send_update",
      reminderDate: "2026-08-01"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));
    const command = prepareCompleteReachOutCommand(
      created.entry,
      currentPerson,
      created.followUp,
      {
        logInteraction: { kind: "email", occurredAt: later, summary: "Sent the update" },
        nextFollowUp: { dueDate: "2026-08-14" }
      },
      { now: later, localDate: "2026-08-02", idFactory: sequence("complete") }
    );
    const first = await completeReachOut(db, command);
    const retry = await completeReachOut(db, command);

    expect(retry.entry).toEqual(first.entry);
    expect(first.entry).toMatchObject({ id: created.entry.id, intentStatus: "active", lastCompletedAt: later });
    expect(first.nextFollowUp).toMatchObject({
      id: first.entry.currentFollowUpId,
      reachOutEntryId: created.entry.id,
      reason: "Share the pilot update",
      actionType: "send_update",
      status: "pending"
    });
    expect(await db.count("interactions")).toBe(1);
    expect((await db.getAllFromIndex("reachOutEvents", "by-entry", created.entry.id))
      .filter((event) => event.kind === "completed")).toHaveLength(1);
    expect((await db.getAllFromIndex("reachOutEvents", "by-entry", created.entry.id))
      .filter((event) => event.kind === "follow_up_linked")).toHaveLength(2);
    expect(deriveLastContact(await db.getAll("interactions"))?.id).toBe(first.interaction?.id);
    expect(validatePeopleOsData(await readAllData(db))).toBeTruthy();
  });

  it("allows generic contacted only for the explicit Already contacted composition path", async () => {
    const db = await openDatabase("already-contacted-relink");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reason: "Reconnect after the fellowship",
      reminderDate: "2026-08-01"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));
    const input = {
      logInteraction: { kind: "contacted" as const, occurredAt: later },
      nextFollowUp: { dueDate: "2026-08-14" as const }
    };
    expect(() => prepareCompleteReachOutCommand(created.entry, currentPerson, created.followUp, input, {
      now: later, localDate: "2026-08-02"
    })).toThrow(/reserved|contact interaction type/);

    const command = prepareCompleteReachOutCommand(created.entry, currentPerson, created.followUp, input, {
      now: later,
      localDate: "2026-08-02",
      completionOrigin: "already_contacted",
      idFactory: sequence("already-contacted")
    });
    const first = await completeReachOut(db, command);
    const retry = await completeReachOut(db, command);
    expect(retry).toEqual(first);
    expect(first.interaction?.kind).toBe("contacted");
    expect(first.entry).toMatchObject({
      id: created.entry.id,
      intentStatus: "active",
      currentFollowUpId: first.nextFollowUp?.id
    });
    expect(await db.count("interactions")).toBe(1);
    expect(await db.count("followUps")).toBe(2);
    expect(validatePeopleOsData(await readAllData(db))).toBeTruthy();
  });

  it("rejects future contact, falls back after a blank next reason, and detects incomplete retry history", async () => {
    const db = await openDatabase("completion-guards");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reason: "Reconnect after the fellowship",
      reminderDate: "2026-08-01"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));
    expect(() => prepareCompleteReachOutCommand(created.entry, currentPerson, created.followUp, {
      logInteraction: { kind: "email", occurredAt: "2026-08-03T09:00:00.000Z" }
    }, { now: later, localDate: "2026-08-02" })).toThrow(/future/);
    expect(() => prepareCompleteReachOutCommand(created.entry, currentPerson, created.followUp, {
      logInteraction: { kind: "email", occurredAt: "2026-08-02T09:00:00.100Z" }
    }, { now: "2026-08-02T09:00:00Z", localDate: "2026-08-02" })).toThrow(/future/);

    const command = prepareCompleteReachOutCommand(created.entry, currentPerson, created.followUp, {
      nextFollowUp: { dueDate: "2026-08-14", reason: "   " }
    }, { now: later, localDate: "2026-08-02", idFactory: sequence("complete") });
    expect(command.input.nextFollowUp?.reason).toBe("Reconnect after the fellowship");
    await completeReachOut(db, command);
    await db.delete("followUpEvents", command.nextFollowUpEventId);
    await expect(completeReachOut(db, command)).rejects.toBeInstanceOf(RecordConflictError);
  });

  it("moves Dormant, reactivates without a reminder, and removes while retaining history", async () => {
    const db = await openDatabase("status");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reminderDate: "2026-08-08"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));
    const dormantCommand = prepareReachOutStatusCommand(
      created.entry, currentPerson, created.followUp, "moved_to_dormant",
      { now: later, idFactory: sequence("dormant") }
    );
    const dormant = await moveReachOutToDormant(db, dormantCommand);
    expect(dormant.entry).toMatchObject({ intentStatus: "dormant" });
    expect(dormant.entry.currentFollowUpId).toBeUndefined();
    expect(dormant.cancelledFollowUp?.status).toBe("cancelled");
    const cancellationEvent = (await db.get("followUpEvents", dormantCommand.followUpEventId))!;
    await db.put("followUpEvents", { ...cancellationEvent, occurredAt: "2026-08-02T10:00:00.000Z" });
    await expect(moveReachOutToDormant(db, dormantCommand)).rejects.toBeInstanceOf(RecordConflictError);
    await db.put("followUpEvents", cancellationEvent);
    expect(() => prepareUpdateReachOutPlanCommand(
      dormant.entry,
      currentPerson,
      undefined,
      { contextIds: [], reminderDate: "2026-08-10" },
      { now: "2026-08-03T08:00:00.000Z", localDate: "2026-08-03" }
    )).toThrow(/Reactivate/);

    const active = await reactivateReachOut(db, prepareReachOutStatusCommand(
      dormant.entry, currentPerson, undefined, "activated",
      { now: "2026-08-03T09:00:00.000Z", idFactory: sequence("activate") }
    ));
    expect(active.entry).toMatchObject({ intentStatus: "active" });
    expect(active.entry.currentFollowUpId).toBeUndefined();

    const removed = await removeReachOut(db, prepareReachOutStatusCommand(
      active.entry, currentPerson, undefined, "removed",
      { now: "2026-08-04T09:00:00.000Z", idFactory: sequence("remove") }
    ));
    expect(removed.entry.removedAt).toBe("2026-08-04T09:00:00.000Z");
    expect(await db.count("reachOutEvents")).toBe(5);
    expect(validatePeopleOsData(await readAllData(db))).toBeTruthy();
  });

  it("rejects stale commands and rolls compound completion back byte-for-byte", async () => {
    const db = await openDatabase("stale-rollback");
    const currentPerson = (await db.get("people", "person-sarah"))!;
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: currentPerson,
      reminderDate: "2026-08-01"
    }, { now, localDate: "2026-08-01", idFactory: sequence("create") }));
    const stale = prepareCompleteReachOutCommand(created.entry, currentPerson, created.followUp, {}, {
      now: later, localDate: "2026-08-02", idFactory: sequence("stale")
    });
    await db.put("reachOutEntries", { ...created.entry, revision: 2, notes: "Changed elsewhere", updatedAt: later });
    await expect(completeReachOut(db, stale)).rejects.toBeInstanceOf(StaleRevisionError);

    await db.put("reachOutEntries", created.entry);
    const before = await readAllData(db);
    const command = prepareCompleteReachOutCommand(created.entry, currentPerson, created.followUp, {
      nextFollowUp: { dueDate: "2026-08-14" }
    }, { now: later, localDate: "2026-08-02", idFactory: sequence("rollback") });
    await expect(completeReachOut(db, command, {
      beforeCommit: () => { throw new Error("completion rollback"); }
    })).rejects.toThrow("completion rollback");
    expect(await readAllData(db)).toEqual(before);
  });
});
