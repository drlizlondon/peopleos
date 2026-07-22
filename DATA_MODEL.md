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
TodayNotificationState (one device-local delivery singleton; never relationship state)
```

Names and contact details may change. History remains attached to the same `Person.id`.

## Core persisted models

Every mutable record carries `revision`, starting at `1`. Updates require the expected revision, increment it exactly once, preserve `createdAt`, and replace `updatedAt` with a UTC ISO instant. Append-only lifecycle records do not carry a revision because they are never edited.

### Person

```ts
type Person = {
  id: string;
  revision: number;
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
      revision: number;
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
      revision: number;
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
  revision: number;
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

V1 defines this provider-neutral type boundary but does not create an ExternalIdentity object store, provider adapter, OAuth flow, or backup collection. Those become persistent only when an approved integration needs them.

### OrganisationAffiliation

```ts
type OrganisationAffiliation = {
  id: string;
  revision: number;
  personId: string;
  organisationName: string;
  role?: string;
  startedOn?: string;
  endedOn?: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};
```

This preserves organisation history without requiring a full Organisation entity now. Introduce a normalised `Organisation` table only when cross-person organisation pages or reliable organisation deduplication justify it. Until then, normalised organisation text may be used for search and duplicate evidence.

### Interaction

```ts
type InteractionKind =
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

type Interaction = {
  id: string;
  revision: number;
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

- Contact by default: met, contacted, WhatsApp message, email, phone call, coffee, meeting, conference, introduction received.
- Context but not contact by default: note added, follow-up completed.
- Introduction made does not count as direct contact; it records that the user connected this Person with someone else.

`contacted` is the generic contact-counting kind created by the explicit Today action **Already contacted**. It records that contact occurred without inventing whether it was WhatsApp, phone, email, in person, Teams, Zoom, text, or another channel. It uses the action time as `occurredAt`, may link the primary completed FollowUp, and needs no summary. Detailed manual logging continues to use a specific kind when the user chooses to provide it.

Changing that policy changes derived results and therefore requires a recorded decision and regression tests.

Person creation appears in the timeline from `Person.createdAt`; it does not create a duplicate Interaction. Opening a phone dialler, email client, or future WhatsApp handoff creates nothing. Only an explicit PeopleOS action records communication; **Already contacted** is such an action, while **Contact now** is not.

### FollowUp

```ts
type RelationshipActionType =
  | "message"
  | "email"
  | "call"
  | "arrange_meeting"
  | "make_introduction"
  | "send_update"
  | "research_contact_route"
  | "other";

type FollowUp = {
  id: string;
  revision: number;
  personId: string;
  dueDate: string; // YYYY-MM-DD local calendar date
  reason: string;
  actionType: RelationshipActionType;
  suggestedByRule?: string;
  reachOutEntryId?: string;
  status: "pending" | "completed" | "cancelled" | "superseded";
  completedAt?: string;
  snoozedUntilDate?: string; // YYYY-MM-DD local calendar date
  supersedesFollowUpId?: string;
  supersededByFollowUpId?: string;
  createdAt: string;
  updatedAt: string;
};
```

`FollowUp` is the single source of truth for a dated promise or plan. There is no `followUpAt` on Person. Rescheduling marks the old follow-up superseded, creates a replacement, and links both directions in one transaction. Completion with contact creates one contact Interaction linked to the FollowUp and no duplicate `follow_up_completed` Interaction. Completion without contact creates one `follow_up_completed` Interaction. Both cases append one matching FollowUpEvent.

`RelationshipActionType` is shared with Reach Out so “Research contact route” and every other intended action survive linking, replacement, and Already-contacted relinking without a lossy `other` mapping.

Recurring cadence remains a preference on Person. The Relationship Engine may suggest a date from cadence, but should not persist a FollowUp until the user accepts it.

`reachOutEntryId` is optional. When present it records that the existing FollowUp is the dated plan for a Reach Out intention. It does not change FollowUp state transitions, Today eligibility, or completion semantics. A pending linked FollowUp must be the single current plan for that ReachOutEntry and must be referenced reciprocally by `ReachOutEntry.currentFollowUpId`. Historical completed, cancelled, or superseded FollowUps may retain `reachOutEntryId`, but are never current.

### FollowUpEvent

```ts
type FollowUpEvent = {
  id: string;
  followUpId: string;
  personId: string;
  kind:
    | "created"
    | "snoozed"
    | "rescheduled"
    | "completed_with_contact"
    | "completed_without_contact"
    | "cancelled";
  occurredAt: string;
  fromDate?: string;
  toDate?: string;
  replacementFollowUpId?: string;
  interactionId?: string;
};
```

FollowUpEvent is append-only. It preserves repeated transitions while FollowUp remains the efficient current snapshot. Timeline coalesces a lifecycle event and its linked completion Interaction into one visible item.

### TodaySkip

```ts
type TodaySkip = {
  id: string; // `${personId}:${localDate}`
  personId: string;
  localDate: string; // YYYY-MM-DD in the user's local day
  createdAt: string;
};
```

The composite identity makes retry idempotent and enforces one suppression per Person per local day. Expired records are ignored and may be pruned opportunistically. Refined Today actions do not expose a partial Undo that deletes only this record: any future reversal must undo the complete compound command so its FollowUp and history remain consistent.

### Today action transaction contracts

**Not today** is a Person-level one-day deferral, not a synonym for the old skip-only behavior:

- If the Today assessment has a primary pending explicit FollowUp, the command snoozes that FollowUp to tomorrow's local calendar date and appends one `snoozed` FollowUpEvent preserving its prior effective date.
- If the primary reason is New or cadence and has no explicit FollowUp, the command creates exactly one pending FollowUp for tomorrow with reason “Reconnect with {display name},” action `other`, and `suggestedByRule: "today_not_today"`.
- In both cases it creates the current-day TodaySkip so another due reason cannot return the Person to Today that day. Other pending FollowUps remain unchanged.
- The snooze/create, lifecycle event, TodaySkip, and dataset revision are one transaction. Stable prepared IDs plus a command identity make an exact retry idempotent; a stale/conflicting retry fails without partial state.

**Already contacted** is one atomic acknowledgement-and-next-plan command:

- Create exactly one `contacted` Interaction at the action time.
- Complete the primary pending FollowUp when one exists and append the matching `completed_with_contact` FollowUpEvent linked to that Interaction. Other pending FollowUps remain unchanged.
- Create exactly one next pending FollowUp for the selected future local date. When a primary FollowUp exists, copy its reason, action type, and optional Reach Out link. Otherwise use reason “Reconnect with {display name},” action `other`, and `suggestedByRule: "today_already_contacted"`.
- Create the current-day TodaySkip so no independent due reason returns the card that day.
- When the completed primary FollowUp belongs to Reach Out, append the existing completion and follow-up-link history, retain the same ReachOutEntry in active intention state, set `lastCompletedAt`, and relink `currentFollowUpId` to the new FollowUp. No second ReachOutEntry or reminder model is created.
- The Interaction, primary completion, lifecycle events, next FollowUp, TodaySkip, Reach Out updates/events when applicable, and one dataset-revision increment commit or roll back together. Prepared stable IDs and one command identity make retries idempotent and prevent two next FollowUps.

The Already-contacted interval sheet writes nothing until a date is selected. Dismissing it leaves the card and every record unchanged.

### ReachOutEntry

```ts
type ReachOutIntentStatus = "active" | "completed" | "dormant";

type ReachOutActionType = RelationshipActionType;

type ReachOutEntry = {
  id: string;
  revision: number;
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

`currentFollowUpId` is an optional reciprocal pointer, not another reminder. When present it must identify the only pending FollowUp whose `personId` matches the entry and whose `reachOutEntryId` equals this entry's ID. Creating or replacing that plan sets both sides in one transaction. Completing, cancelling, or superseding it without a replacement clears `currentFollowUpId` in the same transaction; replacing it moves the pointer to the replacement. Historical FollowUps and ReachOutEvents retain the audit trail. No ReachOutEntry may have two pending FollowUps linked as its current plan.

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
  revision: number;
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
  revision: number;
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
  revision: number;
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
  alreadyContactedDefaultReminderDays: number;
  reachOutDefaultReminderDays?: 1 | 7 | 14 | 30;
  todaySummaryNotificationsEnabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
```

This singleton contains only editable global application preferences. Defaults are the supported device region or `GB`, Standard capture mode, 14 days for Already contacted, no Reach Out reminder, and Today summary notifications Off. `alreadyContactedDefaultReminderDays` is an integer from 1 to 3,650; 2, 7, 14, and 30 are presented as presets. Absence of `reachOutDefaultReminderDays` means No reminder. A selected value pre-fills only its future decision surface and never mutates an existing ReachOutEntry or FollowUp.

`todaySummaryNotificationsEnabled` stores explicit user intent only. Notification permission, runtime capability, scheduled delivery, device timezone, device locale, application version, and schema version are runtime or device-coordination facts and must not be duplicated here. Restoring `true` never requests permission. `lastBackupGeneratedAt` is backup metadata, not a preference. The singleton is versioned, validated, included in backup/restore, and protected by the same revision/idempotency contract as other mutable records.

Settings evolve through two package-owned forward migrations rather than pulling notification storage into Today early. V1-10 adds `alreadyContactedDefaultReminderDays: 14` to older AppSettings records and preserves every existing field. V1-14 later adds `todaySummaryNotificationsEnabled: false`; backups produced before V1-14 migrate through that same default. The final V1 type above applies after both migrations, and each migration follows the repository revision/idempotency contract.

Do not store Person cadence, importance, communication preference, Reach Out state, or configurable engine weights in AppSettings. Deterministic relationship rules are versioned in code and shared by all users. `SETTINGS_SPEC.md` owns the complete visible behavior.

### TodayNotificationState

```ts
type TodayNotificationState = {
  id: "today-summary";
  revision: number;
  nextEvaluationAt?: string; // UTC ISO instant
  lastDeliveredLocalDate?: string; // YYYY-MM-DD
  dismissedThroughLocalDate?: string; // YYYY-MM-DD
  snoozedUntil?: string; // UTC ISO instant, same local day only
  activeDeliveryId?: string;
  createdAt: string;
  updatedAt: string;
};
```

This singleton coordinates delivery only. It never stores Person IDs, FollowUp IDs, Reach Out IDs, copied Today items, eligibility, explanations, names, or counts. The notification application service re-runs the authoritative Today query before every proposed delivery. `activeDeliveryId` makes repeated actions idempotent and lets stale actions be ignored. The fixed policy is 09:00 in the current device timezone and a two-hour same-day Snooze; these are not settings.

Notification **Open**, **Not today**, and **Snooze** may update only this singleton and the platform schedule. Notification Not today sets delivery suppression through the current local date and schedules tomorrow's evaluation; notification Snooze sets an evaluation two hours later only if it remains on the same local date. When it would cross midnight, no same-day re-notification is stored and the ordinary next-day evaluation remains. Neither action may mutate AppSettings or any Person, Interaction, FollowUp, FollowUpEvent, TodaySkip, ReachOutEntry, ReachOutEvent, or Relationship Engine input.

TodayNotificationState is device-local coordination data. Its updates do not increment the relationship dataset revision. It is excluded from backup/export and restore and is discarded when notification intent is turned Off. A failed or cancelled data restore leaves this state and the platform schedule unchanged. After a successful restore transaction, every pre-restore delivery ID becomes stale, the coordinator clears this singleton, cancels/replaces the old platform occurrence, and rebuilds from restored intent plus current capability/permission. Operating-system permission remains a runtime fact rather than a stored field.

### AppMetadata

```ts
type AppMetadata = {
  id: "app";
  datasetRevision: number;
  lastBackupGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

Metadata is device-local coordination state rather than a user preference. Every successful mutation increments `datasetRevision`; atomic restore increments it once so open views can rehydrate. `lastBackupGeneratedAt` changes only after a valid backup string has been produced. AppMetadata is not restored from another device.

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

PeopleOS uses its own database name and export schema. Imports must validate referential integrity: every child references an existing Person; every `ReachOutEntry.currentFollowUpId` points to the sole pending FollowUp that reciprocally names that entry and the same Person; no other pending FollowUp names that ReachOutEntry; historical linked FollowUps may remain non-pending; ReachOut contexts exist; and provider identities are unique.

A later Real Friends or Google Contacts import is explicit, previewable, and non-destructive. Import creates or links PeopleOS entities through application services; it never makes external provider data the live primary model.

The V1 backup envelope is `{ product: "peopleos", schemaVersion, exportedAt, data }`. `data` contains every V1 domain store and the AppSettings singleton, but excludes device-local TodayNotificationState. Restore parses and migrates supported older PeopleOS schemas, validates the complete graph, previews counts, and only then replaces all data stores in one transaction. Restore never requests notification permission; notification delivery state is reconciled separately against current runtime capability. Unsupported future versions, invalid references, cancellation, or any transaction failure leave the current database unchanged.
