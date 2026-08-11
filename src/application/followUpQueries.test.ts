import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import { createRepositories } from "../data/repositories";
import type { FollowUpDraft } from "./followUps";
import {
  cancelFollowUp,
  createCancelFollowUpCommand,
  createFollowUp,
  createRescheduleFollowUpCommand,
  rescheduleFollowUp
} from "./followUps";
import {
  getFollowUpDetail,
  getNextPlanForPerson,
  getTodaySkip,
  hasExistingFutureFollowUp,
  listPersonFollowUps,
  listTodaySkips,
  listUpcomingFollowUps
} from "./followUpQueries";
import type { Interaction, Person, TodaySkip } from "../domain/schema";

const fixedNow = "2026-03-29T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(id: string, displayName: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides
  };
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-follow-up-queries-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, fixedNow);
  connections.add(db);
  return db;
}

async function addPerson(db: PeopleOsDatabase, value: Person): Promise<void> {
  await createRepositories(db).people.create(value);
}

async function addFollowUp(
  db: PeopleOsDatabase,
  id: string,
  personId: string,
  dueDate: string,
  overrides: Partial<FollowUpDraft> = {}
) {
  return createFollowUp(db, {
    id,
    createdEventId: `event-${id}`,
    personId,
    reason: `Plan ${id}`,
    actionType: "other",
    dueDate,
    createdAt: fixedNow,
    ...overrides
  }, { localDate: "2026-03-29" });
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("follow-up queries", () => {
  it("lists only active future plans in deterministic date, importance, name and ID order", async () => {
    const db = await openDatabase("upcoming-order");
    await addPerson(db, person("person-zed", "Zed", { importance: "high" }));
    await addPerson(db, person("person-aaron", "Aaron"));
    const archived = person("person-archived", "Archived");
    const merged = person("person-merged", "Merged");
    await addPerson(db, archived);
    await addPerson(db, merged);
    await addFollowUp(db, "follow-up-due", "person-aaron", "2026-03-29");
    await addFollowUp(db, "follow-up-aaron", "person-aaron", "2026-04-02", { actionType: "email" });
    await addFollowUp(db, "follow-up-zed", "person-zed", "2026-04-02", { actionType: "call" });
    await addFollowUp(db, "follow-up-later", "person-aaron", "2026-05-15");
    await addFollowUp(db, "follow-up-archived", "person-archived", "2026-04-01");
    await addFollowUp(db, "follow-up-merged", "person-merged", "2026-04-01");
    const people = createRepositories(db).people;
    await people.update({ ...archived, archivedAt: "2026-03-30T09:00:00.000Z" }, 1, "2026-03-30T09:00:00.000Z");
    await people.update({
      ...merged,
      identityStatus: "merged",
      mergedIntoPersonId: "person-aaron"
    }, 1, "2026-03-30T09:00:01.000Z");

    const result = await listUpcomingFollowUps(db, { localDate: "2026-03-29" });
    expect(result.dueCount).toBe(1);
    expect(result.items.map((item) => item.followUp.id)).toEqual([
      "follow-up-zed", "follow-up-aaron", "follow-up-later"
    ]);
    expect(result.groups.map((group) => [group.key, group.items.length])).toEqual([
      ["2026-04", 2], ["2026-05", 1]
    ]);
  });

  it("applies Upcoming date, Person and action filters without changing the due count", async () => {
    const db = await openDatabase("upcoming-filters");
    await addPerson(db, person("person-one", "Sarah"));
    await addPerson(db, person("person-two", "Aaron"));
    await addFollowUp(db, "due", "person-one", "2026-03-29");
    await addFollowUp(db, "week", "person-one", "2026-04-03", { actionType: "email" });
    await addFollowUp(db, "month", "person-one", "2026-04-20", { actionType: "call" });
    await addFollowUp(db, "later", "person-two", "2026-05-01", { actionType: "email" });

    const week = await listUpcomingFollowUps(db, {
      localDate: "2026-03-29", window: "next_7_days", personId: "person-one", actionType: "email"
    });
    const later = await listUpcomingFollowUps(db, { localDate: "2026-03-29", window: "later" });
    expect(week.items.map((item) => item.followUp.id)).toEqual(["week"]);
    expect(week.dueCount).toBe(1);
    expect(later.items.map((item) => item.followUp.id)).toEqual(["later"]);
  });

  it("returns pending and retained history separately and resolves detail lineage/events", async () => {
    const db = await openDatabase("person-detail");
    await addPerson(db, person("person-one", "Sarah"));
    const original = await addFollowUp(db, "original", "person-one", "2026-04-01");
    const command = createRescheduleFollowUpCommand(original, { dueDate: "2026-04-10" }, {
      now: "2026-03-30T09:00:00.000Z",
      idFactory: (() => { const values = ["reschedule", "replacement"]; return () => values.shift()!; })()
    });
    const result = await rescheduleFollowUp(db, command, { localDate: "2026-03-29" });
    const other = await addFollowUp(db, "cancelled", "person-one", "2026-04-05");
    await cancelFollowUp(db, createCancelFollowUpCommand(other, {
      now: "2026-03-31T09:00:00.000Z", idFactory: () => "cancelled"
    }));

    const lists = await listPersonFollowUps(db, "person-one");
    const detail = await getFollowUpDetail(db, result.replacement.id);
    expect(lists.pending.map((record) => record.id)).toEqual([result.replacement.id]);
    expect(lists.history.map((record) => record.id)).toEqual([other.id, original.id]);
    expect(detail).toMatchObject({
      followUp: { id: result.replacement.id },
      person: { id: "person-one" },
      lineage: { previous: { id: original.id } }
    });
    expect((await getFollowUpDetail(db, original.id))?.lineage.next?.id).toBe(result.replacement.id);
    expect((await getFollowUpDetail(db, original.id))?.events.map((event) => event.kind)).toEqual([
      "created", "rescheduled"
    ]);
  });

  it("projects an explicit next plan before cadence and computes cadence from timezone-local contact date", async () => {
    const db = await openDatabase("next-plan");
    await addPerson(db, person("person-one", "Sarah", { contactCadence: { value: 1, unit: "months" } }));
    const contact: Interaction = {
      id: "interaction-one",
      revision: 1,
      personId: "person-one",
      kind: "phone_call",
      occurredAt: "2026-03-29T23:30:00.000Z",
      createdAt: fixedNow,
      updatedAt: fixedNow
    };
    await db.add("interactions", contact);

    expect(await getNextPlanForPerson(db, "person-one", "2026-03-30", {
      timeZone: "Europe/London"
    })).toEqual({
      kind: "cadence",
      cadence: { value: 1, unit: "months" },
      cadenceDays: 30,
      date: "2026-04-29"
    });

    const explicit = await addFollowUp(db, "explicit", "person-one", "2026-04-05");
    expect(await getNextPlanForPerson(db, "person-one", "2026-03-30", {
      timeZone: "Europe/London"
    })).toEqual({ kind: "explicit_follow_up", date: "2026-04-05", followUp: explicit });
  });

  it("reports future-plan warnings and current-day skips deterministically", async () => {
    const db = await openDatabase("warnings-skips");
    await addPerson(db, person("person-b", "B"));
    await addPerson(db, person("person-a", "A"));
    await addFollowUp(db, "future", "person-a", "2026-04-01");
    expect(await hasExistingFutureFollowUp(db, "person-a", "2026-03-29")).toBe(true);
    expect(await hasExistingFutureFollowUp(db, "person-a", "2026-04-01")).toBe(false);

    const skips: TodaySkip[] = [{
      id: "person-b:2026-03-29", personId: "person-b", localDate: "2026-03-29", createdAt: fixedNow
    }, {
      id: "person-a:2026-03-29", personId: "person-a", localDate: "2026-03-29", createdAt: fixedNow
    }];
    for (const skip of skips) await db.add("todaySkips", skip);
    expect((await listTodaySkips(db, "2026-03-29")).map((skip) => skip.personId)).toEqual(["person-a", "person-b"]);
    expect(await getTodaySkip(db, "person-a", "2026-03-29")).toEqual(skips[1]);
    expect(await getTodaySkip(db, "person-a", "2026-03-30")).toBeUndefined();
  });
});
