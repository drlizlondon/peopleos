export const DATABASE_NAME = "peopleos-v1";
export const DATABASE_VERSION = 5;
export const BACKUP_SCHEMA_VERSION = 7;
export const DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS = 14;
export const DEFAULT_TODAY_NOTIFICATION_TIME = "12:00";

export type EntityId = string;
export type IsoInstant = string;
export type LocalDate = string;

export type ConversationStarter = {
  id: EntityId;
  template: string;
  relationshipMode: "personal" | "professional" | "both";
};

export const DEFAULT_CONVERSATION_STARTERS = [
  {
    id: "personal-thinking-of-you",
    template: "Hey {name}, just thinking of you today.",
    relationshipMode: "personal"
  },
  {
    id: "personal-how-have-you-been",
    template: "Hi {name}, how have you been lately?",
    relationshipMode: "personal"
  },
  {
    id: "personal-whats-new",
    template: "Hey {name}, what’s new with you?",
    relationshipMode: "personal"
  },
  {
    id: "professional-check-in",
    template: "Hi {name}, I wanted to check in and see how things are going.",
    relationshipMode: "professional"
  },
  {
    id: "professional-catch-up",
    template: "Hi {name}, I’ve been meaning to catch up — how are things?",
    relationshipMode: "professional"
  },
  {
    id: "both-how-are-things",
    template: "Hi {name}, how are things with you?",
    relationshipMode: "both"
  },
  // Everything below was added after the first release. New starters are
  // appended, never inserted: Today picks the first unused starter matching a
  // Person's mode, so reordering the head would change which message an
  // existing relationship is offered next.
  {
    id: "personal-been-a-while",
    template: "Hi {name}, it’s been a while — how are you doing?",
    relationshipMode: "personal"
  },
  {
    id: "personal-popped-into-head",
    template: "Hey {name}, you popped into my head today. How are you?",
    relationshipMode: "personal"
  },
  {
    id: "personal-hope-youre-well",
    template: "Hi {name}, hope you’re keeping well. What have you been up to?",
    relationshipMode: "personal"
  },
  {
    id: "personal-long-overdue",
    template: "Hey {name}, this is long overdue — how have things been?",
    relationshipMode: "personal"
  },
  {
    id: "personal-how-is-everyone",
    template: "Hi {name}, how is everyone at home?",
    relationshipMode: "personal"
  },
  {
    id: "personal-proper-catch-up",
    template: "Hey {name}, are you free for a proper catch-up sometime soon?",
    relationshipMode: "personal"
  },
  {
    id: "personal-still-owe-you",
    template: "Hi {name}, I still owe you a proper catch-up. How are you?",
    relationshipMode: "personal"
  },
  {
    id: "personal-no-agenda",
    template: "Hey {name}, just checking in — no agenda, I hope you’re well.",
    relationshipMode: "personal"
  },
  {
    id: "personal-coffee-soon",
    template: "Hi {name}, fancy a coffee sometime in the next few weeks?",
    relationshipMode: "personal"
  },
  {
    id: "personal-miss-seeing-you",
    template: "Hey {name}, I miss seeing you. How have you been?",
    relationshipMode: "personal"
  },
  {
    id: "personal-kind-week",
    template: "Hi {name}, I hope this week is treating you kindly. How are things?",
    relationshipMode: "personal"
  },
  {
    id: "professional-how-is-work",
    template: "Hi {name}, how is work going at the moment?",
    relationshipMode: "professional"
  },
  {
    id: "professional-since-we-spoke",
    template: "Hi {name}, it’s been a while since we spoke — how are things progressing?",
    relationshipMode: "professional"
  },
  {
    id: "professional-keeping-you-busy",
    template: "Hi {name}, what’s keeping you busy at the moment?",
    relationshipMode: "professional"
  },
  {
    id: "professional-stayed-with-me",
    template: "Hi {name}, our last conversation has stayed with me. How are things now?",
    relationshipMode: "professional"
  },
  {
    id: "professional-any-news",
    template: "Hi {name}, any news since we last caught up?",
    relationshipMode: "professional"
  },
  {
    id: "professional-coffee-or-call",
    template: "Hi {name}, would you be up for a coffee or a quick call in the next few weeks?",
    relationshipMode: "professional"
  },
  {
    id: "professional-how-did-it-go",
    template: "Hi {name}, how did everything go in the end?",
    relationshipMode: "professional"
  },
  {
    id: "professional-settling-in",
    template: "Hi {name}, how are you settling into things?",
    relationshipMode: "professional"
  },
  {
    id: "professional-your-work",
    template: "Hi {name}, I was thinking about what you’re working on. How is it coming along?",
    relationshipMode: "professional"
  },
  {
    id: "professional-quick-hello",
    template: "Hi {name}, just a quick hello — I didn’t want too long to pass without one.",
    relationshipMode: "professional"
  },
  {
    id: "professional-anything-i-can-help",
    template: "Hi {name}, how are things going? Do let me know if there’s anything I can help with.",
    relationshipMode: "professional"
  },
  {
    id: "professional-reconnect",
    template: "Hi {name}, I’d love to reconnect properly. How does your diary look?",
    relationshipMode: "professional"
  },
  {
    id: "professional-since-we-met",
    template: "Hi {name}, it was good to meet you. How have things been since?",
    relationshipMode: "professional"
  },
  {
    id: "professional-year-ahead",
    template: "Hi {name}, how is the year shaping up for you?",
    relationshipMode: "professional"
  },
  {
    id: "both-hope-youre-good",
    template: "Hi {name}, I hope you’re good. What’s been happening?",
    relationshipMode: "both"
  },
  {
    id: "both-on-my-mind",
    template: "Hi {name}, you were on my mind today. How are you?",
    relationshipMode: "both"
  },
  {
    id: "both-quick-check-in",
    template: "Hi {name}, a quick check-in — how are you doing?",
    relationshipMode: "both"
  },
  {
    id: "both-far-too-long",
    template: "Hi {name}, it’s been far too long. How are you?",
    relationshipMode: "both"
  },
  {
    id: "both-whats-been-happening",
    template: "Hi {name}, what’s been happening with you lately?",
    relationshipMode: "both"
  },
  {
    id: "both-hows-your-week",
    template: "Hi {name}, how has your week been?",
    relationshipMode: "both"
  },
  {
    id: "both-no-agenda",
    template: "Hi {name}, no agenda — I just wanted to see how you are.",
    relationshipMode: "both"
  },
  {
    id: "both-find-a-time",
    template: "Hi {name}, shall we find a time to catch up properly?",
    relationshipMode: "both"
  },
  {
    id: "both-still-here",
    template: "Hi {name}, just so you know I’m still here and thinking of you. How are things?",
    relationshipMode: "both"
  },
  {
    id: "both-how-are-you-really",
    template: "Hi {name}, how are you — really?",
    relationshipMode: "both"
  },
  {
    id: "both-good-to-hear",
    template: "Hi {name}, it would be good to hear from you. How have things been?",
    relationshipMode: "both"
  }
] as const satisfies readonly ConversationStarter[];

