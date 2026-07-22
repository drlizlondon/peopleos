import { describe, expect, it } from "vitest";
import { timelineMonthKey, timelineMonthLabel, timelineYearKey } from "./timelineDates";

describe("timeline local-calendar projection", () => {
  it("uses one local calendar for month groups, labels, and year jumps", () => {
    const instant = "2026-12-31T23:30:00.000Z";
    const timeZone = "Pacific/Kiritimati";

    expect(timelineMonthKey(instant, timeZone)).toBe("2027-01");
    expect(timelineYearKey(instant, timeZone)).toBe("2027");
    expect(timelineMonthLabel(instant, timeZone, "en-GB")).toBe("January 2027");
  });
});
