import { afterEach, describe, expect, it } from "vitest";
import { deletePeopleOsDatabase, openPeopleOsDatabase } from "./data/database";
import { DEFAULT_CONVERSATION_STARTERS, isOriginalConversationStarterSet } from "./domain/schema";
import { validateConversationStarters } from "./domain/validation";
import { fixedNow } from "./test/fixtures";

const ORIGINAL_SIX = [
  { id: "personal-thinking-of-you", template: "Hey {name}, just thinking of you today.", relationshipMode: "personal" },
  { id: "personal-how-have-you-been", template: "Hi {name}, how have you been lately?", relationshipMode: "personal" },
  { id: "personal-whats-new", template: "Hey {name}, what’s new with you?", relationshipMode: "personal" },
  { id: "professional-check-in", template: "Hi {name}, I wanted to check in and see how things are going.", relationshipMode: "professional" },
  { id: "professional-catch-up", template: "Hi {name}, I’ve been meaning to catch up — how are things?", relationshipMode: "professional" },
  { id: "both-how-are-things", template: "Hi {name}, how are things with you?", relationshipMode: "both" }
] as const;

const names = new Set<string>();

async function openWithStoredStarters(
  label: string,
  starters: readonly { id: string; template: string; relationshipMode: string }[]
) {
  const name = `peopleos-starters-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const seed = await openPeopleOsDatabase(name, fixedNow);
  const settings = (await seed.get("appSettings", "app"))!;
  await seed.put("appSettings", { ...settings, conversationStarters: starters.map((s) => ({ ...s })) } as never);
  seed.close();
  const reopened = await openPeopleOsDatabase(name, fixedNow);
  const migrated = await reopened.get("appSettings", "app");
  reopened.close();
  return migrated;
}

afterEach(async () => {
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("default conversation starters", () => {
  it("ships at least 40 valid starters across every relationship mode", () => {
    expect(DEFAULT_CONVERSATION_STARTERS.length).toBeGreaterThanOrEqual(40);
    expect(validateConversationStarters(DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter }))))
      .toBe(true);

    const modes = DEFAULT_CONVERSATION_STARTERS.map((starter) => starter.relationshipMode);
    expect(modes.filter((mode) => mode === "personal").length).toBeGreaterThanOrEqual(10);
    expect(modes.filter((mode) => mode === "professional").length).toBeGreaterThanOrEqual(10);
    expect(modes.filter((mode) => mode === "both").length).toBeGreaterThanOrEqual(10);

    const ids = DEFAULT_CONVERSATION_STARTERS.map((starter) => starter.id);
    expect(new Set(ids).size).toBe(ids.length);
    const templates = DEFAULT_CONVERSATION_STARTERS.map((starter) => starter.template);
    expect(new Set(templates).size).toBe(templates.length);
    expect(DEFAULT_CONVERSATION_STARTERS.every((starter) => starter.template.includes("{name}"))).toBe(true);
    expect(DEFAULT_CONVERSATION_STARTERS.every((starter) => starter.template.length <= 240)).toBe(true);
  });

  it("keeps the original six at the head so Today offers the same next message", () => {
    expect(DEFAULT_CONVERSATION_STARTERS.slice(0, ORIGINAL_SIX.length)).toEqual(ORIGINAL_SIX);
    expect(isOriginalConversationStarterSet(ORIGINAL_SIX.map((starter) => ({ ...starter })))).toBe(true);
    expect(isOriginalConversationStarterSet(DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter }))))
      .toBe(false);
    expect(isOriginalConversationStarterSet(undefined)).toBe(false);
  });

  it("upgrades an untouched list on open and never overwrites an edited one", async () => {
    const untouched = await openWithStoredStarters("untouched", ORIGINAL_SIX);
    expect(untouched?.conversationStarters).toEqual(DEFAULT_CONVERSATION_STARTERS);

    const edited = [
      ...ORIGINAL_SIX.slice(0, 5),
      { id: "mine-own", template: "Hi {name}, my own words.", relationshipMode: "both" }
    ];
    const preserved = await openWithStoredStarters("edited", edited);
    expect(preserved?.conversationStarters).toEqual(edited);
    expect(preserved?.conversationStarters).toHaveLength(6);
  });
});
