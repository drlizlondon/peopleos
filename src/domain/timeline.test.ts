import { describe, expect, it } from "vitest";
import type { FollowUpEvent, Interaction, InteractionKind, Person } from "./schema";
import {
  buildTimeline,
  deriveLastContact,
  filterTimelineItems
} from "./timeline";

const createdAt = "2026-01-01T09:00:00.000Z";
const sharedTime = "2026-02-01T10:00:00.000Z";

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-one",
    revision: 1,
    displayName: "Sarah Jones",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

function interaction(
  id: string,
  kind: InteractionKind,
  occurredAt = sharedTime,
  overrides: Partial<Interaction> = {}
): Interaction {
  return {
    id,
    revision: 1,
    personId: "person-one",
    kind,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    ...overrides
  };
}

function followUpEvent(
  id: string,
  kind: FollowUpEvent["kind"],
  overrides: Partial<FollowUpEvent> = {}
): FollowUpEvent {
  return {
    id,
    followUpId: `follow-up-${id}`,
    personId: "person-one",
    kind,
    occurredAt: sharedTime,
    ...overrides
  };
}

describe("automatic Timeline projection", () => {
  it("derives Person creation without storing a duplicate Interaction", () => {
    expect(buildTimeline(person(), [])).toEqual([{
      id: "person-created:person-one",
      source: "person_created",
      occurredAt: createdAt,
      title: "Person created",
      countsAsContact: false,
      editable: false
    }]);
  });

  it("orders equal timestamps by visible source rank and then stable ID", () => {
    const result = buildTimeline(
      person({ createdAt: sharedTime }),
      [interaction("interaction-z", "email"), interaction("interaction-a", "note_added")],
      [followUpEvent("follow-up-event-z", "cancelled"), followUpEvent("follow-up-event-a", "created")]
    );

    expect(result.map((item) => item.id)).toEqual([
      "interaction-a",
      "interaction-z",
      "follow-up-event-a",
      "follow-up-event-z",
      "person-created:person-one"
    ]);
  });

  it("places Person creation at its recorded time when history is backdated", () => {
    const result = buildTimeline(
      person({ createdAt: "2026-07-01T09:00:00.000Z" }),
      [interaction("older-meeting", "meeting", "2025-03-01T10:00:00.000Z")]
    );

    expect(result.map((item) => item.id)).toEqual([
      "person-created:person-one",
      "older-meeting"
    ]);
  });

  it("coalesces a linked completion into one non-editable visible item", () => {
    const completed = interaction("interaction-complete", "email", sharedTime, {
      summary: "Sent the promised update",
      followUpId: "follow-up-one",
      eventId: "event-one",
      relatedPersonId: "person-two"
    });
    const result = buildTimeline(person(), [completed], [followUpEvent(
      "follow-up-event-complete",
      "completed_with_contact",
      { followUpId: "follow-up-one", interactionId: completed.id }
    )]);

    const visible = result.filter((item) => item.occurredAt === sharedTime);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: "follow-up-event-complete",
      source: "follow_up",
      title: "Follow-up completed · Email",
      summary: "Sent the promised update",
      countsAsContact: true,
      interactionId: completed.id,
      eventId: "event-one",
      relatedPersonId: "person-two",
      followUpId: "follow-up-one",
      editable: false
    });
  });

  it("places a backdated linked completion at the contact time, not the later audit time", () => {
    const contactTime = "2026-01-28T09:30:00.000Z";
    const auditTime = "2026-02-01T10:00:00.000Z";
    const completed = interaction("interaction-backdated", "phone_call", contactTime, {
      followUpId: "follow-up-backdated"
    });
    const result = buildTimeline(person(), [completed], [followUpEvent(
      "follow-up-event-backdated",
      "completed_with_contact",
      {
        followUpId: "follow-up-backdated",
        interactionId: completed.id,
        occurredAt: auditTime
      }
    )]);

    expect(result.find((item) => item.id === "follow-up-event-backdated")?.occurredAt).toBe(contactTime);
  });

  it("keeps a lifecycle item understandable when its optional linked Interaction is unavailable", () => {
    const result = buildTimeline(person(), [], [followUpEvent(
      "follow-up-event-missing-link",
      "rescheduled",
      { fromDate: "2026-02-01", toDate: "2026-02-08", interactionId: "missing-interaction" }
    )]);

    expect(result[0]).toMatchObject({
      source: "follow_up",
      title: "Follow-up rescheduled",
      summary: "2026-02-01 → 2026-02-08",
      countsAsContact: false,
      editable: false
    });
  });

  it("derives last contact by contact policy, timestamp, and stable ID", () => {
    const records = [
      interaction("note-newest", "note_added", "2026-03-03T12:00:00.000Z"),
      interaction("contact-z", "email", "2026-03-02T12:00:00.000Z"),
      interaction("contact-a", "meeting", "2026-03-02T12:00:00.000Z"),
      interaction("intro-made", "introduction_made", "2026-03-04T12:00:00.000Z")
    ];

    expect(deriveLastContact(records)?.id).toBe("contact-a");
    expect(deriveLastContact(records.filter((record) => !["contact-a", "contact-z"].includes(record.id)))).toBeUndefined();
  });

  it("filters contact, notes and FollowUp history without mutating source order", () => {
    const items = buildTimeline(person(), [
      interaction("contact", "phone_call", "2026-03-01T12:00:00.000Z"),
      interaction("note", "note_added", "2026-03-02T12:00:00.000Z"),
      interaction("intro", "introduction_made", "2026-03-03T12:00:00.000Z")
    ], [followUpEvent("follow-up-event", "created", { occurredAt: "2026-03-04T12:00:00.000Z" })]);

    expect(filterTimelineItems(items, "contact").map((item) => item.id)).toEqual(["contact"]);
    expect(filterTimelineItems(items, "notes").map((item) => item.id)).toEqual(["note"]);
    expect(filterTimelineItems(items, "follow_ups").map((item) => item.id)).toEqual(["follow-up-event"]);
    expect(filterTimelineItems(items, "reach_out")).toEqual([]);
    expect(filterTimelineItems(items, "all")).toBe(items);
  });

  it("projects existing Reach Out lifecycle records without counting them as contact", () => {
    const linked = interaction("reach-out-contact", "email");
    const items = buildTimeline(person(), [linked], [], [{
      id: "reach-out-event",
      reachOutEntryId: "reach-out-one",
      kind: "added",
      occurredAt: sharedTime,
      interactionId: linked.id
    }]);

    expect(filterTimelineItems(items, "reach_out")).toEqual([expect.objectContaining({
      id: "reach-out-event",
      source: "reach_out",
      title: "Added to Reach Out",
      countsAsContact: false,
      editable: false
    })]);
    expect(items.find((item) => item.id === linked.id)?.editable).toBe(false);
  });
});
