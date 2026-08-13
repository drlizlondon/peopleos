import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import type {
  ConversationStarter,
  ConversationStarterUse,
  Person
} from "../domain/schema";
import {
  formatUkLocalDate,
  rankConversationStarters,
  recordConversationStarterUse
} from "./conversationStarterHistory";

const personId = "person-bibi";
const databaseNames = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

const starters: ConversationStarter[] = [{
  id: "starter-recent",
  template: "Hey {name}, what’s new with you?",
  relationshipMode: "personal"
}, {
  id: "starter-old",
  template: "Hi {name}, how have you been?",
  relationshipMode: "personal"
}, {
  id: "starter-unused",
  template: "Thinking of you, {name}.",
  relationshipMode: "personal"
}];

function use(overrides: Partial<ConversationStarterUse> = {}): ConversationStarterUse {
  return {
    id: `starter-use-${crypto.randomUUID()}`,
    personId,
    starterId: starters[0]!.id,
    starterTemplate: starters[0]!.template,
    occurredAt: "2026-08-12T09:00:00.000Z",
    ...overrides
  };
}

function person(): Person {
  return {
    id: personId,
    revision: 1,
    displayName: "Bibi Johnson",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z"
  };
}

async function openDatabase(): Promise<PeopleOsDatabase> {
  const name = `peopleos-starter-history-${crypto.randomUUID()}`;
  databaseNames.add(name);
  const db = await openPeopleOsDatabase(name, "2026-08-13T09:00:00.000Z");
  connections.add(db);
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of databaseNames) await deletePeopleOsDatabase(name);
  databaseNames.clear();
});

describe("per-Person exact conversation-starter history", () => {
  it("ranks unused starters first, then used starters from least to most recent", () => {
    const ranked = rankConversationStarters(starters, [
      use(),
      use({
        starterId: starters[1]!.id,
        starterTemplate: starters[1]!.template,
        occurredAt: "2025-11-14T09:00:00.000Z"
      })
    ], personId, "Europe/London");

    expect(ranked.map((starter) => starter.id)).toEqual([
      "starter-unused",
      "starter-old",
      "starter-recent"
    ]);
    expect(ranked[0]).not.toHaveProperty("lastUsedDate");
    expect(ranked[1]?.lastUsedDate).toBe("2025-11-14");
    expect(ranked[2]?.lastUsedDate).toBe("2026-08-12");
  });

  it("matches both the stored starter id and exact template", () => {
    const editedStarter: ConversationStarter = {
      ...starters[0]!,
      template: "A newly edited hello for {name}."
    };
    const ranked = rankConversationStarters([editedStarter], [use()], personId, "Europe/London");

    expect(ranked).toEqual([editedStarter]);
    expect(ranked[0]).not.toHaveProperty("lastUsedDate");
  });

  it("does not share the same starter's history between two People", () => {
    const usedBySomeoneElse = use({ personId: "person-someone-else" });

    const forBibi = rankConversationStarters([starters[0]!], [usedBySomeoneElse], personId, "Europe/London");
    const forSomeoneElse = rankConversationStarters(
      [starters[0]!],
      [usedBySomeoneElse],
      "person-someone-else",
      "Europe/London"
    );

    expect(forBibi[0]).not.toHaveProperty("lastUsedDate");
    expect(forSomeoneElse[0]?.lastUsedDate).toBe("2026-08-12");
  });

  it("attributes immutable source history through a merged Person", () => {
    const sourceId = "person-provisional";
    const ranked = rankConversationStarters(
      [starters[0]!],
      [use({ personId: sourceId })],
      personId,
      "Europe/London",
      [{ id: sourceId, mergedIntoPersonId: personId }, { id: personId }]
    );

    expect(ranked[0]?.lastUsedDate).toBe("2026-08-12");
  });

  it("converts the actual local usage day to UK date text", () => {
    const ranked = rankConversationStarters([starters[0]!], [use({
      occurredAt: "2026-08-05T23:30:00.000Z"
    })], personId, "Europe/London");

    expect(ranked[0]?.lastUsedDate).toBe("2026-08-06");
    expect(formatUkLocalDate(ranked[0]!.lastUsedDate!)).toBe("06/08/2026");
  });

  it("persists a successful record command once and keeps exact retry idempotence", async () => {
    const db = await openDatabase();
    await db.put("people", person());
    const command = use({ id: "starter-use-message-handoff" });
    const revisionBefore = (await db.get("metadata", "app"))!.datasetRevision;

    await recordConversationStarterUse(db, command);
    await recordConversationStarterUse(db, command);

    expect(await db.getAll("conversationStarterUses")).toEqual([command]);
    expect((await db.get("metadata", "app"))!.datasetRevision).toBe(revisionBefore + 1);
  });
});
