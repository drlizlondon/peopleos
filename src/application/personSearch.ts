import { readAllData, type PeopleOsDatabase } from "../data/database";
import { effectiveFollowUpDate, localDateForInstant } from "../domain/followUpPolicy";
import type {
  ContactMethod,
  FollowUp,
  Interaction,
  MemoryFact,
  OrganisationAffiliation,
  PeopleOsData,
  Person,
  ReachOutContext,
  ReachOutEntry,
  RelationshipEvent
} from "../domain/schema";
import type {
  MemoryCueProjection,
  RelationshipAssessment,
  RelationshipClock,
  RelationshipStageValue
} from "../relationship-engine";
import { normalizeEmailAddress, normalizePhoneNumber } from "../integrations/contactValues";
import {
  selectDisplayAffiliation,
  sortCurrentAffiliations,
  sortPastAffiliations
} from "./affiliations";
import { memoryFactKindLabel, memoryFactValueLabel, normalizeMemorySearchText } from "./memoryFacts";
import { assessRelationshipsFromData } from "./relationshipEngineQueries";
import { resolveContactNowTargets } from "./contactNow";

export const MAX_PERSON_SEARCH_QUERY_LENGTH = 200;

export type PersonArchiveFilter = "active" | "archived" | "all";

export type PersonSearchFilters = {
  tags?: readonly string[];
  currentOrganisations?: readonly string[];
  eventIds?: readonly string[];
  relationshipStages?: readonly RelationshipStageValue[];
  hasDueFollowUp?: boolean;
  missingContactDetails?: boolean;
  archive?: PersonArchiveFilter;
};

export type PersonSearchSource =
  | "display_name_exact"
  | "display_name_prefix"
  | "name_token_prefix"
  | "contact_identity"
  | "current_affiliation"
  | "event"
  | "memory_fact"
  | "tag"
  | "note"
  | "past_affiliation"
  | "reach_out";

export type PersonSearchMatch = {
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  source: PersonSearchSource;
  sourceId: string;
  label: string;
  value: string;
  matchedAt?: string;
};

export type PersonSearchResult = {
  person: Person;
  assessment: RelationshipAssessment;
  currentAffiliation?: OrganisationAffiliation;
  recognitionCue?: MemoryCueProjection;
  match?: PersonSearchMatch;
  hasDueFollowUp: boolean;
  missingContactDetails: boolean;
};

export type PersonSearchOptions = {
  clock: RelationshipClock;
  query?: string;
  filters?: PersonSearchFilters;
};

export type PersonFilterOptions = {
  tags: string[];
  currentOrganisations: string[];
  events: RelationshipEvent[];
  relationshipStages: RelationshipStageValue[];
};

export type PersonSearchView = {
  results: PersonSearchResult[];
  filterOptions: PersonFilterOptions;
  totalPersonCount: number;
};

export class PersonSearchValidationError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "PersonSearchValidationError";
  }
}

type MatchCandidate = PersonSearchMatch;

type PersonSearchBundle = {
  person: Person;
  assessment: RelationshipAssessment;
  contacts: ContactMethod[];
  affiliations: OrganisationAffiliation[];
  interactions: Interaction[];
  events: RelationshipEvent[];
  facts: MemoryFact[];
  followUps: FollowUp[];
  reachOutEntries: ReachOutEntry[];
  reachOutContexts: ReachOutContext[];
  defaultPhoneRegion: string;
  localDate: string;
};

/** Shared deterministic text normalization. It deliberately performs no fuzzy matching. */
export function normalizePersonSearchText(value: string): string {
  return normalizeMemorySearchText(value);
}

function compareText(left: string, right: string): number {
  const normalizedLeft = normalizePersonSearchText(left);
  const normalizedRight = normalizePersonSearchText(right);
  return normalizedLeft.localeCompare(normalizedRight, "en-US") || left.localeCompare(right, "en-US");
}

function directTokenPrefixMatch(normalizedValue: string, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  if (normalizedValue === normalizedQuery || normalizedValue.startsWith(`${normalizedQuery} `)) return true;
  const valueTokens = normalizedValue.split(" ").filter(Boolean);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  return queryTokens.length > 0
    && queryTokens.every((queryToken) => valueTokens.some((valueToken) => valueToken.startsWith(queryToken)));
}

