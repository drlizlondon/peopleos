import { describe, expect, it } from "vitest";
import type { InteractionKind } from "./schema";
import {
  INTERACTION_KIND_LABELS,
  MANUAL_INTERACTION_KINDS,
  interactionCountsAsContact,
  interactionKindIsManuallySelectable,
  interactionKindLabel
} from "./interactionPolicy";

const allKinds = [
  "met",
  "contacted",
  "whatsapp_message",
  "email",
  "phone_call",
  "coffee",
  "meeting",
  "conference",
  "introduction_received",
  "introduction_made",
  "note_added",
  "follow_up_completed"
] as const satisfies readonly InteractionKind[];

describe("deterministic Interaction policy", () => {
  it("defines an explicit user-facing label for every stored kind", () => {
    expect(Object.keys(INTERACTION_KIND_LABELS).sort()).toEqual([...allKinds].sort());
    expect(allKinds.map(interactionKindLabel)).toEqual([
      "Met",
      "Contacted",
      "WhatsApp message",
      "Email",
      "Phone call",
      "Coffee",
      "Meeting",
      "Conference",
      "Introduction received",
      "Introduction made",
      "Note added",
      "Follow-up completed"
    ]);
  });

  it("counts only the accepted direct-contact kinds as contact", () => {
    const expected: Record<InteractionKind, boolean> = {
      met: true,
      contacted: true,
      whatsapp_message: true,
      email: true,
      phone_call: true,
      coffee: true,
      meeting: true,
      conference: true,
      introduction_received: true,
      introduction_made: false,
      note_added: false,
      follow_up_completed: false
    };

    expect(Object.fromEntries(allKinds.map((kind) => [kind, interactionCountsAsContact(kind)]))).toEqual(expected);
  });

  it("keeps lifecycle and shortcut-owned kinds out of manual logging", () => {
    expect(MANUAL_INTERACTION_KINDS).toEqual([
      "met",
      "whatsapp_message",
      "email",
      "phone_call",
      "coffee",
      "meeting",
      "conference",
      "introduction_received",
      "introduction_made"
    ]);
    expect(Object.fromEntries(allKinds.map((kind) => [kind, interactionKindIsManuallySelectable(kind)]))).toEqual({
      met: true,
      contacted: false,
      whatsapp_message: true,
      email: true,
      phone_call: true,
      coffee: true,
      meeting: true,
      conference: true,
      introduction_received: true,
      introduction_made: true,
      note_added: false,
      follow_up_completed: false
    });
  });
});
