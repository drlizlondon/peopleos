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

- **Status:** Accepted
- **Date:** 2026-07-22

Settings stores Default phone region, Capture mode, and Default Reach Out reminder. Today policy, Interaction confirmation, notification availability, privacy posture, and version information are fixed behavior or runtime facts displayed for transparency. Person cadence, importance, tags, communication preference, Reach Out plans, and FollowUps stay with the Person/domain record they describe.

This is the smallest set that removes repeated global friction without making behavior unpredictable. A generic settings registry, remote configuration layer, and engine customization are rejected.

## POS-D033 — Notifications is an informational V1 section, not a delivery feature

- **Status:** Accepted
- **Date:** 2026-07-22

Settings states that notifications are Off and unavailable in Version 1. It does not show a disabled toggle or request platform permission. Due work appears when the user opens PeopleOS and Today evaluates. Notification delivery remains excluded until capability, permissions, scheduling, timezone, retry, and privacy receive a separate product decision.
