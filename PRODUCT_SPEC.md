# PeopleOS Version 1 Product Specification

Status: execution-ready product specification; implementation is complete through V1-03 and later packages remain governed by this document.

## 1. Product definition

PeopleOS is a calm, private relationship operating system for maintaining valuable professional relationships over many years.

It is not a CRM. It does not represent leads, opportunities, deals, stages of sale, campaigns, or team ownership. It does not automate human contact. It helps the user remember people, context, promises, and appropriate moments to reconnect.

The core product question is:

> Who should I contact today?

Every answer includes a deterministic reason.

PeopleOS also includes **Reach Out**: a curated list of people the user intentionally wants to contact, reconnect with, or build a relationship with. Reach Out helps the user remember why the person matters, decide what to do next, and surface the person again at the appropriate time.

## 2. Version 1 user

V1 is designed for one person managing their own professional relationships on one device. Typical people include cohort peers, conference contacts, founders, investors, clinicians, advisors, mentors, collaborators, recruiters, potential customers, and mutual introductions.

The user values context and trust more than volume. They may know dozens or hundreds of people, but they do not want pipeline administration.

## 3. Product outcomes

V1 should make these moments effortless:

- Capture someone immediately after meeting them.
- Find someone later from partial context rather than exact name.
- See the small set of relationships that merit action today.
- Understand exactly why each person appears.
- Contact someone through a prepared but user-controlled handoff.
- Record what actually happened.
- Preserve a promise to follow up without turning it into guilt.
- Reconstruct the relationship from trustworthy history.
- Keep data portable without creating an account.

## 4. Product principles

### One obvious question per screen

Today does not become a dashboard. Profile does not become a data-entry form. Settings exposes only global application behavior and does not become a control panel for relationship rules.

### Capture first, organise later

Name is the only universally required person field. A user can add detail when it becomes useful. Advanced structure must never block quick capture.

### Explain every recommendation

The reason is normal product copy on the card, not hidden diagnostics. An output without a valid explanation is not shown.

### Record reality, not assumptions

Opening WhatsApp or email does not mean a message was sent. Completing a FollowUp does not necessarily mean contact occurred. The user confirms the outcome.

### Structure only information worth retrieving

Durable facts become Memory Facts. Narrative remains a dated Note. PeopleOS does not demand that every detail be categorised.

### Calm, factual planning

Due and overdue states are honest but not punitive. No debt counter, red escalation, streak, or relationship score.

### Private and reversible

Data stays local unless exported. Import is previewed. Duplicate matches warn. No automatic merge, contact write, message send, or destructive overwrite.

## 5. Core objects as users understand them

### Person

The permanent record for an individual. Contact methods, names, affiliations, and provider links can change without replacing the Person.

A Person may be provisional when the user knows only a descriptive label such as “Chief Information Officer at Watford.” Provisional and confirmed people use the same permanent Person identity model.

### Reach Out

One explicit intention to contact, reconnect with, or build a relationship with a Person. It preserves why the person matters and the next intended action. A Person can exist without Reach Out; adding them is a deliberate action commitment, not a tag.

### Interaction

Something that happened in the relationship: meeting, message, call, coffee, introduction, note, or follow-up completion. Interactions create the timeline and derived relationship context.

### Follow-up

One explicit plan to do something involving a Person on a date, with a reason. User-facing language consistently says “follow-up,” not task/reminder interchangeably.

### Contact cadence

An optional recurring preference such as every 90 days. It creates explainable eligibility, not a chain of stored FollowUps.

### Memory Fact

A concise, durable, searchable statement such as “Based in Bristol” or “Looking for pilot sites.” It can be eligible to surface as a cue.

### Note

A dated free-form record for nuance and narrative. A Note is shown in Timeline and Search but is not automatically surfaced as a compact cue.

### Event

Explicit shared context such as HealthTech Fellowship. Events group people through recorded interactions.

### Affiliation

Current or past organisation and role context.

## 6. Complete journey

### Beginning