/**
 * The six starters the first release shipped with. A stored list that still
 * matches these exactly has never been edited, so it can safely be replaced by
 * the larger default set. An edited list belongs to the user and is left alone.
 */
const ORIGINAL_DEFAULT_CONVERSATION_STARTERS = [
  ["personal-thinking-of-you", "Hey {name}, just thinking of you today."],
  ["personal-how-have-you-been", "Hi {name}, how have you been lately?"],
  ["personal-whats-new", "Hey {name}, what’s new with you?"],
  ["professional-check-in", "Hi {name}, I wanted to check in and see how things are going."],
  ["professional-catch-up", "Hi {name}, I’ve been meaning to catch up — how are things?"],
  ["both-how-are-things", "Hi {name}, how are things with you?"]
] as const;

export function isOriginalConversationStarterSet(
  starters: readonly ConversationStarter[] | undefined
): boolean {
  return starters !== undefined
    && starters.length === ORIGINAL_DEFAULT_CONVERSATION_STARTERS.length
    && starters.every((starter, index) => {
      const [id, template] = ORIGINAL_DEFAULT_CONVERSATION_STARTERS[index]!;
      return starter.id === id && starter.template === template;
    });
}

export type ContactCadenceUnit = "days" | "weeks" | "months";

export type ContactCadence = {
  value: number;
  unit: ContactCadenceUnit;
};

export type MutableRecord = {
  id: EntityId;
  revision: number;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
};

