import { describe, expect, it } from "vitest";
import { isLocalDate, validatePeopleOsData, ValidationError } from "./validation";
import { DEFAULT_CONVERSATION_STARTERS } from "./schema";
import { completeData, fixedNow } from "../test/fixtures";

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

  it("accepts legacy People without a conversational name and validates familiar names and starter ownership", () => {
    const legacy = completeData();
    expect(legacy.people[0]).not.toHaveProperty("conversationalName");
    expect(validatePeopleOsData(legacy)).toBe(legacy);

    const valid = completeData();
    valid.people[0] = {
      ...valid.people[0]!,
      conversationalName: "Lizzie",
      broughtToTodayDate: "2026-08-13"
    };
    valid.conversationStarterUses.push({
      id: "starter-use-lizzie",
      personId: valid.people[0]!.id,
      starterId: valid.appSettings[0]!.conversationStarters[0]!.id,
      starterTemplate: valid.appSettings[0]!.conversationStarters[0]!.template,
      occurredAt: fixedNow
    });
    expect(validatePeopleOsData(valid)).toBe(valid);

    const blankName = structuredClone(valid);
    blankName.people[0]!.conversationalName = " ";
    expect(() => validatePeopleOsData(blankName)).toThrow(/people\[0\] is invalid/);

    const orphanedUse = structuredClone(valid);
    orphanedUse.conversationStarterUses[0]!.personId = "missing-person";
    expect(() => validatePeopleOsData(orphanedUse)).toThrow(/conversationStarterUses.*references a missing/);
  });

  it("requires a whole Already contacted default from 1 through 3650 days", () => {
    const minimum = completeData();
    minimum.appSettings[0]!.alreadyContactedDefaultReminderDays = 1;
    expect(validatePeopleOsData(minimum)).toBe(minimum);

    const maximum = completeData();
    maximum.appSettings[0]!.alreadyContactedDefaultReminderDays = 3_650;
    expect(validatePeopleOsData(maximum)).toBe(maximum);

    for (const value of [0, 3_651, 14.5, "14"] as const) {
      const invalid = completeData();
      invalid.appSettings[0]!.alreadyContactedDefaultReminderDays = value as number;
      expect(() => validatePeopleOsData(invalid), String(value)).toThrow(/appSettings\[0\] is invalid/);
    }

    const missing = completeData();
    delete (missing.appSettings[0] as Partial<(typeof missing.appSettings)[number]>).alreadyContactedDefaultReminderDays;
    expect(() => validatePeopleOsData(missing)).toThrow(/appSettings\[0\] is invalid/);
  });

  it("requires a bounded, unique conversation-starter bank with both mode audiences", () => {
    const valid = completeData();
    expect(valid.appSettings[0]?.conversationStarters).toEqual(DEFAULT_CONVERSATION_STARTERS);
    expect(validatePeopleOsData(valid)).toBe(valid);

    const invalidBanks = [
      [],
      [
        { id: "same", template: "Hi {name}.", relationshipMode: "both" },
        { id: "same", template: "Hello {name}.", relationshipMode: "both" }
      ],
      [{ id: "missing-token", template: "Hello there.", relationshipMode: "both" }],
      [{ id: "personal-only", template: "Hello {name}.", relationshipMode: "personal" }],
      [{ id: " padded ", template: "Hello {name}.", relationshipMode: "both" }]
    ] as const;

    for (const bank of invalidBanks) {
      const invalid = completeData();
      invalid.appSettings[0]!.conversationStarters = bank as never;
      expect(() => validatePeopleOsData(invalid)).toThrow(/appSettings\[0\] is invalid/);
    }

    const missing = completeData();
    delete (missing.appSettings[0] as Partial<(typeof missing.appSettings)[number]>).conversationStarters;
    expect(() => validatePeopleOsData(missing)).toThrow(/appSettings\[0\] is invalid/);
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