First launch goes directly to an empty Today screen. There is no forced tutorial or account. The user adds a first Person manually or imports a user-selected vCard file.

### Capture

The fastest normal path is Add Person: name, optional contact method, optional organisation/where met, Save. Quick Networking Capture adds Event reuse and a one-line memory field. Batch Event Capture preserves shared Event context across repeated saves.

Reach Out Quick Capture accepts an existing Person or a provisional descriptive label as the only required input. Reason, next action, context, and reminder are progressively disclosed and remain editable.

### Enrichment

After save, the Profile offers relevant next steps without requiring them: Plan follow-up, add contact details, record a fact, or log an interaction. Empty sections remain compact.

### Daily use

The app opens to Today. Up to five eligible people appear in deterministic order. Every card shows its reason and the same three actions: Contact now, Not today, and Already contacted. Contact now opens an available contact method but never assumes communication occurred. Not today defers the displayed plan to tomorrow. Already contacted records the user's explicit confirmation without asking them to complete an interaction form, then asks when to remind them again.

The Reach Out tab provides the deliberate queue itself. Dated Reach Out plans appear in Today through the same FollowUp rules as every other explicit plan.

### Reflection and retrieval

People search supports remembered context. Profile summarises what matters now, while full Timeline, Facts, Contact Methods, Affiliations, and FollowUps remain secondary.

### Continuity

Upcoming shows only future plans. Settings provides minimal global preferences, transparent fixed-policy status, export, and atomic restore. Archive removes a Person from active recommendations without destroying history.

Detailed flows are binding in `USER_FLOWS.md`. Screen behavior is binding in `SCREEN_SPECIFICATIONS.md`.

## Reach Out specification

### Definition

Reach Out is a first-class curated action queue. It is not a People filter, tag, contact list, pipeline, or lead stage.

### Membership

- A Person may have no Reach Out entry.
- Adding an existing Person creates Reach Out intention without duplicating Person.
- Adding an incomplete identity first creates a provisional Person with a descriptive display label, then a Reach Out entry referencing that Person ID.
- Only one current non-completed Reach Out entry exists for a Person. Completed entries remain history and a later outreach cycle may create another.
- A provisional Person may be completed in place or explicitly linked to an existing confirmed Person after review. No merge occurs automatically.

### Reach Out information

- Person
- Descriptive label when identity is provisional
- Why the user wants to reach out
- Intended next action
- Optional reminder date through a linked FollowUp
- Context or notes
- Derived display status
- Date added and latest completion date
- Optional project, organisation, Event, fellowship, or other Reach Out context

The minimum quick-capture requirement is Person or descriptive label. Missing reason or action is displayed as a clear completion prompt rather than blocking save.

### Status behavior

- **Active:** Current intention with no later waiting/snoozed date; includes no reminder and due today.
- **Waiting:** Linked pending FollowUp is due after today.
- **Snoozed:** Linked pending FollowUp has a future snooze date.
- **Overdue:** Linked pending FollowUp effective date is before today.
- **Completed:** Outreach completion recorded and no next FollowUp accepted.
- **Dormant:** User intentionally retains the person without a current action.

Active, Completed, and Dormant are durable intention states. Waiting, Snoozed, and Overdue are derived from the linked FollowUp so PeopleOS has only one reminder system.

An active Reach Out reminder is represented by one reciprocal current-plan link: the ReachOutEntry points to its sole pending FollowUp and that FollowUp points back to the same entry and Person. Completion, cancellation, or replacement clears or moves the current pointer atomically; historical FollowUps remain history rather than competing current reminders.

### Completion

Completing outreach records the completion date and offers an optional Interaction. It then asks whether another FollowUp is required. If accepted, the same Reach Out entry remains in the active queue with the new reciprocal current FollowUp and retains completion history. Otherwise it clears the current pointer, becomes Completed, and leaves the active default list.

### Removal

Remove from Reach Out archives the Reach Out membership and removes it from Reach Out results without deleting Person, Interactions, FollowUps, or completion history. Dormant should be used when the user wants to keep the intention visible for later.

### Fellowship example

