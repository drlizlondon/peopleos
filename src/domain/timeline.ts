import {
  interactionCountsAsContact,
  interactionKindLabel
} from "./interactionPolicy";
import type {
  FollowUpEvent,
  Interaction,
  Person,
  ReachOutEvent
} from "./schema";

export type TimelineFilter = "all" | "contact" | "notes" | "follow_ups" | "reach_out";

export type TimelineItem = {
  id: string;
  source: "interaction" | "follow_up" | "reach_out" | "person_created";
  occurredAt: string;
  title: string;
  summary?: string;
  countsAsContact: boolean;
  interactionId?: string;
  interaction?: Interaction;
  eventId?: string;
  relatedPersonId?: string;
  followUpId?: string;
  reachOutEntryId?: string;
  editable: boolean;
};

const SOURCE_RANK: Record<TimelineItem["source"], number> = {
  interaction: 0,
  follow_up: 1,
  reach_out: 2,
  person_created: 3
};

const FOLLOW_UP_LABELS: Record<FollowUpEvent["kind"], string> = {
  created: "Follow-up planned",
  snoozed: "Follow-up snoozed",
  rescheduled: "Follow-up rescheduled",
  completed_with_contact: "Follow-up completed",
  completed_without_contact: "Follow-up completed without contact",
  cancelled: "Follow-up cancelled"
};

const REACH_OUT_LABELS: Record<ReachOutEvent["kind"], string> = {
  added: "Added to Reach Out",
  activated: "Reach Out reactivated",
  completed: "Reach Out completed",
  moved_to_dormant: "Reach Out moved to Dormant",
  removed: "Removed from Reach Out",
  follow_up_linked: "Reach Out reminder linked"
};

function compareTimelineItems(left: TimelineItem, right: TimelineItem): number {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt > right.occurredAt ? -1 : 1;
  const source = SOURCE_RANK[left.source] - SOURCE_RANK[right.source];
  if (source) return source;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function followUpSummary(event: FollowUpEvent): string | undefined {
  if (event.kind === "created" && event.toDate) return `Due ${event.toDate}`;
  if ((event.kind === "snoozed" || event.kind === "rescheduled") && event.toDate) {
    return `${event.fromDate ? `${event.fromDate} → ` : ""}${event.toDate}`;
  }
  return undefined;
}

export function buildTimeline(
  person: Person,
  interactions: Interaction[],
  followUpEvents: FollowUpEvent[] = [],
  reachOutEvents: ReachOutEvent[] = []
): TimelineItem[] {
  const interactionsById = new Map(interactions.map((interaction) => [interaction.id, interaction]));
  const coalescedInteractionIds = new Set(
    followUpEvents.flatMap((event) => event.interactionId ? [event.interactionId] : [])
  );
  const lifecycleInteractionIds = new Set([
    ...followUpEvents.flatMap((event) => event.interactionId ? [event.interactionId] : []),
    ...reachOutEvents.flatMap((event) => event.interactionId ? [event.interactionId] : [])
  ]);

  const interactionItems: TimelineItem[] = interactions
    .filter((interaction) => !coalescedInteractionIds.has(interaction.id))
    .map((interaction) => ({
      id: interaction.id,
      source: "interaction",
      occurredAt: interaction.occurredAt,
      title: interactionKindLabel(interaction.kind),
      ...(interaction.summary ? { summary: interaction.summary } : {}),
      countsAsContact: interactionCountsAsContact(interaction.kind),
      interactionId: interaction.id,
      interaction,
      ...(interaction.eventId ? { eventId: interaction.eventId } : {}),
      ...(interaction.relatedPersonId ? { relatedPersonId: interaction.relatedPersonId } : {}),
      ...(interaction.followUpId ? { followUpId: interaction.followUpId } : {}),
      editable: !interaction.followUpId
        && !lifecycleInteractionIds.has(interaction.id)
        && interaction.kind !== "contacted"
        && interaction.kind !== "follow_up_completed"
    }));

  const followUpItems: TimelineItem[] = followUpEvents.map((event) => {
    const interaction = event.interactionId ? interactionsById.get(event.interactionId) : undefined;
    return {
      id: event.id,
      source: "follow_up",
      // A completion may be recorded after the contact happened. Keep the
      // lifecycle event's audit timestamp in storage, but place the coalesced
      // Timeline item at the linked Interaction's real-world timestamp.
      occurredAt: interaction?.occurredAt ?? event.occurredAt,
      title: interaction && event.kind !== "completed_without_contact"
        ? `${FOLLOW_UP_LABELS[event.kind]} · ${interactionKindLabel(interaction.kind)}`
        : FOLLOW_UP_LABELS[event.kind],
      ...(interaction?.summary
        ? { summary: interaction.summary }
        : followUpSummary(event)
          ? { summary: followUpSummary(event) }
          : {}),
      countsAsContact: interaction ? interactionCountsAsContact(interaction.kind) : false,
      ...(interaction ? { interactionId: interaction.id, interaction } : {}),
      ...(interaction?.eventId ? { eventId: interaction.eventId } : {}),
      ...(interaction?.relatedPersonId ? { relatedPersonId: interaction.relatedPersonId } : {}),
      followUpId: event.followUpId,
      editable: false
    };
  });

  const reachOutItems: TimelineItem[] = reachOutEvents.map((event) => ({
    id: event.id,
    source: "reach_out",
    occurredAt: event.occurredAt,
    title: REACH_OUT_LABELS[event.kind],
    countsAsContact: false,
    reachOutEntryId: event.reachOutEntryId,
    ...(event.followUpId ? { followUpId: event.followUpId } : {}),
    ...(event.interactionId ? { interactionId: event.interactionId } : {}),
    editable: false
  }));

  const creationItem: TimelineItem = {
    id: `person-created:${person.id}`,
    source: "person_created",
    occurredAt: person.createdAt,
    title: "Person created",
    countsAsContact: false,
    editable: false
  };

  return [
    ...interactionItems,
    ...followUpItems,
    ...reachOutItems,
    creationItem
  ].sort(compareTimelineItems);
}

export function deriveLastContact(interactions: Interaction[]): Interaction | undefined {
  return interactions
    .filter((interaction) => interactionCountsAsContact(interaction.kind))
    .sort((left, right) => {
      if (left.occurredAt !== right.occurredAt) return left.occurredAt > right.occurredAt ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })[0];
}

export function filterTimelineItems(items: TimelineItem[], filter: TimelineFilter): TimelineItem[] {
  if (filter === "all") return items;
  if (filter === "contact") return items.filter((item) => item.countsAsContact);
  if (filter === "notes") return items.filter((item) => item.interaction?.kind === "note_added");
  if (filter === "follow_ups") return items.filter((item) => item.source === "follow_up");
  return items.filter((item) => item.source === "reach_out");
}
