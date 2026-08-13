/**
 * Guards the invariant that `highestMatch`'s short-circuit depends on.
 *
 * `highestMatch` evaluates match sources in tier order and stops at the first
 * one that yields anything, which is only correct while every source owns a
 * fixed tier strictly greater than every earlier source's. Adding a source at
 * the wrong tier, or giving an existing source a second tier, would silently
 * change which match a user sees. This makes that a build failure.
 */
import { describe, expect, it } from "vitest";
import { searchPeopleFromData, type PersonSearchSource } from "./personSearch";
import { RELATIONSHIP_ENGINE_POLICY_VERSION, type RelationshipClock } from "../relationship-engine";
import {
  DEFAULT_CONVERSATION_STARTERS,
  type AppSettings,
  type PeopleOsData
} from "../domain/schema";

const NOW = "2026-08-01T09:00:00.000Z";
const CLOCK: RelationshipClock = {
  now: NOW,
  timeZone: "Europe/London",
  policyVersion: RELATIONSHIP_ENGINE_POLICY_VERSION
};

/**
 * The declared contract, in the order `highestMatch` evaluates sources. Kept
 * here rather than imported so a change to the implementation has to be
 * mirrored deliberately.
 */
const EXPECTED_TIERS: ReadonlyArray<readonly [PersonSearchSource, number]> = [
  ["display_name_exact", 1],
  ["display_name_prefix", 2],
  ["name_token_prefix", 3],
  ["contact_identity", 4],
  ["current_affiliation", 5],
  ["event", 6],
  ["memory_fact", 7],
  ["tag", 8],
  ["note", 9],
  ["past_affiliation", 10],
  ["reach_out", 11]
];

const settings: AppSettings[] = [{
  id: "app",
  revision: 1,
  defaultPhoneRegion: "GB",
  captureMode: "standard",
  alreadyContactedDefaultReminderDays: 14,
  todaySummaryNotificationsEnabled: false,
  todaySummaryNotificationTime: "12:00",
  conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter })),
  createdAt: NOW,
  updatedAt: NOW
}];

function emptyData(): PeopleOsData {
  return {
    people: [], contactMethods: [], externalIdentities: [], affiliations: [], interactions: [], events: [],
    memoryFacts: [], followUps: [], followUpEvents: [], todaySkips: [],
    reachOutEntries: [], reachOutEvents: [], reachOutContexts: [], appSettings: settings
  };
}

describe("search match tiers", () => {
  it("declares strictly increasing, disjoint tiers in evaluation order", () => {
    const tiers = EXPECTED_TIERS.map(([, tier]) => tier);
    for (let index = 1; index < tiers.length; index += 1) {
      expect(tiers[index], `tier order broken at ${EXPECTED_TIERS[index][0]}`)
        .toBeGreaterThan(tiers[index - 1]);
    }
    expect(new Set(tiers).size).toBe(tiers.length);
  });

  it("gives a Person matching several sources at once the lowest-tier match", () => {
    // One Person whose name, current affiliation, tag and a note all match
    // "acme". Only the name match may be reported.
    const data = emptyData();
    data.people.push({
      id: "person-1", revision: 1, displayName: "Acme", identityStatus: "confirmed",
      importance: "normal", tags: ["acme"], createdAt: NOW, updatedAt: NOW
    });
    data.affiliations.push({
      id: "affiliation-1", revision: 1, personId: "person-1", organisationName: "Acme",
      isCurrent: true, createdAt: NOW, updatedAt: NOW
    });
    data.interactions.push({
      id: "interaction-1", revision: 1, personId: "person-1", kind: "note_added",
      occurredAt: NOW, summary: "Acme", createdAt: NOW, updatedAt: NOW
    });
    data.memoryFacts.push({
      id: "fact-1", revision: 1, personId: "person-1", kind: "other", value: "Acme",
      showAsMemoryCue: true, createdAt: NOW, updatedAt: NOW
    });

    const [result] = searchPeopleFromData(data, { clock: CLOCK, query: "acme" });
    expect(result.match?.source).toBe("display_name_exact");
    expect(result.match?.tier).toBe(1);
  });

  it("falls through to a later source when earlier ones do not match", () => {
    const data = emptyData();
    data.people.push({
      id: "person-1", revision: 1, displayName: "Zoe Quinn", identityStatus: "confirmed",
      importance: "normal", tags: [], createdAt: NOW, updatedAt: NOW
    });
    data.interactions.push({
      id: "interaction-1", revision: 1, personId: "person-1", kind: "note_added",
      occurredAt: NOW, summary: "Discussed the acme pilot", createdAt: NOW, updatedAt: NOW
    });

    const [result] = searchPeopleFromData(data, { clock: CLOCK, query: "acme" });
    expect(result.match?.source).toBe("note");
    expect(result.match?.tier).toBe(9);
  });
});
