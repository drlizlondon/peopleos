# PeopleOS Data Model

## Modelling principles

- `Person.id` is the permanent internal identity. A phone number, email address, provider record, name, or organisation must never become the primary key.
- Store source facts and user intentions; derive last contact, timeline, relationship stage, memory cue, and Today recommendations.
- Keep repeatable or historical information outside `Person`.
- Use stable IDs, ISO 8601 timestamps, runtime validation, and explicit schema versions.
- External systems link to a Person; they do not own or replace the Person.
- Start with the smallest useful subset of each model while preserving these boundaries.

## Entity map

```text
Person (permanent root)
  ├─ ContactMethod[]        phone, email, WhatsApp address
  ├─ ExternalIdentity[]     Google Contact, LinkedIn, future providers
  ├─ OrganisationAffiliation[]
  ├─ MemoryFact[]
  ├─ Interaction[]
  ├─ FollowUp[]
  ├─ ReachOutEntry[]
  └─ Event participation through interactions

AppSettings (one global singleton; never a Person child)
```

Names and contact details may change. History remains attached to the same `Person.id`.

## Core persisted models

### Person

```ts
type Person = {
  id: string;
  displayName: string;
  identityStatus: "provisional" | "confirmed" | "merged";
  mergedIntoPersonId?: string;
  importance: "normal" | "high";
  tags: string[];
  contactCadenceDays?: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};
```

This is intentionally small. A confirmed Person requires a name. A provisional Person requires only a descriptive `displayName`, such as “Chief Information Officer at Watford” or “Hackathon organiser.” The label is not a second identity system: the provisional record receives a normal permanent `Person.id` and can later be completed or explicitly linked to an existing confirmed Person. `importance`, tags, and cadence describe the user's current relationship preference, not identity. Numerical importance scores are rejected because they imply precision the product does not have.

`mergedIntoPersonId` is set only by the explicit provisional-resolution flow. A merged provisional Person becomes read-only and excluded from active queries. All Reach Out entries and other selected child records are reassigned transactionally after a preview; automatic merging remains prohibited.

Do not put current phone, email, organisation, event, introducer, last-contact timestamp, relationship stage, or follow-up date on `Person`.

### ContactMethod

```ts
type ContactMethod =
  | {
      id: string;
      personId: string;
      kind: "phone";
      label?: string;
      rawValue: string;
      canonicalValue: string; // E.164 including +
      region?: string;
      isPreferred: boolean;
      createdAt: string;
      updatedAt: string;
      archivedAt?: string;
    }
  | {
      id: string;
      personId: string;
      kind: "email";
      label?: string;
      rawValue: string;
      canonicalValue: string; // trimmed, case-normalised for matching
      isPreferred: boolean;
      createdAt: string;
      updatedAt: string;
      archivedAt?: string;
    };
```

One model supports multiple phones and emails without making either an identity. The first implementation may expose one phone and one email, but storage and repositories must return arrays. WhatsApp capability is initially derived from a valid phone; it should not duplicate the number in a separate row.

### ExternalIdentity

```ts
type ExternalIdentity = {
  id: string;
  personId: string;
  provider: "google_contacts" | "linkedin" | string;
  externalId: string;
  profileUrl?: string;
  linkedAt: string;
  lastSyncedAt?: string;
  syncMetadata?: {
    etag?: string;
    resourceVersion?: string;
  };
};
```

`(provider, externalId)` must be unique. This record proves a link and stores only provider coordination data. Provider profile fields should be mapped into PeopleOS models through an explicit import/update proposal rather than read directly throughout the UI.

LinkedIn is only a planned identity link. No LinkedIn integration is approved.

### OrganisationAffiliation

```ts
type OrganisationAffiliation = {
  id: string;
  personId: string;
  organisationName: string;
  role?: string;
  startedOn?: string;
  endedOn?: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};
```

This preserves organisation history without requiring a full Organisation entity now. Introduce a normalised `Organisation` table only when cross-person organisation pages or reliable organisation deduplication justify it. Until then, normalised organisation text may be used for search and duplicate evidence.

### Interaction

```ts
type InteractionKind =
  | "met"
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

type Interaction = {
  id: string;
  personId: string;
  kind: InteractionKind;
  occurredAt: string;
  summary?: string;
  eventId?: string;
  relatedPersonId?: string;
  followUpId?: string;
  createdAt: string;
  updatedAt: string;
};
```

Interaction is the authoritative event history. Whether an interaction counts as relationship contact is a deterministic policy keyed by `kind`, not an editable `meaningful` boolean:

