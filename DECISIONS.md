# PeopleOS Decisions

This log records product and architecture decisions. Later changes should append a new decision rather than silently rewriting the original rationale.

## POS-D001 — Separate product, not Real Friends v2

- **Status:** Accepted
- **Date:** 2026-07-21

PeopleOS and Real Friends are independent products. PeopleOS may reuse code, but it does not inherit Real Friends' product constitution, feature boundaries, roadmap, identity, or obligation of parity. The Real Friends repository remains untouched.

## POS-D002 — Planning before implementation

- **Status:** Accepted
- **Date:** 2026-07-21

The inherited architecture is reviewed and the six governing documents are created before copying or modifying application code in PeopleOS. The first code change must be an approved roadmap package.

## POS-D003 — Deterministic, explainable intelligence

- **Status:** Accepted
- **Date:** 2026-07-21

PeopleOS will not use LLMs for priority, stage, grouping, memory cues, drafting, or duplicate detection. Rules operate on stored facts and produce structured explanations. Any future proposal to use AI requires a new decision and must not replace a reliable deterministic flow.

## POS-D004 — Local-first web baseline

- **Status:** Accepted for initial packages
- **Date:** 2026-07-21

Retain the inherited React/TypeScript/Vite PWA and IndexedDB baseline initially. Add versioned repositories and validation before growing the schema. Accounts, backend sync, and native shells are deferred decisions, not assumed requirements.

## POS-D005 — Interaction history is the source of relationship facts

- **Status:** Accepted
- **Date:** 2026-07-21

Meaningful interactions are stored as appendable records. Last meaningful interaction, timeline, and relationship stage are derived. This avoids stale timestamps and supports explainable history.

## POS-D006 — Explicit follow-up and recurring cadence are distinct

- **Status:** Accepted
- **Date:** 2026-07-21

An explicit follow-up represents a concrete promise or plan. Cadence represents a recurring preference. An explicit due follow-up outranks cadence in Today. Importance is a tie-breaker, not a reason by itself.

## POS-D007 — Canonical phone numbers use E.164

- **Status:** Accepted
- **Date:** 2026-07-21

PeopleOS accepts natural phone input, parses it with a libphonenumber implementation and a default region, stores canonical E.164 including the leading `+`, and formats a familiar national display. Hand-written prefix rules are not sufficient.

## POS-D008 — External actions require confirmation

- **Status:** Accepted
- **Date:** 2026-07-21

WhatsApp links may prefill editable text, but PeopleOS never sends. Contact export may produce a vCard or later invoke a native confirmation flow, but PeopleOS never silently writes contacts. Opening an external app is not evidence that contact occurred.

This does not require a confirmation prompt when the user returns from a phone, email, or future WhatsApp handoff. The Today card stays available and no record changes until the user explicitly chooses a PeopleOS action. **Already contacted** is that explicit acknowledgement when the user wants a one-tap generic record without logging channel detail.

## POS-D009 — Duplicate handling warns; it does not overwrite

- **Status:** Accepted
- **Date:** 2026-07-21

Duplicate detection presents matched evidence and user choices. There is no automatic overwrite or merge. Exact canonical phone is the strongest initial signal; fuzzy signals are clearly labelled as suggestions.

## POS-D010 — Real Friends data is not silently shared

- **Status:** Accepted
- **Date:** 2026-07-21

PeopleOS uses its own application identity, IndexedDB name, PWA manifest, export schema, and storage keys. Any later Real Friends import is an explicit user-controlled migration, never a shared live database.

## POS-D011 — Relationship stage thresholds remain unresolved

- **Status:** Superseded by POS-D023
- **Date:** 2026-07-21

The labels `New`, `Growing`, `Established`, and `Long-term` are agreed, but their thresholds are not. Before implementation, POS-5 must specify examples and exact boundaries using interaction count, relationship span, and recency. Until then the stage must not be guessed or manually stored.

## POS-D012 — Reminder source of truth remains to be resolved in POS-3

- **Status:** Superseded by POS-D015
- **Date:** 2026-07-21

The minimal model currently shows both a convenient current follow-up on `Person` and a historical `Reminder` record. POS-3 must choose one authoritative representation and document migration/query implications before code is written. Both must not become writable sources of truth.

