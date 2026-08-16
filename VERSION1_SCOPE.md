# PeopleOS Version 1 Scope

## Version 1 promise

PeopleOS Version 1 helps one person privately remember and maintain professional relationships on one device.

It must reliably answer:

> Who should I contact today, and why?

Version 1 is successful when the user can capture a person quickly, preserve useful context, make an explicit follow-up plan, receive an explainable recommendation, contact the person through a user-controlled handoff, and keep the next reminder accurate with minimal administration. On supported platforms, one privacy-preserving summary notification may direct the user to Today; it never becomes another reminder source.

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

- Interaction kinds: Met, Contacted, WhatsApp message, Email, Phone call, Coffee, Meeting, Conference, Introduction received, Introduction made, Note added, Follow-up completed
- Manual interaction logging from a person profile, plus channel-neutral Already contacted from Today
- Direct phone-dialler and email-client handoff from Today using a target resolved from an active ContactMethod
- WhatsApp draft handoff using a selected canonical phone number
- Direct Today email handoff plus Profile-origin email composition with editable subject/body
- vCard generation for adding a person to phone contacts
- No automatic sending and no automatic contact-book writing

### Follow-ups and cadence

- One-off follow-ups with a date and reason
- Reschedule, snooze, complete, and cancel behavior, with TodaySkip retained as the day-suppression primitive used by the standard Today actions
- Optional recurring cadence per person
- Upcoming follow-ups list
- Overdue follow-ups shown factually without escalation or guilt language
- One-tap Today deferral to tomorrow without losing or silently completing other reminder history

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

### Today actions and notification delivery

- Exactly three standard actions on every Today card: Contact now, Not today, and Already contacted
- Contact now opens the only resolved phone/email target, presents a labelled chooser when several targets are available, or opens a focused Add phone number flow when no usable target exists
- Any Today card without an active phone also shows Add phone number; it opens the same focused unsaved phone row and returns to the same recalculated Today position after save
- Opening an external application never records contact or changes the card
- Not today moves the primary explicit FollowUp to tomorrow, or creates one explicit tomorrow FollowUp for a New/cadence recommendation, records current-day TodaySkip suppression, and leaves any other due FollowUps unchanged
- Already contacted records one generic contact Interaction without an interaction form, completes the primary due FollowUp when present, and creates one explicitly selected next FollowUp
- One optional native iPhone Today summary at a user-selected local time, default 12:00, containing no Person names or relationship details
- Notification taps open Today; scheduling, cancellation, and taps never mutate a Person, FollowUp, ReachOutEntry, TodaySkip, or Interaction

### Privacy and continuity

- Local-first storage
- Offline use after first load
- Versioned JSON backup export
- Validated restore with preview and explicit replacement confirmation
- Separate PeopleOS storage and export identity

### Global Settings

- Nine-section Settings architecture: General, Modes, Today, Reach Out, Interactions, Notifications, Privacy & Security, Data, About
- Editable Default phone region, Capture mode, Default Reach Out reminder, Default Already contacted interval, and Today summary notifications only
- Fixed Today and Interaction policy shown transparently without engine controls
- Default Already contacted interval: 14 days, with 2, 7, 14, 30, and validated Custom choices
- Today summary notifications default Off and require an explicit user action and platform permission; unsupported platforms state that delivery is unavailable
- Person-level preferences remain on the Person or related domain record

## Explicit Version 1 decisions

### Contact import

V1 supports importing a user-selected `.vcf`/vCard file. The native iPhone MVP also supports explicit selection through Apple's system contact picker, which does not require broad address-book access, and optional one-time contact creation after the PeopleOS record has saved. Both native operations retain preview and duplicate reconciliation; no continuous Contacts sync or Google Contacts connection is introduced.

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

These count as direct contact: Met, Contacted, WhatsApp message, Email, Phone call, Coffee, Meeting, Conference, and Introduction received. Contacted is the generic, explicitly confirmed event created by Already contacted; it asks for no channel or interaction form.

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

### Standard Today action ownership

The three Today actions are presentation-stable while the Relationship Engine's suggested intended action remains visible context. Contact now performs an external handoff only. Not today uses the existing FollowUp and TodaySkip authorities: it snoozes the primary explicit FollowUp to tomorrow, or creates one accepted tomorrow FollowUp when eligibility came from the New/cadence rule, then suppresses the Person for the current local day. Other due FollowUps remain untouched and return through normal evaluation.

Already contacted is explicit evidence that contact happened, so it creates one generic Contacted Interaction without asking the user to log or classify it. After the user chooses the next interval, one atomic command completes the primary FollowUp when present, records Reach Out completion/relinking when applicable, creates exactly one next FollowUp, and refreshes Today, Upcoming, Reach Out, and Profile from the same records. The setting supplies only the preselected interval and never becomes a Person field or Relationship Engine rule.

