import { describe, expect, it } from "vitest";
import { completeData, fixedNow } from "../test/fixtures";
import type { FollowUp, FollowUpEvent, Interaction } from "./schema";
import { assertValidRecord, validatePeopleOsData, ValidationError } from "./validation";

function removeReachOutOwnership(data: ReturnType<typeof completeData>): void {
  data.followUps[0] = { ...data.followUps[0], reachOutEntryId: undefined };
  data.reachOutEntries = [];
  data.reachOutEvents = [];
  data.reachOutContexts = [];
}

describe("follow-up restore validation", () => {
  it("accepts Research contact route and enforces the cadence ceiling", () => {
    const data = completeData();
    data.followUps[0] = { ...data.followUps[0], actionType: "research_contact_route" };
    data.people[0] = { ...data.people[0], todayPausedUntilDate: "2026-08-20" };
    expect(validatePeopleOsData(data)).toBe(data);

    const invalidPause = completeData();
    invalidPause.people[0] = { ...invalidPause.people[0], todayPausedUntilDate: "20 August" as never };
    expect(() => validatePeopleOsData(invalidPause)).toThrow(/people\[0\] is invalid/);

    const excessive = completeData();
    excessive.people[0] = { ...excessive.people[0], contactCadenceDays: 3_651 };
    expect(() => validatePeopleOsData(excessive)).toThrow(/people\[0\] is invalid/);

    const excessiveMonths = completeData();
    excessiveMonths.people[0] = {
      ...excessiveMonths.people[0],
      contactCadence: { value: 122, unit: "months" },
      contactCadenceDays: undefined
    };
    expect(() => validatePeopleOsData(excessiveMonths)).toThrow(/people\[0\] is invalid/);
  });

  it("rejects non-canonical reasons, invalid completion state and invalid snooze dates", () => {
    const untrimmed = completeData();
    untrimmed.followUps[0] = { ...untrimmed.followUps[0], reason: "  Send update  " };
    expect(() => validatePeopleOsData(untrimmed)).toThrow(/followUps\[0\] is invalid/);

    const missingCompletionTime = completeData();
    missingCompletionTime.followUps[0] = { ...missingCompletionTime.followUps[0], status: "completed" };
    expect(() => validatePeopleOsData(missingCompletionTime)).toThrow(/followUps\[0\] is invalid/);

    const invalidSnooze = completeData();
    invalidSnooze.followUps[0] = {
      ...invalidSnooze.followUps[0], snoozedUntilDate: invalidSnooze.followUps[0].dueDate
    };
    expect(() => validatePeopleOsData(invalidSnooze)).toThrow(/followUps\[0\] is invalid/);
  });

  it("rejects terminal history that is incompatible with the stored status", () => {
    const pendingWithCancellation = completeData();
    pendingWithCancellation.followUpEvents.push({
      id: "event-cancel",
      followUpId: pendingWithCancellation.followUps[0].id,
      personId: pendingWithCancellation.people[0].id,
      kind: "cancelled",
      occurredAt: fixedNow
    });
    expect(() => validatePeopleOsData(pendingWithCancellation)).toThrow(/cancellation history incompatible with status pending/);

    const cancelledWithCompletion = completeData();
    removeReachOutOwnership(cancelledWithCompletion);
    const followUp = cancelledWithCompletion.followUps[0];
    const interaction: Interaction = {
      id: "interaction-completion",
      revision: 1,
      personId: followUp.personId,
      kind: "email",
      occurredAt: fixedNow,
      followUpId: followUp.id,
      createdAt: fixedNow,
      updatedAt: fixedNow
    };
    cancelledWithCompletion.interactions.push(interaction);
    cancelledWithCompletion.followUps[0] = { ...followUp, status: "cancelled" };
    cancelledWithCompletion.followUpEvents.push({
      id: "event-cancel",
      followUpId: followUp.id,
      personId: followUp.personId,
      kind: "cancelled",
      occurredAt: fixedNow
    }, {
      id: "event-complete",
      followUpId: followUp.id,
      personId: followUp.personId,
      kind: "completed_with_contact",
      occurredAt: fixedNow,
      interactionId: interaction.id
    });
    expect(() => validatePeopleOsData(cancelledWithCompletion)).toThrow(/completion history incompatible with status cancelled/);
  });

  it("rejects an Interaction whose FollowUp has no reciprocal completion event", () => {
    const data = completeData();
    removeReachOutOwnership(data);
    data.interactions.push({
      id: "orphaned-completion",
      revision: 1,
      personId: data.people[0].id,
      kind: "follow_up_completed",
      occurredAt: fixedNow,
      followUpId: data.followUps[0].id,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });

    expect(() => validatePeopleOsData(data)).toThrow(/must have one reciprocal completion event/);
  });

  it("requires same-person reciprocal reschedule lineage and matching history", () => {
    const data = completeData();
    removeReachOutOwnership(data);
    const original: FollowUp = {
      ...data.followUps[0],
      reachOutEntryId: undefined,
      revision: 2,
      status: "superseded",
      supersededByFollowUpId: "follow-up-replacement"
    };
    const replacement: FollowUp = {
      id: "follow-up-replacement",
      revision: 1,
      personId: original.personId,
      dueDate: "2026-08-20",
      reason: "Arrange a meeting",
      actionType: "arrange_meeting",
      status: "pending",
      supersedesFollowUpId: original.id,
      createdAt: fixedNow,
      updatedAt: fixedNow
    };
    const event: FollowUpEvent = {
      id: "event-rescheduled",
      followUpId: original.id,
      personId: original.personId,
      kind: "rescheduled",
      occurredAt: fixedNow,
      fromDate: original.dueDate,
      toDate: replacement.dueDate,
      replacementFollowUpId: replacement.id
    };
    data.followUps = [original, replacement];
    data.followUpEvents.push(event);
    expect(validatePeopleOsData(data)).toBe(data);

    const broken = completeData();
    removeReachOutOwnership(broken);
    broken.followUps = [original, { ...replacement, supersedesFollowUpId: "missing" }];
    broken.followUpEvents.push(event);
    expect(() => validatePeopleOsData(broken)).toThrow(/supersed/);
  });

  it("enforces lifecycle event field semantics and TodaySkip composite IDs per record", () => {
    expect(() => assertValidRecord("followUpEvents", {
      id: "bad-created",
      followUpId: "follow-up-one",
      personId: "person-one",
      kind: "created",
      occurredAt: fixedNow
    })).toThrow(ValidationError);
    expect(() => assertValidRecord("followUpEvents", {
      id: "bad-snooze",
      followUpId: "follow-up-one",
      personId: "person-one",
      kind: "snoozed",
      occurredAt: fixedNow,
      fromDate: "2026-08-08",
      toDate: "2026-08-07"
    })).toThrow(ValidationError);
    expect(() => assertValidRecord("todaySkips", {
      id: "wrong-id",
      personId: "person-one",
      localDate: "2026-08-01",
      createdAt: fixedNow
    })).toThrow(ValidationError);
  });
});
