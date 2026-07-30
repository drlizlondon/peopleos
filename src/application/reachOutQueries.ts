import type { PeopleOsDatabase } from "../data/database";
import { RecordConflictError } from "../data/repositories";
import { effectiveFollowUpDate } from "../domain/followUpPolicy";
import {
  compareReachOutQueueItems,
  deriveReachOutDisplayState,
  reachOutMatchesStatusFilters,
  type ReachOutDisplayState,
  type ReachOutStatusFilter
} from "../domain/reachOutPolicy";
import type {
  ContactMethod,
  FollowUp,
  LocalDate,
  OrganisationAffiliation,
  Person,
  ReachOutContext,
  ReachOutEntry,
  ReachOutEvent
} from "../domain/schema";
import { selectDisplayAffiliation } from "./affiliations";
import { personMatchesActiveMode, type ActiveRelationshipMode } from "../domain/relationshipMode";

export type ReachOutSearchSource = "Person" | "Role" | "Organisation" | "Why" | "Notes" | "Context";

export type ReachOutSearchMatch = {
  source: ReachOutSearchSource;
  value: string;
};

export type ReachOutListItem = {
  entry: ReachOutEntry;
  person: Person;
  currentFollowUp?: FollowUp;
  contexts: ReachOutContext[];
  affiliation?: OrganisationAffiliation;
  displayState: ReachOutDisplayState;
  relevantDate?: LocalDate;
  searchSources: ReachOutSearchSource[];
  primarySearchMatch?: ReachOutSearchMatch;
  repairNotice?: string;
};

export type ReachOutListOptions = {
  localDate: LocalDate;
  activeMode?: ActiveRelationshipMode;
  query?: string;
  statusFilters?: ReachOutStatusFilter[];
  contextId?: string;
};

export type ReachOutDetail = ReachOutListItem & {
  events: ReachOutEvent[];
  contactMethods: ContactMethod[];
};

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}@+]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
}

function compareSearchAffiliations(
  left: OrganisationAffiliation,
  right: OrganisationAffiliation
): number {
  if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function searchMatches(
  query: string,
  person: Person,
  entry: ReachOutEntry,
  affiliations: OrganisationAffiliation[],
  contexts: ReachOutContext[]
): ReachOutSearchMatch[] {
  if (!query) return [];
  const searchableAffiliations = affiliations
    .filter((affiliation) => !affiliation.archivedAt)
    .sort(compareSearchAffiliations);
  const sortedContexts = [...contexts].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
      || left.id.localeCompare(right.id)
  );
  const candidates: ReachOutSearchMatch[] = [
    { source: "Person", value: person.displayName },
    ...searchableAffiliations
      .filter((affiliation) => Boolean(affiliation.role))
      .map((affiliation) => ({ source: "Role" as const, value: affiliation.role ?? "" })),
    ...searchableAffiliations.map((affiliation) => ({ source: "Organisation" as const, value: affiliation.organisationName })),
    { source: "Why", value: entry.reason ?? "" },
    ...sortedContexts.map((context) => ({ source: "Context" as const, value: context.label })),
    { source: "Notes", value: entry.notes ?? "" }
  ];
  return candidates.filter((candidate) => candidate.value.trim() && normalize(candidate.value).includes(query));
}

function resolveCurrentFollowUp(
  entry: ReachOutEntry,
  followUpsById: Map<string, FollowUp>
): { followUp?: FollowUp; repairNotice?: string } {
  if (!entry.currentFollowUpId) return {};
  const followUp = followUpsById.get(entry.currentFollowUpId);
  if (!followUp || followUp.personId !== entry.personId || followUp.reachOutEntryId !== entry.id || followUp.status !== "pending") {
    return { repairNotice: "This Reach Out reminder link needs repair. No date has been assumed." };
  }
  return { followUp };
}

function relevantDate(followUp: FollowUp | undefined): LocalDate | undefined {
  return followUp ? effectiveFollowUpDate(followUp) : undefined;
}