export type Person = MutableRecord & {
  displayName: string;
  /** The familiar name used on conversational surfaces. Legacy records may omit it. */
  conversationalName?: string;
  relationshipMode?: "personal" | "professional" | "both";
  identityStatus: "provisional" | "confirmed" | "merged";
  mergedIntoPersonId?: EntityId;
  mergeCommandFingerprint?: string;
  identityCompletionFingerprint?: string;
  importance: "normal" | "high";
  tags: string[];
  contactCadence?: ContactCadence;
  /** @deprecated Read compatibility for records written before structured cadence storage. */
  contactCadenceDays?: number;
  /** @deprecated Main-v3 compatibility; migrated to a private initial schedule. */
  contactCadenceFirstDueDate?: LocalDate;
  /** @deprecated Main-v3 compatibility; migrated to todayPausedUntilDate. */
  contactCadenceDeferredUntilDate?: LocalDate;
  /** @deprecated Main-v3 indefinite pause; requires an explicit resume choice. */
  contactCadencePausedAt?: IsoInstant;
  /** A user-chosen date before which this Person must not appear in Today. */
  todayPausedUntilDate?: LocalDate;
  /** A date-scoped, non-contacting override that temporarily brings this Person into Today. */
  broughtToTodayDate?: LocalDate;
  /** Legacy lightweight Today note, retained for lossless compatibility. */
  todayNote?: string;
  todayNoteCompletedAt?: IsoInstant;
  archivedAt?: IsoInstant;
};

type ContactMethodBase = MutableRecord & {
  personId: EntityId;
  label?: string;
  rawValue: string;
  canonicalValue: string;
  isPreferred: boolean;
  archivedAt?: IsoInstant;
};

export type ContactMethod =
  | (ContactMethodBase & { kind: "phone"; region?: string })
  | (ContactMethodBase & { kind: "email" });

export type ExternalIdentity = MutableRecord & {
  personId: EntityId;
  provider: string;
  externalId: string;
  profileUrl?: string;
  linkedAt: IsoInstant;
  lastSyncedAt?: IsoInstant;
  archivedAt?: IsoInstant;
};

export type OrganisationAffiliation = MutableRecord & {
  personId: EntityId;
  organisationName: string;
  role?: string;
  startedOn?: LocalDate;
  endedOn?: LocalDate;
  isCurrent: boolean;
  archivedAt?: IsoInstant;
};

export type InteractionKind =
  | "met"
  | "contacted"
  | "whatsapp_message"
  | "email"
  | "phone_call"
  | "coffee"
  | "meeting"
  | "conference"
  | "introduction_received"
  | "introduction_made"
  | "note_added"
  | "follow_up_completed";

export type Interaction = MutableRecord & {
  personId: EntityId;
  kind: InteractionKind;
  occurredAt: IsoInstant;
  summary?: string;
  eventId?: EntityId;
  relatedPersonId?: EntityId;
  followUpId?: EntityId;
};

export type FollowUpActionType =
  | "message"
  | "email"
  | "call"
  | "arrange_meeting"
  | "make_introduction"
  | "send_update"
  | "research_contact_route"
  | "other";

export type FollowUp = MutableRecord & {
  personId: EntityId;
  dueDate: LocalDate;
  reason: string;
  actionType: FollowUpActionType;
  suggestedByRule?: string;
  reachOutEntryId?: EntityId;
  status: "pending" | "completed" | "cancelled" | "superseded";
  completedAt?: IsoInstant;
  snoozedUntilDate?: LocalDate;
  supersedesFollowUpId?: EntityId;
  supersededByFollowUpId?: EntityId;
};

export type FollowUpEvent = {
  id: EntityId;
  followUpId: EntityId;
  personId: EntityId;
  kind:
    | "created"
    | "snoozed"
    | "rescheduled"
    | "completed_with_contact"
    | "completed_without_contact"
    | "cancelled";
  occurredAt: IsoInstant;
  fromDate?: LocalDate;
  toDate?: LocalDate;
  replacementFollowUpId?: EntityId;
  interactionId?: EntityId;
};

export type TodaySkip = {
  id: string;
  personId: EntityId;
  localDate: LocalDate;
  createdAt: IsoInstant;
};

/** Append-only evidence that an exact stored starter was used for one Person. */
export type ConversationStarterUse = {
  id: EntityId;
  personId: EntityId;
  starterId: EntityId;
  starterTemplate: string;
  occurredAt: IsoInstant;
};