A Fellowship Reach Out context can group Simon, Chief Information Officer at Watford, Hackathon organiser, and Aaron from the hackathon. These are acceptance examples only and are never production seed data.

## 7. Manual person capture specification

### Target

Under 20 seconds for name plus phone, measured from choosing Add Person to confirmed save on a familiar mobile device.

### Required input

Name only.

### Initially visible optional inputs

- One Phone or Email
- Organisation
- Where met / Event

### Progressively disclosed inputs

- Additional contact methods
- Role
- Importance
- Tags
- Contact cadence

### Not part of initial capture

- Relationship stage
- Full Fact list
- Long Note
- Multiple FollowUps
- Provider account linking
- Organisation-history administration

### After save

Open the Profile. If a deterministic follow-up suggestion applies, show it as an optional suggestion with reason. Never save it automatically.

## 8. Today specification

### Eligibility

People appear for one of three reasons:

1. An explicit FollowUp is due or overdue.
2. A first follow-up is due seven days after the only recorded contact.
3. Their recurring cadence is due.

A future explicit FollowUp suppresses early cadence or first-follow-up recommendations. Archived and skipped-for-today people do not appear.

A due Reach Out reminder is an ordinary explicit FollowUp and follows the same eligibility and ordering. Reach Out does not receive a separate priority boost.

### Ordering

1. Overdue explicit FollowUps
2. Explicit FollowUps due today
3. New relationship follow-up
4. Cadence due

Importance only breaks ties within a group. There is no score.

### Card content

- Name
- Current role/organisation when known
- Factual due label when relevant
- Full-sentence reason
- One safe memory cue when available
- Contact now
- Not today
- Already contacted
- Add phone number whenever no active valid phone is stored, including when email is available
- Person name or context link to open Profile without competing with the three standard actions

The three actions are identical on every Today card. A FollowUp's intended action remains useful explanatory context, but it never replaces these controls.

### Contact now behavior

Contact now resolves executable targets only from active, valid contact methods:

- With one target, phone opens the device dialler through `tel:` and email opens the default email client through `mailto:`. WhatsApp may use the same handoff boundary when its later package is implemented.
- With several targets, an accessible choice sheet lists the channel, stored method label, and familiar formatted value. No target is silently chosen.
- With no usable target, open that Person's Contact Methods screen with a blank phone draft already open and the number field focused.

Before V1-13, one phone or email ContactMethod produces one target. V1-13 may derive both Call and WhatsApp targets from one canonical phone without duplicating the ContactMethod; target count therefore determines direct launch versus the chooser.

Opening another application causes no Interaction, FollowUp, Reach Out, TodaySkip, or other domain write. PeopleOS does not show a return-confirmation prompt. When the user returns, the card remains until they explicitly choose Not today, Already contacted, or another domain action elsewhere.

Add phone number opens the same focused phone draft even when Contact now can use email. Cancelling writes nothing. After a successful save, returning to Today refreshes the card immediately and includes the new phone in Contact now.

### Initial list size

Five people. When more are eligible, Show more due people reveals the next five without changing order.

### After action

- Contact now changes nothing in PeopleOS, whether or not another app opens.
- Not today atomically moves the primary explicit FollowUp to tomorrow using the existing snooze lifecycle and stores today's Person-scoped TodaySkip. For a New or cadence card with no primary FollowUp, it creates one pending FollowUp for tomorrow with reason “Reconnect with {display name}” and action `other`, then stores the TodaySkip. Other FollowUps are not changed.
- Already contacted opens the next-reminder sheet. Choosing a date atomically records one generic contact Interaction, completes the primary FollowUp when present, creates one next FollowUp, stores today's TodaySkip, maintains any linked Reach Out plan/history, and recalculates. Dismissing the sheet restores the card and writes nothing. When other due FollowUps will remain, the sheet discloses that they may bring the Person back sooner without adding another question.
- FollowUp completed without contact removes that FollowUp but does not change last contact.
- Reschedule or Snooze changes the effective plan and recalculates.
- The TodaySkip used by Not today and Already contacted prevents additional independent due reasons from keeping the Person visible on the current local day. It does not complete or alter those other FollowUps.
- Cancel removes that FollowUp, then independent New/cadence eligibility is evaluated.
- External-app opening alone changes nothing.

