/**
 * Differential equivalence harness for V1-R2.
 *
 * V1-R2 changed how relationship projections are computed — grouped bundling,
 * a shared memory-cue fallback, and linear scans replacing full re-sorts — on
 * the promise that nothing observable changes. The 514 functional tests check
 * behaviour the team thought to write down; this checks the far larger space of
 * behaviour nobody wrote down, by running the pre-V1-R2 engine and the current
 * engine over hundreds of randomised datasets and demanding deep equality.
 *
 * The reference is the engine exactly as it stood at commit `d845681`. Datasets
 * are generated from a seeded PRNG and deliberately concentrate on the ties and
 * boundaries where an "obviously equivalent" refactor silently diverges:
 * identical `occurredAt`, identical `dueDate`, snoozed follow-ups, Reach Out
 * linkage, archived and merged People, sole-contact relationships, People with
 * no contact methods, and empty datasets.
 */
import { describe, expect, it } from "vitest";
import { assessRelationship as assessCurrent, buildToday as buildTodayCurrent } from "./engine";
import {
  assessRelationship as assessLegacy,
  buildToday as buildTodayLegacy
} from "./__legacy.engine";
import { RELATIONSHIP_ENGINE_POLICY_VERSION, type RelationshipClock } from "./types";
import type {
  FollowUp,
  Interaction,
  InteractionKind,
  MemoryFact,
  MemoryFactKind,
  OrganisationAffiliation,
  PeopleOsData,
  Person,
  ReachOutEntry,
  RelationshipEvent,
  TodaySkip
} from "../domain/schema";
import { relationshipBundleFromData } from "../application/relationshipEngineQueries";

const NOW = "2026-08-01T09:00:00.000Z";
const TIME_ZONE = "Europe/London";
const CLOCK: RelationshipClock = {
  now: NOW,
  timeZone: TIME_ZONE,
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
};

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: readonly InteractionKind[] = [
  "met", "contacted", "whatsapp_message", "email", "phone_call", "coffee",
  "meeting", "conference", "note_added", "introduction_received", "introduction_made",
  "follow_up_completed"
];
const FACT_KINDS: readonly MemoryFactKind[] = [
  "introduced_by", "interest", "seeking", "family", "communication_preference", "location", "other"
];

/**
 * A handful of shared instants and dates, reused across records on purpose:
 * ties are where ordering bugs live, and random timestamps almost never collide.
 */
const TIE_INSTANTS = [
  "2026-07-01T09:00:00.000Z",
  "2026-07-15T09:00:00.000Z",
  "2026-07-25T09:00:00.000Z",
  "2026-06-01T09:00:00.000Z"
] as const;
const TIE_DATES = ["2026-07-20", "2026-08-01", "2026-08-02", "2026-07-31"] as const;