export type ReachOutIntentStatus = "active" | "completed" | "dormant";

export type ReachOutActionType = FollowUpActionType;

export type ReachOutEntry = MutableRecord & {
  personId: EntityId;
  reason?: string;
  intendedActionType?: ReachOutActionType;
  actionDetail?: string;
  notes?: string;
  intentStatus: ReachOutIntentStatus;
  currentFollowUpId?: EntityId;
  contextIds: EntityId[];
  addedAt: IsoInstant;
  lastCompletedAt?: IsoInstant;
  removedAt?: IsoInstant;
  lastCommandFingerprint?: string;
};

export type ReachOutEvent = {
  id: EntityId;
  reachOutEntryId: EntityId;
  kind:
    | "added"
    | "activated"
    | "completed"
    | "moved_to_dormant"
    | "removed"
    | "follow_up_linked";
  occurredAt: IsoInstant;
  followUpId?: EntityId;
  interactionId?: EntityId;
  commandFingerprint?: string;
};

export type ReachOutContext = MutableRecord & {
  kind: "project" | "organisation" | "event" | "fellowship" | "other";
  label: string;
  eventId?: EntityId;
  archivedAt?: IsoInstant;
};

export type MemoryFactKind =
  | "introduced_by"
  | "interest"
  | "seeking"
  | "family"
  | "communication_preference"
  | "location"
  | "other";

export type MemoryFact = MutableRecord & {
  personId: EntityId;
  kind: MemoryFactKind;
  value: string;
  showAsMemoryCue: boolean;
  relatedPersonId?: EntityId;
  sourceInteractionId?: EntityId;
  archivedAt?: IsoInstant;
};

export type RelationshipEvent = MutableRecord & {
  name: string;
  occurredOn?: LocalDate;
  location?: string;
};

export type AppSettings = MutableRecord & {
  id: "app";
  defaultPhoneRegion: string;
  captureMode: "standard" | "networking";
  alreadyContactedDefaultReminderDays: number;
  reachOutDefaultReminderDays?: 1 | 7 | 14 | 30;
  relationshipContexts?: Array<"personal" | "professional">;
  todaySummaryNotificationsEnabled: boolean;
  todaySummaryNotificationTime: string;
  conversationStarters: ConversationStarter[];
};

export type AppMetadata = {
  id: "app";
  datasetRevision: number;
  lastBackupGeneratedAt?: IsoInstant;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
};

export type PeopleOsData = {
  people: Person[];
  contactMethods: ContactMethod[];
  externalIdentities: ExternalIdentity[];
  affiliations: OrganisationAffiliation[];
  interactions: Interaction[];
  events: RelationshipEvent[];
  memoryFacts: MemoryFact[];
  followUps: FollowUp[];
  followUpEvents: FollowUpEvent[];
  conversationStarterUses: ConversationStarterUse[];
  todaySkips: TodaySkip[];
  reachOutEntries: ReachOutEntry[];
  reachOutEvents: ReachOutEvent[];
  reachOutContexts: ReachOutContext[];
  appSettings: AppSettings[];
};

export type BackupEnvelope = {
  product: "peopleos";
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: IsoInstant;
  data: PeopleOsData;
};

export type BackupCounts = { [K in keyof PeopleOsData]: number };

export type BackupPreview = {
  envelope: BackupEnvelope;
  counts: BackupCounts;
  migratedFromVersion?: number;
};

export const DATA_STORE_NAMES = [
  "people",
  "contactMethods",
  "externalIdentities",
  "affiliations",
  "interactions",
  "events",
  "memoryFacts",
  "followUps",
  "followUpEvents",
  "conversationStarterUses",
  "todaySkips",
  "reachOutEntries",
  "reachOutEvents",
  "reachOutContexts",
  "appSettings"
] as const satisfies ReadonlyArray<keyof PeopleOsData>;

export type DataStoreName = (typeof DATA_STORE_NAMES)[number];

export function emptyPeopleOsData(settings: AppSettings): PeopleOsData {
  return {
    people: [],
    contactMethods: [],
    externalIdentities: [],
    affiliations: [],
    interactions: [],
    events: [],
    memoryFacts: [],
    followUps: [],
    followUpEvents: [],
    conversationStarterUses: [],
    todaySkips: [],
    reachOutEntries: [],
    reachOutEvents: [],
    reachOutContexts: [],
    appSettings: [settings]
  };
}