## POS-D013 — Person is the permanent internal identity

- **Status:** Accepted
- **Date:** 2026-07-21

`Person.id` is the stable aggregate root. Phone numbers, emails, names, external-provider IDs, and organisations are mutable records that reference Person. Matching contact data may suggest a duplicate but never determines identity or silently changes ownership.

## POS-D014 — Contact methods and provider links are separate

- **Status:** Accepted
- **Date:** 2026-07-21

Phone and email use a one-to-many ContactMethod model. External provider records use ExternalIdentity with a unique `(provider, externalId)` link. WhatsApp capability is initially derived from a valid phone rather than duplicated as another identity. Google Contacts and LinkedIn remain future adapters.

## POS-D015 — FollowUp is the single source of dated intentions

- **Status:** Accepted
- **Date:** 2026-07-21

Remove follow-up date and reason from Person. A FollowUp record owns each explicit dated promise or plan. Recurring cadence remains a Person preference and produces only a suggestion until the user accepts a FollowUp. Completion is also represented in Interaction history.

## POS-D016 — One pure Relationship Engine owns relationship projections

- **Status:** Accepted
- **Date:** 2026-07-21

Today eligibility, explanations, suggested action/date, relationship stage, memory cue, last contact, and relationship age come from a pure versioned Relationship Engine. React and application screens do not calculate these rules. The engine uses ordered eligibility bands rather than an opaque weighted score.

## POS-D017 — Structured facts coexist with free-form notes

- **Status:** Accepted
- **Date:** 2026-07-21

Durable searchable information uses a small controlled MemoryFact vocabulary. Narrative and dated context remain `note_added` interactions. Promotion from note to fact is explicit, never AI-inferred. A generic entity-attribute-value system and automatic fact extraction are rejected.

## POS-D018 — Organisation remains lightweight initially

- **Status:** Accepted
- **Date:** 2026-07-21

Use OrganisationAffiliation with organisation text and dates so history is possible. Do not introduce a first-class Organisation entity until cross-person organisation pages or reliable organisation deduplication provide a demonstrated benefit.

## POS-D019 — Google Contacts is a provider adapter, not a data owner

- **Status:** Accepted for architecture; implementation deferred
- **Date:** 2026-07-21

Future selected import, link, and create workflows go through a ContactProvider port. Provider DTOs are mapped at the boundary, and ExternalIdentity records linkage. Google data never silently overwrites or deletes a Person.

## POS-D020 — Introduction contact semantics remain unresolved

- **Status:** Superseded by POS-D024
- **Date:** 2026-07-21

An introduction may mean the user directly communicated with the Person or merely introduced two other people. Before POS-3, define when it counts toward last contact and relationship stage, or split it into more precise interaction kinds.

## POS-D021 — Sensitive facts in memory cues remain unresolved

- **Status:** Superseded by POS-D025
- **Date:** 2026-07-21

Structured personal facts improve recall but can be intrusive when surfaced automatically. Before POS-5, decide whether facts need an explicit `useAsCue` control and which fact kinds should never be selected by default.

## POS-D022 — Google authentication and sync policy are deferred

- **Status:** Proposed; blocks Google Contacts implementation
- **Date:** 2026-07-21

OAuth scopes, token storage, sync direction, conflict handling, unlink behavior, and background refresh require a separate security and product decision. The current architecture supports future integration but does not approve it.

## POS-D023 — Version 1 relationship stage thresholds

- **Status:** Accepted
- **Date:** 2026-07-21

V1 derives stage from contact-counting interactions and the span between the earliest and latest contact. New covers fewer than 2 contacts or less than 30 days; Growing requires at least 2 contacts across 30 days; Established requires at least 5 across 180 days; Long-term requires at least 5 across 730 days. Current inactivity does not demote a stage. Exact evaluation order and boundary behavior are governed by `RELATIONSHIP_ENGINE_SPEC.md`.

## POS-D024 — Split introduction interaction semantics

- **Status:** Accepted
- **Date:** 2026-07-21

V1 uses Introduction received when the user and Person were introduced to one another; it counts as direct contact. Introduction made means the user connected that Person with someone else; it does not count as direct contact. This removes ambiguous editable contact semantics.

## POS-D025 — Explicit memory-cue eligibility

