import {
  DATA_STORE_NAMES,
  type AppMetadata,
  DEFAULT_CONVERSATION_STARTERS,
  type ConversationStarter,
  type FollowUp,
  type OrganisationAffiliation,
  type PeopleOsData,
  type Person,
  type ReachOutContext,
  type ReachOutEntry
} from "../domain/schema";
import type { PeopleOsDatabase } from "../data/database";
import {
  assessRelationship,
  buildToday,
  type MemoryCueProjection,
  type RelationshipAssessment,
  type RelationshipClock,
  type TodayItem,
  type TodayResult
} from "../relationship-engine";
import { selectDisplayAffiliation } from "./affiliations";
import { personMatchesActiveMode, type ActiveRelationshipMode } from "../domain/relationshipMode";
import {
  resolveContactNowTargets,
  type ContactNowProjection
} from "./contactNow";
import {
  groupRelationshipData,
  relationshipBundleFromGroups,
  type GroupedRelationshipData
} from "./relationshipEngineQueries";

export type TodayEvaluationIssue = {
  personId: string;
  displayName: string;
};

export type TodayReachOutProjection = {
  entry: ReachOutEntry;
  contexts: ReachOutContext[];
};

export type TodayCardProjection = {
  item: TodayItem;
  person: Person;
  currentAffiliation?: OrganisationAffiliation;
  memoryCue?: MemoryCueProjection;
  primaryFollowUp?: FollowUp;
  additionalDueFollowUps: FollowUp[];
  reachOut?: TodayReachOutProjection;
  contact: ContactNowProjection;
  conversationStarters: ConversationStarter[];
};

export type TodayScreenProjection = {
  result: TodayResult;
  datasetRevision: number;
  alreadyContactedDefaultReminderDays: number;
  activePersonCount: number;
  eligibleBeforeSkipsCount: number;
  skippedEligibleCount: number;
  cards: TodayCardProjection[];
  evaluationIssues: TodayEvaluationIssue[];
};

export type TodayActionContext = {
  projection: TodayScreenProjection;
  card: TodayCardProjection;
  alreadyContactedDefaultReminderDays: number;
};

type TodaySnapshot = {
  data: PeopleOsData;
  metadata: AppMetadata;
};

const SNAPSHOT_STORE_NAMES = [...DATA_STORE_NAMES, "metadata"] as const;

async function readTodaySnapshot(db: PeopleOsDatabase): Promise<TodaySnapshot> {
  const tx = db.transaction(SNAPSHOT_STORE_NAMES, "readonly");
  const [entries, metadata] = await Promise.all([
    Promise.all(DATA_STORE_NAMES.map(async (name) => [
      name,
      await tx.objectStore(name).getAll()
    ] as const)),
    tx.objectStore("metadata").get("app")
  ]);
  await tx.done;
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  return { data: Object.fromEntries(entries) as PeopleOsData, metadata };
}

function activePerson(person: Person): boolean {
  return !person.archivedAt && person.identityStatus !== "merged";
}

function compareId(left: Person, right: Person): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function assessSnapshot(
  data: PeopleOsData,
  clock: RelationshipClock,
  activeMode: ActiveRelationshipMode
): {
  assessments: RelationshipAssessment[];
  issues: TodayEvaluationIssue[];
  grouped: GroupedRelationshipData;
} {
  const grouped = groupRelationshipData(data);
  const assessments: RelationshipAssessment[] = [];
  const issues: TodayEvaluationIssue[] = [];
  for (const person of [...data.people].sort(compareId)) {
    if (!personMatchesActiveMode(person, activeMode)) continue;
    try {
      assessments.push(assessRelationship(relationshipBundleFromGroups(grouped, person), clock));
    } catch {
      issues.push({ personId: person.id, displayName: person.displayName });
    }
  }
  return { assessments, issues, grouped };
}

/**
 * Record lookups a card needs, indexed once per snapshot.
 *
 * Card building previously scanned whole collections per card: three `find`s
 * and two `filter`s over every Person, FollowUp, ContactMethod and affiliation
 * in the dataset. With 634 due People in a 3,000-contact dataset that is
 * several million comparisons to assemble a list the user reads ten rows of.
 * Indexing is behaviour-identical — `id` is the object-store key path, so it is
 * unique, and the grouped collections preserve source order exactly as the
 * previous `filter` did.
 */
type CardIndex = {
  peopleById: ReadonlyMap<string, Person>;
  followUpsById: ReadonlyMap<string, FollowUp>;
  reachOutEntriesById: ReadonlyMap<string, ReachOutEntry>;
  reachOutContextsById: ReadonlyMap<string, ReachOutContext>;
  grouped: GroupedRelationshipData;
};

function byId<T extends { id: string }>(records: readonly T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const record of records) index.set(record.id, record);
  return index;
}

function buildCardIndex(data: PeopleOsData, grouped: GroupedRelationshipData): CardIndex {
  return {
    peopleById: byId(data.people),
    followUpsById: byId(data.followUps),
    reachOutEntriesById: byId(data.reachOutEntries),
    reachOutContextsById: byId(data.reachOutContexts),
    grouped
  };
}

