import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import {
  emptyPeopleOsData,
  type AppSettings,
  type ContactMethod,
  type FollowUp,
  type Interaction,
  type MemoryFact,
  type OrganisationAffiliation,
  type PeopleOsData,
  type Person,
  type ReachOutContext,
  type ReachOutEntry,
  type RelationshipEvent
} from "../domain/schema";
import {
  RELATIONSHIP_ENGINE_POLICY_VERSION,
  type RelationshipClock
} from "../relationship-engine";
import {
  MAX_PERSON_SEARCH_QUERY_LENGTH,
  PersonSearchValidationError,
  normalizePersonSearchText,
  personFilterOptionsFromData,
  searchPeople,
  searchPeopleFromData
} from "./personSearch";

const now = "2026-08-10T09:00:00.000Z";
const clock: RelationshipClock = {
  now,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
};

const settings: AppSettings = {
  id: "app",
  revision: 1,
  defaultPhoneRegion: "GB",
  captureMode: "standard",
  alreadyContactedDefaultReminderDays: 14,
  todaySummaryNotificationsEnabled: false,
  todaySummaryNotificationTime: "12:00",
  createdAt: now,
  updatedAt: now
};

function person(id: string, displayName = id, overrides: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: now,
    ...overrides
  };
}

function contact(
  id: string,
  personId: string,
  kind: "phone" | "email",
  value: string,
  overrides: Partial<ContactMethod> = {}
): ContactMethod {
  const base = {
    id,
    revision: 1,
    personId,
    rawValue: value,
    canonicalValue: kind === "phone" ? value : value.toLocaleLowerCase("en-US"),
    isPreferred: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  return kind === "phone" ? { ...base, kind, region: "GB" } : { ...base, kind };
}

function affiliation(
  id: string,
  personId: string,
  organisationName: string,
  overrides: Partial<OrganisationAffiliation> = {}
): OrganisationAffiliation {
  return {
    id,
    revision: 1,
    personId,
    organisationName,
    isCurrent: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function interaction(
  id: string,
  personId: string,
  kind: Interaction["kind"],
  overrides: Partial<Interaction> = {}
): Interaction {
  return {
    id,
    revision: 1,
    personId,
    kind,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function event(id: string, name: string): RelationshipEvent {
  return { id, revision: 1, name, createdAt: now, updatedAt: now };
}

function fact(
  id: string,
  personId: string,
  value: string,
  overrides: Partial<MemoryFact> = {}
): MemoryFact {
  return {
    id,
    revision: 1,
    personId,
    kind: "interest",
    value,
    showAsMemoryCue: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function followUp(
  id: string,
  personId: string,
  dueDate: string,
  overrides: Partial<FollowUp> = {}
): FollowUp {
  return {
    id,
    revision: 1,
    personId,
    dueDate,
    reason: "Reconnect",
    actionType: "other",
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function reachOutEntry(
  id: string,
  personId: string,
  overrides: Partial<ReachOutEntry> = {}
): ReachOutEntry {
  return {
    id,
    revision: 1,
    personId,
    intentStatus: "active",
    contextIds: [],
    addedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function context(id: string, label: string, overrides: Partial<ReachOutContext> = {}): ReachOutContext {
  return {
    id,
    revision: 1,
    kind: "fellowship",
    label,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function data(people: Person[]): PeopleOsData {
  return { ...emptyPeopleOsData(settings), people };
}

function oneResult(source: Parameters<typeof searchPeopleFromData>[0], query: string) {
  const result = searchPeopleFromData(source, { clock, query });
  expect(result).toHaveLength(1);
  return result[0];
}

describe("V1-11 deterministic People search", () => {
  it("normalizes case, whitespace, punctuation, and diacritics without fuzzy or mid-token matching", () => {
    const source = data([person("bristol", "Brístol—NHS Adviser")]);
    expect(normalizePersonSearchText("  BrÍstol—NHS  ")).toBe("bristol nhs");
    expect(searchPeopleFromData(source, { clock, query: " BRISTOL  nhs " })).toHaveLength(1);
    expect(searchPeopleFromData(source, { clock, query: "bristlo" })).toEqual([]);
    expect(searchPeopleFromData(source, { clock, query: "ristol" })).toEqual([]);
  });

  it("returns exact, starts-with, and other name-token matches in tiers 1, 2, and 3", () => {
    const source = data([
      person("exact", "Pilot"),
      person("prefix", "Pilot Smith"),
      person("token", "Sarah Pilot")
    ]);
    const results = searchPeopleFromData(source, { clock, query: "pilot" });
    expect(results.map((result) => [result.person.id, result.match?.tier, result.match?.source])).toEqual([
      ["exact", 1, "display_name_exact"],
      ["prefix", 2, "display_name_prefix"],
      ["token", 3, "name_token_prefix"]
    ]);
  });

  it("matches only exact canonical phone and email identities for contact-like input", () => {
    const phonePerson = person("phone", "Phone Person");
    const emailPerson = person("email", "Email Person");
    const source = data([phonePerson, emailPerson]);
    source.contactMethods = [
      contact("phone-method", phonePerson.id, "phone", "+447900123456", { rawValue: "07900 123456" }),
      contact("email-method", emailPerson.id, "email", "Sarah.Ahmed@Example.com", {
        canonicalValue: "sarah.ahmed@example.com"
      })
    ];

    expect(oneResult(source, "07900 123456").match).toMatchObject({
      tier: 4,
      source: "contact_identity",
      sourceId: "phone-method"
    });
    expect(oneResult(source, " SARAH.AHMED@example.com ").match).toMatchObject({
      tier: 4,
      source: "contact_identity",
      sourceId: "email-method"
    });
    expect(searchPeopleFromData(source, { clock, query: "0790012345" })).toEqual([]);
    expect(searchPeopleFromData(source, { clock, query: "sarah.ahmed@" })).toEqual([]);
  });

  it("matches current affiliation and contextual Events only through explicit linked interactions", () => {
    const current = person("current", "Current Context");
    const linked = person("linked", "Linked Event");
    const unlinked = person("unlinked", "Unlinked Event");
    const source = data([current, linked, unlinked]);
    source.affiliations = [affiliation("current-aff", current.id, "NHS England", { role: "Clinical adviser" })];
    source.events = [event("event-healthtech", "HealthTech Fellowship")];
    source.interactions = [interaction("linked-met", linked.id, "met", { eventId: "event-healthtech" })];

    expect(oneResult(source, "clinical adv").match).toMatchObject({ tier: 5, source: "current_affiliation" });
    const eventResults = searchPeopleFromData(source, { clock, query: "healthtech fell" });
    expect(eventResults.map((result) => result.person.id)).toEqual(["linked"]);
    expect(eventResults[0].match).toMatchObject({
      tier: 6,
      source: "event",
      label: "Event",
      value: "HealthTech Fellowship"
    });
  });

  it("matches only active Fact values and chooses the newest same-tier Fact source", () => {
    const candidate = person("facts", "Fact Person");
    const source = data([candidate]);
    source.memoryFacts = [
      fact("older", candidate.id, "Pilot sites", { updatedAt: "2026-08-01T09:00:00.000Z" }),
      fact("newer", candidate.id, "Pilot programme", { updatedAt: "2026-08-09T09:00:00.000Z" }),
      fact("archived", candidate.id, "Hidden research", { archivedAt: now })
    ];

    expect(oneResult(source, "pilot").match).toMatchObject({ tier: 7, sourceId: "newer" });
    expect(searchPeopleFromData(source, { clock, query: "hidden" })).toEqual([]);
  });

  it("covers Tag, Note summary, past affiliation, and Reach Out reason/context/notes tiers", () => {
    const tagPerson = person("tag", "Tag Person", { tags: ["Digital health"] });
    const notePerson = person("note", "Note Person");
    const pastPerson = person("past", "Past Person");
    const reachReason = person("reach-reason", "Reason Person");
    const reachContext = person("reach-context", "Context Person");
    const reachNotes = person("reach-notes", "Notes Person");
    const removed = person("removed", "Removed Person");
    const source = data([tagPerson, notePerson, pastPerson, reachReason, reachContext, reachNotes, removed]);
    source.interactions = [
      interaction("note-entry", notePerson.id, "note_added", { summary: "Interested in simulation education" }),
      interaction("ordinary-summary", tagPerson.id, "meeting", { summary: "Not searchable as a note summary" })
    ];
    source.affiliations = [affiliation("past-aff", pastPerson.id, "Watford Health", {
      isCurrent: false,
      endedOn: "2025-12-31"
    })];
    source.reachOutContexts = [context("context-fellowship", "Darzi Fellowship")];
    source.reachOutEntries = [
      reachOutEntry("reason-entry", reachReason.id, { reason: "Discuss clinical safety" }),
      reachOutEntry("context-entry", reachContext.id, { contextIds: ["context-fellowship"], intentStatus: "completed" }),
      reachOutEntry("notes-entry", reachNotes.id, { notes: "Potential board adviser", intentStatus: "dormant" }),
      reachOutEntry("removed-entry", removed.id, { reason: "Removed outreach", removedAt: now })
    ];

    expect(oneResult(source, "digital hea").match).toMatchObject({ tier: 8, source: "tag" });
    expect(oneResult(source, "simulation edu").match).toMatchObject({ tier: 9, source: "note" });
    expect(oneResult(source, "watford hea").match).toMatchObject({ tier: 10, source: "past_affiliation" });
    expect(oneResult(source, "clinical saf").match).toMatchObject({ tier: 11, label: "Reach Out reason" });
    expect(oneResult(source, "darzi fell").match).toMatchObject({ tier: 11, label: "Reach Out context" });
    expect(oneResult(source, "board adv").match).toMatchObject({ tier: 11, label: "Reach Out notes" });
    expect(searchPeopleFromData(source, { clock, query: "removed outreach" })).toEqual([]);
    expect(searchPeopleFromData(source, { clock, query: "not searchable" })).toEqual([]);
  });

  it("selects the highest-ranked matching source and exposes its explanation data", () => {
    const candidate = person("multi", "Sarah Jones", { tags: ["Pilot"] });
    const source = data([candidate]);
    source.affiliations = [affiliation("aff", candidate.id, "Pilot Health")];
    source.memoryFacts = [fact("fact", candidate.id, "Pilot sites")];
    source.interactions = [interaction("note", candidate.id, "note_added", { summary: "Pilot notes" })];

    expect(oneResult(source, "pilot").match).toEqual({
      tier: 5,
      source: "current_affiliation",
      sourceId: "aff",
      label: "Current affiliation",
      value: "Pilot Health",
      matchedAt: now
    });
  });

  it("orders same-tier Fact and Note results by source recency, then name and stable Person ID", () => {
    const a = person("a", "Same Name");
    const b = person("b", "Same Name");
    const c = person("c", "Alpha Name");
    const source = data([a, b, c]);
    source.memoryFacts = [
      fact("fact-a", a.id, "Pilot work", { updatedAt: "2026-08-03T09:00:00.000Z" }),
      fact("fact-b", b.id, "Pilot work", { updatedAt: "2026-08-03T09:00:00.000Z" }),
      fact("fact-c", c.id, "Pilot work", { updatedAt: "2026-08-09T09:00:00.000Z" })
    ];
    expect(searchPeopleFromData(source, { clock, query: "pilot" }).map((result) => result.person.id))
      .toEqual(["c", "a", "b"]);
  });

  it("uses RC-09 default directory ordering without importance scoring", () => {
    const latest = person("latest", "Zulu", { importance: "normal" });
    const earlier = person("earlier", "Alpha", { importance: "high" });
    const newA = person("new-a", "Same", { createdAt: "2026-08-08T09:00:00.000Z" });
    const newB = person("new-b", "Same", { createdAt: "2026-08-08T09:00:00.000Z" });
    const old = person("old", "Old", { createdAt: "2026-08-01T09:00:00.000Z" });
    const archived = person("archived", "Archived", { archivedAt: now });
    const source = data([old, newB, earlier, archived, latest, newA]);
    source.interactions = [
      interaction("contact-latest", latest.id, "phone_call", { occurredAt: "2026-08-09T09:00:00.000Z" }),
      interaction("contact-earlier", earlier.id, "coffee", { occurredAt: "2026-08-05T09:00:00.000Z" })
    ];

    expect(searchPeopleFromData(source, { clock }).map((result) => result.person.id)).toEqual([
      "latest", "earlier", "new-a", "new-b", "old"
    ]);
    expect(searchPeopleFromData(source, { clock, filters: { archive: "all" } })
      .map((result) => result.person.id)).toEqual([
      "latest", "earlier", "new-a", "new-b", "old", "archived"
    ]);
  });

  it("applies OR within each filter category and AND across categories", () => {
    const match = person("match", "Matching Person", { tags: ["mentor"] });
    const wrongOrganisation = person("wrong-org", "Wrong Organisation", { tags: ["mentor"] });
    const wrongContact = person("wrong-contact", "Has Contact", { tags: ["mentor"] });
    const archived = person("archived", "Archived Match", { tags: ["mentor"], archivedAt: now });
    const source = data([match, wrongOrganisation, wrongContact, archived]);
    source.affiliations = [
      affiliation("match-org", match.id, "NHS England"),
      affiliation("wrong-org-aff", wrongOrganisation.id, "Private Health"),
      affiliation("wrong-contact-org", wrongContact.id, "NHS England"),
      affiliation("archived-org", archived.id, "NHS England")
    ];
    source.events = [event("event-one", "AI Fellowship")];
    source.interactions = [
      interaction("match-met", match.id, "met", { eventId: "event-one" }),
      interaction("wrong-org-met", wrongOrganisation.id, "met", { eventId: "event-one" }),
      interaction("wrong-contact-met", wrongContact.id, "met", { eventId: "event-one" }),
      interaction("archived-met", archived.id, "met", { eventId: "event-one" })
    ];
    source.followUps = [
      followUp("match-due", match.id, "2026-08-10"),
      followUp("wrong-org-due", wrongOrganisation.id, "2026-08-09"),
      followUp("wrong-contact-due", wrongContact.id, "2026-08-10"),
      followUp("archived-due", archived.id, "2026-08-10")
    ];
    source.contactMethods = [contact("wrong-contact-email", wrongContact.id, "email", "valid@example.com")];

    const results = searchPeopleFromData(source, {
      clock,
      filters: {
        tags: ["advisor", "mentor"],
        currentOrganisations: ["NHS England", "Watford"],
        eventIds: ["event-other", "event-one"],
        relationshipStages: ["growing", "new"],
        hasDueFollowUp: true,
        missingContactDetails: true,
        archive: "active"
      }
    });
    expect(results.map((result) => result.person.id)).toEqual(["match"]);
    expect(results[0]).toMatchObject({ hasDueFollowUp: true, missingContactDetails: true });

    expect(searchPeopleFromData(source, { clock, filters: { missingContactDetails: false } })
      .map((result) => result.person.id)).toEqual(["wrong-contact"]);
    expect(searchPeopleFromData(source, { clock, filters: { archive: "archived" } })
      .map((result) => result.person.id)).toEqual(["archived"]);
  });

  it("offers only filter values represented by explicit stored records", () => {
    const active = person("active", "Active", { tags: ["mentor"] });
    const source = data([active]);
    source.affiliations = [affiliation("aff", active.id, "NHS England")];
    source.events = [event("used-event", "AI Fellowship"), event("unused-event", "Unused Event")];
    source.interactions = [interaction("met", active.id, "met", { eventId: "used-event" })];
    const options = personFilterOptionsFromData(source, clock);
    expect(options.tags).toEqual(["mentor"]);
    expect(options.currentOrganisations).toEqual(["NHS England"]);
    expect(options.events.map((item) => item.id)).toEqual(["used-event"]);
    expect(options.relationshipStages).toEqual(["new"]);
  });

  it("excludes archived invalid contact methods from contact search and Missing contact details", () => {
    const candidate = person("candidate", "Candidate");
    const source = data([candidate]);
    source.contactMethods = [
      contact("archived-phone", candidate.id, "phone", "+447900123456", { archivedAt: now }),
      contact("invalid-email", candidate.id, "email", "invalid", { canonicalValue: "invalid" })
    ];
    expect(searchPeopleFromData(source, { clock })[0].missingContactDetails).toBe(true);
    expect(searchPeopleFromData(source, { clock, query: "07900 123456" })).toEqual([]);
  });

  it("excludes merged People and requires Archived explicitly", () => {
    const active = person("active", "Shared Name");
    const archived = person("archived", "Shared Name", { archivedAt: now });
    const merged = person("merged", "Shared Name", {
      identityStatus: "merged",
      mergedIntoPersonId: active.id
    });
    const source = data([merged, archived, active]);
    expect(searchPeopleFromData(source, { clock, query: "shared" }).map((result) => result.person.id))
      .toEqual(["active"]);
    expect(searchPeopleFromData(source, { clock, query: "shared", filters: { archive: "all" } })
      .map((result) => result.person.id)).toEqual(["active", "archived"]);
  });

  it("limits raw query length to 200 characters", () => {
    const source = data([person("person", "Person")]);
    expect(() => searchPeopleFromData(source, {
      clock,
      query: "x".repeat(MAX_PERSON_SEARCH_QUERY_LENGTH + 1)
    })).toThrow(PersonSearchValidationError);
    expect(() => searchPeopleFromData(source, {
      clock,
      query: " ".repeat(MAX_PERSON_SEARCH_QUERY_LENGTH)
    })).not.toThrow();
  });

  it("uses the engine's due-free recognition cue and the injected clock", () => {
    const candidate = person("cue", "Cue Person");
    const source = data([candidate]);
    source.memoryFacts = [fact("cue-fact", candidate.id, "Interested in education")];
    source.followUps = [followUp("due", candidate.id, "2026-08-10", { reason: "Private commitment" })];
    const result = searchPeopleFromData(source, { clock })[0];
    expect(result.recognitionCue).toMatchObject({ source: "memory_fact", sourceId: "cue-fact" });
    expect(result.recognitionCue?.text).toBe("Interested in education");
    expect(result.hasDueFollowUp).toBe(true);
    expect(result.assessment.localDate).toBe("2026-08-10");
  });
});

const databaseNames = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of databaseNames) await deletePeopleOsDatabase(name);
  databaseNames.clear();
});

describe("V1-11 People search snapshot query", () => {
  it("reads one complete persisted snapshot and returns no persisted index or cache", async () => {
    const name = `peopleos-person-search-${crypto.randomUUID()}`;
    databaseNames.add(name);
    const db = await openPeopleOsDatabase(name, now);
    connections.add(db);
    const candidate = person("persisted", "Persistent Sarah");
    await db.put("people", candidate);
    await db.put("memoryFacts", fact("persisted-fact", candidate.id, "Looking for pilot sites"));

    const result = await searchPeople(db, { clock, query: "pilot sit" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      person: { id: "persisted" },
      match: { tier: 7, sourceId: "persisted-fact", value: "Looking for pilot sites" }
    });
    expect(Array.from(db.objectStoreNames)).not.toContain("personSearch");
  });
});
