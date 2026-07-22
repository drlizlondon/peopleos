# PeopleOS Version 1 Scope

## Version 1 promise

PeopleOS Version 1 helps one person privately remember and maintain professional relationships on one device.

It must reliably answer:

> Who should I contact today, and why?

Version 1 is successful when the user can capture a person quickly, preserve useful context, make an explicit follow-up plan, receive an explainable recommendation, contact the person through a user-controlled handoff, and record what happened.

## Product test

Every V1 feature must help at least one of these jobs:

1. Remember who someone is.
2. Remember relevant context about them.
3. Remember a promise or appropriate time to reconnect.
4. Take a deliberate contact action.
5. Preserve trustworthy relationship history.

If a feature does none of these, it is outside V1.

## Included in Version 1

### People

- Manual person creation with name as the only required field
- Fast networking capture for one person
- Batch event capture for several people sharing an event
- User-selected vCard file import with preview
- Multiple phone numbers and email addresses per person
- Current and past organisation affiliations
- Importance: Normal or High
- Optional tags
- Archive and restore person
- Provisional People with descriptive labels and explicit completion/linking
- Deterministic duplicate warnings before creation or import

### Relationship memory

- Free-form dated notes
- Structured memory facts using a small fixed set of kinds
- Explicit events and event membership through interactions
- Automatic timeline from creation, interactions, and follow-up activity
- Search across names, organisations, events, facts, notes, and tags

### Contact and interaction history

- Interaction kinds: Met, WhatsApp message, Email, Phone call, Coffee, Meeting, Conference, Introduction received, Introduction made, Note added, Follow-up completed
- Quick interaction logging from Today and a person profile
- WhatsApp draft handoff using a selected canonical phone number
- Email handoff using a selected email address and editable subject/body
- vCard generation for adding a person to phone contacts
- No automatic sending and no automatic contact-book writing

### Follow-ups and cadence

- One-off follow-ups with a date and reason
- Reschedule, snooze, complete, skip once, and cancel behavior
- Optional recurring cadence per person
- Upcoming follow-ups list
- Overdue follow-ups shown factually without escalation or guilt language

### Reach Out

- First-class Reach Out primary navigation section
- Curated outreach intentions referencing permanent Person IDs
- Existing-Person and provisional-label quick capture
- Reason, intended next action, notes, completion history, and lightweight project/organisation/Event/fellowship context
- Active, Waiting, Snoozed, Overdue, Completed, and Dormant display states
- Existing FollowUp integration for all reminder dates and Today eligibility
- Person Profile integration and explicit provisional identity resolution
- Search and filtering across active and historical outreach

### Explainable relationship support

- Today recommendations using ordered deterministic rules
- A visible reason for every Today recommendation
- Suggested next action
- Suggested reminder date where an explicit rule applies
- Derived relationship stage
- Derived memory cue with source
- Factual last-contact and relationship-started information

### Privacy and continuity

- Local-first storage
- Offline use after first load
- Versioned JSON backup export
- Validated restore with preview and explicit replacement confirmation
- Separate PeopleOS storage and export identity

### Global Settings

- Nine-section Settings architecture: General, Modes, Today, Reach Out, Interactions, Notifications, Privacy & Security, Data, About
- Editable Default phone region, Capture mode, and Default Reach Out reminder only
- Fixed Today and Interaction policy shown transparently without engine controls
- Notifications shown as Off and unavailable; no permission or delivery capability
- Person-level preferences remain on the Person or related domain record

## Explicit Version 1 decisions

### Contact import

V1 supports importing a user-selected `.vcf`/vCard file. It does not request access to the device address book and does not connect to Google Contacts. Import is deliberately previewable and works without an account.

The import flow is secondary, not part of mandatory onboarding. Manual capture remains the primary path.

### Relationship stage thresholds

V1 uses these deterministic stages based only on contact-counting interactions:

| Stage | Rule |
| --- | --- |
| New | Fewer than 2 contact interactions, or less than 30 days since the first contact |
| Growing | At least 2 contacts across at least 30 days, but fewer than 5 contacts or less than 180 days of span |
| Established | At least 5 contacts across at least 180 days, but less than 730 days of span |
| Long-term | At least 5 contacts across at least 730 days |

Evaluation is top-down from Long-term to New so boundary overlap is impossible. Recency does not demote a relationship stage in V1; it affects cadence recommendations instead. When no contact interaction exists, stage is New and the explanation says it is based on the person being recently added.

### Contact-counting interactions

