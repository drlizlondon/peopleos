import { describe, expect, it } from "vitest";
import { conversationalNameFor, defaultConversationalName } from "./personNames";

describe("conversational person names", () => {
  it.each([
    ["Elizabeth Soyode", "Elizabeth"],
    ["Camille Aliker", "Camille"],
    ["Dad", "Dad"]
  ])("defaults %s to %s without requiring another capture step", (displayName, expected) => {
    expect(defaultConversationalName(displayName)).toBe(expected);
  });

  it("gives legacy People a safe fallback without changing the stored full name", () => {
    const legacyPerson = { displayName: "Elizabeth Soyode" };

    expect(conversationalNameFor(legacyPerson)).toBe("Elizabeth");
    expect(legacyPerson.displayName).toBe("Elizabeth Soyode");
  });

  it("uses an explicit familiar-name override on conversational surfaces", () => {
    expect(conversationalNameFor({
      displayName: "Elizabeth Soyode",
      conversationalName: "Lizzie"
    })).toBe("Lizzie");
  });

  it.each(["07912 345678", "bibi@example.com"])(
    "keeps the complete non-name identity %s as the fallback",
    (displayName) => {
      expect(defaultConversationalName(displayName)).toBe(displayName);
    }
  );
});
