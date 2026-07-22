import { describe, expect, it } from "vitest";
import { isLocalDate, validatePeopleOsData, ValidationError } from "./validation";
import { completeData } from "../test/fixtures";

describe("V1 data validation", () => {
  it("accepts a complete referentially valid dataset", () => {
    const data = completeData();
    expect(validatePeopleOsData(data)).toBe(data);
  });

  it("accepts the channel-neutral Contacted interaction kind", () => {
    const data = completeData();
    data.interactions[0] = { ...data.interactions[0], kind: "contacted" };
    expect(validatePeopleOsData(data)).toBe(data);
  });

  it("rejects child records without their permanent Person", () => {
    const data = completeData();
    data.people = [];
    expect(() => validatePeopleOsData(data)).toThrow(ValidationError);
    expect(() => validatePeopleOsData(data)).toThrow(/references a missing/);
  });

  it("rejects invalid and incomplete records", () => {
    const data = completeData();
    data.people[0] = { ...data.people[0], displayName: "" };
    expect(() => validatePeopleOsData(data)).toThrow(/people\[0\] is invalid/);
  });

  it("validates calendar dates without timezone conversion", () => {
    expect(isLocalDate("2026-03-29")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-08-01T00:00:00.000Z")).toBe(false);
  });

  it("rejects non-canonical Facts and inconsistent affiliation dates", () => {
    const untrimmedFact = completeData();
    untrimmedFact.memoryFacts[0] = { ...untrimmedFact.memoryFacts[0], value: "  NHS AI pilots  " };
    expect(() => validatePeopleOsData(untrimmedFact)).toThrow(/memoryFacts\[0\] is invalid/);

    const longFact = completeData();
    longFact.memoryFacts[0] = { ...longFact.memoryFacts[0], value: "x".repeat(241) };
    expect(() => validatePeopleOsData(longFact)).toThrow(/memoryFacts\[0\] is invalid/);

    const reversedDates = completeData();
    reversedDates.affiliations[0] = {
      ...reversedDates.affiliations[0],
      isCurrent: false,
      startedOn: "2026-08-02",
      endedOn: "2026-08-01"
    };
    expect(() => validatePeopleOsData(reversedDates)).toThrow(/affiliations\[0\] is invalid/);

    const endedCurrent = completeData();
    endedCurrent.affiliations[0] = { ...endedCurrent.affiliations[0], endedOn: "2026-08-01" };
    expect(() => validatePeopleOsData(endedCurrent)).toThrow(/affiliations\[0\] is invalid/);
  });

  it("rejects incompatible Memory Fact links before restore", () => {
    const wrongKind = completeData();
    wrongKind.memoryFacts[0] = { ...wrongKind.memoryFacts[0], relatedPersonId: wrongKind.people[0].id };
    expect(() => validatePeopleOsData(wrongKind)).toThrow(/memoryFacts\[0\] is invalid/);

    const wrongOwnerSource = completeData();
    wrongOwnerSource.people.push({
      ...wrongOwnerSource.people[0],
      id: "person-aaron",
      displayName: "Aaron Patel"
    });
    wrongOwnerSource.interactions.push({
      ...wrongOwnerSource.interactions[0],
      id: "interaction-aaron",
      personId: "person-aaron"
    });
    wrongOwnerSource.memoryFacts[0] = {
      ...wrongOwnerSource.memoryFacts[0],
      sourceInteractionId: "interaction-aaron"
    };
    expect(() => validatePeopleOsData(wrongOwnerSource)).toThrow(/sourceInteractionId references a missing or incompatible record/);
  });

  it("rejects duplicate current Reach Out entries for one Person", () => {
    const data = completeData();
    data.reachOutEntries.push({ ...data.reachOutEntries[0], id: "reach-out-sarah-2", currentFollowUpId: undefined });
    expect(() => validatePeopleOsData(data)).toThrow(/more than one current entry/);
  });
});