- **Status:** Accepted
- **Date:** 2026-07-21

Each Memory Fact has a user-controlled Show as memory cue choice. It defaults on for Introduced by, Interest, Seeking, Communication preference, and Location; it defaults off for Family and Other. Free-form Notes never become compact Today cues in V1.

## POS-D026 — Version 1 contact import is local vCard only

- **Status:** Accepted
- **Date:** 2026-07-21

V1 may import a user-selected vCard file with local parsing, preview, validation, and duplicate review. It does not request contact-book access and does not create Google provider links. Direct Google Contacts workflows remain blocked by POS-D022.

## POS-D027 — Reach Out is a first-class intention queue

- **Status:** Accepted
- **Date:** 2026-07-22

Reach Out is a primary navigation destination and a first-class domain concept for people the user intentionally wants to contact, reconnect with, or build a relationship with. It is not a tag, People filter, contact list, pipeline, lead stage, or CRM opportunity.

## POS-D028 — Reach Out reuses Person, FollowUp, and Interaction

- **Status:** Accepted
- **Date:** 2026-07-22

Every ReachOutEntry references a permanent `Person.id`. Reminder dates are represented only by linked FollowUps and appear in Today through the existing explicit-FollowUp rules. Actual contact remains an Interaction. Reach Out never creates parallel Person, reminder, or interaction systems.

A current Reach Out reminder uses reciprocal pointers: `ReachOutEntry.currentFollowUpId` names its sole pending FollowUp, and that FollowUp names the same ReachOutEntry and Person. Completion/cancellation without replacement clears the current pointer; replacement moves it atomically. Historical links remain history.

## POS-D029 — Incomplete identities are provisional People

- **Status:** Accepted
- **Date:** 2026-07-22

A descriptive identity such as “Hackathon organiser” creates a normal Person with provisional identity status and the description as display label. Completing the identity edits the same Person. A narrow explicit resolution flow may link a provisional Person to an existing confirmed Person after preview; no automatic or general-purpose merge is introduced.

## POS-D030 — Reach Out stores intention state; reminder state is derived

- **Status:** Accepted
- **Date:** 2026-07-22

Reach Out durably stores Active, Completed, or Dormant intention state. Waiting, Snoozed, and Overdue are derived from the linked FollowUp. Due and Upcoming are filter predicates. This preserves one reminder source of truth.

## POS-D031 — Reach Out context remains lightweight

- **Status:** Accepted
- **Date:** 2026-07-22

V1 supports reusable ReachOutContext labels for project, organisation, Event, fellowship, and other context. They exist only for grouping, recognition, and filtering. They do not create project management, organisation accounts, fellowship management, pipeline stages, or analytics.

## POS-D032 — V1 Settings has only three editable global preferences

- **Status:** Superseded by POS-D036
- **Date:** 2026-07-22

Settings stores Default phone region, Capture mode, and Default Reach Out reminder. Today policy, Interaction confirmation, notification availability, privacy posture, and version information are fixed behavior or runtime facts displayed for transparency. Person cadence, importance, tags, communication preference, Reach Out plans, and FollowUps stay with the Person/domain record they describe.

This is the smallest set that removes repeated global friction without making behavior unpredictable. A generic settings registry, remote configuration layer, and engine customization are rejected.

## POS-D033 — Notifications is an informational V1 section, not a delivery feature

- **Status:** Superseded by POS-D038 and POS-D039
- **Date:** 2026-07-22

Settings states that notifications are Off and unavailable in Version 1. It does not show a disabled toggle or request platform permission. Due work appears when the user opens PeopleOS and Today evaluates. Notification delivery remains excluded until capability, permissions, scheduling, timezone, retry, and privacy receive a separate product decision.

## POS-D034 — Manual Person capture is one aggregate transaction

- **Status:** Accepted
- **Date:** 2026-07-22

V1-03 prepares stable IDs for the Person and possible child records when a capture draft begins. Saving validates and normalises the entire draft, then atomically writes the Person, contact methods, optional first affiliation, optional `met` Interaction, and one dataset-revision update. Replaying the same prepared command is idempotent; an ID collision with different content is a conflict and rolls back the complete write.