function currentContactCanonicals(
  contacts: readonly ContactMethod[],
  defaultPhoneRegion: string
): Set<string> {
  return new Set(resolveContactNowTargets(contacts, defaultPhoneRegion).targets.map((target) => target.canonicalValue));
}

function canonicalContactQuery(query: string, defaultPhoneRegion: string): string | undefined {
  const trimmed = query.trim();
  if (trimmed.includes("@")) {
    try {
      return normalizeEmailAddress(trimmed).canonicalValue;
    } catch {
      return undefined;
    }
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || !/^[+()\d\s.-]+$/.test(trimmed)) return undefined;
  try {
    return normalizePhoneNumber(trimmed, defaultPhoneRegion).canonicalValue;
  } catch {
    return undefined;
  }
}

function compareSourceCandidate(left: MatchCandidate, right: MatchCandidate): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (left.matchedAt !== right.matchedAt) return (right.matchedAt ?? "").localeCompare(left.matchedAt ?? "");
  return compareText(left.value, right.value) || left.sourceId.localeCompare(right.sourceId);
}

function nameMatch(person: Person, query: string): MatchCandidate | undefined {
  const name = normalizePersonSearchText(person.displayName);
  const base = {
    sourceId: person.id,
    value: person.displayName,
    label: "Name"
  } as const;
  if (name === query) return { ...base, source: "display_name_exact", tier: 1 };
  if (name.startsWith(query)) return { ...base, source: "display_name_prefix", tier: 2 };
  if (directTokenPrefixMatch(name, query)) return { ...base, source: "name_token_prefix", tier: 3 };
  return undefined;
}

function contactMatch(bundle: PersonSearchBundle, rawQuery: string): MatchCandidate[] {
  const canonicalQuery = canonicalContactQuery(rawQuery, bundle.defaultPhoneRegion);
  if (!canonicalQuery) return [];
  return bundle.contacts
    .filter((contact) => !contact.archivedAt && contact.canonicalValue === canonicalQuery)
    .filter((contact) => currentContactCanonicals([contact], bundle.defaultPhoneRegion).has(canonicalQuery))
    .map((contact) => ({
      tier: 4,
      source: "contact_identity",
      sourceId: contact.id,
      label: contact.kind === "phone" ? "Phone" : "Email",
      value: contact.rawValue
    }));
}

function affiliationMatches(
  affiliations: readonly OrganisationAffiliation[],
  query: string,
  current: boolean
): MatchCandidate[] {
  const selected = current ? sortCurrentAffiliations(affiliations) : sortPastAffiliations(affiliations);
  return selected.flatMap((affiliation): MatchCandidate[] => {
    const organisationMatches = directTokenPrefixMatch(
      normalizePersonSearchText(affiliation.organisationName),
      query
    );
    const roleMatches = affiliation.role
      ? directTokenPrefixMatch(normalizePersonSearchText(affiliation.role), query)
      : false;
    if (!organisationMatches && !roleMatches) return [];
    return [{
      tier: current ? 5 : 10,
      source: current ? "current_affiliation" : "past_affiliation",
      sourceId: affiliation.id,
      label: current ? "Current affiliation" : "Past affiliation",
      value: [affiliation.role, affiliation.organisationName].filter(Boolean).join(" · "),
      matchedAt: current
        ? affiliation.startedOn ?? affiliation.createdAt
        : affiliation.endedOn ?? affiliation.startedOn ?? affiliation.createdAt
    }];
  });
}

function eventMatches(bundle: PersonSearchBundle, query: string): MatchCandidate[] {
  const eventsById = new Map(bundle.events.map((event) => [event.id, event]));
  return bundle.interactions.flatMap((interaction): MatchCandidate[] => {
    const event = interaction.eventId ? eventsById.get(interaction.eventId) : undefined;
    if (!event || !directTokenPrefixMatch(normalizePersonSearchText(event.name), query)) return [];
    return [{
      tier: 6,
      source: "event",
      sourceId: event.id,
      label: "Event",
      value: event.name,
      matchedAt: interaction.occurredAt
    }];
  });
}

function factMatches(facts: readonly MemoryFact[], query: string): MatchCandidate[] {
  return facts.flatMap((fact): MatchCandidate[] => {
    if (fact.archivedAt || !directTokenPrefixMatch(normalizePersonSearchText(fact.value), query)) return [];
    return [{
      tier: 7,
      source: "memory_fact",
      sourceId: fact.id,
      label: memoryFactKindLabel(fact.kind),
      value: memoryFactValueLabel(fact),
      matchedAt: fact.updatedAt
    }];
  });
}