### Today summary notifications

Notifications are an optional native iPhone delivery mechanism. They default Off and request normal iOS permission only after the user turns them On. The reminder time defaults to 12:00 local and is editable. The app derives at most 30 anonymous one-off occurrences from the same deterministic rules as Today — for each qualifying date, the chosen time and a reminder every three hours, never at or after 22:00 local — rebuilding them on launch, foreground/background transition, selected relationship mode, Settings, and dataset changes. Current-date occurrences may use the current Today count; forecast occurrences use “People are waiting on your list today.” Tapping, or View Today, opens Today; Not Now does nothing. Opening PeopleOS after a notification was sent ends that day's reminders. Turning reminders Off cancels all pending PeopleOS summaries. No notification action mutates individual reminders or relationship state.

Reliable delivery uses Capacitor's native local-notifications adapter backed by `UNUserNotificationCenter`. The browser PWA does not request permission or claim closed-app delivery. There is no backend, APNs/remote push entitlement, server push, or unlimited closed-app evaluation claim. Reopening replenishes the bounded 30-occurrence plan.

## Excluded from Version 1

- Direct Google Contacts import, linking, creation, or sync
- LinkedIn integration
- Continuous device contact-book synchronisation or PeopleOS metadata write-back
- Automatic or scheduled message sending
- AI-generated text, summaries, facts, priorities, or duplicate decisions
- SMS, calling, or email delivery services inside PeopleOS
- PeopleOS accounts, a hosted application backend, or shared/collaborative workspaces; optional private iCloud replication in the native app is a separate accepted capability
- Per-Person notifications, one notification per Today card, or names in notification content
- Per-Person notification time, notification actions beyond View Today and Not Now, or a configurable reminder interval or cut-off
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

Rejected. Notifications now contains one genuine global opt-in for the Today summary; this does not justify controls in every section. Today ordering, Interactions policy, Privacy & Security, and About remain fixed policy, capability status, actions, or information. Informational rows must not masquerade as disabled controls.

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
- Settings exposes exactly the six editable global preferences in `SETTINGS_SPEC.md`; none reads or mutates a Person.
- In the iPhone app, empty forecast dates schedule no summary, non-empty dates schedule one anonymous summary at the selected local time, and every notification operation is proven unable to mutate Person, Reach Out, FollowUp, TodaySkip, or Interaction data.
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

Deliver interaction logging, the generic Contacted kind used by Already contacted, split introduction kinds, free-form notes, events, automatic timeline, interaction detail/edit/delete confirmation, and derived last contact.

**Independent acceptance:** every interaction kind has correct contact semantics; a Contacted Interaction requires explicit Already contacted intent but no channel form; opening an external app records nothing; timeline order and last contact derive correctly.

### V1-06 — Memory facts and affiliations

Deliver fact creation/edit/archive, cue eligibility control, affiliation history, profile memory summary, and searchable data projections.

**Independent acceptance:** facts and notes coexist; sensitive fact defaults are respected; archived facts do not surface; organisation history is preserved.

### V1-07 — Follow-ups and cadence

Deliver one-off follow-ups, Upcoming, cadence, complete, snooze, reschedule, cancel, follow-up history, TodaySkip persistence, and the atomic primitives required by Today Not today. V1-10 composes the later Already contacted application transaction from these ordinary FollowUp capabilities.

**Independent acceptance:** every state transition matches the follow-up specification; the shared action type represents Research contact route without lossy mapping; Not today snoozes the primary explicit FollowUp to tomorrow or creates exactly one tomorrow FollowUp for New/cadence eligibility, records current-day TodaySkip suppression, leaves other due FollowUps untouched, and is idempotent; no follow-up date is duplicated on Person; cadence never creates persistent work without acceptance.

### V1-08 — Reach Out

Deliver Reach Out navigation, quick capture, ReachOutEntry/ReachOutEvent/ReachOutContext behavior, existing-Person and provisional-Person flows, linked FollowUps, completion and replacement-FollowUp relinking for Already contacted, Dormant/removal, Profile summary/detail, and provisional identity resolution.

**Independent acceptance:** an existing or provisional Person can enter Reach Out; only one current entry exists per Person; a reminder creates exactly one pending FollowUp with reciprocal current pointers and completion/cancellation/replacement clears or moves the pointer atomically; Already contacted retains one completion event and atomically relinks the same active intention to its one replacement FollowUp; status derives correctly; completion history remains searchable; identity resolution preserves all selected history without automatic merge.

### V1-09 — Relationship Engine core