All compound Today actions are idempotent. A retry uses the same prepared Interaction, FollowUp, lifecycle-event, Reach Out event, and TodaySkip identifiers; failure leaves the previous domain state authoritative and keeps or restores the card.

### Daily summary notification

Daily Today notifications are opt-in and Off by default. In the native iPhone app, normal iOS permission is requested only after the user turns reminders On. The default time is 12:00 in the device's local timezone and the user may change it or turn reminders Off.

- PeopleOS derives at most 30 one-off occurrences from the same deterministic eligibility rules as Today — for each qualifying date, the chosen time and a reminder every three hours, never at or after 22:00 local — and safely replaces them after launch, foreground/background transition, selected-mode, Settings, or dataset changes.
- Empty forecast dates schedule nothing. One or more actionable People schedule one privacy-safe summary for that date, never one notification per Person.
- Title: `PeopleOS`. A trustworthy same-day body may say “3 people are on your list today.” Forecast occurrences say “People are waiting on your list today.” Names and relationship details are omitted.

Tapping a notification, or its View Today action, opens Today. Not Now does nothing at all: the next reminder in the already-installed ladder simply arrives. Opening PeopleOS after a notification was sent ends that day's cycle; dismissing or ignoring one never does. The MVP adds no configurable snooze, automatic messaging, or notification-only Not today command. Changing the time or turning reminders Off cancels/replaces pending PeopleOS summaries. If the bounded plan is exhausted without reopening the app, it ends until PeopleOS is reopened. Scheduling, taps and notification actions never change a Person, Interaction, FollowUp, Reach Out entry, TodaySkip, or Today eligibility, and never remove anyone from Today.

The summary payload targets Today and contains no Person or FollowUp identifier, name, contact detail, reason, note, affiliation, or other relationship data. Foreign or malformed payloads are ignored rather than opening another record by fallback matching.

### Overdue behavior

Show “Overdue” and “Planned for {date}.” Do not show days-late debt, escalating colors, guilt copy, or repeated nagging. Oldest plans appear first because that is deterministic ordering, not punishment.

## 9. Person Profile specification

The Profile is a decision-ready summary, not the complete database on one page.

### Main page

1. Identity: name, current role/organisation, preferred contact
2. Primary action from current context
3. Today's reason or next FollowUp
4. Reach Out summary when the Person has a current entry: why, intended action, reminder date, and status
5. Relationship stage, last contact, known since
6. One memory cue and up to three prominent facts
7. Five recent timeline items
8. Preferred contact details
9. Current affiliation

### Secondary views

- All Memory Facts
- Full Timeline
- All FollowUps and detail
- All Contact Methods
- Affiliation history
- Edit Person preferences
- Reach Out detail/history

### Prominence rules

- A current due commitment outranks descriptive context.
- Contact method is prominent only when it enables action.
- Tags and importance remain in Edit/More.
- Past affiliations remain secondary.
- Full notes never occupy the profile header.
- Relationship stage always has an explanation.

## 10. Follow-up and cadence behavior

### One-off FollowUp fields

- Person
- Reason
- Action type
- Date

All are required except Person when already in profile context. The user may accept or change a suggested date.

### State behavior

