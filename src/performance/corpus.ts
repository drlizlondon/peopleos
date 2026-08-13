/**
 * Deterministic reference corpus for the V1-R performance ratchet.
 *
 * SCALE_REMEDIATION_PLAN.md §2 fixes this shape: 3,000 People and ~45,000
 * Interactions, the size PeopleOS must stay calm at. Every value here comes
 * from a seeded generator — no `Math.random`, no `Date.now` — so two runs on
 * two machines produce byte-identical records and the ratchet measures code
 * changes rather than fixture drift.
 */
import {
  DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS,
  DEFAULT_CONVERSATION_STARTERS,
  type AppSettings,
  type ContactMethod,
  type FollowUp,
  type Interaction,
  type InteractionKind,
  type LocalDate,
  type MemoryFact,
  type MemoryFactKind,
  type OrganisationAffiliation,
  type PeopleOsData,
  type Person,
  type ReachOutContext,
  type ReachOutEntry,
  type RelationshipEvent
} from "../domain/schema";

/** The instant the corpus is evaluated at. Fixed so due/overdue splits are stable. */
export const CORPUS_NOW = "2026-08-01T09:00:00.000Z";
export const CORPUS_TIME_ZONE = "Europe/London";
export const CORPUS_LOCAL_DATE: LocalDate = "2026-08-01";

export const CORPUS_SHAPE = {
  people: 3000,
  events: 40,
  reachOutContexts: 25,
  /** Interactions are distributed per Person; this is the exact resulting total. */
  expectedInteractions: 45_000,
  expectedPendingFollowUps: 750,
  expectedReachOutEntries: 200
} as const;

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
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

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