export async function listReachOut(
  db: PeopleOsDatabase,
  options: ReachOutListOptions
): Promise<ReachOutListItem[]> {
  const tx = db.transaction([
    "reachOutEntries", "people", "followUps", "reachOutContexts", "affiliations"
  ], "readonly");
  const [entries, people, followUps, contexts, affiliations] = await Promise.all([
    tx.objectStore("reachOutEntries").getAll(),
    tx.objectStore("people").getAll(),
    tx.objectStore("followUps").getAll(),
    tx.objectStore("reachOutContexts").getAll(),
    tx.objectStore("affiliations").getAll()
  ]);
  await tx.done;
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const followUpsById = new Map(followUps.map((followUp) => [followUp.id, followUp]));
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  const normalizedQuery = normalize(options.query);
  const filters = options.statusFilters ?? [];

  const result = entries.flatMap((entry): ReachOutListItem[] => {
    if (entry.removedAt) return [];
    const person = peopleById.get(entry.personId);
    if (!person || person.archivedAt || person.identityStatus === "merged" || !personMatchesActiveMode(person, options.activeMode ?? "personal")) return [];
    const selectedContexts = entry.contextIds
      .map((id) => contextsById.get(id))
      .filter((context): context is ReachOutContext => Boolean(context && !context.archivedAt));
    if (options.contextId && !entry.contextIds.includes(options.contextId)) return [];
    const personAffiliations = affiliations.filter((candidate) => candidate.personId === person.id);
    const affiliation = selectDisplayAffiliation(personAffiliations);
    const resolved = resolveCurrentFollowUp(entry, followUpsById);
    if (!reachOutMatchesStatusFilters(entry, resolved.followUp, options.localDate, filters)) return [];
    const matches = searchMatches(normalizedQuery, person, entry, personAffiliations, selectedContexts);
    if (normalizedQuery && matches.length === 0) return [];
    const searchSources = matches.reduce<ReachOutSearchSource[]>((sources, match) => {
      if (!sources.includes(match.source)) sources.push(match.source);
      return sources;
    }, []);
    return [{
      entry,
      person,
      ...(resolved.followUp ? { currentFollowUp: resolved.followUp } : {}),
      contexts: selectedContexts,
      ...(affiliation ? { affiliation } : {}),
      displayState: deriveReachOutDisplayState(entry, resolved.followUp, options.localDate),
      ...(relevantDate(resolved.followUp) ? { relevantDate: relevantDate(resolved.followUp) } : {}),
      searchSources,
      ...(matches[0] ? { primarySearchMatch: matches[0] } : {}),
      ...(resolved.repairNotice ? { repairNotice: resolved.repairNotice } : {})
    }];
  });
  const searchRank = (item: ReachOutListItem): number => {
    if (item.searchSources.includes("Person")) return 0;
    if (item.searchSources.includes("Role") || item.searchSources.includes("Organisation")) return 1;
    if (item.searchSources.includes("Why")) return 2;
    if (item.searchSources.includes("Context")) return 3;
    return 4;
  };
  return result.sort((left, right) => {
    if (normalizedQuery) {
      const rank = searchRank(left) - searchRank(right);
      if (rank) return rank;
      const label = left.person.displayName.localeCompare(right.person.displayName, undefined, { sensitivity: "base" });
      return label || left.entry.id.localeCompare(right.entry.id);
    }
    return compareReachOutQueueItems({
      entry: left.entry,
      followUp: left.currentFollowUp,
      displayName: left.person.displayName
    }, {
      entry: right.entry,
      followUp: right.currentFollowUp,
      displayName: right.person.displayName
    }, options.localDate);
  });
}

export async function hasReachOutEntries(db: PeopleOsDatabase, activeMode: ActiveRelationshipMode = "personal"): Promise<boolean> {
  const tx = db.transaction(["reachOutEntries", "people"], "readonly");
  const [entries, people] = await Promise.all([
    tx.objectStore("reachOutEntries").getAll(),
    tx.objectStore("people").getAll()
  ]);
  await tx.done;
  const peopleById = new Map(people.map((person) => [person.id, person]));
  return entries.some((entry) => {
    if (entry.removedAt) return false;
    const person = peopleById.get(entry.personId);
    return Boolean(person && !person.archivedAt && person.identityStatus !== "merged" && personMatchesActiveMode(person, activeMode));
  });
}