function cardFromItem(
  item: TodayItem,
  data: PeopleOsData,
  assessmentsByPerson: ReadonlyMap<string, RelationshipAssessment>,
  index: CardIndex
): TodayCardProjection {
  const person = index.peopleById.get(item.personId);
  const assessment = assessmentsByPerson.get(item.personId);
  if (!person || !assessment) throw new Error(`Today item ${item.personId} has no Person assessment`);
  const primaryFollowUp = item.primaryFollowUpId
    ? index.followUpsById.get(item.primaryFollowUpId)
    : undefined;
  if (item.primaryFollowUpId && !primaryFollowUp) {
    throw new Error(`Today item ${item.personId} has no primary FollowUp`);
  }
  const additionalDueFollowUps = item.additionalDueFollowUpIds.map((id) => {
    const followUp = index.followUpsById.get(id);
    if (!followUp) throw new Error(`Today item ${item.personId} has a missing additional FollowUp`);
    return followUp;
  });
  const entry = primaryFollowUp?.reachOutEntryId
    ? index.reachOutEntriesById.get(primaryFollowUp.reachOutEntryId)
    : undefined;
  const contactMethods = index.grouped.contactMethods.get(person.id) ?? [];
  const settings = data.appSettings[0];
  if (!settings) throw new Error("PeopleOS settings are missing");
  return {
    item,
    person,
    currentAffiliation: selectDisplayAffiliation(index.grouped.affiliations.get(person.id) ?? []),
    ...(assessment.memoryCue ? { memoryCue: assessment.memoryCue } : {}),
    ...(primaryFollowUp ? { primaryFollowUp } : {}),
    additionalDueFollowUps,
    ...(entry ? {
      reachOut: {
        entry,
        contexts: entry.contextIds.flatMap((contextId) => {
          const context = index.reachOutContextsById.get(contextId);
          return context ? [context] : [];
        })
      }
    } : {}),
    contact: resolveContactNowTargets(contactMethods, settings.defaultPhoneRegion),
    conversationStarters: (settings.conversationStarters ?? DEFAULT_CONVERSATION_STARTERS).filter((starter) => {
      const mode = person.relationshipMode ?? "personal";
      return starter.relationshipMode === "both" || mode === "both" || starter.relationshipMode === mode;
    })
  };
}

async function buildTodayProjection(
  db: PeopleOsDatabase,
  clock: RelationshipClock,
  activeMode: ActiveRelationshipMode = "personal",
  /**
   * When set, only this Person's card is assembled. Eligibility, global order
   * and every count still come from the complete evaluation — only the display
   * join is narrowed. Used by the action path, which needs one card and would
   * otherwise assemble hundreds it discards.
   */
  onlyCardFor?: string
): Promise<TodayScreenProjection> {
  const { data, metadata } = await readTodaySnapshot(db);
  const { assessments, issues, grouped } = assessSnapshot(data, clock, activeMode);
  const settings = data.appSettings[0];
  if (!settings) throw new Error("PeopleOS settings are missing");
  const result = buildToday({ assessments, todaySkips: data.todaySkips, clock });
  const assessmentsByPerson = new Map(assessments.map((assessment) => [assessment.personId, assessment]));
  const index = buildCardIndex(data, grouped);
  const eligibleBeforeSkipsCount = assessments.filter((assessment) => assessment.active && assessment.today).length;
  const cardItems = onlyCardFor === undefined
    ? result.orderedItems
    : result.orderedItems.filter((item) => item.personId === onlyCardFor);
  return {
    result,
    datasetRevision: metadata.datasetRevision,
    alreadyContactedDefaultReminderDays: settings.alreadyContactedDefaultReminderDays,
    activePersonCount: data.people.filter((person) => activePerson(person) && personMatchesActiveMode(person, activeMode)).length,
    eligibleBeforeSkipsCount,
    skippedEligibleCount: Math.max(0, eligibleBeforeSkipsCount - result.totalCount),
    cards: cardItems.map((item) => cardFromItem(item, data, assessmentsByPerson, index)),
    evaluationIssues: issues
  };
}

/**
 * Build the complete Today view model from one IndexedDB snapshot. The engine
 * still owns eligibility and global order; the application layer only joins
 * stored display/action context to those ordered results.
 */
export async function getTodayScreenProjection(
  db: PeopleOsDatabase,
  clock: RelationshipClock,
  activeMode: ActiveRelationshipMode = "personal"
): Promise<TodayScreenProjection> {
  return buildTodayProjection(db, clock, activeMode);
}

/**
 * Recalculate immediately before preparing a mutating Today action.
 *
 * The returned `projection` carries the complete `result` — order, counts and
 * the clock the command is validated against — but only the acting Person's
 * card. Callers that need every card must use `getTodayScreenProjection`.
 */
export async function getTodayActionContext(
  db: PeopleOsDatabase,
  personId: string,
  clock: RelationshipClock,
  activeMode: ActiveRelationshipMode = "personal"
): Promise<TodayActionContext | undefined> {
  const projection = await buildTodayProjection(db, clock, activeMode, personId);
  const card = projection.cards.find((candidate) => candidate.person.id === personId);
  if (!card) return undefined;
  return {
    projection,
    card,
    alreadyContactedDefaultReminderDays: projection.alreadyContactedDefaultReminderDays
  };
}
