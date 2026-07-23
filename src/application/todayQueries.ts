import {
  DATA_STORE_NAMES,
  type AppMetadata,
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
import {
  resolveContactNowTargets,
  type ContactNowProjection
} from "./contactNow";
import { relationshipBundleFromData } from "./relationshipEngineQueries";

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
  clock: RelationshipClock
): { assessments: RelationshipAssessment[]; issues: TodayEvaluationIssue[] } {
  const assessments: RelationshipAssessment[] = [];
  const issues: TodayEvaluationIssue[] = [];
  for (const person of [...data.people].sort(compareId)) {
    try {
      assessments.push(assessRelationship(relationshipBundleFromData(data, person), clock));
    } catch {
      issues.push({ personId: person.id, displayName: person.displayName });
    }
  }
  return { assessments, issues };
}

function cardFromItem(
  item: TodayItem,
  data: PeopleOsData,
  assessmentsByPerson: ReadonlyMap<string, RelationshipAssessment>
): TodayCardProjection {
  const person = data.people.find((candidate) => candidate.id === item.personId);
  const assessment = assessmentsByPerson.get(item.personId);
  if (!person || !assessment) throw new Error(`Today item ${item.personId} has no Person assessment`);
  const primaryFollowUp = item.primaryFollowUpId
    ? data.followUps.find((followUp) => followUp.id === item.primaryFollowUpId)
    : undefined;
  if (item.primaryFollowUpId && !primaryFollowUp) {
    throw new Error(`Today item ${item.personId} has no primary FollowUp`);
  }
  const additionalDueFollowUps = item.additionalDueFollowUpIds.map((id) => {
    const followUp = data.followUps.find((candidate) => candidate.id === id);
    if (!followUp) throw new Error(`Today item ${item.personId} has a missing additional FollowUp`);
    return followUp;
  });
  const entry = primaryFollowUp?.reachOutEntryId
    ? data.reachOutEntries.find((candidate) => candidate.id === primaryFollowUp.reachOutEntryId)
    : undefined;
  const contactMethods = data.contactMethods.filter((method) => method.personId === person.id);
  const settings = data.appSettings[0];
  if (!settings) throw new Error("PeopleOS settings are missing");
  return {
    item,
    person,
    currentAffiliation: selectDisplayAffiliation(
      data.affiliations.filter((affiliation) => affiliation.personId === person.id)
    ),
    ...(assessment.memoryCue ? { memoryCue: assessment.memoryCue } : {}),
    ...(primaryFollowUp ? { primaryFollowUp } : {}),
    additionalDueFollowUps,
    ...(entry ? {
      reachOut: {
        entry,
        contexts: entry.contextIds.flatMap((contextId) => {
          const context = data.reachOutContexts.find((candidate) => candidate.id === contextId);
          return context ? [context] : [];
        })
      }
    } : {}),
    contact: resolveContactNowTargets(contactMethods, settings.defaultPhoneRegion)
  };
}

/**
 * Build the complete Today view model from one IndexedDB snapshot. The engine
 * still owns eligibility and global order; the application layer only joins
 * stored display/action context to those ordered results.
 */
export async function getTodayScreenProjection(
  db: PeopleOsDatabase,
  clock: RelationshipClock
): Promise<TodayScreenProjection> {
  const { data, metadata } = await readTodaySnapshot(db);
  const { assessments, issues } = assessSnapshot(data, clock);
  const settings = data.appSettings[0];
  if (!settings) throw new Error("PeopleOS settings are missing");
  const result = buildToday({ assessments, todaySkips: data.todaySkips, clock });
  const assessmentsByPerson = new Map(assessments.map((assessment) => [assessment.personId, assessment]));
  const eligibleBeforeSkipsCount = assessments.filter((assessment) => assessment.active && assessment.today).length;
  return {
    result,
    datasetRevision: metadata.datasetRevision,
    alreadyContactedDefaultReminderDays: settings.alreadyContactedDefaultReminderDays,
    activePersonCount: data.people.filter(activePerson).length,
    eligibleBeforeSkipsCount,
    skippedEligibleCount: Math.max(0, eligibleBeforeSkipsCount - result.totalCount),
    cards: result.orderedItems.map((item) => cardFromItem(item, data, assessmentsByPerson)),
    evaluationIssues: issues
  };
}

/** Recalculate immediately before preparing a mutating Today action. */
export async function getTodayActionContext(
  db: PeopleOsDatabase,
  personId: string,
  clock: RelationshipClock
): Promise<TodayActionContext | undefined> {
  const projection = await getTodayScreenProjection(db, clock);
  const card = projection.cards.find((candidate) => candidate.person.id === personId);
  if (!card) return undefined;
  return {
    projection,
    card,
    alreadyContactedDefaultReminderDays: projection.alreadyContactedDefaultReminderDays
  };
}