function tagMatches(person: Person, query: string): MatchCandidate[] {
  return person.tags.flatMap((tag, index): MatchCandidate[] => directTokenPrefixMatch(
    normalizePersonSearchText(tag),
    query
  ) ? [{
    tier: 8,
    source: "tag",
    sourceId: `${person.id}:tag:${index}`,
    label: "Tag",
    value: tag
  }] : []);
}

function noteMatches(interactions: readonly Interaction[], query: string): MatchCandidate[] {
  return interactions.flatMap((interaction): MatchCandidate[] => {
    if (interaction.kind !== "note_added" || !interaction.summary
      || !directTokenPrefixMatch(normalizePersonSearchText(interaction.summary), query)) return [];
    return [{
      tier: 9,
      source: "note",
      sourceId: interaction.id,
      label: "Note",
      value: interaction.summary,
      matchedAt: interaction.occurredAt
    }];
  });
}

function reachOutMatches(bundle: PersonSearchBundle, query: string): MatchCandidate[] {
  const contextsById = new Map(bundle.reachOutContexts
    .filter((context) => !context.archivedAt)
    .map((context) => [context.id, context]));
  return bundle.reachOutEntries.flatMap((entry): MatchCandidate[] => {
    if (entry.removedAt) return [];
    const fields: Array<{ sourceId: string; label: string; value: string }> = [];
    if (entry.reason) fields.push({ sourceId: entry.id, label: "Reach Out reason", value: entry.reason });
    if (entry.notes) fields.push({ sourceId: entry.id, label: "Reach Out notes", value: entry.notes });
    for (const contextId of entry.contextIds) {
      const context = contextsById.get(contextId);
      if (context) fields.push({ sourceId: context.id, label: "Reach Out context", value: context.label });
    }
    return fields.flatMap((field): MatchCandidate[] => directTokenPrefixMatch(
      normalizePersonSearchText(field.value),
      query
    ) ? [{
      tier: 11,
      source: "reach_out",
      sourceId: field.sourceId,
      label: field.label,
      value: field.value,
      matchedAt: entry.updatedAt
    }] : []);
  });
}

function highestMatch(bundle: PersonSearchBundle, rawQuery: string, normalizedQuery: string): MatchCandidate | undefined {
  const directNameMatch = nameMatch(bundle.person, normalizedQuery);
  const candidates: MatchCandidate[] = [
    ...(directNameMatch ? [directNameMatch] : []),
    ...contactMatch(bundle, rawQuery),
    ...affiliationMatches(bundle.affiliations, normalizedQuery, true),
    ...eventMatches(bundle, normalizedQuery),
    ...factMatches(bundle.facts, normalizedQuery),
    ...tagMatches(bundle.person, normalizedQuery),
    ...noteMatches(bundle.interactions, normalizedQuery),
    ...affiliationMatches(bundle.affiliations, normalizedQuery, false),
    ...reachOutMatches(bundle, normalizedQuery)
  ];
  return candidates.sort(compareSourceCandidate)[0];
}

function groupedByPerson<T extends { personId: string }>(records: readonly T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const record of records) {
    const group = result.get(record.personId) ?? [];
    group.push(record);
    result.set(record.personId, group);
  }
  return result;
}

function validCurrentContactMethods(bundle: PersonSearchBundle): ContactMethod[] {
  const ids = new Set(resolveContactNowTargets(bundle.contacts, bundle.defaultPhoneRegion).targets
    .map((target) => target.contactMethodId));
  return bundle.contacts.filter((contact) => ids.has(contact.id));
}

function hasDueFollowUp(followUps: readonly FollowUp[], localDate: string): boolean {
  return followUps.some((followUp) => followUp.status === "pending"
    && effectiveFollowUpDate(followUp) <= localDate);
}

function normalizedSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizePersonSearchText).filter(Boolean));
}

