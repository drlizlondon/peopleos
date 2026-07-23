import { describe, expect, it } from "vitest";
import { completeData, fixedNow } from "../test/fixtures";
import { validatePeopleOsData, ValidationError } from "./validation";

function invalid(mutator: (data: ReturnType<typeof completeData>) => void): void {
  const data = completeData();
  mutator(data);
  expect(() => validatePeopleOsData(data)).toThrow(ValidationError);
}

describe("Reach Out graph validation", () => {
  it("rejects a pending linked FollowUp without the reciprocal current pointer", () => {
    invalid((data) => { delete data.reachOutEntries[0].currentFollowUpId; });
  });

  it("rejects two pending FollowUps linked to one current entry", () => {
    invalid((data) => {
      data.followUps.push({
        ...data.followUps[0],
        id: "follow-up-second",
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T10:00:00.000Z"
      });
      data.followUpEvents.push({
        ...data.followUpEvents[0],
        id: "follow-up-event-second",
        followUpId: "follow-up-second",
        occurredAt: "2026-08-01T10:00:00.000Z"
      });
      data.reachOutEvents.push({
        id: "reach-out-link-second",
        reachOutEntryId: data.reachOutEntries[0].id,
        kind: "follow_up_linked",
        occurredAt: "2026-08-01T10:00:00.000Z",
        followUpId: "follow-up-second"
      });
    });
  });

  it("rejects current pointers on completed, Dormant, or removed entries", () => {
    for (const state of ["completed", "dormant"] as const) {
      invalid((data) => { data.reachOutEntries[0].intentStatus = state; });
    }
    invalid((data) => { data.reachOutEntries[0].removedAt = fixedNow; });
  });

  it("requires one matching added event and reciprocal current link event", () => {
    invalid((data) => {
      data.reachOutEvents = data.reachOutEvents.filter((event) => event.kind !== "added");
    });
    invalid((data) => {
      data.reachOutEvents = data.reachOutEvents.filter((event) => event.kind !== "follow_up_linked");
    });
  });

  it("requires latest completion and removal facts to be backed by history", () => {
    invalid((data) => { data.reachOutEntries[0].lastCompletedAt = fixedNow; });
    invalid((data) => {
      data.reachOutEntries[0].removedAt = fixedNow;
      delete data.reachOutEntries[0].currentFollowUpId;
      data.followUps[0].status = "cancelled";
      data.followUpEvents.push({
        id: "cancel",
        followUpId: data.followUps[0].id,
        personId: data.followUps[0].personId,
        kind: "cancelled",
        occurredAt: fixedNow
      });
    });
  });

  it("rejects duplicate contexts and lifecycle links owned by another Person", () => {
    invalid((data) => { data.reachOutEntries[0].contextIds.push(data.reachOutEntries[0].contextIds[0]); });
    invalid((data) => {
      data.people.push({ ...data.people[0], id: "person-other", displayName: "Other Person" });
      data.interactions.push({
        id: "interaction-other",
        revision: 1,
        personId: "person-other",
        kind: "email",
        occurredAt: fixedNow,
        createdAt: fixedNow,
        updatedAt: fixedNow
      });
      data.reachOutEvents.push({
        id: "reach-out-complete-wrong-owner",
        reachOutEntryId: data.reachOutEntries[0].id,
        kind: "completed",
        occurredAt: fixedNow,
        interactionId: "interaction-other"
      });
      data.reachOutEntries[0].lastCompletedAt = fixedNow;
    });
  });

  it("rejects blank Reach Out relationship IDs and malformed command fingerprints", () => {
    invalid((data) => { data.reachOutEntries[0].currentFollowUpId = ""; });
    invalid((data) => { data.reachOutContexts[0].eventId = ""; });
    invalid((data) => { data.reachOutEvents[0].interactionId = ""; });
    invalid((data) => { data.reachOutEvents[0].commandFingerprint = "not-a-fingerprint"; });
    invalid((data) => { data.people[0].mergeCommandFingerprint = "not-a-fingerprint"; });
    invalid((data) => { data.people[0].identityCompletionFingerprint = "not-a-fingerprint"; });
    invalid((data) => {
      data.people[0].identityStatus = "provisional";
      data.people[0].identityCompletionFingerprint = "0123456789abcdef";
    });
    invalid((data) => { data.reachOutEntries[0].lastCommandFingerprint = ""; });
  });

  it("allows an archived Person to preserve Reach Out history but rejects a merged owner", () => {
    const archived = completeData();
    archived.people[0].archivedAt = fixedNow;
    expect(() => validatePeopleOsData(archived)).not.toThrow();
    invalid((data) => {
      data.people.push({ ...data.people[0], id: "person-survivor", displayName: "Survivor" });
      data.people[0].identityStatus = "merged";
      data.people[0].mergedIntoPersonId = "person-survivor";
    });
  });
});
