import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import type { FollowUp, Interaction, Person } from "../domain/schema";
import { RELATIONSHIP_ENGINE_POLICY_VERSION } from "../relationship-engine";
import { getUpcomingPeopleProjection } from "./upcomingQueries";

const now = "2026-08-12T12:00:00.000Z";
const clock = {
  now,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
} as const;
const databases: Array<{ name: string; db: PeopleOsDatabase }> = [];

function person(id: string, displayName: string, patch: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName,
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    ...patch
  };
}

function followUp(id: string, personId: string, dueDate: string): FollowUp {
  return {
    id,
    revision: 1,
    personId,
    dueDate,
    reason: "Keep in touch",
    actionType: "other",
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
}

async function openDatabase(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-upcoming-${label}-${crypto.randomUUID()}`;
  const db = await openPeopleOsDatabase(name, now);
  databases.push({ name, db });
  return db;
}

afterEach(async () => {
  for (const { name, db } of databases.splice(0)) {
    db.close();
    await deletePeopleOsDatabase(name);
  }
});

describe("Upcoming people projection", () => {
  it("uses the relationship forecast for recurring people and future stored schedules", async () => {
    const db = await openDatabase("forecast");
    const cadencePerson = person("person-cadence", "Dad", {
      contactCadence: { value: 3, unit: "days" }
    });
    const plannedPerson = person("person-planned", "Sarah");
    const contact: Interaction = {
      id: "interaction-dad",
      revision: 1,
      personId: cadencePerson.id,
      kind: "contacted",
      occurredAt: "2026-08-10T12:00:00.000Z",
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T12:00:00.000Z"
    };
    await db.put("people", cadencePerson);
    await db.put("people", plannedPerson);
    await db.put("interactions", contact);
    await db.put("followUps", followUp("follow-up-sarah", plannedPerson.id, "2026-08-20"));

    const result = await getUpcomingPeopleProjection(db, clock, "all");
    expect(result.localDate).toBe("2026-08-12");
    expect(result.people.map((item) => [item.person.displayName, item.date])).toEqual([
      ["Dad", "2026-08-13"],
      ["Sarah", "2026-08-20"]
    ]);
  });

  it("omits people already due, archived or outside the selected relationship view", async () => {
    const db = await openDatabase("filters");
    const due = person("person-due", "Due");
    const personal = person("person-personal", "Personal");
    const professional = person("person-professional", "Professional", { relationshipMode: "professional" });
    const archived = person("person-archived", "Archived", { archivedAt: now });
    for (const record of [due, personal, professional, archived]) await db.put("people", record);
    await db.put("followUps", followUp("follow-up-due", due.id, "2026-08-12"));
    await db.put("followUps", followUp("follow-up-personal", personal.id, "2026-08-15"));
    await db.put("followUps", followUp("follow-up-professional", professional.id, "2026-08-14"));
    await db.put("followUps", followUp("follow-up-archived", archived.id, "2026-08-13"));

    const result = await getUpcomingPeopleProjection(db, clock, "personal");
    expect(result.people.map((item) => item.person.id)).toEqual([personal.id]);
  });

  it("shows a paused due Person on their chosen return date", async () => {
    const db = await openDatabase("paused");
    const paused = person("person-paused", "Dad", {
      contactCadence: { value: 1, unit: "days" },
      todayPausedUntilDate: "2026-08-19"
    });
    await db.put("people", paused);
    await db.put("followUps", followUp("follow-up-paused", paused.id, "2026-08-10"));

    const result = await getUpcomingPeopleProjection(db, clock, "personal");
    expect(result.people).toEqual([{ person: paused, date: "2026-08-19" }]);
  });

  it("keeps valid people visible when one stored relationship cannot be evaluated", async () => {
    const db = await openDatabase("isolation");
    const valid = person("person-valid", "Valid");
    const invalid = person("person-invalid", "Invalid", { createdAt: "not-an-instant" });
    await db.put("people", valid);
    await db.put("people", invalid);
    await db.put("followUps", followUp("follow-up-valid", valid.id, "2026-08-18"));
    await db.put("interactions", {
      id: "interaction-invalid",
      revision: 1,
      personId: invalid.id,
      kind: "contacted",
      occurredAt: "not-an-instant",
      createdAt: now,
      updatedAt: now
    });

    const result = await getUpcomingPeopleProjection(db, clock, "all");
    expect(result.people.map((item) => item.person.id)).toEqual([valid.id]);
    expect(result.evaluationIssues).toEqual([{ personId: invalid.id, displayName: invalid.displayName }]);
  });
});