function randomDataset(seed: number): PeopleOsData {
  const random = seededRandom(seed);
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const integer = (minimum: number, maximum: number) =>
    minimum + Math.floor(random() * (maximum - minimum + 1));

  const personCount = integer(0, 12);
  const events: RelationshipEvent[] = Array.from({ length: integer(0, 3) }, (_unused, index) => ({
    id: `event-${index}`,
    revision: 1,
    name: `Event ${index}`,
    occurredOn: pick(TIE_DATES),
    createdAt: NOW,
    updatedAt: NOW
  }));

  const people: Person[] = [];
  const interactions: Interaction[] = [];
  const followUps: FollowUp[] = [];
  const memoryFacts: MemoryFact[] = [];
  const affiliations: OrganisationAffiliation[] = [];
  const contactMethods: PeopleOsData["contactMethods"] = [];
  const reachOutEntries: ReachOutEntry[] = [];
  const todaySkips: TodaySkip[] = [];

  for (let index = 0; index < personCount; index += 1) {
    const personId = `person-${index}`;
    const identityRoll = random();
    people.push({
      id: personId,
      revision: 1,
      // Names collide often, so display-name tie-breaks are exercised.
      displayName: pick(["Ana", "ana", "Ána", "Bob", "Bob", "Zoe"]),
      identityStatus: identityRoll < 0.1 ? "merged" : identityRoll < 0.2 ? "provisional" : "confirmed",
      importance: random() < 0.4 ? "high" : "normal",
      tags: [],
      ...(random() < 0.4 ? { contactCadenceDays: pick([7, 30, 90]) } : {}),
      ...(random() < 0.15 ? { archivedAt: pick(TIE_INSTANTS) } : {}),
      createdAt: pick(TIE_INSTANTS),
      updatedAt: NOW
    });

    // Deliberately includes 0 and 1 contact counts: the sole-contact rule and
    // the no-contact branch are both easy to break.
    for (let i = 0; i < integer(0, 4); i += 1) {
      interactions.push({
        id: `interaction-${index}-${i}`,
        revision: 1,
        personId,
        kind: pick(KINDS),
        occurredAt: pick(TIE_INSTANTS),
        ...(random() < 0.4 && events.length ? { eventId: pick(events).id } : {}),
        createdAt: NOW,
        updatedAt: NOW
      });
    }

    for (let i = 0; i < integer(0, 3); i += 1) {
      const dueDate = pick(TIE_DATES);
      followUps.push({
        id: `follow-up-${index}-${i}`,
        revision: 1,
        personId,
        dueDate,
        reason: `Reason ${i}`,
        actionType: pick(["message", "email", "call", "arrange_meeting", "send_update"] as const),
        status: pick(["pending", "pending", "pending", "completed", "cancelled", "superseded"] as const),
        ...(random() < 0.3 ? { snoozedUntilDate: pick(TIE_DATES) } : {}),
        createdAt: pick(TIE_INSTANTS),
        updatedAt: NOW
      });
    }

    for (let i = 0; i < integer(0, 3); i += 1) {
      memoryFacts.push({
        id: `fact-${index}-${i}`,
        revision: 1,
        personId,
        kind: pick(FACT_KINDS),
        value: pick(["whatsapp", "email", "phone", "Cycling", "London"]),
        showAsMemoryCue: random() < 0.7,
        ...(random() < 0.2 ? { archivedAt: pick(TIE_INSTANTS) } : {}),
        createdAt: pick(TIE_INSTANTS),
        // Equal updatedAt values exercise the fact tie-break.
        updatedAt: pick(TIE_INSTANTS)
      });
    }

    if (random() < 0.7) {
      affiliations.push({
        id: `affiliation-${index}`,
        revision: 1,
        personId,
        organisationName: pick(["Acme", "NHS"]),
        ...(random() < 0.6 ? { role: "Fellow" } : {}),
        ...(random() < 0.7 ? { startedOn: pick(TIE_DATES) } : {}),
        isCurrent: random() < 0.8,
        ...(random() < 0.2 ? { archivedAt: pick(TIE_INSTANTS) } : {}),
        createdAt: pick(TIE_INSTANTS),
        updatedAt: NOW
      });
    }

    if (random() < 0.6) {
      contactMethods.push({
        id: `contact-${index}-phone`,
        revision: 1,
        personId,
        kind: "phone",
        rawValue: "07900123456",
        canonicalValue: "+447900123456",
        region: "GB",
        isPreferred: random() < 0.5,
        ...(random() < 0.2 ? { archivedAt: pick(TIE_INSTANTS) } : {}),
        createdAt: NOW,
        updatedAt: NOW
      });
    }
    if (random() < 0.4) {
      contactMethods.push({
        id: `contact-${index}-email`,
        revision: 1,
        personId,
        kind: "email",
        rawValue: `p${index}@example.org`,
        canonicalValue: `p${index}@example.org`,
        isPreferred: random() < 0.5,
        createdAt: NOW,
        updatedAt: NOW
      });
    }

    // Reach Out linkage, including the reciprocal currentFollowUpId pointer.
    if (random() < 0.35) {
      const linked = followUps.filter((followUp) => followUp.personId === personId);
      const target = linked.length ? pick(linked) : undefined;
      if (target) target.reachOutEntryId = `reach-out-${index}`;
      reachOutEntries.push({
        id: `reach-out-${index}`,
        revision: 1,
        personId,
        reason: random() < 0.7 ? "Pilot conversation" : undefined,
        intentStatus: pick(["active", "dormant", "completed"] as const),
        contextIds: [],
        addedAt: pick(TIE_INSTANTS),
        ...(target ? { currentFollowUpId: target.id } : {}),
        ...(random() < 0.3 ? { lastCompletedAt: pick(TIE_INSTANTS) } : {}),
        ...(random() < 0.15 ? { removedAt: pick(TIE_INSTANTS) } : {}),
        createdAt: pick(TIE_INSTANTS),
        updatedAt: NOW
      });
    }

    if (random() < 0.15) {
      todaySkips.push({
        id: `skip-${index}`,
        personId,
        localDate: pick(["2026-08-01", "2026-07-31"]),
        createdAt: NOW
      });
    }
  }

  return {
    people,
    contactMethods,
    affiliations,
    interactions,
    events,
    memoryFacts,
    followUps,
    followUpEvents: [],
    todaySkips,
    reachOutEntries,
    reachOutEvents: [],
    reachOutContexts: [],
    appSettings: []
  };
}

