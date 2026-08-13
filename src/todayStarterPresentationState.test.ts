import { describe, expect, it, vi } from "vitest";
import type { ConversationStarterSuggestion } from "./application/conversationStarterHistory";
import {
  advanceTodayStarter,
  TODAY_STARTER_PRESENTATION_STORAGE_KEY,
  todayStarterRotation
} from "./todayStarterPresentationState";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values
  };
}

function starter(id: string, lastUsedAt?: string): ConversationStarterSuggestion {
  return {
    id,
    template: `${id} for {name}`,
    relationshipMode: "personal",
    ...(lastUsedAt ? { lastUsedAt: lastUsedAt as never, lastUsedDate: lastUsedAt.slice(0, 10) as never } : {})
  };
}

describe("Today starter presentation state", () => {
  it("randomly starts once, keeps a fixed sequence, traverses every starter and wraps", () => {
    const storage = memoryStorage();
    const random = vi.fn(() => 0.67);
    const candidates = [starter("one"), starter("two"), starter("three")];
    let rotation = todayStarterRotation("2026-08-13", "bibi", candidates, { storage, random });
    expect(rotation.suggestions.map(({ id }) => id)).toEqual(["three", "one", "two"]);
    expect(rotation.selectedStarterId).toBe("three");
    rotation = advanceTodayStarter("2026-08-13", "bibi", candidates, { storage });
    expect(rotation.selectedStarterId).toBe("one");
    rotation = advanceTodayStarter("2026-08-13", "bibi", candidates, { storage });
    expect(rotation.selectedStarterId).toBe("two");
    rotation = advanceTodayStarter("2026-08-13", "bibi", candidates, { storage });
    expect(rotation.selectedStarterId).toBe("three");
    expect(random).toHaveBeenCalledOnce();
  });

  it("survives independent reads and history refreshes without reshuffling", () => {
    const storage = memoryStorage();
    const first = [starter("unused"), starter("old", "2025-01-01T09:00:00.000Z"), starter("recent", "2026-01-01T09:00:00.000Z")];
    const initial = todayStarterRotation("2026-08-13", "bibi", first, { storage, random: () => 0 });
    advanceTodayStarter("2026-08-13", "bibi", first, { storage });
    const refreshed = todayStarterRotation("2026-08-13", "bibi", [
      starter("unused", "2026-08-13T12:00:00.000Z"),
      ...first.slice(1)
    ], { storage, random: () => 0.9 });
    expect(refreshed.suggestions.map(({ id }) => id)).toEqual(initial.suggestions.map(({ id }) => id));
    expect(refreshed.selectedStarterId).toBe("old");
  });

  it("keeps unused ahead of used and older use ahead of recent use", () => {
    const storage = memoryStorage();
    const rotation = todayStarterRotation("2026-08-13", "bibi", [
      starter("recent", "2026-01-01T09:00:00.000Z"),
      starter("unused-a"),
      starter("old", "2024-01-01T09:00:00.000Z"),
      starter("unused-b")
    ], { storage, random: () => 0.9 });
    expect(rotation.suggestions.slice(0, 2).map(({ id }) => id).sort()).toEqual(["unused-a", "unused-b"]);
    expect(rotation.suggestions.slice(2).map(({ id }) => id)).toEqual(["old", "recent"]);
  });

  it("treats id and exact template as identity but ignores usage metadata", () => {
    const storage = memoryStorage();
    const candidates = [starter("one"), starter("two")];
    const random = vi.fn(() => 0.9);
    expect(todayStarterRotation("2026-08-13", "bibi", candidates, { storage, random }).selectedStarterId)
      .toBe("two");

    const usageRefresh = candidates.map((candidate) => ({
      ...candidate,
      lastUsedAt: "2026-08-13T12:00:00.000Z",
      lastUsedDate: "2026-08-13"
    }));
    expect(todayStarterRotation("2026-08-13", "bibi", usageRefresh, { storage, random }).selectedStarterId)
      .toBe("two");

    const edited = [{ ...candidates[0]!, template: "Edited for {name}" }, candidates[1]!];
    expect(todayStarterRotation("2026-08-13", "bibi", edited, { storage, random }).selectedStarterId)
      .toBe("two");
    expect(random).toHaveBeenCalledTimes(2);
  });

  it("rejects structurally corrupt and duplicate stored rotations safely", () => {
    const storage = memoryStorage();
    const candidates = [starter("one"), starter("two"), starter("three")];
    storage.values.set(TODAY_STARTER_PRESENTATION_STORAGE_KEY, JSON.stringify({
      version: 1,
      localDate: "2026-08-13",
      people: { bibi: { signature: 12, orderedKeys: "not-an-array", selectedKey: null } }
    }));
    expect(() => todayStarterRotation("2026-08-13", "bibi", candidates, {
      storage,
      random: () => 0
    })).not.toThrow();

    const stored = JSON.parse(storage.values.get(TODAY_STARTER_PRESENTATION_STORAGE_KEY)!) as {
      people: { bibi: { signature: string; orderedKeys: string[]; selectedKey: string } };
    };
    stored.people.bibi.orderedKeys = [
      stored.people.bibi.orderedKeys[0]!,
      stored.people.bibi.orderedKeys[0]!,
      stored.people.bibi.orderedKeys[1]!
    ];
    storage.values.set(TODAY_STARTER_PRESENTATION_STORAGE_KEY, JSON.stringify(stored));
    const repaired = todayStarterRotation("2026-08-13", "bibi", candidates, {
      storage,
      random: () => 0.67
    });
    expect(new Set(repaired.suggestions.map(({ id }) => id))).toEqual(new Set(["one", "two", "three"]));
  });

  it("keeps only the current local date in storage", () => {
    const storage = memoryStorage();
    todayStarterRotation("2026-08-13", "bibi", [starter("one"), starter("two")], { storage, random: () => 0 });
    todayStarterRotation("2026-08-14", "sarah", [starter("three")], { storage });

    expect(JSON.parse(storage.values.get(TODAY_STARTER_PRESENTATION_STORAGE_KEY)!)).toMatchObject({
      version: 1,
      localDate: "2026-08-14",
      people: { sarah: expect.any(Object) }
    });
    expect(JSON.parse(storage.values.get(TODAY_STARTER_PRESENTATION_STORAGE_KEY)!).people)
      .not.toHaveProperty("bibi");
  });

  it("starts a new future cycle and handles a single starter and corrupt storage", () => {
    const storage = memoryStorage();
    const candidates = [starter("one"), starter("two")];
    expect(todayStarterRotation("2026-08-13", "bibi", candidates, { storage, random: () => 0 }).selectedStarterId).toBe("one");
    expect(todayStarterRotation("2026-08-14", "bibi", candidates, { storage, random: () => 0.9 }).selectedStarterId).toBe("two");
    storage.values.set("peopleos.today.starter-presentation.v1", "not json");
    const single = todayStarterRotation("2026-08-15", "bibi", [starter("only")], { storage });
    expect(single.suggestions.map(({ id }) => id)).toEqual(["only"]);
    expect(advanceTodayStarter("2026-08-15", "bibi", [starter("only")], { storage }).selectedStarterId).toBe("only");
  });

  it("keeps cycling the fixed in-memory sequence when storage is unavailable", () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error("storage unavailable"); }
    };
    const candidates = [starter("one"), starter("two"), starter("three")];
    let rotation = todayStarterRotation("2026-08-13", "bibi", candidates, { storage, random: () => 0 });
    rotation = advanceTodayStarter("2026-08-13", "bibi", rotation.suggestions, {
      storage,
      selectedStarterId: rotation.selectedStarterId
    });
    expect(rotation.selectedStarterId).toBe("two");
    rotation = advanceTodayStarter("2026-08-13", "bibi", rotation.suggestions, {
      storage,
      selectedStarterId: rotation.selectedStarterId
    });
    expect(rotation.selectedStarterId).toBe("three");
  });
});