Deliver deterministic projections for Today eligibility/order, explanations, stage, suggested intended action, suggested reminder, relationship age, memory cue, and Reach Out display state. The suggested intended action remains context; it does not replace the three fixed Today controls.

**Independent acceptance:** table-driven rules and all documented Relationship Engine output examples pass with injected time/timezone; `buildToday` returns stable Person IDs, eligibility/due state, relevant date, primary and additional due FollowUp IDs, explanation, and intended-action context in identical global order regardless of input-array order; downstream Today commands, contact-target resolution, and notification coordination remain in V1-07, V1-10, and V1-14 respectively; no UI module contains relationship calculations; no opaque score exists.

### V1-10 — Today experience

Deliver live Today cards with exactly Contact now, Not today, and Already contacted; explanation disclosure; direct `tel:`/`mailto:` handoff and labelled contact-target chooser; the visible no-phone action, focused Add phone number entry, and return; the Already contacted interval sheet, additional-due-plan disclosure, and atomic transaction; the new versioned default-interval setting and forward migration; Reach Out-linked explanations; list refresh; pagination; and all Today states.

**Independent acceptance:** every card has the three standard actions and a human-readable reason; one resolved phone/email target opens directly, several open the deterministically ordered labelled chooser, and none opens the focused unsaved phone row; Add phone number appears whenever no active phone exists and save/cancel returns correctly; an external handoff alone records nothing and leaves the card available; Not today has no confirmation, handles explicit/New/cadence reasons, preserves other FollowUps, and rolls back atomically on failure; opening then dismissing Already contacted writes nothing, while each preset/Custom valid date creates exactly one Contacted Interaction and one next FollowUp, completes only the primary plan, discloses and retains other due plans, and preserves Reach Out linkage/history; retries duplicate nothing; the default interval migrates and round-trips through backup/restore; all affected lists recalculate consistently; keyboard focus, accessible labels/errors, and 390px layout pass.

### V1-11 — Search and complete person profile

Deliver global search, Reach Out scoped search/status/context filters, ranked results, complete profile sections including Reach Out, profile secondary views, archive/restore, contextual event results, and preservation of the stable focused Contact Methods entry/return route introduced by V1-10.

**Independent acceptance:** every required field type is searchable with deterministic ranking; profile hierarchy matches the screen spec; archived people are excluded unless requested; after the complete Profile lands, Today-origin Add phone still opens one focused unsaved row, cancel/Back writes nothing, save returns to the originating Today position, and the recalculated Contact now options appear without reload.

### V1-12 — Batch networking capture

Deliver event-first batch capture, rapid repeated person entry, shared context reuse, duplicate review, batch completion summary, and deterministic routing from the global Add action when Networking capture mode is selected.

**Independent acceptance:** five people can be added with one event entry; backing out preserves already saved people and discards only the unsaved row; duplicates remain explicit.

### V1-13 — Contact actions and product hardening

Deliver WhatsApp as an additional resolved Contact now target, the Profile-origin templated composition flow for WhatsApp/email, vCard export, remaining Settings selection sheets and status rows, accessibility, error recovery, performance checks, complete empty states, and end-to-end flow verification. Notification delivery is not part of this package.

**Independent acceptance:** no action sends or writes contacts automatically; WhatsApp uses a canonical phone and remains a target rather than a duplicated ContactMethod or automatic contact record; one phone that supplies Call and WhatsApp opens the target chooser; Profile composition exposes the documented deterministic Networking/Coffee/Custom drafts, blank editable email subject, Copy fallback, and no domain mutation; Today email remains a direct handoff; returning from every handoff leaves Today unchanged; all critical flows work offline except external handoff; accessibility and 390px criteria pass.

### V1-14 — Today summary notifications

Moved into the chargeable MVP by POS-D047. Deliver Off-by-default native iPhone Today reminders, explicit permission, editable local time defaulting to 12:00, a narrow scheduler over at most 30 anonymous one-off occurrences, verified replacement/cancellation, and warm/cold tap routing to Today. Do not add action buttons, backend delivery, remote push, automatic messaging, or per-Person notifications.

**Independent acceptance:** permission is requested only after an explicit action; denied stays Off and never auto-prompts; empty forecast dates schedule nothing; payloads contain no relationship data; time changes replace rather than duplicate; Off cancels; taps land on Today; unsupported web reports the native boundary; Person, Reach Out, FollowUp, TodaySkip, and Interaction stores remain unchanged. Signed physical-device/TestFlight delivery and cold-tap checks remain release acceptance, not something browser tests can prove.

No later package begins against this amended scope until it is explicitly accepted. Completed package baselines remain intact unless the user explicitly reopens them.
