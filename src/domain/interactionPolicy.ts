import type { InteractionKind } from "./schema";

export const INTERACTION_KIND_LABELS: Record<InteractionKind, string> = {
  met: "Met",
  contacted: "Contacted",
  whatsapp_message: "WhatsApp message",
  email: "Email",
  phone_call: "Phone call",
  coffee: "Coffee",
  meeting: "Meeting",
  conference: "Conference",
  introduction_received: "Introduction received",
  introduction_made: "Introduction made",
  note_added: "Note added",
  follow_up_completed: "Follow-up completed"
};

export const MANUAL_INTERACTION_KINDS = [
  "met",
  "whatsapp_message",
  "email",
  "phone_call",
  "coffee",
  "meeting",
  "conference",
  "introduction_received",
  "introduction_made"
] as const satisfies readonly InteractionKind[];

const CONTACT_KINDS = new Set<InteractionKind>([
  "met",
  "contacted",
  "whatsapp_message",
  "email",
  "phone_call",
  "coffee",
  "meeting",
  "conference",
  "introduction_received"
]);

export function interactionCountsAsContact(kind: InteractionKind): boolean {
  return CONTACT_KINDS.has(kind);
}

export function interactionKindLabel(kind: InteractionKind): string {
  return INTERACTION_KIND_LABELS[kind];
}

export function interactionKindIsManuallySelectable(kind: InteractionKind): boolean {
  return (MANUAL_INTERACTION_KINDS as readonly InteractionKind[]).includes(kind);
}
