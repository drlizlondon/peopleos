/**
 * Dataset generators and compact output rows behind the golden fixtures.
 *
 * These are the same seeded generators the V1-R2 and V1-R6 executable oracles
 * used, lifted out of those tests when the frozen implementation copies were
 * retired. Keeping the generators means the goldens still cover the awkward
 * inputs the oracles were built around — ties on `occurredAt` and `dueDate`,
 * archived and merged People, sole-contact relationships, accented and
 * duplicate names, shared phone numbers, and queries that match nothing.
 *
 * Nothing here may use `Math.random` or the wall clock: goldens are worthless
 * if regenerating them produces different data.
 */
import {
  assessRelationship,
  buildToday,
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  type RelationshipClock
} from "../relationship-engine";
import {
  assessmentsForSearch,
  personFilterOptionsFromData,
  searchPeopleFromData,
  type PersonSearchFilters
} from "../application/personSearch";
import { relationshipBundleFromData } from "../application/relationshipEngineQueries";
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
  RelationshipEvent,
  TodaySkip
} from "../domain/schema";

const NOW = "2026-08-01T09:00:00.000Z";
export const GOLDEN_CLOCK: RelationshipClock = {
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

export function engineDataset(seed: number): PeopleOsData {
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
    externalIdentities: [],
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


/**
 * Names, organisations, events, facts, tags and notes all deliberately draw on
 * the same small vocabulary, so a query collides across several sources at once
 * and the tier ordering is actually exercised rather than trivially decided.
 */
const VOCAB = ["sarah", "sam", "fellowship", "nhs", "pilot", "london", "acme"] as const;
const NAMES = ["Sarah Ahmed", "sarah ahmed", "Sam Okonkwo", "Sára Novak", "Pilot Sarah", "NHS Sam"] as const;
const SEARCH_TIE_INSTANTS = [
  "2026-07-01T09:00:00.000Z",
  "2026-07-15T09:00:00.000Z",
  "2026-06-01T09:00:00.000Z"
] as const;
const SEARCH_TIE_DATES = ["2026-07-20", "2026-08-01", "2026-08-05"] as const;
const SEARCH_KINDS: readonly InteractionKind[] = [
  "met", "contacted", "email", "phone_call", "coffee", "conference", "note_added", "introduction_received"
];
const SEARCH_FACT_KINDS: readonly MemoryFactKind[] = [
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

export function searchDataset(seed: number): PeopleOsData {
  const random = seededRandom(seed);
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const integer = (minimum: number, maximum: number) =>
    minimum + Math.floor(random() * (maximum - minimum + 1));

  const events: RelationshipEvent[] = Array.from({ length: integer(1, 3) }, (_unused, index) => ({
    id: `event-${index}`,
    revision: 1,
    // Event names share the query vocabulary so event matches actually fire.
    name: `${pick(VOCAB)} ${index}`,
    occurredOn: pick(SEARCH_TIE_DATES),
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
      ...(random() < 0.2 ? { archivedAt: pick(SEARCH_TIE_INSTANTS) } : {}),
      createdAt: pick(SEARCH_TIE_INSTANTS),
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
        ...(random() < 0.2 ? { archivedAt: pick(SEARCH_TIE_INSTANTS) } : {}),
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
        ...(random() < 0.7 ? { startedOn: pick(SEARCH_TIE_DATES) } : {}),
        isCurrent: random() < 0.6,
        ...(random() < 0.15 ? { archivedAt: pick(SEARCH_TIE_INSTANTS) } : {}),
        createdAt: pick(SEARCH_TIE_INSTANTS),
        updatedAt: NOW
      });
    }

    for (let i = 0; i < integer(0, 3); i += 1) {
      interactions.push({
        id: `interaction-${index}-${i}`,
        revision: 1,
        personId,
        kind: pick(SEARCH_KINDS),
        occurredAt: pick(SEARCH_TIE_INSTANTS),
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
        kind: pick(SEARCH_FACT_KINDS),
        value: pick([...VOCAB, "whatsapp", "email", "Looking for pilot sites"]),
        showAsMemoryCue: random() < 0.7,
        ...(random() < 0.15 ? { archivedAt: pick(SEARCH_TIE_INSTANTS) } : {}),
        createdAt: pick(SEARCH_TIE_INSTANTS),
        updatedAt: pick(SEARCH_TIE_INSTANTS)
      });
    }

    for (let i = 0; i < integer(0, 2); i += 1) {
      followUps.push({
        id: `follow-up-${index}-${i}`,
        revision: 1,
        personId,
        dueDate: pick(SEARCH_TIE_DATES),
        reason: `Follow up about ${pick(VOCAB)}`,
        actionType: pick(["message", "email", "call"] as const),
        status: pick(["pending", "pending", "completed", "cancelled"] as const),
        ...(random() < 0.25 ? { snoozedUntilDate: pick(SEARCH_TIE_DATES) } : {}),
        createdAt: pick(SEARCH_TIE_INSTANTS),
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
        addedAt: pick(SEARCH_TIE_INSTANTS),
        ...(random() < 0.15 ? { removedAt: pick(SEARCH_TIE_INSTANTS) } : {}),
        createdAt: pick(SEARCH_TIE_INSTANTS),
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
    todaySummaryNotificationsEnabled: false,
    todaySummaryNotificationTime: "12:00",
    createdAt: NOW,
    updatedAt: NOW
  }];

  return {
    people,
    contactMethods,
    externalIdentities: [],
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


export const GOLDEN_QUERIES = QUERIES;
export const GOLDEN_FILTER_SETS: readonly PersonSearchFilters[] = FILTER_SETS;

function comparePersonId(left: Person, right: Person): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Compact, readable renderings of behaviour.
 *
 * Full assessment objects would make the fixtures megabytes of nested noise and
 * nobody would read the diff — which is the only thing that makes a golden
 * useful. These keep every decision that is observable to a user (eligibility,
 * order, explanation codes and their source facts, cue text, match tier and
 * ordering) and drop the redundancy.
 */
function renderFacts(facts: ReadonlyArray<{ label: string; value: string; sourceId?: string }>): string {
  return facts.map((fact) => `${fact.label}=${fact.value}${fact.sourceId ? `@${fact.sourceId}` : ""}`).join("|");
}

export function engineGoldenRow(seed: number): unknown {
  const data = engineDataset(seed);
  const people = [...data.people].sort(comparePersonId);
  const assessments = people.map((person) =>
    assessRelationship(relationshipBundleFromData(data, person), GOLDEN_CLOCK));
  const today = buildToday({ assessments, todaySkips: data.todaySkips, clock: GOLDEN_CLOCK });
  return {
    seed,
    today: today.orderedItems.map((item) => [
      item.personId,
      item.eligibilityCode,
      item.dueState,
      item.relevantDate,
      item.primaryFollowUpId ?? "",
      item.additionalDueFollowUpIds.join(","),
      item.explanation.code,
      item.explanation.templateKey,
      renderFacts(item.explanation.facts),
      item.intendedActionContext.code,
      item.intendedActionContext.source,
      renderFacts(item.intendedActionContext.explanation.facts)
    ].join(" ~ ")),
    assessments: assessments.map((assessment) => [
      assessment.personId,
      assessment.active ? "active" : "inactive",
      assessment.relationshipStage.value,
      `${assessment.relationshipStage.contactCount}/${assessment.relationshipStage.contactSpanDays}`,
      assessment.lastContactAt ?? "",
      assessment.relationshipAge.startDate,
      assessment.memoryCue ? `${assessment.memoryCue.source}:${assessment.memoryCue.text}` : "",
      assessment.searchContextCue ? `${assessment.searchContextCue.source}:${assessment.searchContextCue.text}` : "",
      assessment.overdueFollowUp?.followUpId ?? "",
      assessment.suggestedReminder ? `${assessment.suggestedReminder.rule}:${assessment.suggestedReminder.dueDate}` : "",
      assessment.reachOutStates.map((state) => `${state.reachOutEntryId}:${state.state}:${state.effectiveDate ?? ""}`).join(",")
    ].join(" ~ "))
  };
}

export function searchGoldenRow(seed: number): unknown {
  const data = searchDataset(seed);
  const assessments = assessmentsForSearch(data, GOLDEN_CLOCK);
  const combinations = [0, 1, 2, 3].map((offset) => {
    const query = GOLDEN_QUERIES[(seed * 4 + offset) % GOLDEN_QUERIES.length];
    const filters = GOLDEN_FILTER_SETS[(seed + offset) % GOLDEN_FILTER_SETS.length];
    const results = searchPeopleFromData(data, { clock: GOLDEN_CLOCK, query, filters }, assessments);
    return {
      query,
      filters,
      // Order is the product, so the sequence itself is the fixture.
      results: results.map((result) => [
        result.person.id,
        result.match ? `${result.match.source}#${result.match.tier}` : "-",
        result.match?.label ?? "",
        result.match?.value ?? "",
        result.recognitionCue ? `${result.recognitionCue.source}:${result.recognitionCue.text}` : "",
        result.currentAffiliation?.organisationName ?? "",
        result.hasDueFollowUp ? "due" : "-",
        result.missingContactDetails ? "no-contact" : "-"
      ].join(" ~ "))
    };
  });
  const options = personFilterOptionsFromData(data, GOLDEN_CLOCK, assessments);
  return {
    seed,
    combinations,
    filterOptions: {
      tags: options.tags,
      currentOrganisations: options.currentOrganisations,
      events: options.events.map((event) => event.name),
      relationshipStages: options.relationshipStages
    }
  };
}

/** Deterministic, dependency-free digest so every seed is covered cheaply. */
export function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code + index, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
