/**
 * Differential equivalence oracle for search ranking (V1-R6).
 *
 * Ranking decides which People a user can find and in what order, across eleven
 * match sources. A performance change that silently reorders a tier, drops a
 * source, or shifts a tie-break produces a product that still looks like it
 * works — the failure mode is a contact the user cannot find six weeks later,
 * with nothing in the logs. The 519 functional tests cover the behaviour
 * somebody thought to write down; this covers the space nobody wrote down.
 *
 * The reference is `__legacy.personSearch.ts`, frozen at commit `c8bcc86`
 * before any ranking optimisation. This file must be green before, during and
 * after every change V1-R6 makes.
 *
 * It asserts the FULL result list including order, not just membership: order
 * is the product here.
 */
import { describe, expect, it } from "vitest";
import {
  assessmentsForSearch,
  personFilterOptionsFromData,
  searchPeopleFromData,
  type PersonSearchFilters,
  type PersonSearchSource
} from "./personSearch";
import {
  legacyPersonFilterOptionsFromData,
  legacySearchPeopleFromData
} from "./__legacy.personSearch";
import { RELATIONSHIP_ENGINE_POLICY_VERSION, type RelationshipClock } from "../relationship-engine";
import type {
  AppSettings,
  ContactMethod,
  FollowUp,
  Interaction,
  InteractionKind,
  MemoryFact,
  MemoryFactKind,
  OrganisationAffiliation,
  PeopleOsData,
  Person,
  ReachOutContext,
  ReachOutEntry,
  RelationshipEvent
} from "../domain/schema";

