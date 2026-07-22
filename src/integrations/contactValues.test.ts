import { describe, expect, it } from "vitest";
import {
  ContactValueValidationError,
  formatPhoneNumberForDisplay,
  getPhoneRegionOptions,
  normalizeEmailAddress,
  normalizePhoneNumber
} from "./contactValues";

describe("contact value normalization", () => {
  it("provides every supported region as a human-readable option", () => {
    expect(getPhoneRegionOptions("en-GB")).toEqual(expect.arrayContaining([
      { code: "GB", label: "United Kingdom (+44)" },
      { code: "US", label: "United States (+1)" }
    ]));
  });

  it.each([
    "07900123456",
    "07900 123456",
    "+447900123456",
    "447900123456"
  ])("normalizes common UK input %s to E.164", (input) => {
    expect(normalizePhoneNumber(input, "GB")).toMatchObject({
      canonicalValue: "+447900123456",
      region: "GB"
    });
  });

  it("accepts an international number and uses familiar international display", () => {
    const result = normalizePhoneNumber("+1 202 555 0123", "GB");
    expect(result.canonicalValue).toBe("+12025550123");
    expect(result.displayValue).toBe("+1 202 555 0123");
    expect(formatPhoneNumberForDisplay(result.canonicalValue, "US")).toBe("(202) 555-0123");
  });

  it("rejects clearly invalid phone input with a field-specific error", () => {
    expect(() => normalizePhoneNumber("123", "GB")).toThrow(ContactValueValidationError);
    expect(() => normalizePhoneNumber("123", "GB")).toThrow(/valid phone number/);
  });

  it("trims email input, preserves its display case and canonicalizes comparison", () => {
    expect(normalizeEmailAddress("  Sarah.Ahmed@Example.COM  ")).toEqual({
      rawValue: "Sarah.Ahmed@Example.COM",
      canonicalValue: "sarah.ahmed@example.com",
      displayValue: "Sarah.Ahmed@Example.COM"
    });
  });

  it.each(["sarah", "sarah@", "@example.com", "sarah @example.com"])(
    "rejects malformed email input %s",
    (input) => expect(() => normalizeEmailAddress(input)).toThrow(/valid email address/)
  );
});
