import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import type {
  FollowUp,
  OrganisationAffiliation,
  Person,
  ReachOutContext,
  ReachOutEntry
} from "../domain/schema";
import { RELATIONSHIP_ENGINE_POLICY_VERSION } from "../relationship-engine";
import { getTodayActionContext, getTodayScreenProjection } from "./todayQueries";

const now = "2026-08-14T12:00:00.000Z";
const clock = {
  now,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
} as const;
const databaseNames: string[] = [];

const person: Person = {
  id: "person-sarah",
  revision: 1,
  displayName: "Sarah Ahmed",
  identityStatus: "confirmed",
  importance: "high",
  tags: [],
  createdAt: "2025-01-01T12:00:00.000Z",
  updatedAt: "2025-01-01T12:00:00.000Z"
};

const primary: FollowUp = {
  id: "follow-up-primary",
  revision: 1,
  personId: person.id,
  dueDate: "2026-08-13",
  reason: "Send the pilot update",
  actionType: "send_update",
  reachOutEntryId: "reach-out-sarah",
  status: "pending",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z"
};

const additional: FollowUp = {
  ...primary,
  id: "follow-up-additional",
  dueDate: "2026-08-14",
  reason: "Arrange coffee",
  actionType: "arrange_meeting",
  reachOutEntryId: undefined,
  createdAt: "2026-08-02T12:00:00.000Z",
  updatedAt: "2026-08-02T12:00:00.000Z"
};

const entry: ReachOutEntry = {
  id: "reach-out-sarah",
  revision: 1,
  personId: person.id,
  reason: "Share the NHS AI pilot update",
  intendedActionType: "send_update",
  intentStatus: "active",
  currentFollowUpId: primary.id,
  contextIds: ["context-fellowship"],
  addedAt: "2026-08-01T12:00:00.000Z",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z"
};

const context: ReachOutContext = {
  id: "context-fellowship",
  revision: 1,
  kind: "fellowship",
  label: "AI Fellowship",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z"
};

const affiliation: OrganisationAffiliation = {
  id: "affiliation-sarah",
  revision: 1,
  personId: person.id,
  organisationName: "NHS England",
  role: "Fellow",
  isCurrent: true,
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z"
};

async function openDatabase(): Promise<PeopleOsDatabase> {
  const name = `peopleos-v110-today-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return openPeopleOsDatabase(name, now);
}

async function seedDuePerson(db: PeopleOsDatabase): Promise<void> {
  const tx = db.transaction([
    "people", "followUps", "reachOutEntries", "reachOutContexts", "affiliations",
    "contactMethods", "metadata"
  ], "readwrite");
  await tx.objectStore("people").add(person);
  await tx.objectStore("followUps").add(primary);
  await tx.objectStore("followUps").add(additional);
  await tx.objectStore("reachOutEntries").add(entry);
  await tx.objectStore("reachOutContexts").add(context);
  await tx.objectStore("affiliations").add(affiliation);
  await tx.objectStore("contactMethods").add({
    id: "contact-email",
    revision: 1,
    personId: person.id,
    kind: "email",
    label: "NHS email",
    rawValue: "Sarah@nhs.net",
    canonicalValue: "sarah@nhs.net",
    isPreferred: true,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z"
  });
  const metadata = await tx.objectStore("metadata").get("app");
  await tx.objectStore("metadata").put({ ...metadata!, datasetRevision: 42, updatedAt: now });
  await tx.done;
}

afterEach(async () => {
  for (const name of databaseNames.splice(0)) await deletePeopleOsDatabase(name);
});

describe("V1-10 Today application projection", () => {
  it("joins the engine order to card context and the metadata revision from one snapshot", async () => {
    const db = await openDatabase();
    await seedDuePerson(db);
    const projection = await getTodayScreenProjection(db, clock);
    expect(projection).toMatchObject({
      datasetRevision: 42,
      activePersonCount: 1,
      eligibleBeforeSkipsCount: 1,
      skippedEligibleCount: 0,
      evaluationIssues: []
    });
    expect(projection.cards).toHaveLength(1);
    expect(projection.cards[0]).toMatchObject({
      item: {
        personId: person.id,
        eligibilityCode: "explicit_follow_up",
        primaryFollowUpId: primary.id,
        additionalDueFollowUpIds: [additional.id]
      },
      person: { id: person.id, displayName: person.displayName },
      currentAffiliation: { organisationName: "NHS England", role: "Fellow" },
      primaryFollowUp: { id: primary.id },
      additionalDueFollowUps: [{ id: additional.id }],
      reachOut: {
        entry: { id: entry.id, reason: entry.reason },
        contexts: [{ id: context.id, label: context.label }]
      },
      contact: {
        hasActivePhone: false,
        targets: [{ id: "email:contact-email", label: "NHS email", isPreferred: true }]
      }
    });
    const action = await getTodayActionContext(db, person.id, clock);
    expect(action?.projection.datasetRevision).toBe(42);
    expect(action?.card.item.primaryFollowUpId).toBe(primary.id);
    expect(action?.alreadyContactedDefaultReminderDays).toBe(14);
    db.close();
  });

  it("distinguishes an eligible Person suppressed for the current local day", async () => {
    const db = await openDatabase();
    await seedDuePerson(db);
    await db.put("todaySkips", {
      id: `${person.id}:2026-08-14`,
      personId: person.id,
      localDate: "2026-08-14",
      createdAt: now
    });
    const projection = await getTodayScreenProjection(db, clock);
    expect(projection.result.totalCount).toBe(0);
    expect(projection.eligibleBeforeSkipsCount).toBe(1);
    expect(projection.skippedEligibleCount).toBe(1);
    expect(projection.cards).toEqual([]);
    db.close();
  });

  it("omits only the Person whose relationship cannot be evaluated", async () => {
    const db = await openDatabase();
    await seedDuePerson(db);
    await db.put("people", {
      ...person,
      id: "person-invalid",
      displayName: "Invalid date fixture",
      createdAt: "not-an-instant",
      updatedAt: now
    } as Person);
    const projection = await getTodayScreenProjection(db, clock);
    expect(projection.cards.map((card) => card.person.id)).toEqual([person.id]);
    expect(projection.evaluationIssues).toEqual([{
      personId: "person-invalid",
      displayName: "Invalid date fixture"
    }]);
    db.close();
  });
});