function comparePersonId(left: Person, right: Person): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

const DATASET_COUNT = 500;

describe("V1-R2 differential equivalence", () => {
  it(`produces identical assessments and Today order across ${DATASET_COUNT} randomised datasets`, () => {
    let comparedAssessments = 0;
    let comparedTodayItems = 0;
    let datasetsWithTodayItems = 0;

    for (let seed = 1; seed <= DATASET_COUNT; seed += 1) {
      const data = randomDataset(seed);
      const people = [...data.people].sort(comparePersonId);

      const legacyAssessments = people.map((person) =>
        assessLegacy(relationshipBundleFromData(data, person), CLOCK));
      const currentAssessments = people.map((person) =>
        assessCurrent(relationshipBundleFromData(data, person), CLOCK));

      // Whole-assessment equality, not just the Today slice: stage, age, last
      // contact, both cues, overdue follow-up, suggested reminder and Reach Out
      // states are all consumed by Profile and search.
      expect(currentAssessments, `assessments diverged for dataset seed ${seed}`)
        .toEqual(legacyAssessments);
      comparedAssessments += currentAssessments.length;

      const legacyToday = buildTodayLegacy({
        assessments: legacyAssessments,
        todaySkips: data.todaySkips,
        clock: CLOCK
      });
      const currentToday = buildTodayCurrent({
        assessments: currentAssessments,
        todaySkips: data.todaySkips,
        clock: CLOCK
      });
      expect(currentToday, `Today result diverged for dataset seed ${seed}`).toEqual(legacyToday);
      comparedTodayItems += currentToday.orderedItems.length;
      if (currentToday.totalCount > 0) datasetsWithTodayItems += 1;
    }

    // The harness is worthless if the generator produced nothing interesting.
    expect(comparedAssessments).toBeGreaterThan(2000);
    expect(comparedTodayItems).toBeGreaterThan(200);
    expect(datasetsWithTodayItems).toBeGreaterThan(DATASET_COUNT / 4);
  }, 600_000);

  it("agrees on an empty dataset", () => {
    const empty: PeopleOsData = randomDataset(0);
    expect(buildTodayCurrent({ assessments: [], todaySkips: empty.todaySkips, clock: CLOCK }))
      .toEqual(buildTodayLegacy({ assessments: [], todaySkips: empty.todaySkips, clock: CLOCK }));
  });

  it("agrees when input array order is shuffled", () => {
    // Order independence is a V1-09 guarantee; grouping is the change most
    // likely to have quietly made results depend on input order.
    const data = randomDataset(42);
    const people = [...data.people].sort(comparePersonId);
    const shuffled: PeopleOsData = {
      ...data,
      interactions: [...data.interactions].reverse(),
      followUps: [...data.followUps].reverse(),
      memoryFacts: [...data.memoryFacts].reverse(),
      affiliations: [...data.affiliations].reverse(),
      contactMethods: [...data.contactMethods].reverse()
    };
    for (const person of people) {
      expect(assessCurrent(relationshipBundleFromData(shuffled, person), CLOCK))
        .toEqual(assessLegacy(relationshipBundleFromData(shuffled, person), CLOCK));
    }
  });
});