The strongest alternative was composing the generic single-record repository actions. That would expose intermediate state and could leave a Person without the child records the user submitted, so it is rejected for aggregate capture. This dedicated command does not create a parallel persistence layer; ordinary record mutations continue to use the established application and repository boundaries.

## POS-D035 — V1 phone parsing uses the minimal libphonenumber entry point

- **Status:** Accepted
- **Date:** 2026-07-22

V1-03 uses `libphonenumber-js/min` at the integration boundary. It stores trimmed user input as `rawValue`, the validated E.164 number as `canonicalValue`, and the parsed region when known; display formatting remains derived. The global default phone region assists ambiguous local input, and a phone row can explicitly override that parsing region without requiring the user to know a calling code. Neither choice becomes Person identity or silently rewrites existing contact methods.

The larger metadata bundles and hand-written national-prefix rules were considered unnecessary for V1. Duplicate-warning UI, phone-based merging, and communication launch actions remain outside V1-03.

## POS-D036 — Settings adds only the global defaults required by the refined Today loop

- **Status:** Accepted
- **Date:** 2026-07-22

AppSettings adds `alreadyContactedDefaultReminderDays`, default 14 and validated as an integer from 1 to 3,650, plus `todaySummaryNotificationsEnabled`, default Off. The Today sheet presents 2, 7, 14, and 30-day presets and a custom interval. Notification delivery remains subject to runtime capability and permission. Permission is requested only after the user explicitly enables the setting on a supported runtime.

These settings change only future Today decision defaults or delivery. They never change Relationship Engine rules or rewrite Person, Interaction, FollowUp, TodaySkip, or Reach Out data. Notification delivery time remains fixed at 09:00 local and same-day Snooze remains fixed at two hours, so neither becomes another preference.

The strongest alternative was to retain three settings and infer or hard-code notification consent. That would either leave the requested default unavailable or request a privacy-sensitive permission without an explicit user choice. This decision would be wrong if notification opt-in were owned by an approved system-level onboarding flow, which V1 does not have.

## POS-D037 — Today actions use explicit atomic relationship commands

- **Status:** Accepted
- **Date:** 2026-07-22

Every Today card exposes Contact now, Not today, and Already contacted. Contact now is a provider handoff only and writes nothing. Not today snoozes the primary explicit FollowUp to tomorrow or creates one tomorrow FollowUp for a New/cadence reason, then writes today's Person-scoped TodaySkip so another reason cannot immediately re-display the card. Other FollowUps remain unchanged.

Already contacted records one generic contact-counting `contacted` Interaction, completes the primary FollowUp when present, creates exactly one next FollowUp for the selected date, writes today's TodaySkip, and completes/relinks the same ReachOutEntry when the primary plan belongs to Reach Out. All records and history commit atomically with stable IDs and an idempotent command identity. Dismissing the interval sheet writes nothing.

`buildToday` supplies the stable Person ID, eligibility and due state, relevant ordering date, primary and additional due FollowUp IDs, explanation, and intended-action context. The commands never rediscover “primary” in UI code. If additional plans remain due, the interval sheet discloses that they may bring the Person back sooner.

Contact now resolves executable targets rather than counting ContactMethod rows. V1-10 resolves phone-call and email targets; V1-13 may derive both Call and WhatsApp from one phone without creating another ContactMethod. The target count determines direct launch versus the labelled chooser.

The strongest alternative was to treat Not today as the existing TodaySkip alone and Already contacted as a plain reschedule. Skip alone would not establish tomorrow as the next explicit plan, while rescheduling would leave a fulfilled plan looking unfinished and would not record real contact. This decision would be wrong if product intent were only temporary visual dismissal with no reminder/history change; the accepted wording instead requires accurate reminders and preserved history.

## POS-D038 — Today summary notifications are downstream delivery, never reminder state

- **Status:** Accepted
- **Date:** 2026-07-22

A pure delivery policy consumes the current authoritative `buildToday` result. It sends no notification when Today is empty and one privacy-safe summary when one or more actionable People exist. The summary contains no names or count. A device-local TodayNotificationState coordinates evaluation, suppression, Snooze, and idempotent delivery actions without storing copied Today items or relationship identifiers; it is excluded from backup/restore.