function integer(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

const DAY_MS = 86_400_000;
const CORPUS_NOW_MS = Date.parse(CORPUS_NOW);

function instantDaysAgo(days: number): string {
  return new Date(CORPUS_NOW_MS - days * DAY_MS).toISOString();
}

function localDateDaysFromNow(days: number): LocalDate {
  return new Date(CORPUS_NOW_MS + days * DAY_MS).toISOString().slice(0, 10);
}

const FIRST_NAMES = [
  "Sarah", "Amara", "Joy", "Noor", "Priya", "Tom", "Rachel", "Idris", "Mei", "Ola",
  "Fatima", "Daniel", "Grace", "Hassan", "Lucy", "Marcus", "Nia", "Omar", "Ruth", "Sam"
] as const;
const LAST_NAMES = [
  "Ahmed", "Okonkwo", "Bennett", "Chen", "Duarte", "Ellis", "Farah", "Gray", "Hughes", "Iqbal",
  "Jensen", "Kaur", "Lawson", "Mbeki", "Nowak", "Oyelaran", "Patel", "Quinn", "Rahman", "Silva"
] as const;
const ORGANISATIONS = [
  "NHS Fellowship", "Founders Forum", "Wellcome Trust", "Imperial College", "Seedcamp",
  "Bethnal Green Ventures", "Guy's and St Thomas'", "Entrepreneur First", "Zinc VC", "NIHR"
] as const;
const ROLES = ["Fellow", "Consultant", "Founder", "Partner", "Researcher", "Advisor"] as const;
const EVENT_NAMES = [
  "AI Fellowship", "HealthTech Summit", "Founders Dinner", "NHS Expo", "Demo Day",
  "Clinical AI Workshop", "Investor Breakfast", "Digital Health Rewired"
] as const;

/** Weighted to match real contact behaviour: most kinds count as contact, notes do not. */
const INTERACTION_KINDS: readonly InteractionKind[] = [
  "met", "contacted", "whatsapp_message", "email", "phone_call", "coffee",
  "meeting", "conference", "note_added", "introduction_received"
];
const FACT_KINDS: readonly MemoryFactKind[] = [
  "interest", "seeking", "location", "family", "communication_preference", "introduced_by"
];
const FACT_VALUES: Record<string, readonly string[]> = {
  interest: ["Cycling", "Open water swimming", "Jazz", "Rock climbing", "Pottery"],
  seeking: ["Clinical partners", "Seed investment", "A technical co-founder", "NHS pilot sites"],
  location: ["London", "Manchester", "Edinburgh", "Bristol", "Leeds"],
  family: ["Two daughters", "Newborn son", "Moving house in spring"],
  communication_preference: ["whatsapp", "email", "phone"],
  introduced_by: ["Priya Patel", "Tom Bennett", "Idris Farah"]
};

/**
 * Person shapes, chosen so the corpus exercises every Today rule rather than
 * one hot path. Proportions approximate a real professional network: most
 * contacts are dormant, a minority carry active plans.
 */
type PersonShape = "dormant" | "cadence" | "due_follow_up" | "overdue_follow_up" | "future_follow_up" | "new_relationship";

const SHAPE_WEIGHTS: readonly (readonly [PersonShape, number])[] = [
  ["dormant", 0.55],
  ["cadence", 0.14],
  ["future_follow_up", 0.12],
  ["due_follow_up", 0.08],
  ["overdue_follow_up", 0.07],
  ["new_relationship", 0.04]
];

function shapeFor(random: () => number): PersonShape {
  const roll = random();
  let cumulative = 0;
  for (const [shape, weight] of SHAPE_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return shape;
  }
  return "dormant";
}

/**
 * Build the reference corpus. `seed` is fixed by default; pass a different one
 * only for differential testing, never for the ratchet.
 */
export function buildReferenceCorpus(seed = 20260725): PeopleOsData {
  const random = seededRandom(seed);

  const events: RelationshipEvent[] = Array.from({ length: CORPUS_SHAPE.events }, (_unused, index) => ({
    id: `event-${String(index).padStart(3, "0")}`,
    revision: 1,
    name: `${EVENT_NAMES[index % EVENT_NAMES.length]} ${2024 + (index % 3)}`,
    occurredOn: localDateDaysFromNow(-integer(random, 30, 900)),
    location: pick(random, ["London", "Manchester", "Online", "Cambridge"]),
    createdAt: CORPUS_NOW,
    updatedAt: CORPUS_NOW
  }));

  const reachOutContexts: ReachOutContext[] = Array.from(
    { length: CORPUS_SHAPE.reachOutContexts },
    (_unused, index) => ({
      id: `ro-context-${String(index).padStart(3, "0")}`,
      revision: 1,
      kind: pick(random, ["project", "organisation", "event", "fellowship", "other"] as const),
      label: `${pick(random, ORGANISATIONS)} ${index}`,
      createdAt: CORPUS_NOW,
      updatedAt: CORPUS_NOW
    })
  );

  const people: Person[] = [];
  const contactMethods: ContactMethod[] = [];
  const affiliations: OrganisationAffiliation[] = [];
  const interactions: Interaction[] = [];
  const memoryFacts: MemoryFact[] = [];
  const followUps: FollowUp[] = [];
  const reachOutEntries: ReachOutEntry[] = [];

  let interactionBudget = CORPUS_SHAPE.expectedInteractions;
  let pendingFollowUpBudget = CORPUS_SHAPE.expectedPendingFollowUps;
  let reachOutBudget = CORPUS_SHAPE.expectedReachOutEntries;

  for (let index = 0; index < CORPUS_SHAPE.people; index += 1) {
    const personId = `person-${String(index).padStart(5, "0")}`;
    const remainingPeople = CORPUS_SHAPE.people - index;
    const shape = shapeFor(random);
    const createdDaysAgo = integer(random, 1, 1200);

    people.push({
      id: personId,
      revision: 1,
      displayName: `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)} ${index}`,
      identityStatus: random() < 0.02 ? "provisional" : "confirmed",
      importance: random() < 0.12 ? "high" : "normal",
      tags: random() < 0.3 ? [pick(random, ["fellowship", "investor", "clinician", "mentor"])] : [],
      ...(shape === "cadence" ? { contactCadenceDays: pick(random, [30, 60, 90, 180]) } : {}),
      ...(random() < 0.03 ? { archivedAt: instantDaysAgo(integer(random, 1, 200)) } : {}),
      createdAt: instantDaysAgo(createdDaysAgo),
      updatedAt: instantDaysAgo(integer(random, 0, createdDaysAgo))
    });

    // Contact methods: most people have a phone, some also an email, a few neither.
    const contactRoll = random();
    if (contactRoll < 0.85) {
      contactMethods.push({
        id: `contact-${personId}-phone`,
        revision: 1,
        personId,
        kind: "phone",
        rawValue: `07${String(700000000 + index).slice(0, 9)}`,
        canonicalValue: `+447${String(700000000 + index).slice(0, 9)}`,
        region: "GB",
        isPreferred: true,
        createdAt: CORPUS_NOW,
        updatedAt: CORPUS_NOW
      });
    }
    if (contactRoll < 0.5) {
      contactMethods.push({
        id: `contact-${personId}-email`,
        revision: 1,
        personId,
        kind: "email",
        rawValue: `person${index}@example.org`,
        canonicalValue: `person${index}@example.org`,
        isPreferred: false,
        createdAt: CORPUS_NOW,
        updatedAt: CORPUS_NOW
      });
    }

    if (random() < 0.8) {
      affiliations.push({
        id: `affiliation-${personId}`,
        revision: 1,
        personId,
        organisationName: pick(random, ORGANISATIONS),
        role: pick(random, ROLES),
        startedOn: localDateDaysFromNow(-integer(random, 30, 1500)),
        isCurrent: true,
        createdAt: CORPUS_NOW,
        updatedAt: CORPUS_NOW
      });
    }

    // Interactions. `new_relationship` people get exactly one, deliberately, so
    // the sole-contact rule is exercised. Everyone else draws from the remaining
    // budget so the corpus lands on exactly CORPUS_SHAPE.expectedInteractions.
    const averageRemaining = Math.max(0, Math.round(interactionBudget / remainingPeople));
    const interactionCount = shape === "new_relationship"
      ? Math.min(1, interactionBudget)
      : Math.min(interactionBudget, integer(random, 0, Math.max(0, averageRemaining * 2)));
    interactionBudget -= interactionCount;

    for (let i = 0; i < interactionCount; i += 1) {
      const kind = shape === "new_relationship" ? "met" : pick(random, INTERACTION_KINDS);
      const attachEvent = (kind === "met" || kind === "conference") && random() < 0.6;
      const occurredDaysAgo = shape === "new_relationship"
        ? integer(random, 8, 40)
        : integer(random, 0, Math.min(createdDaysAgo, 900));
      interactions.push({
        id: `interaction-${personId}-${String(i).padStart(3, "0")}`,
        revision: 1,
        personId,
        kind,
        occurredAt: instantDaysAgo(occurredDaysAgo),
        summary: `Interaction ${i}`,
        ...(attachEvent ? { eventId: pick(random, events).id } : {}),
        createdAt: CORPUS_NOW,
        updatedAt: CORPUS_NOW
      });
    }

    // Memory facts: ~4 per Person, most cue-enabled.
    const factCount = integer(random, 2, 6);
    for (let i = 0; i < factCount; i += 1) {
      const kind = pick(random, FACT_KINDS);
      memoryFacts.push({
        id: `fact-${personId}-${i}`,
        revision: 1,
        personId,
        kind,
        value: pick(random, FACT_VALUES[kind]),
        showAsMemoryCue: random() < 0.7,
        ...(random() < 0.05 ? { archivedAt: instantDaysAgo(integer(random, 1, 100)) } : {}),
        createdAt: CORPUS_NOW,
        updatedAt: CORPUS_NOW
      });
    }

    // Follow-ups, sized so pending count lands on budget.
    const wantsPending = shape === "due_follow_up" || shape === "overdue_follow_up" || shape === "future_follow_up";
    if (wantsPending && pendingFollowUpBudget > 0) {
      pendingFollowUpBudget -= 1;
      const dueOffset = shape === "overdue_follow_up"
        ? -integer(random, 1, 45)
        : shape === "due_follow_up"
          ? 0
          : integer(random, 1, 120);
      followUps.push({
        id: `follow-up-${personId}`,
        revision: 1,
        personId,
        dueDate: localDateDaysFromNow(dueOffset),
        reason: "Reconnect after the fellowship introduction",
        actionType: pick(random, ["message", "email", "call", "arrange_meeting", "send_update"] as const),
        status: "pending",
        ...(random() < 0.15 ? { snoozedUntilDate: localDateDaysFromNow(dueOffset + integer(random, 1, 7)) } : {}),
        createdAt: instantDaysAgo(integer(random, 1, 90)),
        updatedAt: CORPUS_NOW
      });
    }
    // Completed history exists for many people and must be skipped by the engine.
    if (random() < 0.35) {
      followUps.push({
        id: `follow-up-${personId}-done`,
        revision: 2,
        personId,
        dueDate: localDateDaysFromNow(-integer(random, 50, 400)),
        reason: "Earlier commitment",
        actionType: "message",
        status: "completed",
        completedAt: instantDaysAgo(integer(random, 50, 400)),
        createdAt: instantDaysAgo(integer(random, 400, 800)),
        updatedAt: CORPUS_NOW
      });
    }

    if (reachOutBudget > 0 && random() < 0.08) {
      reachOutBudget -= 1;
      reachOutEntries.push({
        id: `reach-out-${personId}`,
        revision: 1,
        personId,
        reason: "Worth a proper conversation about the pilot",
        intendedActionType: "message",
        intentStatus: random() < 0.8 ? "active" : "dormant",
        contextIds: random() < 0.6 ? [pick(random, reachOutContexts).id] : [],
        addedAt: instantDaysAgo(integer(random, 1, 200)),
        createdAt: instantDaysAgo(integer(random, 1, 200)),
        updatedAt: CORPUS_NOW
      });
    }
  }

  const appSettings: AppSettings[] = [{
    id: "app",
    revision: 1,
    defaultPhoneRegion: "GB",
    captureMode: "standard",
    alreadyContactedDefaultReminderDays: DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS,
    todaySummaryNotificationsEnabled: false,
    todaySummaryNotificationTime: "12:00",
    conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter })),
    createdAt: CORPUS_NOW,
    updatedAt: CORPUS_NOW
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