| Action/state | What is stored | Today effect | Contact effect |
| --- | --- | --- | --- |
| Pending future | Active FollowUp | Not shown until due | None |
| Due today | Active FollowUp | Eligible | None |
| Overdue | Active FollowUp | Eligible before other bands | None |
| Complete with contact | Completed FollowUp + contact Interaction | Removed unless another reason remains | Updates last contact |
| Complete without contact | Completed FollowUp + Follow-up completed Interaction | Removed unless another reason remains | Does not update last contact |
| Not today, explicit FollowUp | Same FollowUp snoozed to tomorrow + lifecycle event + day-scoped TodaySkip | Hidden until next local day | None |
| Not today, New/cadence | New pending FollowUp for tomorrow + day-scoped TodaySkip | Hidden until next local day | None |
| Already contacted | Generic Contacted Interaction + completed primary FollowUp when present + one next FollowUp + day-scoped TodaySkip | Hidden today; returns on selected date unless another reason becomes eligible later | Updates last contact |
| Snooze | Same plan with later effective date and original date preserved | Hidden until snooze date unless another reason remains | None |
| Reschedule | Original superseded; replacement pending | Based on replacement date | None |
| Cancel | Cancelled FollowUp | This reason removed; evaluate other rules | None |

### Not today versus Snooze versus Reschedule

- **Not today:** “I still intend to contact this person, just not today.” The primary plan is moved or created for tomorrow, lifecycle history is preserved, and the Person is suppressed for the rest of the current local day.
- **Snooze:** “Temporarily defer this same plan.” Original date remains visible.
- **Reschedule:** “The plan itself has changed.” Replacement date/reason/action become authoritative.

### Recurring cadence

- Options: None, Monthly, Every 3 months, Every 6 months, Yearly, Custom days.
- Cadence is calculated from last contact.
- Without a contact Interaction, cadence does not put the Person on Today; prompt for explicit first FollowUp.
- A future FollowUp overrides cadence until resolved.
- Contact immediately recalculates the next cadence date.
- Cadence never creates stored FollowUps automatically.

## 11. Memory behavior

### Fact kinds

- Introduced by
- Interest
- Seeking
- Family
- Communication preference
- Location
- Other

### Creation

Facts are created explicitly from Profile or after saving a Note. Nothing is extracted automatically. Introduced by may link another Person.

### Editing

Value, kind, related Person, and cue eligibility are editable. Archive removes the Fact from active search/cues but preserves it in archived facts.

### Display

Profile shows the selected cue and up to three active prominent facts. Full Facts groups all active items by kind. Updated date is secondary metadata.

### Searching

All active Fact values are searchable. Results identify the matching kind and value.

### Surfacing

Cue priority is deterministic. Family and Other default off; other kinds default on. Users can change cue eligibility. Notes never surface as Today cues in V1.

### Avoiding repeated entry

- Capture can create a Note or Fact directly.
- Existing Event and Person selectors reuse saved context.
- The same Fact can be edited rather than re-entered.
- Duplicate Fact warning identifies exact active repeats.
- Affiliation and Event information remain in their own source record; a Fact should not duplicate “Works at X” or “Met at Y.”

## 12. Search behavior

Search covers:

- Names
- Canonical phones/emails when contact-like input is entered
- Current and past organisations/roles
- Events
- Memory Facts
- Tags
- Free-form Note summaries
- Reach Out provisional labels, reasons, notes, and context labels

Ranking prioritises exact and prefix name matches, then contact identities, then current professional context, Event, Fact, Tag, Note, and past affiliation. Each non-name result explains why it matched.

Within Reach Out, identity matches rank before organisation/role, then Reach Out reason, context, and notes. Reach Out filters include Due, Overdue, Upcoming, Waiting, Snoozed, Dormant, and Completed. “Due” means due today; “Upcoming” means a future pending FollowUp whether or not the display state is Waiting.

Search never uses Relationship Engine priority or importance to hide a better textual match. Archived people are excluded by default.

Filters are scoped tools, not persistent saved views. People filters include Tag, Current organisation, Event, Relationship stage, Has due follow-up, Missing contact details, and Archived.

## 13. Interaction behavior

### Types that count as contact

Met, WhatsApp message, Email, Phone call, Coffee, Meeting, Conference, Introduction received, Contacted.

Contacted is the channel-neutral contact fact created only when the user explicitly chooses Already contacted. It prevents a compulsory logging form while keeping last contact, cadence, stage, and timeline truthful. It never results from opening another app.

### Types that do not count as contact

Introduction made, Note added, Follow-up completed.

### Creation

The form states whether the selected kind counts as contact. Date/time defaults to now. Summary and Event are optional. Introductions can link another Person.