const NOW = "2026-08-01T09:00:00.000Z";
const CLOCK: RelationshipClock = {
  now: NOW,
  timeZone: "Europe/London",
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

/**
 * Names, organisations, events, facts, tags and notes all deliberately draw on
 * the same small vocabulary, so a query collides across several sources at once
 * and the tier ordering is actually exercised rather than trivially decided.
 */
const VOCAB = ["sarah", "sam", "fellowship", "nhs", "pilot", "london", "acme"] as const;
const NAMES = ["Sarah Ahmed", "sarah ahmed", "Sam Okonkwo", "Sára Novak", "Pilot Sarah", "NHS Sam"] as const;
const TIE_INSTANTS = [
  "2026-07-01T09:00:00.000Z",
  "2026-07-15T09:00:00.000Z",
  "2026-06-01T09:00:00.000Z"
] as const;
const TIE_DATES = ["2026-07-20", "2026-08-01", "2026-08-05"] as const;
const KINDS: readonly InteractionKind[] = [
  "met", "contacted", "email", "phone_call", "coffee", "conference", "note_added", "introduction_received"
];
const FACT_KINDS: readonly MemoryFactKind[] = [
  "introduced_by", "interest", "seeking", "family", "communication_preference", "location", "other"
];

/** Queries chosen to hit every source, plus formats that exercise contact identity. */
const QUERIES = [
  "", "sarah", "sam", "sára", "SARAH", "fellowship", "nhs", "pilot", "london", "acme",
  "sarah ahmed", "ahm", "+447900123456", "07900 123456", "07900123456",
  "person3@example.org", "PERSON3@EXAMPLE.ORG", "zzzz no match", "a"
] as const;

const FILTER_SETS: readonly PersonSearchFilters[] = [
  {},
  { archive: "active" },
  { archive: "archived" },
  { archive: "all" },
  { tags: ["fellowship"] },
  { currentOrganisations: ["Acme"] },
  { relationshipStages: ["new"] },
  { relationshipStages: ["growing", "established"] },
  { hasDueFollowUp: true },
  { missingContactDetails: true },
  { archive: "all", tags: ["nhs"], hasDueFollowUp: false }
];

function randomDataset(seed: number): PeopleOsData {
  const random = seededRandom(seed);
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const integer = (minimum: number, maximum: number) =>
    minimum + Math.floor(random() * (maximum - minimum + 1));

  const events: RelationshipEvent[] = Array.from({ length: integer(1, 3) }, (_unused, index) => ({
    id: `event-${index}`,
    revision: 1,
    // Event names share the query vocabulary so event matches actually fire.
    name: `${pick(VOCAB)} ${index}`,
    occurredOn: pick(TIE_DATES),
    createdAt: NOW,
    updatedAt: NOW
  }));

  const reachOutContexts: ReachOutContext[] = Array.from({ length: integer(1, 3) }, (_unused, index) => ({
    id: `ro-context-${index}`,
    revision: 1,
    kind: pick(["project", "organisation", "event", "fellowship", "other"] as const),
    label: `${pick(VOCAB)} context ${index}`,
    createdAt: NOW,
    updatedAt: NOW
  }));

  const people: Person[] = [];
  const contactMethods: ContactMethod[] = [];
  const affiliations: OrganisationAffiliation[] = [];
  const interactions: Interaction[] = [];
  const memoryFacts: MemoryFact[] = [];
  const followUps: FollowUp[] = [];
  const reachOutEntries: ReachOutEntry[] = [];

  for (let index = 0; index < integer(4, 16); index += 1) {
    const personId = `person-${index}`;
    const identityRoll = random();
    people.push({
      id: personId,
      revision: 1,
      // Repeated and case/accent-varying names drive the display-name tie-break.
      displayName: pick(NAMES),
      identityStatus: identityRoll < 0.08 ? "merged" : identityRoll < 0.16 ? "provisional" : "confirmed",
      importance: random() < 0.3 ? "high" : "normal",
      tags: random() < 0.5 ? [pick(VOCAB)] : [],
      ...(random() < 0.3 ? { contactCadenceDays: pick([30, 90]) } : {}),
      ...(random() < 0.2 ? { archivedAt: pick(TIE_INSTANTS) } : {}),
      createdAt: pick(TIE_INSTANTS),
      updatedAt: NOW
    });

    // Contact identity: a shared canonical number across People forces the
    // contact-identity tier to resolve ties rather than pick a lone match.
    if (random() < 0.7) {
      contactMethods.push({
        id: `contact-${index}-phone`,
        revision: 1,
        personId,
        kind: "phone",
        rawValue: "07900 123456",
        canonicalValue: "+447900123456",
        region: "GB",
        isPreferred: random() < 0.5,
        ...(random() < 0.2 ? { archivedAt: pick(TIE_INSTANTS) } : {}),
        createdAt: NOW,
        updatedAt: NOW
      });
    }
    if (random() < 0.5) {
      contactMethods.push({
        id: `contact-${index}-email`,
        revision: 1,
        personId,
        kind: "email",
        rawValue: `person${index % 4}@example.org`,
        canonicalValue: `person${index % 4}@example.org`,
        isPreferred: random() < 0.5,
        createdAt: NOW,
        updatedAt: NOW
      });
    }

    // Both current and past affiliations, which are separate tiers.
    for (let i = 0; i < integer(0, 2); i += 1) {
      affiliations.push({
        id: `affiliation-${index}-${i}`,
        revision: 1,
        personId,
        organisationName: pick(["Acme", "NHS", "Fellowship Trust"]),
        ...(random() < 0.6 ? { role: pick(["Fellow", "Pilot lead", "Sarah's deputy"]) } : {}),
        ...(random() < 0.7 ? { startedOn: pick(TIE_DATES) } : {}),
        isCurrent: random() < 0.6,
        ...(random() < 0.15 ? { archivedAt: pick(TIE_INSTANTS) } : {}),
        createdAt: pick(TIE_INSTANTS),
        updatedAt: NOW
      });
    }

    for (let i = 0; i < integer(0, 3); i += 1) {
      interactions.push({
        id: `interaction-${index}-${i}`,
        revision: 1,
        personId,
        kind: pick(KINDS),
        occurredAt: pick(TIE_INSTANTS),
        // Note text carries the vocabulary so the note tier fires.
        ...(random() < 0.7 ? { summary: `Talked about ${pick(VOCAB)}` } : {}),
        ...(random() < 0.5 ? { eventId: pick(events).id } : {}),
        createdAt: NOW,
        updatedAt: NOW
      });
    }

    for (let i = 0; i < integer(0, 3); i += 1) {
      memoryFacts.push({
        id: `fact-${index}-${i}`,
        revision: 1,
        personId,
        kind: pick(FACT_KINDS),
        value: pick([...VOCAB, "whatsapp", "email", "Looking for pilot sites"]),
        showAsMemoryCue: random() < 0.7,
        ...(random() < 0.15 ? { archivedAt: pick(TIE_INSTANTS) } : {}),
        createdAt: pick(TIE_INSTANTS),
        updatedAt: pick(TIE_INSTANTS)
      });
    }

    for (let i = 0; i < integer(0, 2); i += 1) {
      followUps.push({
        id: `follow-up-${index}-${i}`,
        revision: 1,
        personId,
        dueDate: pick(TIE_DATES),
        reason: `Follow up about ${pick(VOCAB)}`,
        actionType: pick(["message", "email", "call"] as const),
        status: pick(["pending", "pending", "completed", "cancelled"] as const),
        ...(random() < 0.25 ? { snoozedUntilDate: pick(TIE_DATES) } : {}),
        createdAt: pick(TIE_INSTANTS),
        updatedAt: NOW
      });
    }

    if (random() < 0.4) {
      reachOutEntries.push({
        id: `reach-out-${index}`,
        revision: 1,
        personId,
        reason: `Reconnect about ${pick(VOCAB)}`,
        intentStatus: pick(["active", "dormant", "completed"] as const),
        contextIds: random() < 0.6 ? [pick(reachOutContexts).id] : [],
        addedAt: pick(TIE_INSTANTS),
        ...(random() < 0.15 ? { removedAt: pick(TIE_INSTANTS) } : {}),
        createdAt: pick(TIE_INSTANTS),
        updatedAt: NOW
      });
    }
  }

  const appSettings: AppSettings[] = [{
    id: "app",
    revision: 1,
    defaultPhoneRegion: "GB",
    captureMode: "standard",
    alreadyContactedDefaultReminderDays: 14,
    createdAt: NOW,
    updatedAt: NOW
  }];

  return {
    people,
    contactMethods,
    affiliations,
    interactions,
    events,
    memoryFacts,
    followUps,
    followUpEvents: [],
    todaySkips: [],
    reachOutEntries,
    reachOutEvents: [],
    reachOutContexts,
    appSettings
  };
}

const ALL_SOURCES: readonly PersonSearchSource[] = [
  "display_name_exact", "display_name_prefix", "name_token_prefix", "contact_identity",
  "current_affiliation", "event", "memory_fact", "tag", "note", "past_affiliation", "reach_out"
];

const DATASET_COUNT = 500;

describe("V1-R6 search ranking equivalence", () => {
  it(`matches the frozen implementation across ${DATASET_COUNT} datasets, every query and every filter set`, () => {
    const seenSources = new Set<PersonSearchSource>();
    let comparisons = 0;
    let nonEmptyResults = 0;

    for (let seed = 1; seed <= DATASET_COUNT; seed += 1) {
      const data = randomDataset(seed);
      const assessments = assessmentsForSearch(data, CLOCK);

      // Rotate through queries and filters so every dataset exercises several
      // different combinations without the suite becoming quadratic.
      for (let offset = 0; offset < 4; offset += 1) {
        const query = QUERIES[(seed * 4 + offset) % QUERIES.length];
        const filters = FILTER_SETS[(seed + offset) % FILTER_SETS.length];
        const options = { clock: CLOCK, query, filters };

        const current = searchPeopleFromData(data, options, assessments);
        const legacy = legacySearchPeopleFromData(data, options, assessments);

        expect(
          current,
          `results diverged for seed ${seed}, query "${query}", filters ${JSON.stringify(filters)}`
        ).toEqual(legacy);
        // Order is the product: assert the id sequence explicitly, so a
        // membership-preserving reordering can never pass unnoticed.
        expect(
          current.map((result) => result.person.id),
          `result ORDER diverged for seed ${seed}, query "${query}"`
        ).toEqual(legacy.map((result) => result.person.id));

        for (const result of current) if (result.match) seenSources.add(result.match.source);
        comparisons += current.length;
        if (current.length > 0) nonEmptyResults += 1;
      }

      expect(
        personFilterOptionsFromData(data, CLOCK, assessments),
        `filter options diverged for seed ${seed}`
      ).toEqual(legacyPersonFilterOptionsFromData(data, CLOCK, assessments));
    }

    // An oracle that never produced a match would pass vacuously.
    const missingSources = ALL_SOURCES.filter((source) => !seenSources.has(source));
    expect(
      missingSources,
      `generator never produced these match sources: ${missingSources.join(", ")}`
    ).toEqual([]);
    expect(comparisons).toBeGreaterThan(2000);
    expect(nonEmptyResults).toBeGreaterThan(DATASET_COUNT / 2);
  }, 900_000);

  it("matches on every query against one rich dataset", () => {
    // Query rotation above means any single dataset sees one query; this sweeps
    // every query against one dataset so query-shape differences are covered.
    const data = randomDataset(7);
    const assessments = assessmentsForSearch(data, CLOCK);
    for (const query of QUERIES) {
      for (const filters of FILTER_SETS) {
        const options = { clock: CLOCK, query, filters };
        expect(
          searchPeopleFromData(data, options, assessments),
          `diverged for query "${query}" with filters ${JSON.stringify(filters)}`
        ).toEqual(legacySearchPeopleFromData(data, options, assessments));
      }
    }
  }, 900_000);

  it("agrees when the input arrays are shuffled", () => {
    const data = randomDataset(23);
    const shuffled: PeopleOsData = {
      ...data,
      interactions: [...data.interactions].reverse(),
      memoryFacts: [...data.memoryFacts].reverse(),
      affiliations: [...data.affiliations].reverse(),
      contactMethods: [...data.contactMethods].reverse(),
      followUps: [...data.followUps].reverse()
    };
    const assessments = assessmentsForSearch(shuffled, CLOCK);
    for (const query of ["sarah", "acme", "", "pilot"]) {
      const options = { clock: CLOCK, query };
      expect(searchPeopleFromData(shuffled, options, assessments))
        .toEqual(legacySearchPeopleFromData(shuffled, options, assessments));
    }
  });
});