- Contact by default: met, WhatsApp message, email, phone call, coffee, meeting, conference, introduction received.
- Context but not contact by default: note added, follow-up completed.
- Introduction made does not count as direct contact; it records that the user connected this Person with someone else.

Changing that policy changes derived results and therefore requires a recorded decision and regression tests.

Person creation appears in the timeline from `Person.createdAt`; it does not create a duplicate Interaction. Opening WhatsApp or email creates nothing. Only explicit user confirmation records communication.

### FollowUp

```ts
type FollowUp = {
  id: string;
  personId: string;
  dueAt: string;
  reason: string;
  actionType:
    | "message"
    | "email"
    | "call"
    | "arrange_meeting"
    | "make_introduction"
    | "send_update"
    | "other";
  suggestedByRule?: string;
  reachOutEntryId?: string;
  status: "pending" | "completed" | "cancelled" | "superseded";
  completedAt?: string;
  snoozedUntil?: string;
  supersedesFollowUpId?: string;
  createdAt: string;
  updatedAt: string;
};
```

`FollowUp` is the single source of truth for a dated promise or plan. There is no `followUpAt` on Person. Rescheduling marks the old follow-up superseded and creates a traceable replacement. Completing it creates a `follow_up_completed` interaction referencing `followUpId`.

Recurring cadence remains a preference on Person. The Relationship Engine may suggest a date from cadence, but should not persist a FollowUp until the user accepts it.

`reachOutEntryId` is optional. When present it records that the existing FollowUp is the dated plan for a Reach Out intention. It does not change FollowUp state transitions, Today eligibility, or completion semantics.

### ReachOutEntry

```ts
type ReachOutIntentStatus = "active" | "completed" | "dormant";

type ReachOutActionType =
  | "message"
  | "email"
  | "call"
  | "arrange_meeting"
  | "make_introduction"
  | "send_update"
  | "research_contact_route"
  | "other";

type ReachOutEntry = {
  id: string;
  personId: string;
  reason?: string;
  intendedActionType?: ReachOutActionType;
  actionDetail?: string;
  notes?: string;
  intentStatus: ReachOutIntentStatus;
  currentFollowUpId?: string;
  contextIds: string[];
  addedAt: string;
  lastCompletedAt?: string;
  removedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

Reach Out is a first-class intention record, not a tag. It always references a Person, including a provisional Person. `reason` and intended action are strongly prompted but optional at quick-capture time because the accepted minimum is a Person or temporary label. Missing values render explicit “Add why” and “Choose next action” prompts.

Only one non-removed, non-completed ReachOutEntry may exist for a Person at a time; Dormant counts as that retained entry and can be reactivated. Completed entries remain searchable history. A later new outreach cycle may create a new entry after completion.

`intentStatus` stores only durable intention state. User-visible Reach Out state is derived:

- **Completed:** `intentStatus == "completed"`
- **Dormant:** `intentStatus == "dormant"`
- **Overdue:** active entry with linked pending FollowUp effective before today
- **Snoozed:** active entry whose linked pending FollowUp has a future snooze date
- **Waiting:** active entry with linked pending FollowUp due after today
- **Active:** active entry with no future/snoozed/overdue condition, including due today or no date yet

Waiting, Snoozed, and Overdue are never separately persisted. The linked FollowUp remains the only reminder source of truth. `lastCompletedAt` is a convenience fact backed by an append-only ReachOutEvent.

### ReachOutEvent

```ts
type ReachOutEvent = {
  id: string;
  reachOutEntryId: string;
  kind:
    | "added"
    | "activated"
    | "completed"
    | "moved_to_dormant"
    | "removed"
    | "follow_up_linked";
  occurredAt: string;
  followUpId?: string;
  interactionId?: string;
};
```

ReachOutEvent preserves completion and status history without pretending outreach completion is necessarily contact. Completion may optionally link an Interaction. If the user schedules another FollowUp during completion, the same ReachOutEntry returns to active intention state, keeps `lastCompletedAt`, links the new FollowUp, and remains in the active queue. Otherwise it becomes Completed.

### ReachOutContext

```ts
type ReachOutContext = {
  id: string;
  kind: "project" | "organisation" | "event" | "fellowship" | "other";
  label: string;
  eventId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};
```

ReachOutContext is a lightweight reusable label for filtering and grouping Reach Out entries. It is not a CRM account, project-management system, or generic tagging framework. An Event context may link an existing Event; organisation, fellowship, and project context do not create new domain subsystems in V1. The Fellowship acceptance examples use one `fellowship` context and are never seeded as production data.

### MemoryFact

```ts
type MemoryFactKind =
  | "introduced_by"
  | "interest"
  | "seeking"
  | "family"
  | "communication_preference"
  | "location"
  | "other";