These count as direct contact: Met, WhatsApp message, Email, Phone call, Coffee, Meeting, Conference, and Introduction received.

These do not count as direct contact: Introduction made, Note added, and Follow-up completed. “Introduction received” means the user and this person were introduced to each other. “Introduction made” means the user connected this person with someone else.

### Memory cue safety

Each Memory Fact has a `Show as memory cue` choice. It defaults:

- On for Interest, Seeking, Communication preference, Location, and Introduced by
- Off for Family and Other

Users can change it. Free-form notes are never selected as a Home/Today memory cue in V1; they remain visible on the profile and in search. This prevents private narrative from surfacing unexpectedly.

### Event grouping

V1 groups people only through an explicit Event selected or created by the user. It may suggest an existing event by exact normalised name during capture, but does not create or assign fuzzy inferred groups.

### Today list size

Today shows up to five people at once. If more are eligible, a “Show more due people” action reveals the next five. This keeps the first view calm without hiding that more commitments exist.

### Reach Out reminder ownership

Reach Out never creates a second reminder system. A dated outreach plan is one normal FollowUp linked to ReachOutEntry. Waiting, Snoozed, and Overdue are derived from that FollowUp. Reach Out membership alone does not make someone appear in Today.

## Excluded from Version 1

- Direct Google Contacts import, linking, creation, or sync
- LinkedIn integration
- Device contact-book permissions or native contact writing
- Automatic or scheduled message sending
- AI-generated text, summaries, facts, priorities, or duplicate decisions
- SMS, calling, or email delivery services inside PeopleOS
- Accounts, cloud sync, multi-device use, or shared workspaces
- Browser/server push notifications or any notification delivery
- Background scheduled tasks
- Deals, pipelines, companies as managed accounts, tasks unrelated to a person, campaigns, or analytics dashboards
- Birthdays as a special recommendation system
- Automatic merging or general-purpose merge; V1 includes only explicit provisional-Person resolution
- Automatic event inference
- Relationship health scores, streaks, and engagement charts
- Custom Relationship Engine weights or rule settings
- Bulk editing, bulk messaging, or mass follow-up creation
- Interaction attachments, audio, images, and document storage
- Audit history for edits to old interactions

## Features challenged and removed

### Filters as a permanent primary screen

Rejected. Filters are useful only within Search and Upcoming. A dedicated filter-management screen adds administration without helping the core job.

### A general dashboard

Rejected. Counts, charts, and activity summaries distract from “Who should I contact today?”

### Editable relationship stage

Rejected. Stage is derived and explained.

### Several reminder types

Rejected. V1 has one Follow-up concept plus optional recurring cadence. “Reminder,” “task,” and “follow-up” are not separate user-facing objects.

### Persistent note on Person

Rejected. Notes are dated timeline events; durable searchable information belongs in Memory Facts.

### Dedicated Events tab

Rejected. Events are context reached through Search, capture, and profiles. They do not earn a primary navigation position in V1.

### Dedicated Settings for engine behavior

Rejected. Explainable rules should be consistent. Settings may explain Today policy but cannot change ordering, weights, stage, cues, ranking, or eligibility.

### A toggle in every Settings section

Rejected. Today, Interactions, Notifications, Privacy & Security, and About contain fixed policy, capability status, actions, or information where no genuine V1 preference exists. Informational rows must not masquerade as disabled controls.

## Version 1 completion criteria

V1 is complete only when:

- Every included screen and state in `SCREEN_SPECIFICATIONS.md` is implemented or explicitly removed through a product decision.
- Every Relationship Engine rule in `RELATIONSHIP_ENGINE_SPEC.md` passes example and boundary tests.
- All critical user flows in `USER_FLOWS.md` can be completed at a 390px viewport and with keyboard-only navigation.
- A manual person can be saved in under 20 seconds in usability testing.
- A batch of five event contacts can be captured without re-entering shared event context.
- Every Today card has an explanation derived from visible facts.
- Reach Out supports existing and provisional People, all required display states, completion history, and linked FollowUp behavior without duplicate Person or reminder records.
- Export and restore preserve all V1 data.
- Settings exposes exactly the three editable global preferences in `SETTINGS_SPEC.md`; none reads or mutates a Person.
- No excluded feature has been pulled forward.

## Complete implementation order

Each package is independently testable and must leave the application usable.

### V1-01 — Independent shell and product identity

Deliver the PeopleOS PWA shell, navigation frame, offline boot, PeopleOS storage identity, and empty Today/Reach Out/People/Upcoming/Settings destinations, including the nine-section Settings structure and fixed informational copy.