Notification Open deep-links to Today. Notification Not today dismisses only that day's summary and schedules tomorrow's evaluation. Notification Snooze schedules one evaluation two hours later only when that instant remains on the same local day; otherwise no same-day re-notification is created and the ordinary next-day evaluation remains. V1 sends no late catch-up when notification intent is enabled or Today first becomes non-empty after 09:00. These actions may mutate only notification-delivery state and must never create or change a Person, Interaction, FollowUp, FollowUpEvent, TodaySkip, ReachOutEntry, ReachOutEvent, or Relationship Engine input.

The strongest alternative was to persist a notification queue beside Today. That would duplicate eligibility and become a competing reminder system as relationship data changed. This decision would be wrong only if a future remote delivery service could not evaluate or receive a fresh authoritative Today projection; such a service requires a new privacy/sync architecture decision.

## POS-D039 — Reliable notification delivery has a platform stop condition

- **Status:** Accepted
- **Date:** 2026-07-22

PeopleOS must not advertise Today summary delivery on a runtime until an adapter proves permission, scheduled closed-app delivery, replacement and cancellation, notification actions, warm and cold deep links, timezone reconciliation, retries, and idempotency. The browser PWA remains unavailable where it cannot meet this contract. The [Periodic Background Sync API is limited and experimental](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API), and Chrome ended [Notification Triggers](https://developer.chrome.com/docs/web-platform/notification-triggers/) after consistent cross-platform reliability could not be established.

The strongest V1 candidate is a provider-neutral adapter backed by [Capacitor local notifications](https://capacitorjs.com/). That candidate is not approval to add a native build before its package. Backend push is rejected for V1 because it introduces subscription, delivery, privacy, retry, and likely account/sync decisions solely to wake the app. This decision would be wrong if a portable, reliable, testable browser scheduling capability becomes available before implementation; the adapter boundary permits that substitution without changing Today or reminder rules.

## POS-D040 — Reach Out compound mutations are conservatively retry-safe

- **Status:** Accepted
- **Date:** 2026-07-23

Reach Out create, plan-edit, completion, and durable-status commands use prepared stable IDs and canonical command fingerprints. Primary ReachOutEvents anchor create, completion, and status retries; the current ReachOutEntry anchors exact plan-edit retries. Aggregate provisional identity completion stores its fingerprint on the confirmed Person. Provisional linking binds its explicit record preview to Person revisions and the complete dataset revision, then stores its command fingerprint on the merged source Person. Exact retries return the established result only when every expected artifact matches; stale, incomplete, or conflicting state aborts without partial writes.

Provisional linking blocks dual current Reach Out plans and unsafe lifecycle or self-reference closures. Its sole exception to append-only ownership is rekeying `FollowUpEvent.personId` while preserving the event ID and all lifecycle content.

The strongest alternative was a generic persisted command log plus a general-purpose merge engine. That would add infrastructure and product behavior beyond Version 1, so prepared commands and the narrow provisional-resolution transaction are preferred.

This decision could become wrong if multi-device sync requires operation-level reconciliation or unrelated dataset mutations make the global preview revision impractically strict. A future implementation could then use dependency-specific revision tokens without changing Reach Out product behavior.

## POS-D041 — V1 Relationship Engine projections are pure and calculated on read

- **Status:** Accepted and implemented
- **Date:** 2026-07-23

V1 uses fixed policy version `peopleos-v1`. `assessRelationship` accepts one Person bundle plus an injected instant/timezone, and `buildToday` applies TodaySkip suppression and owns the complete global order. The application adapter reads one consistent domain snapshot; no assessment, score, queue, cache, or Settings-controlled rule is persisted. Display name and binary importance travel as factual ordering metadata only.

The accepted readiness corrections close the remaining deterministic gaps. Any FollowUp created after a sole contact suppresses the New-relationship rule regardless of status. Enabled Family and Other facts follow Location before Event/affiliation cue fallbacks, with updated-time and stable-ID ties. The latest contact Interaction drives a general reminder suggestion unless a calling flow explicitly supplies its triggering contact ID. A current Reach Out FollowUp remains in the ordinary explicit-FollowUp band.

The strongest alternative was a persisted versioned projection cache. That adds invalidation and restore complexity without measured need, so V1 calculates on read. This decision could become wrong if profiling on a materially larger local dataset shows unacceptable projection latency; a later cache must remain disposable, versioned, and safe to rebuild without changing the authoritative records.

## POS-D042 — Calculate-on-read survives 3,000 contacts; the two-phase engine split is not built

- **Status:** Accepted
- **Date:** 2026-07-25
- **Supersedes:** the two-phase engine contract change proposed and accepted in `SCALE_REMEDIATION_PLAN.md` on the same day

The scale target rose to 3,000 contacts. Measured on a 3,000-Person, 45,000-Interaction dataset, a Today projection took 1,916 ms, so POS-D041's own reversal trigger — "profiling on a materially larger local dataset shows unacceptable projection latency" — had fired.

The plan's answer was to split evaluation into a cheap candidate pass over every Person and a card-grade pass over only the People rendered, on the evidence that dormant contacts cost *more* to assess (240 µs) than eligible ones (193 µs) because card-grade projections were being built for People who never appear on Today. That would have changed a published engine contract.

**It was not needed, and is not built.** Four changes that alter no contract removed 91% of the cost:

1. `Intl.DateTimeFormat` is constructed once per time zone instead of once per call. The engine resolves local dates roughly eight times per Person; formatter construction cost ~27 µs against ~1.3 µs for a reused formatter, for byte-identical output. This alone took 2,062 ms to 1,101 ms.
2. Child collections are grouped by `personId` once per snapshot instead of filtered once per Person, removing an O(People × records) join.
3. Today card assembly uses id-indexed maps instead of scanning whole collections per card.
4. The memory cue and the search-context cue share one computed fallback, and three call sites that fully re-sorted the contact list to read its newest element use a linear scan.

The Today projection now costs 179 ms, and its remaining time is 105 ms of IndexedDB read, 49 ms of assessment across all 3,000 People, and 23 ms of card assembly. The two-phase split targets only that 49 ms. Paying a permanent contract split, and amending a closed package's acceptance criteria, to reach part of 27% of the remaining cost is not justified — and the dominant term is a storage read the split does nothing about.

**Guarantees that remain intact.** Every V1-09 guarantee holds unchanged: the engine is pure and takes an injected instant, time zone and policy version; `assessRelationship` returns the complete per-Person projection set; `buildToday` owns eligibility filtering and the complete global order, rejects duplicate assessments and mixed clocks, and returns explanation and intended-action context in that one order; results are identical regardless of input array order; nothing is persisted or cached. `TodayItem`, `RelationshipAssessment` and `buildToday`'s signature are unchanged. **V1-09's acceptance criteria therefore need no amendment**, and V1-09 remains Complete on its original terms.

Equivalence is not asserted, it is tested: `src/relationship-engine/differential.test.ts` runs the engine as it stood at commit `d845681` and the current engine over 500 seeded random datasets — concentrating on equal `occurredAt`, equal `dueDate`, snoozed follow-ups, Reach Out linkage, archived and merged People, sole-contact relationships and shuffled input order — and requires deep equality of every assessment and every Today result.

The strongest alternative remains the persisted projection cache, still rejected under POS-D043. This decision could become wrong if the dataset grows well beyond 3,000 contacts, or if a future rule makes per-Person assessment materially more expensive; the candidate/card split stays available and its evidence is recorded here.

## POS-D043 — Contact state stays derived; no denormalisation, no persisted cache

- **Status:** Accepted
- **Date:** 2026-07-25

`Person.lastContactAt` and `Person.contactCount` are not stored, and no projection is persisted. What counts as contact is policy (`interactionCountsAsContact`); storing its output freezes that policy into the schema and turns any future change into a data migration.

The measured position after POS-D042 is that assessment across 3,000 People costs 49 ms, so denormalisation buys little. It becomes worth revisiting only in service of narrowing the dataset read, which is the dominant remaining term: Today currently reads all 45,000 Interactions solely to derive each Person's most recent contact.

Consequently the `TARGETS` of 150 ms for the Today projection and 300 ms for the Already contacted round trip in `SCALE_REMEDIATION_PLAN.md` §2 are **not reachable by engine work alone**. Reaching them requires either denormalised contact state or an equivalent narrowed read, which is V1-R3's scope and needs its own decision with measurements attached. Until then the gate holds the proven 179 ms / 341 ms rather than an aspiration.