### Editing and deletion

Editing or deleting recalculates Timeline, last contact, stage, Today, and cadence. Delete confirmation says this. V1 does not provide historical edit audit.

### Timeline

Automatically includes Person creation, Interactions, and FollowUp lifecycle events. Newest first, grouped by month/year. No manual timeline assembly.

## 14. Contact actions

### Contact now

- Resolves targets only from active, valid ContactMethods.
- A sole phone-call target opens `tel:` using its canonical international number.
- A sole email target opens `mailto:` using its active canonical address.
- Multiple targets open an accessible choice sheet showing channels, labels, and familiar values.
- No usable target opens Contact Methods with a blank phone row ready and focused.
- External handoff never records contact and never triggers a return-confirmation prompt.
- The Today card remains available after handoff until the user chooses an explicit Today action.

### WhatsApp

- Uses selected validated canonical phone.
- Templates: Networking, Coffee, Custom.
- Networking starts “Hi {first name}, it was lovely meeting you today at {event}. Great chatting with you.” When no Event exists, omit “at {event}.”
- Coffee starts “Lovely seeing you today. Let's catch up again soon.”
- Custom starts blank. PeopleOS does not infer sender identity or content.
- Draft is always editable.
- User opens WhatsApp and presses Send there.
- Returning to PeopleOS records nothing; Already contacted is the explicit acknowledgement path.
- Failure offers Copy.

### Email

- Uses selected active email.
- From Profile or another non-Today Compose action, Networking, Coffee, and Custom provide editable subject/body before handoff.
- Email uses the same starting body as WhatsApp; subject starts blank and remains editable.
- Today Contact now launches a sole email target directly without inserting template composition.
- User sends in their email app.
- Returning to PeopleOS records nothing and leaves the Today card available.

### Phone contacts

- Profile generates a previewed vCard.
- User chooses included fields.
- Device contact UI owns final confirmation.
- No link or success is assumed.

### Phone call

Contact now opens a sole active valid phone through `tel:` or offers it in the method chooser. Opening the dialler is never treated as evidence of a call. The user may later log Phone call in detail or choose Already contacted for the frictionless channel-neutral record.

## 15. Contact import

V1 imports only a user-selected vCard file. It requests no contact permission and creates no Google provider link.

Import requirements:

- Local parsing
- Full preview
- Per-row validation
- Duplicate evidence
- Explicit create, link-new-details, separate, or skip decision
- No automatic interaction/follow-up creation
- Result summary
- Row-safe failure behavior

“Link new details” adds only reviewed new Contact Methods/Affiliation to an existing Person. It is not a merge.

## 16. Duplicate behavior

Strong evidence:

- Same linked external identity, though V1 creates none
- Exact canonical phone
- Exact canonical email

Review evidence:

- Similar name plus same current organisation
- Similar name plus same explicit Event

Name similarity alone does not warn. Every warning names the evidence. The app never auto-merges and never assumes shared contact details are definitely the same person.

## 17. Empty-state system

Empty states do one of three jobs:

1. Start: explain value and provide a create/import action.
2. Confirm calm: explain that nothing requires attention.
3. Recover search/filter: explain why nothing matches and provide Clear/Adjust.

They must not introduce unrelated feature promotion.

Canonical empty states are specified per screen in `SCREEN_SPECIFICATIONS.md`.

## 18. Settings behavior

Settings contains nine sections: General, Modes, Today, Reach Out, Interactions, Notifications, Privacy & Security, Data, and About.

Six MVP preferences are editable globally:

- Default phone region, using the device region when supported and otherwise `GB`
- Capture mode, default Standard with optional Networking
- Default reminder for new Reach Out entries, default No reminder with Tomorrow/7/14/30-day alternatives
- Default “Already contacted” interval, with 2/7/14/30 days and Custom, default 14 days
- Daily Today summary notifications, opt-in and Off by default
- Today summary reminder time, default 12:00 local

