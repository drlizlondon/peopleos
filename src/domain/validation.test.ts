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

  it("rejects duplicate current Reach Out entries for one Person", () => {
    const data = completeData();
    data.reachOutEntries.push({ ...data.reachOutEntries[0], id: "reach-out-sarah-2", currentFollowUpId: undefined });
    expect(() => validatePeopleOsData(data)).toThrow(/more than one current entry/);
  });
});