export async function getReachOutDetail(
  db: PeopleOsDatabase,
  entryId: string,
  localDate: LocalDate
): Promise<ReachOutDetail | undefined> {
  const tx = db.transaction([
    "reachOutEntries", "people", "followUps", "reachOutContexts", "affiliations",
    "reachOutEvents", "contactMethods"
  ], "readonly");
  const entry = await tx.objectStore("reachOutEntries").get(entryId);
  if (!entry) {
    await tx.done;
    return undefined;
  }
  const [person, followUps, contexts, affiliations, events, contactMethods] = await Promise.all([
    tx.objectStore("people").get(entry.personId),
    tx.objectStore("followUps").index("by-reach-out").getAll(entry.id),
    tx.objectStore("reachOutContexts").getAll(),
    tx.objectStore("affiliations").index("by-person").getAll(entry.personId),
    tx.objectStore("reachOutEvents").index("by-entry").getAll(entry.id),
    tx.objectStore("contactMethods").index("by-person").getAll(entry.personId)
  ]);
  await tx.done;
  if (!person) throw new RecordConflictError("This Reach Out entry references a missing Person.");
  const followUpsById = new Map(followUps.map((followUp) => [followUp.id, followUp]));
  const resolved = resolveCurrentFollowUp(entry, followUpsById);
  const selectedContexts = entry.contextIds
    .map((id) => contexts.find((context) => context.id === id))
    .filter((context): context is ReachOutContext => Boolean(context));
  const affiliation = selectDisplayAffiliation(affiliations);
  return {
    entry,
    person,
    ...(resolved.followUp ? { currentFollowUp: resolved.followUp } : {}),
    contexts: selectedContexts,
    ...(affiliation ? { affiliation } : {}),
    displayState: deriveReachOutDisplayState(entry, resolved.followUp, localDate),
    ...(relevantDate(resolved.followUp) ? { relevantDate: relevantDate(resolved.followUp) } : {}),
    searchSources: [],
    ...(resolved.repairNotice ? { repairNotice: resolved.repairNotice } : {}),
    events: [...events].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id)),
    contactMethods: contactMethods.filter((method) => !method.archivedAt)
  };
}

export async function getCurrentReachOutForPerson(
  db: PeopleOsDatabase,
  personId: string
): Promise<ReachOutEntry | undefined> {
  const entries = (await db.getAllFromIndex("reachOutEntries", "by-person", personId))
    .filter((entry) => !entry.removedAt && entry.intentStatus !== "completed")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  if (entries.length > 1) throw new RecordConflictError("This Person has more than one current Reach Out entry.");
  return entries[0];
}

export async function listReachOutHistoryForPerson(
  db: PeopleOsDatabase,
  personId: string
): Promise<ReachOutEntry[]> {
  return (await db.getAllFromIndex("reachOutEntries", "by-person", personId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export async function listReachOutContexts(
  db: PeopleOsDatabase,
  activeMode: ActiveRelationshipMode = "personal"
): Promise<ReachOutContext[]> {
  const [contexts, entries, people] = await Promise.all([
    db.getAll("reachOutContexts"),
    db.getAll("reachOutEntries"),
    db.getAll("people")
  ]);
  const visiblePeople = new Set(people.filter((person) => personMatchesActiveMode(person, activeMode)).map((person) => person.id));
  const visibleEntries = entries.filter((entry) => visiblePeople.has(entry.personId));
  const lastUsedAt = new Map<string, string>();
  for (const entry of visibleEntries) {
    for (const contextId of entry.contextIds) {
      const current = lastUsedAt.get(contextId);
      if (!current || entry.updatedAt > current) lastUsedAt.set(contextId, entry.updatedAt);
    }
  }
  return contexts
    .filter((context) => !context.archivedAt)
    .sort((left, right) => {
      const leftUsedAt = lastUsedAt.get(left.id) ?? left.createdAt;
      const rightUsedAt = lastUsedAt.get(right.id) ?? right.createdAt;
      return rightUsedAt.localeCompare(leftUsedAt)
        || left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
        || left.id.localeCompare(right.id);
    });
}