The custom Already contacted interval is a whole number of days from 1 through 3650. It preselects a visible choice only; it never creates or changes a FollowUp until the user confirms Already contacted. Notification permission and platform availability remain runtime facts; the selected zero-padded `HH:mm` reminder time is an AppSettings preference.

Today ordering, local-first privacy behavior, versions, and schema information are fixed policies or runtime facts. They are shown transparently but are not styled as configurable controls. Per-Person importance, tags, cadence, communication preference, Reach Out plans, FollowUps, and relationship data never appear in Settings.

The complete option, default, persistence, validation, and flow contract is authoritative in `SETTINGS_SPEC.md`. No setting may alter Relationship Engine ordering, stage, memory cues, search ranking, or duplicate evidence.

## 19. Error model

### User-correctable validation

Show inline beside the relevant field. Preserve values. Explain natural corrections.

### Storage failure

Do not close the flow or show success. Keep data, offer Retry, and avoid partial child records.

### Import/restore failure

Current data remains unchanged. State this clearly. Show actionable file/version issue.

### External handoff failure

Keep the draft, offer Copy or another method, and record nothing.

### Derived-output failure

Do not show an unexplained or stale result. Hide the affected output, show Retry, and keep other profile sections available.

## 20. Privacy and trust

- Local-first; no account or backend in V1.
- No background contacts access.
- vCard import/export only after user action.
- Backup contains sensitive relationship data and is labelled accordingly.
- Memory Facts are editable/archivable; sensitive kinds default out of cues.
- No analytics dashboard or behavior-driven priority.
- No interaction inferred from opening or returning from another app.
- Daily notification copy contains no Person names by default, and notification actions never mutate relationship records.

## 21. Product consistency review

### Kept because it directly supports relationships

- Today and explanations
- People/Search
- Upcoming FollowUps
- Person Profile summary
- Interaction Timeline
- Facts and Notes
- Event-based capture
- Contact methods and affiliations
- vCard import/export
- Backup/restore
- Duplicate warning
- Reach Out intentional action queue
- One opt-in privacy-safe Today summary notification

### Narrowed

- Import contacts is file-based, not provider sync.
- Filters live inside People/Upcoming, not as a destination.
- Events are context, not a tab.
- Stage is a small derived summary, not a health metric.
- Importance is a tie-breaker and edit preference, not a visible score.
- Templates are three simple choices, not a template-management system.
- Templates never add an intermediate step to the direct Today Contact now phone/email handoff.
- Profile shows summaries; full entity lists are secondary.
- Reach Out contexts are lightweight grouping labels, not projects, company accounts, or fellowship-management features.

### Removed from V1

- Dashboard metrics
- Custom relationship rules or Person-level settings
- Direct Google/LinkedIn integrations
- Native contact permissions
- Bulk messaging/editing
- Relationship health scores
- Automatic event/fact inference
- Merge workflow
- Accounts/sync

## 22. Acceptance and precedence

The seven V1 documents form one specification:

- `PRODUCT_SPEC.md` — product behavior and rationale
- `SCREEN_SPECIFICATIONS.md` — visible screens and states
- `USER_FLOWS.md` — end-to-end interactions
- `RELATIONSHIP_ENGINE_SPEC.md` — deterministic outputs and examples
- `NAVIGATION.md` — information architecture and back behavior
- `SETTINGS_SPEC.md` — global options, defaults, status, and deterministic effects
- `VERSION1_SCOPE.md` — included/excluded scope and implementation order

When wording conflicts:

1. `VERSION1_SCOPE.md` decides whether a feature belongs in V1.
2. `RELATIONSHIP_ENGINE_SPEC.md` decides deterministic relationship behavior.
3. `SCREEN_SPECIFICATIONS.md` decides visible screen behavior.
4. `USER_FLOWS.md` decides cross-screen sequence.
5. `NAVIGATION.md` decides route and back behavior.
6. `SETTINGS_SPEC.md` decides global Settings behavior.
7. This document supplies the product rationale and overall contract.

No later package begins against an unaccepted specification change. Completed package baselines remain intact unless the user explicitly reopens them.
