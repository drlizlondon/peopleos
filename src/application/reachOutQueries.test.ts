import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import { createRepositories } from "../data/repositories";
import type { Person } from "../domain/schema";
import {
  completeReachOut,
  createReachOut,
  moveReachOutToDormant,
  prepareCompleteReachOutCommand,
  prepareCreateReachOutCommand,
  prepareReachOutStatusCommand,
  removeReachOut
} from "./reachOut";
import {
  getCurrentReachOutForPerson,
  getReachOutDetail,
  listReachOut,
  listReachOutHistoryForPerson
} from "./reachOutQueries";

const baseNow = "2026-08-01T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function person(id: string, displayName: string): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: baseNow,
    updatedAt: baseNow
  };
}

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-reach-out-queries-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, baseNow);
  connections.add(db);
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("Reach Out queries", () => {
  it("returns the documented default active queue in deterministic order", async () => {
    const db = await openDatabase("order");
    const repositories = createRepositories(db);
    const records = [
      person("overdue-old", "Old overdue"),
      person("overdue-late", "Late overdue"),
      person("due", "Due today"),
      person("active-new", "Active newest"),
      person("waiting", "Waiting person")
    ];
    for (const record of records) await repositories.people.create(record);
    const create = async (record: Person, dueDate: string | undefined, now: string) => createReachOut(db, prepareCreateReachOutCommand({
      person: record,
      ...(dueDate ? { reminderDate: dueDate } : {})
    }, { now, localDate: "2026-07-01", idFactory: sequence(record.id) }));
    await create(records[4], "2026-08-15", "2026-08-01T09:00:00.000Z");
    await create(records[3], undefined, "2026-08-05T09:00:00.000Z");
    await create(records[2], "2026-08-10", "2026-08-03T09:00:00.000Z");
    await create(records[1], "2026-08-09", "2026-08-02T09:00:00.000Z");
    await create(records[0], "2026-08-01", "2026-08-01T09:00:00.000Z");

    const first = await listReachOut(db, { localDate: "2026-08-10" });
    const second = await listReachOut(db, { localDate: "2026-08-10" });
    expect(second.map((item) => item.entry.id)).toEqual(first.map((item) => item.entry.id));
    expect(first.map((item) => item.person.id)).toEqual([
      "overdue-old", "overdue-late", "due", "active-new", "waiting"
    ]);
    expect(first.map((item) => item.displayState)).toEqual([
      "overdue", "overdue", "active", "active", "waiting"
    ]);
  });

  it("searches identity, past affiliation, reason, notes and context with explained ranking", async () => {
    const db = await openDatabase("search");
    const repositories = createRepositories(db);
    const identity = person("identity", "NHS AI Founder");
    const organisation = person("organisation", "Priya Shah");
    const reason = person("reason", "Alex Morgan");
    const context = person("context", "Sam Lee");
    const notes = person("notes", "Jo Patel");
    for (const record of [identity, organisation, reason, context, notes]) await repositories.people.create(record);
    await repositories.affiliations.create({
      id: "past-affiliation", revision: 1, personId: organisation.id,
      organisationName: "NHS AI Lab", role: "Advisor", isCurrent: false,
      endedOn: "2025-12-31", createdAt: baseNow, updatedAt: baseNow
    });
    const create = async (record: Person, input: Parameters<typeof prepareCreateReachOutCommand>[0]) => createReachOut(db, prepareCreateReachOutCommand({
      ...input, person: record
    }, { now: baseNow, localDate: "2026-08-01", idFactory: sequence(record.id) }));
    await create(identity, { person: identity });
    await create(organisation, { person: organisation });
    await create(reason, { person: reason, reason: "Discuss NHS-AI pilots" });
    await create(context, { person: context, newContexts: [{ kind: "fellowship", label: "NHS AI Fellowship" }] });
    await create(notes, { person: notes, notes: "Interested in the NHS AI programme" });

    const results = await listReachOut(db, { localDate: "2026-08-01", query: "nhs ai" });
    expect(results.map((item) => item.person.id)).toEqual([
      "identity", "organisation", "reason", "context", "notes"
    ]);
    expect(results.map((item) => item.searchSources[0])).toEqual([
      "Person", "Organisation", "Why", "Context", "Notes"
    ]);
  });

  it("retains Completed and Dormant in query/history while excluding removed records", async () => {
    const db = await openDatabase("history");
    const repositories = createRepositories(db);
    const completedPerson = person("completed", "Completed Person");
    const dormantPerson = person("dormant", "Dormant Person");
    const removedPerson = person("removed", "Removed Person");
    for (const record of [completedPerson, dormantPerson, removedPerson]) await repositories.people.create(record);
    const completedCreated = await createReachOut(db, prepareCreateReachOutCommand({ person: completedPerson }, {
      now: baseNow, localDate: "2026-08-01", idFactory: sequence("complete-create")
    }));
    await completeReachOut(db, prepareCompleteReachOutCommand(completedCreated.entry, completedPerson, undefined, {}, {
      now: "2026-08-02T09:00:00.000Z", localDate: "2026-08-02", idFactory: sequence("complete")
    }));
    const dormantCreated = await createReachOut(db, prepareCreateReachOutCommand({ person: dormantPerson }, {
      now: baseNow, localDate: "2026-08-01", idFactory: sequence("dormant-create")
    }));
    await moveReachOutToDormant(db, prepareReachOutStatusCommand(dormantCreated.entry, dormantPerson, undefined, "moved_to_dormant", {
      now: "2026-08-02T10:00:00.000Z", idFactory: sequence("dormant")
    }));
    const removedCreated = await createReachOut(db, prepareCreateReachOutCommand({ person: removedPerson }, {
      now: baseNow, localDate: "2026-08-01", idFactory: sequence("remove-create")
    }));
    await removeReachOut(db, prepareReachOutStatusCommand(removedCreated.entry, removedPerson, undefined, "removed", {
      now: "2026-08-02T11:00:00.000Z", idFactory: sequence("remove")
    }));

    expect(await listReachOut(db, { localDate: "2026-08-03" })).toEqual([]);
    expect((await listReachOut(db, { localDate: "2026-08-03", statusFilters: ["completed"] }))
      .map((item) => item.person.id)).toEqual(["completed"]);
    expect((await listReachOut(db, { localDate: "2026-08-03", statusFilters: ["dormant"] }))
      .map((item) => item.person.id)).toEqual(["dormant"]);
    expect(await listReachOut(db, {
      localDate: "2026-08-03",
      statusFilters: ["active", "completed", "dormant"],
      query: "removed"
    })).toEqual([]);
    expect(await getCurrentReachOutForPerson(db, completedPerson.id)).toBeUndefined();
    expect((await listReachOutHistoryForPerson(db, completedPerson.id))).toHaveLength(1);
    expect((await listReachOutHistoryForPerson(db, removedPerson.id))).toEqual([
      expect.objectContaining({ id: removedCreated.entry.id, removedAt: "2026-08-02T11:00:00.000Z" })
    ]);
  });

  it("returns detail history and reports a broken current link without inventing a date", async () => {
    const db = await openDatabase("detail-repair");
    const repositories = createRepositories(db);
    const record = person("person-one", "Aaron Jones");
    await repositories.people.create(record);
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: record,
      reason: "Follow up after the hackathon",
      reminderDate: "2026-08-08"
    }, { now: baseNow, localDate: "2026-08-01", idFactory: sequence("detail") }));

    const detail = await getReachOutDetail(db, created.entry.id, "2026-08-01");
    expect(detail).toMatchObject({
      displayState: "waiting",
      relevantDate: "2026-08-08",
      currentFollowUp: { id: created.followUp!.id }
    });
    expect(detail?.events.map((event) => event.kind)).toEqual(["added", "follow_up_linked"]);

    await db.delete("followUps", created.followUp!.id);
    const broken = await getReachOutDetail(db, created.entry.id, "2026-08-01");
    expect(broken).toMatchObject({
      displayState: "active",
      repairNotice: "This Reach Out reminder link needs repair. No date has been assumed."
    });
    expect(broken?.currentFollowUp).toBeUndefined();
    expect(broken?.relevantDate).toBeUndefined();
  });
});