function matchesFilters(bundle: PersonSearchBundle, filters: PersonSearchFilters): boolean {
  const archive = filters.archive ?? "active";
  const isArchived = Boolean(bundle.person.archivedAt);
  if (archive === "active" && isArchived) return false;
  if (archive === "archived" && !isArchived) return false;

  const tags = normalizedSet(filters.tags);
  if (tags.size > 0 && !bundle.person.tags.some((tag) => tags.has(normalizePersonSearchText(tag)))) return false;

  const organisations = normalizedSet(filters.currentOrganisations);
  if (organisations.size > 0 && !bundle.affiliations.some((affiliation) => !affiliation.archivedAt
    && affiliation.isCurrent
    && organisations.has(normalizePersonSearchText(affiliation.organisationName)))) return false;

  const eventIds = new Set(filters.eventIds ?? []);
  if (eventIds.size > 0 && !bundle.interactions.some((interaction) => interaction.eventId
    && eventIds.has(interaction.eventId))) return false;

  const stages = new Set(filters.relationshipStages ?? []);
  if (stages.size > 0 && !stages.has(bundle.assessment.relationshipStage.value)) return false;

  const due = hasDueFollowUp(bundle.followUps, bundle.localDate);
  if (filters.hasDueFollowUp !== undefined && due !== filters.hasDueFollowUp) return false;

  const missing = validCurrentContactMethods(bundle).length === 0;
  if (filters.missingContactDetails !== undefined && missing !== filters.missingContactDetails) return false;
  return true;
}

function compareDefaultResults(left: PersonSearchResult, right: PersonSearchResult): number {
  const archive = Number(Boolean(left.person.archivedAt)) - Number(Boolean(right.person.archivedAt));
  if (archive !== 0) return archive;
  const leftLastContact = left.assessment.lastContactAt;
  const rightLastContact = right.assessment.lastContactAt;
  if (Boolean(leftLastContact) !== Boolean(rightLastContact)) return leftLastContact ? -1 : 1;
  if (leftLastContact && rightLastContact && leftLastContact !== rightLastContact) {
    return rightLastContact.localeCompare(leftLastContact);
  }
  if (!leftLastContact && !rightLastContact && left.person.createdAt !== right.person.createdAt) {
    return right.person.createdAt.localeCompare(left.person.createdAt);
  }
  return compareText(left.person.displayName, right.person.displayName)
    || left.person.id.localeCompare(right.person.id);
}

function compareSearchResults(left: PersonSearchResult, right: PersonSearchResult): number {
  if (!left.match || !right.match) return left.match ? -1 : right.match ? 1 : compareDefaultResults(left, right);
  if (left.match.tier !== right.match.tier) return left.match.tier - right.match.tier;
  const archive = Number(Boolean(left.person.archivedAt)) - Number(Boolean(right.person.archivedAt));
  if (archive !== 0) return archive;
  if ((left.match.tier === 7 || left.match.tier === 9)
    && left.match.matchedAt !== right.match.matchedAt) {
    return (right.match.matchedAt ?? "").localeCompare(left.match.matchedAt ?? "");
  }
  return compareText(left.person.displayName, right.person.displayName)
    || left.person.id.localeCompare(right.person.id);
}

/**
 * Assessments indexed by Person, computed once.
 *
 * Search needs exactly two things from a RelationshipAssessment — the
 * relationship stage, for filtering and filter options, and the search-context
 * cue, for display. Both the result list and the filter options used to build
 * their own complete pass over every Person, so a single query assessed all
 * 3,000 People twice. Callers that need both now compute this once and share it.
 */
export type PersonSearchAssessments = ReadonlyMap<string, RelationshipAssessment>;

export function assessmentsForSearch(
  data: PeopleOsData,
  clock: RelationshipClock
): PersonSearchAssessments {
  return new Map(assessRelationshipsFromData(data, clock)
    .map((assessment) => [assessment.personId, assessment]));
}

