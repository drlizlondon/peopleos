import { describe, expect, it } from "vitest";
import {
  contactCadenceInDays,
  contactCadenceOf,
  contactCadencesEqual,
  formatContactCadence,
  isValidContactCadence,
  maxContactCadenceValue
} from "./cadence";

describe("contact cadence", () => {
  it.each([
    [{ value: 3, unit: "days" as const }, 3],
    [{ value: 4, unit: "weeks" as const }, 28],
    [{ value: 2, unit: "months" as const }, 60]
  ])("converts %j only at the calculation boundary", (cadence, days) => {
    expect(contactCadenceInDays(cadence)).toBe(days);
  });

  it("reads legacy days without overriding canonical value and unit", () => {
    expect(contactCadenceOf({ contactCadenceDays: 90 })).toEqual({ value: 90, unit: "days" });
    expect(contactCadenceOf({
      contactCadence: { value: 3, unit: "months" },
      contactCadenceDays: 90
    })).toEqual({ value: 3, unit: "months" });
  });

  it("enforces the existing 3650-day ceiling for every unit", () => {
    expect(isValidContactCadence({ value: 3_650, unit: "days" })).toBe(true);
    expect(isValidContactCadence({ value: 521, unit: "weeks" })).toBe(true);
    expect(isValidContactCadence({ value: 522, unit: "weeks" })).toBe(false);
    expect(isValidContactCadence({ value: 121, unit: "months" })).toBe(true);
    expect(isValidContactCadence({ value: 122, unit: "months" })).toBe(false);
    expect(() => contactCadenceInDays({ value: 122, unit: "months" })).toThrow(RangeError);
    expect(maxContactCadenceValue("days")).toBe(3_650);
    expect(maxContactCadenceValue("weeks")).toBe(521);
    expect(maxContactCadenceValue("months")).toBe(121);
  });

  it("compares the stored value and unit rather than only derived days", () => {
    expect(contactCadencesEqual({ value: 4, unit: "weeks" }, { value: 28, unit: "days" })).toBe(false);
    expect(contactCadencesEqual({ value: 4, unit: "weeks" }, { value: 4, unit: "weeks" })).toBe(true);
    expect(contactCadencesEqual(undefined, undefined)).toBe(true);
  });

  it("formats the preserved cadence rather than its calculated day interval", () => {
    expect(formatContactCadence({ value: 1, unit: "months" })).toBe("1 month");
    expect(formatContactCadence({ value: 4, unit: "weeks" })).toBe("4 weeks");
  });
});
