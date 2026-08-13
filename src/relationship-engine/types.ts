import type {
  ContactMethod,
  FollowUp,
  Interaction,
  InteractionKind,
  LocalDate,
  MemoryFact,
  OrganisationAffiliation,
  Person,
  ReachOutEntry,
  RelationshipEvent,
  TodaySkip
} from "../domain/schema";
import type { ReachOutDisplayState } from "../domain/reachOutPolicy";

export const RELATIONSHIP_ENGINE_POLICY_VERSION = "peopleos-v1" as const;

export type RelationshipEnginePolicyVersion = typeof RELATIONSHIP_ENGINE_POLICY_VERSION;

export type RelationshipClock = {
  now: string;
  timeZone: string;
  policyVersion: RelationshipEnginePolicyVersion;
};

export type RelationshipPersonBundle = {
  person: Person;
  contactMethods: readonly ContactMethod[];
  interactions: readonly Interaction[];
  followUps: readonly FollowUp[];
  reachOutEntries: readonly ReachOutEntry[];
  facts: readonly MemoryFact[];
  affiliations: readonly OrganisationAffiliation[];
  events: readonly RelationshipEvent[];
  /**
   * The interaction whose newly recorded facts should drive a reminder suggestion.
   * When omitted, the latest contact interaction is used so a read projection is
   * still deterministic.
   */
  triggeringInteractionId?: string;
};

export type RelationshipScheduleState =
  | {
      kind: "scheduled";
      localDate: LocalDate;
      /** A date-scoped override whose ordinary schedule resumes later. */
      temporary?: true;
      resumesOn?: LocalDate;
    }
  | { kind: "incomplete_regular_schedule" }
  | { kind: "not_scheduled" };

export type ExplanationFact = {
  label: string;
  value: string;
  sourceId?: string;
};

export type Explanation = {
  code: string;
  templateKey: string;
  facts: ExplanationFact[];
};

export type TodayEligibilityCode =
  | "explicit_follow_up"
  | "brought_to_today"
  | "new_relationship"
  | "cadence_due";

export type TodayDueState = "overdue" | "due_today" | "rule_due";

export type IntendedActionCode =
  | "message"
  | "email"
  | "call"
  | "arrange_meeting"
  | "make_introduction"
  | "send_update"
  | "research_contact_route"
  | "other"
  | "add_contact_details";

export type IntendedActionContext = {
  code: IntendedActionCode;
  source: "follow_up" | "communication_preference" | "contact_method" | "none";
  sourceId?: string;
  explanation: Explanation;
};

export type TodayAssessment = {
  eligibilityCode: TodayEligibilityCode;
  dueState: TodayDueState;
  relevantDate: LocalDate;
  primaryFollowUpId?: string;
  additionalDueFollowUpIds: string[];
  explanation: Explanation;
  intendedActionContext: IntendedActionContext;
};

export type RelationshipStageValue = "new" | "growing" | "established" | "long_term";

export type RelationshipStageProjection = {
  value: RelationshipStageValue;
  contactCount: number;
  contactSpanDays: number;
  explanation: Explanation;
};

export type MemoryCueSource = "follow_up" | "memory_fact" | "event" | "affiliation";

export type MemoryCueProjection = {
  text: string;
  source: MemoryCueSource;
  sourceId: string;
  explanation: Explanation;
};

export type OverdueFollowUpProjection = {
  followUpId: string;
  effectiveDate: LocalDate;
  originalDate: LocalDate;
  explanation: Explanation;
};

export type SuggestedReminderRule = "event_contact" | "introduction_received" | "cadence";

export type SuggestedReminderProjection = {
  dueDate: LocalDate;
  rule: SuggestedReminderRule;
  sourceInteractionId: string;
  explanation: Explanation;
};

export type RelationshipAgeProjection = {
  startedAt: string;
  startDate: LocalDate;
  elapsedDays: number;
  estimated: boolean;
  sourceInteractionId?: string;
  explanation: Explanation;
};

export type LastContactProjection = {
  interactionId: string;
  kind: InteractionKind;
  occurredAt: string;
  localDate: LocalDate;
  explanation: Explanation;
};

export type ReachOutStateProjection = {
  reachOutEntryId: string;
  state: ReachOutDisplayState;
  currentFollowUpId?: string;
  effectiveDate?: LocalDate;
  due: boolean;
  upcoming: boolean;
  explanation: Explanation;
};

export type RelationshipAssessment = {
  policyVersion: RelationshipEnginePolicyVersion;
  evaluatedAt: string;
  timeZone: string;
  localDate: LocalDate;
  personId: string;
  displayName: string;
  importance: Person["importance"];
  active: boolean;
  scheduleState: RelationshipScheduleState;
  today?: TodayAssessment;
  relationshipStage: RelationshipStageProjection;
  memoryCue?: MemoryCueProjection;
  searchContextCue?: MemoryCueProjection;
  overdueFollowUp?: OverdueFollowUpProjection;
  suggestedReminder?: SuggestedReminderProjection;
  lastContact?: LastContactProjection;
  lastContactAt?: string;
  relationshipAge: RelationshipAgeProjection;
  relationshipStartedAt: string;
  reachOutStates: ReachOutStateProjection[];
};

export type TodayItem = TodayAssessment & { personId: string };

export type TodayResult = {
  policyVersion: RelationshipEnginePolicyVersion;
  evaluatedAt: string;
  timeZone: string;
  localDate: LocalDate;
  orderedItems: TodayItem[];
  totalCount: number;
};

export type BuildTodayInput = {
  assessments: readonly RelationshipAssessment[];
  todaySkips: readonly TodaySkip[];
  clock: RelationshipClock;
};
