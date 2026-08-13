import { interactionKindLabel } from "../domain/interactionPolicy";
import type { InteractionKind, LocalDate } from "../domain/schema";
import type { Explanation, RelationshipStageValue } from "./types";

function fact(explanation: Explanation, label: string): string | undefined {
  return explanation.facts.find((candidate) => candidate.label === label)?.value;
}

function requiredFact(explanation: Explanation, label: string): string {
  const value = fact(explanation, label);
  if (value === undefined) throw new RangeError(`Explanation ${explanation.code} is missing ${label}.`);
  return value;
}

function cadenceFactLabel(explanation: Explanation): string {
  const value = fact(explanation, "cadenceValue");
  const unit = fact(explanation, "cadenceUnit");
  if (value !== undefined && unit !== undefined) {
    const count = Number(value);
    const label = count === 1 ? unit.replace(/s$/, "") : unit;
    return `${value} ${label}`;
  }
  const days = requiredFact(explanation, "cadenceDays");
  return `${days} ${days === "1" ? "day" : "days"}`;
}

export function formatEngineLocalDate(date: LocalDate, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T12:00:00.000Z`));
}

export function formatElapsedDuration(days: number): string {
  const safeDays = Math.max(0, Math.trunc(days));
  if (safeDays < 30) return `${safeDays} ${safeDays === 1 ? "day" : "days"}`;
  if (safeDays < 365) {
    const months = Math.max(1, Math.round(safeDays / 30.4375));
    return `about ${months} ${months === 1 ? "month" : "months"}`;
  }
  const years = Math.max(1, Math.round(safeDays / 365.2425));
  return `about ${years} ${years === 1 ? "year" : "years"}`;
}

export function relationshipStageLabel(value: RelationshipStageValue): string {
  if (value === "long_term") return "Long-term";
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

const actionLabels: Record<string, string> = {
  message: "message them",
  email: "email them",
  call: "call them",
  arrange_meeting: "arrange a meeting",
  make_introduction: "make an introduction",
  send_update: "send an update",
  research_contact_route: "research how to contact them",
  other: "take the action you recorded"
};

export function formatExplanation(explanation: Explanation, locale = "en-GB"): string {
  const key = explanation.templateKey;
  if (key.startsWith("today.explicit_follow_up.")) {
    const reason = requiredFact(explanation, "reason");
    const date = requiredFact(explanation, "effectiveDate");
    const planned = key.includes("due_today")
      ? `You planned to ${reason} today.`
      : `You planned to ${reason} on ${formatEngineLocalDate(date, locale)}.`;
    const reachOutReason = fact(explanation, "reachOutReason");
    return reachOutReason ? `${planned} You added this person to Reach Out because ${reachOutReason}.` : planned;
  }
  if (key === "today.brought_to_today") {
    return "You chose to bring this person forward to Today. No contact has been recorded yet.";
  }
  if (key === "today.new_relationship.event") {
    return `You met at ${requiredFact(explanation, "eventName")} ${requiredFact(explanation, "elapsedDays")} days ago and have not recorded a later follow-up.`;
  }
  if (key === "today.new_relationship") {
    return `Your only recorded contact was ${requiredFact(explanation, "elapsedDays")} days ago and you have not recorded a later follow-up.`;
  }
  if (key === "today.cadence_due") {
    return `You usually reconnect every ${cadenceFactLabel(explanation)}. Your last recorded contact was ${requiredFact(explanation, "elapsedDays")} days ago.`;
  }
  if (key === "intended_action.follow_up") {
    const action = requiredFact(explanation, "actionType");
    return `This follow-up is to ${actionLabels[action] ?? "take the action you recorded"}.`;
  }
  if (key === "intended_action.communication_preference") {
    return `You recorded that they prefer ${requiredFact(explanation, "preference")}.`;
  }
  if (key === "intended_action.preference_unavailable_fallback") {
    return `Their recorded ${requiredFact(explanation, "unavailablePreference")} preference is unavailable, so the first available contact method is shown as context.`;
  }
  if (key === "intended_action.contact_method") return "Their first available contact method is shown as context.";
  if (key === "intended_action.preference_unavailable_no_method") {
    return `Their recorded ${requiredFact(explanation, "unavailablePreference")} preference is unavailable and no contact method is stored yet.`;
  }
  if (key === "intended_action.no_contact_method") return "No contact method is available yet.";

  if (key === "relationship_stage.new.no_contact") {
    return "New · based on when you added this person; no contact recorded yet.";
  }
  if (key === "relationship_stage.new.single_contact") {
    return `New · 1 recorded conversation since your first contact on ${formatEngineLocalDate(requiredFact(explanation, "firstContactDate"), locale)}.`;
  }
  if (key.startsWith("relationship_stage.")) {
    const value = key.slice("relationship_stage.".length) as RelationshipStageValue;
    const count = Number(requiredFact(explanation, "contactCount"));
    const span = Number(requiredFact(explanation, "contactSpanDays"));
    return `${relationshipStageLabel(value)} · ${count} recorded ${count === 1 ? "conversation" : "conversations"} across ${formatElapsedDuration(span)}.`;
  }
  if (key === "relationship_age.estimated") {
    return `Added ${formatElapsedDuration(Number(requiredFact(explanation, "elapsedDays")))} ago · no contact recorded yet.`;
  }
  if (key === "relationship_age.contact") {
    return `Known for ${formatElapsedDuration(Number(requiredFact(explanation, "elapsedDays")))} · first recorded contact ${formatEngineLocalDate(requiredFact(explanation, "firstContactDate"), locale)}.`;
  }
  if (key === "last_contact.recorded") {
    const kind = requiredFact(explanation, "interactionKind") as InteractionKind;
    return `Last logged interaction: ${interactionKindLabel(kind)} on ${formatEngineLocalDate(requiredFact(explanation, "contactDate"), locale)}.`;
  }

  if (key === "memory_cue.follow_up") {
    return `From a follow-up planned for ${formatEngineLocalDate(requiredFact(explanation, "effectiveDate"), locale)}.`;
  }
  if (key.startsWith("memory_cue.fact.")) {
    return `From a memory fact you added on ${formatEngineLocalDate(requiredFact(explanation, "factAddedDate"), locale)}.`;
  }
  if (key === "memory_cue.event") return "From your first recorded meeting.";
  if (key === "memory_cue.affiliation") return "From the current affiliation you recorded.";

  if (key === "follow_up.overdue") {
    return `Planned for ${formatEngineLocalDate(requiredFact(explanation, "effectiveDate"), locale)}.`;
  }
  if (key === "follow_up.overdue.snoozed") {
    return `Snoozed until ${formatEngineLocalDate(requiredFact(explanation, "effectiveDate"), locale)}; originally planned for ${formatEngineLocalDate(requiredFact(explanation, "originalDate"), locale)}.`;
  }

  if (key === "suggested_reminder.event_contact") {
    return `Suggested for ${formatEngineLocalDate(requiredFact(explanation, "dueDate"), locale)}: 7 days after you met at ${requiredFact(explanation, "eventName")}.`;
  }
  if (key === "suggested_reminder.introduction_received") {
    return `Suggested for ${formatEngineLocalDate(requiredFact(explanation, "dueDate"), locale)}: 30 days after your introduction.`;
  }
  if (key === "suggested_reminder.cadence") {
    return `Suggested for ${formatEngineLocalDate(requiredFact(explanation, "dueDate"), locale)}: your contact cadence of ${cadenceFactLabel(explanation)}.`;
  }

  if (key === "reach_out.active") return "In Reach Out because you chose to contact this person.";
  if (key === "reach_out.waiting") return `Planned for ${formatEngineLocalDate(requiredFact(explanation, "effectiveDate"), locale)}.`;
  if (key === "reach_out.snoozed") {
    return `Snoozed until ${formatEngineLocalDate(requiredFact(explanation, "effectiveDate"), locale)}; originally planned for ${formatEngineLocalDate(requiredFact(explanation, "originalDate"), locale)}.`;
  }
  if (key === "reach_out.overdue") return `Planned for ${formatEngineLocalDate(requiredFact(explanation, "effectiveDate"), locale)}.`;
  if (key === "reach_out.completed") {
    const completionDate = fact(explanation, "completionDate");
    return completionDate ? `Outreach completed on ${formatEngineLocalDate(completionDate, locale)}.` : "Outreach completed.";
  }
  if (key === "reach_out.dormant") return "Kept for later with no active plan.";

  throw new RangeError(`Unsupported explanation template: ${key}`);
}