**Independent acceptance:** app installs, reopens offline, navigates between all primary tabs, and contains no Real Friends product identity.

### V1-02 — Versioned local data and backup foundation

Deliver repositories, validation, schema migrations, safe archive behavior, Reach Out/provisional-Person storage contracts, the versioned AppSettings singleton, export, restore preview, and restore confirmation.

**Independent acceptance:** seeded data and all three global preferences round-trip losslessly; invalid restore changes nothing; all child records require a Person; stale Settings revisions cannot overwrite newer values.

### V1-03 — Manual person capture and contact methods

Deliver Add person, provisional identity support, contact methods, phone parsing, email validation, affiliation capture, progressive disclosure, and person summary profile.

**Independent acceptance:** name-only save works; natural UK phone formats canonicalise correctly; a person can hold multiple contact methods without identity changing; under-20-second capture test passes.

### V1-04 — Duplicate warning and vCard import

Deliver deterministic duplicate evidence, single-create warnings, user-selected vCard import, preview, skip/create/open-existing choices, and import results.

**Independent acceptance:** exact phone/email matches explain the warning; weak matches require combined evidence; no candidate is merged automatically; malformed files preserve existing data.

### V1-05 — Interactions and timeline

Deliver interaction logging, split introduction kinds, free-form notes, events, automatic timeline, interaction detail/edit/delete confirmation, and derived last contact.

**Independent acceptance:** every interaction kind has correct contact semantics; opening an external app records nothing; timeline order and last contact derive correctly.

### V1-06 — Memory facts and affiliations

Deliver fact creation/edit/archive, cue eligibility control, affiliation history, profile memory summary, and searchable data projections.

**Independent acceptance:** facts and notes coexist; sensitive fact defaults are respected; archived facts do not surface; organisation history is preserved.

### V1-07 — Follow-ups and cadence

Deliver one-off follow-ups, Upcoming, cadence, complete, skip once, snooze, reschedule, cancel, and follow-up history.

**Independent acceptance:** every state transition matches the follow-up specification; no follow-up date is duplicated on Person; cadence never creates persistent work without acceptance.

### V1-08 — Reach Out

Deliver Reach Out navigation, quick capture, ReachOutEntry/ReachOutEvent/ReachOutContext behavior, existing-Person and provisional-Person flows, linked FollowUps, completion, Dormant/removal, Profile summary/detail, and provisional identity resolution.

**Independent acceptance:** an existing or provisional Person can enter Reach Out; only one current entry exists per Person; reminder dates create exactly one linked FollowUp; status derives correctly; completion history remains searchable; identity resolution preserves all selected history without automatic merge.

### V1-09 — Relationship Engine core

Deliver deterministic projections for Today eligibility/order, explanations, stage, suggested action, suggested reminder, relationship age, memory cue, and Reach Out display state.

**Independent acceptance:** table-driven rules and all documented examples pass with injected time/timezone; no UI module contains relationship calculations; no opaque score exists.

### V1-10 — Today experience

Deliver live Today cards, explanation disclosure, WhatsApp/email handoffs, interaction confirmation, reschedule/skip/cancel/Dormant/remove actions, Reach Out-linked explanations, list refresh, pagination, and all Today states.

**Independent acceptance:** completing or rescheduling immediately recalculates the list; external handoff alone records nothing; every card has a human-readable reason.

### V1-11 — Search and complete person profile

Deliver global search, Reach Out scoped search/status/context filters, ranked results, complete profile sections including Reach Out, profile secondary views, archive/restore, and contextual event results.

**Independent acceptance:** every required field type is searchable with deterministic ranking; profile hierarchy matches the screen spec; archived people are excluded unless requested.

### V1-12 — Batch networking capture

Deliver event-first batch capture, rapid repeated person entry, shared context reuse, duplicate review, batch completion summary, and deterministic routing from the global Add action when Networking capture mode is selected.

**Independent acceptance:** five people can be added with one event entry; backing out preserves already saved people and discards only the unsaved row; duplicates remain explicit.

### V1-13 — Contact actions and product hardening

Deliver editable WhatsApp/email templates, vCard export, complete Settings selection sheets and status rows, accessibility, error recovery, performance checks, complete empty states, and end-to-end flow verification.

**Independent acceptance:** no action sends or writes contacts automatically; all critical flows work offline except external handoff; accessibility and 390px criteria pass.

Implementation must not begin until this specification is explicitly accepted.