export function searchPeopleFromData(
  data: PeopleOsData,
  options: PersonSearchOptions,
  precomputedAssessments?: PersonSearchAssessments
): PersonSearchResult[] {
  const rawQuery = options.query ?? "";
  if (rawQuery.length > MAX_PERSON_SEARCH_QUERY_LENGTH) {
    throw new PersonSearchValidationError(`Search is limited to ${MAX_PERSON_SEARCH_QUERY_LENGTH} characters.`);
  }
  const query = normalizePersonSearchText(rawQuery);
  const settings = data.appSettings.find((record) => record.id === "app");
  if (!settings) throw new Error("PeopleOS settings are missing");
  const localDate = localDateForInstant(options.clock.now, options.clock.timeZone);
  const assessments = precomputedAssessments ?? assessmentsForSearch(data, options.clock);
  const contacts = groupedByPerson(data.contactMethods);
  const affiliations = groupedByPerson(data.affiliations);
  const interactions = groupedByPerson(data.interactions);
  const facts = groupedByPerson(data.memoryFacts);
  const followUps = groupedByPerson(data.followUps);
  const reachOutEntries = groupedByPerson(data.reachOutEntries);

  return data.people.flatMap((person): PersonSearchResult[] => {
    if (person.identityStatus === "merged") return [];
    const assessment = assessments.get(person.id);
    if (!assessment) return [];
    const personInteractions = interactions.get(person.id) ?? [];
    const bundle: PersonSearchBundle = {
      person,
      assessment,
      contacts: contacts.get(person.id) ?? [],
      affiliations: affiliations.get(person.id) ?? [],
      interactions: personInteractions,
      events: data.events,
      facts: facts.get(person.id) ?? [],
      followUps: followUps.get(person.id) ?? [],
      reachOutEntries: reachOutEntries.get(person.id) ?? [],
      reachOutContexts: data.reachOutContexts,
      defaultPhoneRegion: settings.defaultPhoneRegion,
      localDate
    };
    if (!matchesFilters(bundle, options.filters ?? {})) return [];
    const match = query ? highestMatch(bundle, rawQuery, query) : undefined;
    if (query && !match) return [];
    const validContacts = validCurrentContactMethods(bundle);
    const displayAffiliation = selectDisplayAffiliation(bundle.affiliations);
    return [{
      person,
      assessment,
      ...(displayAffiliation ? { currentAffiliation: displayAffiliation } : {}),
      ...(assessment.searchContextCue ? { recognitionCue: assessment.searchContextCue } : {}),
      ...(match ? { match } : {}),
      hasDueFollowUp: hasDueFollowUp(bundle.followUps, localDate),
      missingContactDetails: validContacts.length === 0
    }];
  }).sort(query ? compareSearchResults : compareDefaultResults);
}

export function personFilterOptionsFromData(
  data: PeopleOsData,
  clock: RelationshipClock,
  precomputedAssessments?: PersonSearchAssessments
): PersonFilterOptions {
  const visiblePeople = data.people.filter((person) => person.identityStatus !== "merged");
  const personIds = new Set(visiblePeople.map((person) => person.id));
  const eventIds = new Set(data.interactions
    .filter((interaction) => personIds.has(interaction.personId) && interaction.eventId)
    .map((interaction) => interaction.eventId!));
  const assessments = precomputedAssessments ?? assessmentsForSearch(data, clock);
  const stages = new Set([...assessments.values()]
    .filter((assessment) => personIds.has(assessment.personId))
    .map((assessment) => assessment.relationshipStage.value));
  return {
    tags: [...new Set(visiblePeople.flatMap((person) => person.tags).map((tag) => tag.trim()).filter(Boolean))]
      .sort(compareText),
    currentOrganisations: [...new Set(data.affiliations
      .filter((affiliation) => personIds.has(affiliation.personId) && !affiliation.archivedAt && affiliation.isCurrent)
      .map((affiliation) => affiliation.organisationName.trim())
      .filter(Boolean))].sort(compareText),
    events: data.events.filter((event) => eventIds.has(event.id)).sort((left, right) =>
      compareText(left.name, right.name)
      || (left.occurredOn ?? "").localeCompare(right.occurredOn ?? "")
      || left.id.localeCompare(right.id)),
    relationshipStages: (["new", "growing", "established", "long_term"] as RelationshipStageValue[])
      .filter((stage) => stages.has(stage))
  };
}

/** One complete IndexedDB snapshot is the sole input; no index or projection is persisted. */
export async function searchPeople(
  db: PeopleOsDatabase,
  options: PersonSearchOptions
): Promise<PersonSearchResult[]> {
  return searchPeopleFromData(await readAllData(db), options);
}

export async function getPersonSearchView(
  db: PeopleOsDatabase,
  options: PersonSearchOptions
): Promise<PersonSearchView> {
  const data = await readAllData(db);
  const assessments = assessmentsForSearch(data, options.clock);
  return {
    results: searchPeopleFromData(data, options, assessments),
    filterOptions: personFilterOptionsFromData(data, options.clock, assessments),
    totalPersonCount: data.people.filter((person) => person.identityStatus !== "merged").length
  };
}
