export const DATABASE_NAME = "peopleos-v1";
export const DATABASE_VERSION = 2;
export const BACKUP_SCHEMA_VERSION = 3;
export const DEFAULT_ALREADY_CONTACTED_REMINDER_DAYS = 14;

export type EntityId = string;
export type IsoInstant = string;
export type LocalDate = string;

export type MutableRecord = {
  id: EntityId;
  revision: number;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
};

export type Person = MutableRecord & {
  displayName: string;
  relationshipMode?: "personal" | "professional" | "both";
  identityStatus: "provisional" | "confirmed" | "merged";
  mergedIntoPersonId?: EntityId;
  mergeCommandFingerprint?: string;
  identityCompletionFingerprint?: string;
  importance: "normal" | "high";
  tags: string[];
  contactCadenceDays?: number;
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
  affiliations: OrganisationAffiliation[];
  interactions: Interaction[];
  events: RelationshipEvent[];
  memoryFacts: MemoryFact[];
  followUps: FollowUp[];
  followUpEvents: FollowUpEvent[];
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
  "affiliations",
  "interactions",
  "events",
  "memoryFacts",
  "followUps",
  "followUpEvents",
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
    affiliations: [],
    interactions: [],
    events: [],
    memoryFacts: [],
    followUps: [],
    followUpEvents: [],
    todaySkips: [],
    reachOutEntries: [],
    reachOutEvents: [],
    reachOutContexts: [],
    appSettings: [settings]
  };
}
