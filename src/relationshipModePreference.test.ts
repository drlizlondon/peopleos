import { describe, expect, it } from "vitest";
import { personMatchesActiveMode, relationshipModeOf } from "./domain/relationshipMode";
import {
  RELATIONSHIP_MODE_PREFERENCE_KEY,
  readActiveRelationshipMode,
  writeActiveRelationshipMode
} from "./relationshipModePreference";

describe("relationship mode", () => {
  it("migrates legacy people logically to Personal and keeps Both visible in either view", () => {
    expect(relationshipModeOf({})).toBe("personal");
    expect(personMatchesActiveMode({}, "all")).toBe(true);
    expect(personMatchesActiveMode({}, "personal")).toBe(true);
    expect(personMatchesActiveMode({}, "professional")).toBe(false);
    expect(personMatchesActiveMode({ relationshipMode: "both" }, "personal")).toBe(true);
    expect(personMatchesActiveMode({ relationshipMode: "both" }, "professional")).toBe(true);
    expect(personMatchesActiveMode({}, "all")).toBe(true);
  });

  it("persists the selected global mode and safely defaults invalid or unavailable storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    expect(readActiveRelationshipMode(storage)).toBe("all");
    writeActiveRelationshipMode("professional", storage);
    expect(values.get(RELATIONSHIP_MODE_PREFERENCE_KEY)).toBe("professional");
    expect(readActiveRelationshipMode(storage)).toBe("professional");
    values.set(RELATIONSHIP_MODE_PREFERENCE_KEY, "unexpected");
    expect(readActiveRelationshipMode(storage)).toBe("all");
  });
});