type MemoryFact = {
  id: string;
  personId: string;
  kind: MemoryFactKind;
  value: string;
  showAsMemoryCue: boolean;
  relatedPersonId?: string;
  sourceInteractionId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};
```

Structured facts and free-form notes coexist:

- Use a MemoryFact for a durable, searchable statement such as “Based in Bristol,” “Prefers email,” or “Looking for pilot sites.”
- Use an Interaction with `kind: "note_added"` and `summary` for dated narrative, meeting notes, nuance, or uncertain information.
- A note may optionally promote one or more facts, but never automatically. The user confirms the fact kind and value.
- `introduced_by` should use `relatedPersonId` when James is already a Person; the display name can be retained in `value` for readability/export.
- `showAsMemoryCue` defaults on for introduced by, interest, seeking, communication preference, and location; it defaults off for family and other. The user may change it.

Do not build an open-ended entity-attribute-value database. Fact kinds are a small controlled vocabulary; `other` preserves flexibility. Sensitive personal facts require normal edit/delete controls and must not be inferred.

### Event

```ts
type Event = {
  id: string;
  name: string;
  occurredOn?: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
};
```

Participation is derived from interactions carrying `eventId`, especially `met`, `conference`, or `meeting`. Do not duplicate `eventId` on Person. Free-form “where met” can begin as a `met` interaction summary and later link to an Event.

### AppSettings

```ts
type AppSettings = {
  id: "app";
  defaultPhoneRegion: string;
  captureMode: "standard" | "networking";
  reachOutDefaultReminderDays?: 1 | 7 | 14 | 30;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
```

This singleton contains only editable global application preferences. Defaults are the supported device region or `GB`, Standard capture mode, and no Reach Out reminder. Absence of `reachOutDefaultReminderDays` means No reminder. A selected value pre-fills only a new Reach Out draft and never mutates an existing ReachOutEntry or FollowUp.

Device timezone, device locale, notification availability, application version, and schema version are runtime facts and must not be duplicated here. `lastBackupGeneratedAt` is backup metadata, not a preference. The singleton is versioned, validated, included in backup/restore, and protected by the same revision/idempotency contract as other mutable records.

Do not store Person cadence, importance, communication preference, Reach Out state, or configurable engine weights in AppSettings. Deterministic relationship rules are versioned in code and shared by all users. `SETTINGS_SPEC.md` owns the complete visible behavior.

## Derived relationship state

The Relationship Engine derives:

- last contact from the latest contact-counting Interaction
- relationship age from the earliest `met` or contact-counting Interaction, falling back to `Person.createdAt` with reduced confidence
- timeline from Person creation plus Interactions and explicit FollowUp state changes
- relationship stage from contact interactions, relationship age, and recency
- event groups from shared Event-linked interactions
- memory cue from pending commitments, MemoryFacts, and recent context interactions
- Today eligibility and explanation from pending FollowUps, cadence, interaction history, and rules
- Reach Out display state from the durable intention state and linked FollowUp

Derived values are not persisted in the authoritative schema. A disposable cache may be introduced only after profiling proves it necessary; cache entries must include the engine version and be safe to rebuild.

## Duplicate candidate evidence

Duplicate candidates are calculated on capture, import, and provider linking. Each result returns evidence rather than an opaque score:

```ts
type DuplicateEvidence =
  | { code: "same_phone"; contactMethodIds: [string, string] }
  | { code: "same_email"; contactMethodIds: [string, string] }
  | { code: "same_external_identity"; externalIdentityIds: [string, string] }
  | { code: "similar_name_same_organisation"; affiliationIds: [string, string] }
  | { code: "similar_name_same_event"; eventId: string };
```

Rules:

1. Same Google Contact link, exact canonical phone, or exact canonical email is a strong warning.
2. Similar normalised names plus the same current organisation is a review suggestion.
3. Similar normalised names plus the same event is a review suggestion.
4. Similar name alone is insufficient.
5. Multiple weak signals may raise prominence, but never trigger an automatic merge.

The UI must say which facts matched and allow: open existing Person, continue creating, or enter a separate explicit merge flow designed later.

## Import and migration

PeopleOS uses its own database name and export schema. Imports must validate referential integrity: every child references an existing Person, every linked Reach Out FollowUp references the same Person as its ReachOutEntry, ReachOut contexts exist, and provider identities are unique.

A later Real Friends or Google Contacts import is explicit, previewable, and non-destructive. Import creates or links PeopleOS entities through application services; it never makes external provider data the live primary model.
