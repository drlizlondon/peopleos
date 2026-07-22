# PeopleOS Version 1 Screen Specifications

## Screen design rules

- Each screen has one question and one dominant action.
- A screen may show information that supports its question; it must not become a dashboard.
- Destructive actions are visually secondary and require confirmation.
- Dates use familiar local formatting. Exact dates remain available even when relative wording is used.
- Engine explanations use recorded facts and never appear as unexplained scores.
- Save failures retain user input.
- Empty states explain the value of the screen and offer one relevant action.
- Future extension points are seams, not V1 controls or placeholders.

## Screen inventory

| ID | Screen | Core question |
| --- | --- | --- |
| S01 | Today | Who should I contact today? |
| S02 | Add Person | Who is this person? |
| S03 | Quick Networking Capture | Who did I just meet? |
| S04 | Batch Event Capture | Who else did I meet here? |
| S05 | Import Contacts | Which contacts should PeopleOS add? |
| S06 | Import Results | What happened during import? |
| S07 | Duplicate Warning | Is this already the same person? |
| S08 | People and Search | Who am I trying to remember? |
| S09 | Filters | Which people should be included? |
| S10 | Person Profile | What matters about this relationship now? |
| S11 | Edit Person | What current person-level details should change? |
| S12 | Contact Methods | How can I contact this person? |
| S13 | Memory Facts | What durable facts should I remember? |
| S14 | Fact Editor | What fact should PeopleOS preserve? |
| S15 | Timeline | What has happened in this relationship? |
| S16 | Interaction Editor | What interaction occurred? |
| S17 | Follow-up Editor | What do I intend to do, and when? |
| S18 | Follow-up Detail | What is the current plan? |
| S19 | Upcoming | What have I planned for later? |
| S20 | Affiliations | Where has this person worked? |
| S21 | Contact Handoff | What should I send or do? |
| S22 | Contact Confirmation | Did contact actually happen? |
| S23 | Event Selector | Which event provides the context? |
| S24 | Settings | What essential app or data choice needs attention? |
| S25 | Export Backup | How do I preserve my data? |
| S26 | Restore Backup | Which backup will replace current data? |
| S27 | Contact Card Preview | What will be added to phone contacts? |
| S28 | Explanation Sheet | Why did PeopleOS show this result? |
| S29 | Reach Out | Who have I deliberately decided to contact? |
| S30 | Reach Out Quick Capture | Who do I want to reach out to? |
| S31 | Reach Out Detail | What is my plan for this person? |
| S32 | Resolve Provisional Person | Is this provisional person someone already in PeopleOS? |

The Add menu, destructive confirmations, person picker, date picker, and short action menus are modal controls, not separate product screens.

## S01 — Today

### Purpose

Answer only “Who should I contact today?” with a calm, finite initial list and an explanation for every person.

### Primary action

The first viable suggested action on the first card: Message on WhatsApp, Email, Make introduction, Call, Arrange meeting, Send update, or Add contact details.

### Secondary actions

- Mark contacted
- Reschedule or Snooze the associated FollowUp
- Skip for today
- Open Person profile
- Open Reach Out plan when the due FollowUp is linked to Reach Out
- Move linked Reach Out plan to Dormant or remove it through overflow
- Expand Why this person?
- Show next five due people when more than five are eligible
- Add person through the global Add action

### Information hierarchy

1. Heading: Today
2. Optional one-line orientation: “People to contact, based on your plans and cadence.”
3. Person cards in engine order
4. Each card:
   - Person name
   - Current organisation/role when available
   - Due state: Due today or Overdue; omitted for cadence/new relationship
   - Primary reason in full sentence
   - One memory cue when available
   - Suggested primary action
   - Compact secondary actions
5. “Show more due people” when applicable

No total relationship counts, charts, streaks, or general activity feed.

### Navigation

Default primary tab. Person name opens Profile. Explanation opens S28. Contact action opens S21. Reschedule/Snooze opens S17 in the relevant mode.

### Possible states

- First launch, no people
- People exist, nobody eligible
- One to five eligible
- More than five eligible
- Card has explicit due FollowUp
- Card is overdue
- Card is New relationship recommendation
- Card is cadence recommendation
- Card has several due FollowUps; one primary plus “Also due” count
- Card is linked to Reach Out and shows its reason/context without a separate priority score
- Person lacks usable contact details
- Refreshing after an action
- Local storage error

### Validation

Every card must contain a Relationship Engine reason and valid active Person. External actions require a usable selected contact method.

A Reach Out card remains a normal explicit FollowUp card. Completing, snoozing, rescheduling, or skipping uses the existing commands; moving to Dormant or removing Reach Out changes the intention record and cancels any linked pending FollowUp in the same confirmed transaction.

### Error handling

- If engine evaluation fails for one person, omit that card and show a non-blocking “One relationship could not be evaluated” notice with Retry; never show an unexplained fallback card.
- Save/action failure leaves the card and user input in place.
- External handoff failure offers Copy and stays on Today.

### Empty state

- No people: “Start with one person you want to remember.” Primary: Add your first person. Secondary: Import vCard.
- People but none due: “Nothing needs your attention today.” Primary: Find someone in People. Secondary: Add follow-up.
- All eligible skipped: “You’ve cleared Today for now.” Action: Undo last skip when available.

### Future extension points

Reliable notifications may deep-link here only after a future product decision. V1 has no notification delivery or placeholder badges; Settings reports the capability as unavailable.

## S02 — Add Person

### Purpose

Create one permanent Person with minimal friction.

This screen creates confirmed People. Incomplete descriptive identities are created through S30 so the user is not forced to pretend a role description is a full name.

### Primary action

Save person.

### Secondary actions

- Add another phone/email
- Add organisation and role
- Add meeting context
- Show more: importance, tags, cadence
- Cancel

### Information hierarchy

1. Name — required, focused
2. Contact method — optional combined starter control allowing Phone or Email
3. Organisation — optional
4. Where met — optional Event selector or plain meeting summary
5. “More details” disclosure:
   - Role
   - Importance
   - Tags
   - Cadence

No Memory Fact editor or interaction history is embedded here.

### Navigation

Full-screen create flow. Successful save opens Person Profile. Duplicate evidence opens S07 before persistence.

### Possible states

- Blank
- Partially entered
- Validating phone/email
- Duplicate candidate found
- Saving
- Saved
- Save failed

### Validation

- Name: required after trimming; maximum 120 characters.
- Phone: natural input accepted; must be possible under selected/default region or saved only after user removes it. Ambiguous input asks for country/region.
- Email: optional; must have plausible local and domain parts; preserve display case but compare canonical form.
- Tags: optional, maximum 10 per person, each maximum 40 characters.
- Cadence: optional, 1–3650 days when custom.

### Error handling

Inline field errors. Storage error retains all entered data. Save is disabled only while actively saving or when Name is empty; optional invalid fields block save with direct correction text.

### Empty state

The blank form is the empty state. Placeholder examples support input without prescribing it.

### Future extension points

Provider import/link may be offered after save, never as required identity.

## S03 — Quick Networking Capture

### Purpose

Capture one newly met person in under 20 seconds while preserving event context.

### Primary action

Save and add another.

### Secondary actions

- Save and finish
- Plan follow-up after save
- Switch to full Add Person
- Add several people
- Cancel

### Information hierarchy

1. Name — required
2. Phone or email — optional
3. Event — recent/current event shown first
4. One-line Remember field — optional
5. Remember as: Note by default; optional Memory Fact kind
6. Suggested follow-up after save, not before

### Navigation

Opened from global Add or People. Add several opens S04. Full details opens S02 with current values preserved.

### Possible states

- No recent Event
- Recent Event preselected from prior batch/capture session
- Duplicate warning
- Saved confirmation
- Repeated-entry mode
- Offline, fully usable

### Validation

Same name/contact rules as S02. Event name maximum 120 characters. Remember line maximum 240 characters in quick capture; longer text redirects to full Note after save.

### Error handling

Failed save retains the current entry and shared event. Previously saved people remain committed.

### Empty state

Blank focused Name field with prompt “Who did you meet?”

### Future extension points

Selected Google Contact import could later enter through Add Person, not this event-speed flow.

## S04 — Batch Event Capture

### Purpose

Add several people from one event without re-entering shared context.

### Primary action

Save current person.

### Secondary actions

- Finish batch
- Edit Event
- Review saved people
- Remove an accidentally saved batch person through their profile/archive flow

### Information hierarchy

1. Sticky Event name/date summary
2. Current compact person form: Name, phone/email, Remember line
3. Save person
4. Saved-this-session list with status: Created, Linked to existing, Skipped
5. Finish batch

### Navigation

Full-screen focused flow. Duplicate opens S07. Finish opens batch summary within the same screen, then returns to People or Event search results.

### Possible states

- Event not yet selected
- Entry ready
- Duplicate review
- Several saved rows
- No saved rows
- Batch summary
- Partial save failure

### Validation

Event and Name required. Contact fields optional but validated when present. A person cannot be saved twice from an accidental double tap.

### Error handling

Failure is row-specific. Keep shared event and unsaved row. Finish is allowed when earlier rows are safely saved.

### Empty state

Before Event selection: “Start with the event everyone shares.” Primary: Choose or create event.

### Future extension points

Event detail may later show the captured cohort; V1 uses search/filter results.

## S05 — Import Contacts

### Purpose

Preview and deliberately import selected contacts from a local vCard file.

### Primary action

Import selected contacts.

### Secondary actions

- Select file
- Select all ready rows
- Review duplicate
- Edit row
- Skip row
- Cancel

### Information hierarchy

1. Privacy/explanation: parsed locally, no contact-book access
2. File selection
3. File summary
4. Rows grouped by Needs review, Ready, Skipped
5. Per-row name, contact summary, organisation, status/reason, selection
6. Import selected

### Navigation

Opened from People or Settings. Duplicate opens S07. Completion opens S06.

### Possible states

- No file
- Parsing
- Valid preview
- Empty file
- Unsupported/malformed file
- Duplicates present
- Validation issues present
- Importing
- Partial row failures

### Validation

Accept supported vCard versions and reasonable file-size limit defined during implementation. A row needs a name. Invalid individual contact methods may be omitted only after the user sees the warning; they are never silently transformed.

### Error handling

Parsing failure changes nothing and names the file problem without exposing code details. Import is transactional per person: a failed person creates no orphan child records. Other selected rows may complete and appear in S06.

### Empty state

“Choose a vCard file exported from your contacts app.” Primary: Choose file. Secondary help explains common export locations without platform-specific guarantees.

### Future extension points

Google Contacts may later be another source selector feeding the same preview behavior.

## S06 — Import Results

### Purpose

Make the outcome of contact import unambiguous.

### Primary action

View imported people.

### Secondary actions

- Review failed rows
- Import another file
- Done

### Information hierarchy

1. Completion statement
2. Counts: Created, Added details to existing, Skipped, Failed
3. Failed items with actionable reason
4. Next actions

### Navigation

Back does not rerun import. View imported people opens People with a temporary import-session filter.

### Possible states

- All successful
- Some skipped
- Partial failure
- Nothing imported

### Validation

Counts must reconcile to reviewed selected rows.

### Error handling

Failed rows can be retried after edit without duplicating successful rows.

### Empty state

If nothing imported: “No people were added.” Explain whether all were skipped, duplicates, or invalid.

### Future extension points

Provider-specific results may use the same structure later.

## S07 — Duplicate Warning

### Purpose

Help the user decide whether a candidate is an existing Person without making the decision automatically.

### Primary action

Open existing person for strong evidence; no default action for weak evidence.

### Secondary actions

- Add new details to existing
- Create separate person
- Return to edit
- Skip import row

### Information hierarchy

1. “Possible duplicate”
2. Candidate being created/imported
3. Each possible existing Person
4. Explicit evidence per match
5. Side-by-side new information preview
6. Actions

### Navigation

Modal sheet above creation/import. Opening existing profile preserves the unsaved candidate until user chooses to abandon or return.

### Possible states

- One strong match
- Several strong matches
- Weak combined match
- Candidate already linked/added during current import

### Validation

“Add details” cannot overwrite an existing canonical contact method or current affiliation without a second field-level choice.

### Error handling

If match data becomes unavailable, return to the creation flow and rerun detection.

### Empty state

Not applicable; sheet appears only with evidence.

### Future extension points

A dedicated merge flow may be added later. V1 does not merge histories.

## S08 — People and Search

### Purpose

Find a Person using whatever context the user remembers.

### Primary action

Open a Person result.

### Secondary actions

- Add person
- Search
- Apply filters
- Clear query/filters
- Import contacts

### Information hierarchy

1. Heading and Add action
2. Persistent search field
3. Active filter chips
4. Results
5. Each result: name, current organisation/role, best recognition cue, match explanation when searching

Provisional People display their descriptive label and a quiet “Identity incomplete” marker. Global People search also matches active, Dormant, and Completed Reach Out reason, notes, and context; Reach Out-specific status filtering remains in S29.

Default no-query order is recently interacted first, then recently added, then alphabetical. It is a directory order, not a priority score.

### Search matching and ranking

Normalize case, surrounding whitespace, punctuation, and diacritics for matching while preserving original display.

Ranking tiers:

1. Exact display name
2. Display name starts with query
3. Other name token/prefix match
4. Exact canonical phone/email match when query resembles contact data
5. Current organisation or role match
6. Event name match
7. Memory Fact match
8. Tag match
9. Free-form Note summary match
10. Past affiliation match
11. Reach Out reason, context, or notes match

Within a tier: active before archived, current affiliation before past, more recent matching fact/note before older, then display name. Results show the highest-ranked matching source. No fuzzy result appears for a one-character query. Typo-tolerant name matching may activate from three characters and must be lower than direct name/token matches.

### Navigation

Primary tab. Result opens Profile. Filter opens S09. Query/filters/scroll restore on Back.

### Possible states

- No people
- Default directory
- Query results
- Filtered results
- No matches
- Archived included
- Index unavailable/rebuilding

### Validation

Query maximum 200 characters. Filter combinations apply conjunctively across different filter types and disjunctively within one type.

### Error handling

Search failure falls back to name-only directory with a clear Retry notice; it must not show stale results as current.

### Empty state

- No people: “Your people will appear here.” Primary: Add person.
- No matches: “No one matches ‘{query}’.” Actions: Clear search, adjust filters, add new person.

### Future extension points

Provider-linked status may become result metadata; it does not change ranking unless explicitly specified later.

## S09 — Filters

### Purpose

Narrow People or Upcoming without creating saved views or configuration work.

### Primary action

Show results.

### Secondary actions

- Clear all
- Cancel

### Information hierarchy

People filters:

- Tags
- Current organisation
- Event
- Relationship stage
- Has due follow-up
- Missing contact details
- Archived status

Upcoming filters:

- Date window
- Person
- Action type

Only values that exist are offered. Search within long filter value lists is allowed.

### Navigation

Modal sheet; returns to originating screen.

### Possible states

- No filters
- One/many filters
- Chosen combination yields no results

### Validation

Archived is a status choice: Active, Archived, or All; it cannot be selected inconsistently.

### Error handling

If filter values cannot load, leave current results unchanged and allow Retry.

### Empty state

“No filter values yet” for unused categories; do not show empty category controls.

### Future extension points

Saved searches are excluded from V1.

## S10 — Person Profile

### Purpose

Answer “What matters about this relationship now?” without making the user traverse the whole history.

### Primary action

Best available suggested action from the Relationship Engine.

### Secondary actions

- Log interaction
- Add follow-up
- Add to Reach Out, or Edit Reach Out plan when current
- Add note or fact
- Edit person
- See full timeline/facts/contact methods/affiliations/follow-ups
- Add to phone contacts
- Archive person

### Information hierarchy

1. **Identity:** name; current role and organisation; preferred contact summary
2. **Action row:** suggested contact action, Log interaction, Add follow-up
3. **Current plan:** Today's reason when eligible; otherwise next pending FollowUp; otherwise omitted
4. **Reach Out:** current status, why, intended action, reminder date, and Add/Edit/Complete/Remove actions when present; otherwise a compact Add to Reach Out action
5. **Relationship summary:** stage plus short explanation, last contact, known-since date
6. **Memory:** one cue, up to three prominent facts, Add memory, See all
7. **Recent timeline:** five newest items, See full timeline
8. **Contact details:** preferred phone/email and communication preference, See all
9. **Affiliation:** current affiliation, See history

Tags and importance are not prominent; they appear under Edit/More because they support retrieval and ordering rather than recognition.

### Navigation

Secondary screen reachable from Today, People, Upcoming, person pickers, and duplicate review. Back preserves origin state.

### Possible states

- Sparse new Person
- Eligible Today
- Future FollowUp
- Multiple due FollowUps
- No contact methods
- No interactions
- No facts
- Archived
- Provisional identity with missing contact details
- Active, Waiting, Snoozed, Overdue, Completed, or Dormant Reach Out history
- Storage/engine partial failure

### Validation

All derived labels must carry explanation source. Archived profile blocks new records until restored.

### Error handling

If one secondary section fails, show a section-level Retry while retaining identity and other sections. Never show stale stage without marking it unavailable.

### Empty state

- No contact methods: “No contact details yet.” Action: Add contact details.
- No memory: “Add one thing you want to remember.” Action: Add memory.
- No timeline beyond creation: “No interactions recorded yet.” Action: Log interaction.
- No FollowUp/cadence: do not add a large empty card; show a small “Plan follow-up” action near action row.

### Future extension points

Provider-link status belongs within Contact details. It does not add profile tabs.

## S11 — Edit Person

### Purpose

Change only person-level preferences and display identity.

### Primary action

Save changes.

### Secondary actions

- Manage contact methods
- Manage affiliations
- Archive person
- Cancel

### Information hierarchy

- Display name
- Importance
- Tags
- Contact cadence
- Links to contact methods and affiliations
- Archive at bottom

### Navigation

Opened from Profile. Child management opens S12/S20 without losing unsaved person changes; if necessary, prompt to save/discard first rather than holding complex nested drafts.

### Possible states

- Editing active Person
- Unsaved changes
- Duplicate name-only similarity, which does not block save
- Archived Person read-only except Restore

### Validation

Same name/tag/cadence rules as Add Person.

### Error handling

Retain edits on failure. Archive failure leaves active state unchanged.

### Empty state

Not applicable.

### Future extension points

No provider account fields belong here.

## S12 — Contact Methods

### Purpose

Manage all current and past ways to contact a Person.

### Primary action

Add contact method.

### Secondary actions

- Edit
- Set preferred
- Archive/remove method
- Copy value

### Information hierarchy

1. Preferred active methods
2. Other active methods
3. Archived methods behind disclosure
4. Add action

Each item shows type, familiar formatted value, optional label, preferred status, and validation state.

### Navigation

Secondary Profile screen. Add/edit uses a sheet.

### Possible states

- No methods
- One phone/email
- Multiple methods
- Invalid legacy/imported method needing attention
- Duplicate warning
- Archived method

### Validation

Canonical phone/email rules. Only one preferred active method per kind. Archiving the preferred method selects no replacement automatically; prompt the user when alternatives exist.

### Error handling

Failed edits retain values. A method used by an open handoff cannot disappear mid-flow; return with an availability error.

### Empty state

“Add a phone number or email when you have one.”

### Future extension points

Provider identities and verified states may appear in a separate Linked accounts section later.

## S13 — Memory Facts

### Purpose

Review durable, searchable facts without mixing them into narrative history.

### Primary action

Add fact.

### Secondary actions

- Edit fact
- Archive fact
- Toggle Show as memory cue through Edit
- Filter by fact kind when more than 10 facts exist

### Information hierarchy

Active facts grouped by kind, with value, related Person when any, cue eligibility, and last updated date. Archived facts are hidden behind a disclosure.

### Navigation

From Profile Memory section. Fact opens S14.

### Possible states

- No facts
- Active facts
- Archived facts
- Related Person archived/missing

### Validation

Only active facts are searchable/surfaceable. Missing related Person falls back to stored readable value.

### Error handling

Fact-level save/archive failure changes nothing and retains edit state.

### Empty state

“Add a fact you’ll want to find later.” Examples: based in Bristol, looking for pilot sites. Primary: Add fact.

### Future extension points

No automatic fact suggestions in V1.

## S14 — Fact Editor

### Purpose

Create or edit one concise durable fact and control whether it may surface as a cue.

### Primary action

Save fact.

### Secondary actions

- Link related Person for Introduced by
- Archive fact when editing
- Cancel

### Information hierarchy

- Kind
- Value
- Related Person when applicable
- Show as memory cue with plain explanation

### Navigation

Modal sheet from Profile or Memory Facts. Save returns to the originating screen with cue/search projections recalculated. Cancel returns without changes.

### Possible states

- New
- Editing
- Default cue on/off by kind
- Related Person selected

### Validation

Kind and trimmed value required. Value maximum 240 characters. Introduced by may use either related Person, readable value, or both. Exact duplicate active fact for same Person/kind/value warns and offers Cancel or Save anyway only when meaningful distinction is explained.

### Error handling

Retain draft on failure.

### Empty state

Blank value with kind-specific example.

### Future extension points

Additional controlled kinds require a product decision, not user-defined schemas.

## S15 — Timeline

### Purpose

Show what happened, automatically, in a trustworthy chronological history.

### Primary action

Log interaction.

### Secondary actions

- Open/edit Interaction
- Open FollowUp detail
- Filter by All, Contact, Notes, Follow-ups, Reach Out
- Jump to year when history is long

### Information hierarchy

Newest first, grouped by month/year. Items show kind, date, concise summary, Event/related Person, and whether it counted as contact when useful. Reach Out lifecycle items show intention added, completed, reactivated, moved to Dormant, or removed without masquerading as contact. Person Created is the oldest item.

### Navigation

From Profile. Interaction opens S16; FollowUp lifecycle item opens S18.

### Possible states

- Creation only
- Mixed history
- Filtered history
- Item edited/deleted and order changes

### Validation

Stable ordering for equal timestamps. Derived lifecycle entries cannot be edited as free interactions.

### Error handling

Loading failure shows Retry without fabricating items.

### Empty state

Creation-only state: “No interactions recorded yet.” Primary: Log interaction.

### Future extension points

Attachments and audit history are excluded from V1.

## S16 — Interaction Editor

### Purpose

Record or correct one relationship event.

### Primary action

Save interaction.

### Secondary actions

- Choose/create Event
- Select related Person
- Delete existing interaction
- Cancel

### Information hierarchy

- Interaction kind
- Date/time
- Summary
- Event when relevant
- Related Person for introductions
- Plain statement: “This will/will not count as contact”

### Navigation

Sheet from Profile/Today/Add or full screen when editing a long summary.

### Possible states

- New quick interaction
- Editing existing
- Contact-counting kind
- Context-only kind
- Suggested FollowUp after save

### Validation

Kind/date required. Future dates are allowed only up to current day for interactions; future plans belong in FollowUp. Summary maximum 5,000 characters. Introduction kind asks for related Person or summary context but does not require another saved Person.

### Error handling

Retain draft. Delete requires confirmation naming the derived effects that may change.

### Empty state

Not applicable.

### Future extension points

No attachments or automatic message capture.

## S17 — Follow-up Editor

### Purpose

Create, reschedule, or snooze one explicit future plan.

### Primary action

Save follow-up or Confirm snooze/reschedule according to mode.

### Secondary actions

- Use suggested date
- Pick date
- Cancel

### Information hierarchy

Create/reschedule:

- Reason
- Action type
- Date
- Engine suggestion with explanation when available

Snooze:

- Current reason and original date
- Tomorrow, Next week, In one month, Pick date
- Explanation that original date remains in history

### Navigation

Modal sheet from Today/Profile/Upcoming or person picker flow.

### Possible states

- New, no suggestion
- New, suggested date
- Reschedule
- Snooze
- Existing future FollowUp warning
- Invalid past date

### Validation

Reason and date required. New/rescheduled date must be today or future. Snooze date must be after current effective date. Reason maximum 240 characters.

### Error handling

Failure leaves current FollowUp untouched and retains new values.

### Empty state

Blank reason with action examples, but no generic prefilled promise.

### Future extension points

Time-of-day reminders and notifications are excluded.

## S18 — Follow-up Detail

### Purpose

Show the current plan, its history, and available state transitions.

### Primary action

Complete follow-up.

### Secondary actions

- Contact Person using suggested action
- Snooze
- Reschedule
- Cancel
- Open Person

### Information hierarchy

- Person
- Status and effective date
- Reason/action
- Original date if snoozed/rescheduled lineage exists
- Created date
- Lifecycle history
- Actions

### Navigation

From Upcoming, Profile, or Timeline.

### Possible states

- Future pending
- Due today
- Overdue
- Snoozed pending
- Completed with contact
- Completed without contact
- Cancelled
- Superseded

### Validation

Only valid actions for current status appear. Completed/cancelled/superseded records are read-only.

### Error handling

Transition failure retains prior status and keeps detail open.

### Empty state

Not applicable.

### Future extension points

No collaborators, assignees, or attachments in V1.

## S19 — Upcoming

### Purpose

Answer “What have I planned for later?” without duplicating Today.

### Primary action

Open the next FollowUp.

### Secondary actions

- Add follow-up
- Filter
- Open Person
- Reschedule/complete/cancel from row menu
- View due items in Today

### Information hierarchy

1. Heading and Add
2. Optional “Due items are in Today” link when applicable
3. Filters
4. FollowUps after today, grouped by month and ordered by date, then importance, then name
5. Row: date, Person, reason, action type

### Navigation

Primary tab. Row opens S18. Person opens S10.

### Possible states

- No future FollowUps
- Grouped follow-ups
- Filtered
- No filtered matches
- Today items exist

### Validation

Only active Persons and pending future-effective FollowUps appear.

### Error handling

Load failure shows Retry; no stale list without notice.

### Empty state

“Nothing planned yet.” Primary: Add follow-up. Secondary: Find a person.

### Future extension points

Calendar export is excluded from V1.

## S20 — Affiliations

### Purpose

Preserve current and past organisation/role context.

### Primary action

Add affiliation.

### Secondary actions

- Edit
- Mark current/end affiliation
- Archive incorrect affiliation

### Information hierarchy

Current first, then past newest-ended first. Each shows organisation, role, and known dates.

### Navigation

From Profile or Edit Person. Add/edit uses a sheet.

### Possible states

- None
- Current only
- Current and past
- Several current affiliations

### Validation

Organisation required. Start cannot be after end. Several current affiliations are allowed; the user is not forced into one employer.

### Error handling

Retain draft on failure.

### Empty state

“Add an organisation when it helps you remember their context.”

### Future extension points

An Organisation entity is not implied by this screen.

## S21 — Contact Handoff

### Purpose

Prepare a deliberate message or action while keeping the user in control.

### Primary action

Open WhatsApp or Open email app.

### Secondary actions

- Choose contact method
- Choose Networking, Coffee, or Custom template
- Edit message/subject
- Copy message
- Cancel

### Information hierarchy

- Person and selected method
- Template choice
- Fully editable draft
- External-open action
- Safety note: “PeopleOS will open the app; you choose whether to send.”

### Navigation

Sheet from Today/Profile/FollowUp. External app return triggers S22.

### Possible states

- One/multiple methods
- No usable method
- Template selected
- Custom draft
- External app unavailable
- Draft copied

### Validation

Selected method must be active and valid. Draft may be empty only after explicit confirmation; PeopleOS does not require a canned message.

### Error handling

Keep draft and offer Copy. Never record an Interaction here.

### Empty state

No usable method: explain and offer Add contact details or Copy custom text.

### Future extension points

Other handoff channels may reuse this pattern after product approval.

## S22 — Contact Confirmation

### Purpose

Record reality after an external handoff without assuming it.

### Primary action

Yes, record contact.

### Secondary actions

- No
- Record another interaction
- Adjust date/type before save

### Information hierarchy

- “Did you contact {name}?”
- Expected interaction type and current time
- Due FollowUp fulfilled, when unambiguous
- Actions

### Navigation

Return sheet after external app. Save returns to recalculated origin.

### Possible states

- One matching FollowUp
- Several due FollowUps requiring selection
- No FollowUp
- User says No

### Validation

At most the explicitly selected FollowUp is completed. Contact date cannot be in the future.

### Error handling

Failure keeps confirmation open. Saying No records nothing.

### Empty state

Not applicable.

### Future extension points

No delivery/read receipt integration planned.

## S23 — Event Selector

### Purpose

Reuse or create explicit event context quickly.

### Primary action

Select event.

### Secondary actions

- Create event
- Clear event
- Search

### Information hierarchy

- Recent events
- Search results
- Create exact entered name
- Event date/location on disambiguation

### Navigation

Modal from capture/interaction. Selection returns to caller.

### Possible states

- Recent events
- Exact name match
- No match
- Same names on different dates

### Validation

Event name required, maximum 120 characters. Exact normalised name and same date warns before duplicate Event creation. No fuzzy automatic assignment.

### Error handling

Failure retains caller state and entered event text.

### Empty state

“No events yet.” Primary: Create this event.

### Future extension points

Event detail is deferred.

## S24 — Settings

### Purpose

Expose global application preferences, capability status, data actions, and app information without moving Person-level choices into Settings.

### Primary action

None. Settings is a grouped index; each editable row or data action has its own explicit action.

### Secondary actions

- Change Default phone region
- Change Capture mode
- Change Default Reach Out reminder
- Open How Today works
- Import contacts
- Export backup
- Restore backup
- Open privacy explanation
- Open About PeopleOS

### Information hierarchy

1. General: Default phone region; device timezone and locale status
2. Modes: Capture mode
3. Today: fixed ordering and pagination policy
4. Reach Out: default reminder for new entries
5. Interactions: fixed confirmation and date behavior
6. Notifications: unavailable in V1
7. Privacy & Security: local storage and network/security boundary
8. Data: Import, Export, Restore, last successful backup
9. About: app version, schema version, product explanation, licences

Only Default phone region, Capture mode, and Default Reach Out reminder are editable V1 preferences. Today, Interactions, Notifications, Privacy & Security, and About rows accurately disclose fixed behavior; they are not disabled controls. Full contracts are in `SETTINGS_SPEC.md`.

### Navigation

Primary tab. Preference rows open focused selection sheets and return to the same Settings scroll position. Export/Restore/Import open their existing full screens. How Today works opens the explanation reference. Browser/device Back closes a sheet before leaving Settings.

### Possible states

- Defaults created on first launch
- One or more preferences changed
- No backup generated yet
- Last successful backup available
- Notifications unavailable
- Storage unavailable
- Preference save in progress or failed

### Validation

Default region must be supported. Capture mode is Standard or Networking. Reach Out reminder is No reminder, Tomorrow, or exactly 7, 14, or 30 calendar days. Changing phone region never rewrites canonical stored numbers. No editable row may read or write Person-specific state.

### Error handling

Settings save failure retains the prior value, keeps the selection sheet open, and offers Retry. A stale revision reports that Settings changed elsewhere and offers Reload without overwriting the newer value. Failure to read runtime status shows “Unavailable” only for that row; other sections remain usable.

### Empty state

Not applicable. The nine sections and their fixed status rows always exist, even before any People or backup has been created.

### Future extension points

Account/sync, notification delivery, app lock, theme, or additional global preferences require a separate product decision. Person-level choices never move here.

## S25 — Export Backup

### Purpose

Let the user preserve all PeopleOS data knowingly.

### Primary action

Create backup.

### Secondary actions

- Cancel

### Information hierarchy

- What is included
- Privacy warning
- Current data summary counts
- Create backup

### Navigation

From Settings. Device/browser save handling follows creation.

### Possible states

- Ready
- Generating
- Generated/handoff complete
- Failed

### Validation

Export must pass schema validation before generation.

### Error handling

Failure creates no corrupt download and offers Retry.

### Empty state

When no people exist, backup remains available and explains that settings/empty schema will be saved.

### Future extension points

Encrypted/cloud backups are excluded.

## S26 — Restore Backup

### Purpose

Validate and preview a full local-data replacement before it occurs.

### Primary action

Replace current data.

### Secondary actions

- Choose file
- Export current data first
- Cancel

### Information hierarchy

- Destructive replacement explanation
- File chooser
- Validation result
- Backup version/date and entity counts
- Compatibility/migration note
- Replace action

### Navigation

From Settings. Success returns to Today with restored data.

### Possible states

- No file
- Validating
- Valid compatible backup
- Valid migratable older backup
- Unsupported future version
- Invalid/corrupt backup
- Restoring
- Success/failure

### Validation

Referential integrity and supported schema required. Current data is untouched until final confirmation and successful atomic replacement.

### Error handling

Any failure retains current data. Failure message says this explicitly.

### Empty state

“Choose a PeopleOS backup file.”

### Future extension points

Merge restore is excluded.

## S27 — Contact Card Preview

### Purpose

Show exactly what will be offered to the device contact app.

### Primary action

Download/Open contact card.

### Secondary actions

- Choose included contact methods
- Cancel

### Information hierarchy

- Name
- Selected active phones/emails
- Current affiliation(s)
- Optional concise public-safe note chosen by user; Memory Facts are off by default
- Confirmation statement

### Navigation

From Profile More menu.

### Possible states

- Complete identity
- Name only
- Several methods
- No methods

### Validation

At least name required. Only active selected data included. Private notes/facts never included by default.

### Error handling

Generation failure stays on preview and offers Retry.

### Empty state

Name-only card is permitted with a note that no contact details are included.

### Future extension points

A native contacts adapter may replace the download handoff while preserving preview and confirmation.

## S28 — Explanation Sheet

### Purpose

Make a recommendation, stage, cue, or suggested date understandable.

### Primary action

Done.

### Secondary actions

- Open source FollowUp, Interaction, Fact, or Event when relevant
- Edit cadence/fact when that is the source

### Information hierarchy

1. Plain-language conclusion
2. Rule applied
3. Source facts with dates/values
4. Relevant source links

Examples:

- “Sarah appears today because you planned to send her the pilot update on 14 August.”
- “Established because you recorded 7 conversations across 11 months.”
- “Looking for pilot sites comes from a memory fact you added on 12 July.”

### Navigation

Modal sheet from Today/Profile. Source link may open the relevant detail and close the sheet.

### Possible states

- Today reason
- Relationship stage
- Memory cue
- Suggested action
- Suggested reminder date

### Validation

Every displayed fact must reference current stored or derived input. If a source was deleted, recalculate before display rather than showing broken evidence.

### Error handling

If explanation cannot be built, do not show the derived output elsewhere. Offer Retry.

### Empty state

Not applicable; explanations exist only for outputs with evidence.

### Future extension points

Localisation may change prose, not rule meaning.

## S29 — Reach Out

### Purpose

Show the curated queue of people the user has intentionally decided to contact, reconnect with, or build a relationship with.

### Primary action

Add someone.

### Secondary actions

- Open Reach Out detail
- Contact now
- Snooze or Reschedule the linked FollowUp
- Complete outreach
- Skip for today when due
- Move to Dormant
- Remove from Reach Out
- Search and filter
- Open Person profile

### Information hierarchy

1. Heading: Reach Out
2. Search field
3. Filter chips: Active, Due, Overdue, Upcoming, Waiting, Snoozed, Dormant, Completed
4. Optional context filter/group such as Fellowship
5. Default active queue ordered by display state and relevant date
6. Each item:
   - Person name or provisional label
   - “Identity incomplete” when provisional
   - Role/organisation when known
   - Why the user wants to reach out, or “Add why”
   - Intended action, or “Choose next action”
   - Reminder/effective date when present
   - Display status
   - Context label when present

Default order is Overdue oldest first, due today, Active without date newest-added first, Waiting/Snoozed by effective date, then stable display label and ID. Completed and Dormant are hidden from the default active view and appear through filters.

### Navigation

Second primary tab after Today. Item opens S31. Person identity opens S10. Add opens S30. Due contact action may open S21. Filter is a modal sheet scoped to Reach Out.

### Possible states

- No Reach Out entries
- Active entries with and without complete plans
- Due and Overdue
- Waiting and Snoozed
- Dormant filter
- Completed history filter
- Provisional People
- Search results/no matches
- Context-filtered Fellowship example
- Local storage/query error

### Validation

Each visible entry references an existing non-merged Person. Display status must be derived from the durable intent state plus linked FollowUp. A linked FollowUp must reference the same Person and ReachOutEntry.

### Error handling

Query failure shows Retry without falling back to a generic People list. Failed status or FollowUp actions leave the item unchanged and retain entered data. A missing linked FollowUp downgrades the item to Active and shows a repair notice rather than inventing a date.

### Empty state

Display exactly:

> **People you mean to contact**
>
> Keep a deliberate list of people you want to contact, reconnect with or build a relationship with.
>
> You can even add someone if all you remember is where you met them.

Primary action: **Add someone**.

### Future extension points

Additional context types may be added only when they improve retrieval. No pipeline stages, owners, opportunity values, bulk outreach, or analytics belong here.

## S30 — Reach Out Quick Capture

### Purpose

Create a Reach Out intention in seconds for an existing, new confirmed, or provisional Person.

### Primary action

Add to Reach Out.

### Secondary actions

- Select existing Person
- Create provisional Person from entered label
- Add why
- Choose next action
- Choose reminder date
- Add context/notes
- Cancel

### Information hierarchy

1. **Person or description** — required; searches existing People as the user types
2. Existing-Person matches with role/organisation/cue
3. When no match is chosen: “Use ‘{label}’ as a temporary description”
4. Optional Why I want to reach out
5. Optional intended next action
6. Optional reminder shortcuts: Today, Tomorrow, Next week, In one month, Pick date; initially pre-filled from the global Reach Out default and always visible/editable
7. Optional context: recent contexts first, or create project/organisation/Event/fellowship/other label
8. Optional notes

The example “Aaron, hackathon, interested in NHS AI, contact next week” is supported through these fast fields and date shortcuts. V1 does not parse a free-form sentence with AI or silently infer fields.

### Navigation

Modal/full-height sheet from Reach Out, global Add, or Person Profile. Selecting an existing Person keeps the flow in place. Successful save opens S31 or returns to Reach Out with the new item focused.

### Possible states

- Blank
- Existing Person selected
- Existing current Reach Out entry found
- New provisional label
- Duplicate provisional candidates
- Reminder selected/not selected
- Global reminder default pre-filled, changed, or cleared in this draft
- Saving/saved/save failed

### Validation

An existing Person or trimmed temporary label is required. Temporary label maximum 120 characters. Reason maximum 240 characters. Notes maximum 5,000 characters. A new FollowUp is created only when a reminder date is selected; if action is absent its action type is `other` until the user edits the plan. The global reminder default only pre-fills a new draft and never bypasses this visible confirmation. If the Person already has a current Reach Out entry, primary action becomes Open/Edit existing; a second current entry cannot be created.

### Error handling

Person/ReachOutEntry/optional FollowUp/context creation is one transaction. Failure saves nothing and retains the draft. Duplicate candidates show explicit evidence; no automatic merge occurs.

### Empty state

Blank focused Person or description field with examples: “Simon,” “Hackathon organiser,” “A potential mentor.”

### Future extension points

No provider lookup, Google Contacts search, LinkedIn discovery, or AI enrichment in V1.

## S31 — Reach Out Detail

### Purpose

Show and manage the user's deliberate outreach plan and its history for one Person.

### Primary action

Contact now when an actionable contact method exists; otherwise Edit plan.

### Secondary actions

- Edit reason, action, notes, and context
- Add, Snooze, or Reschedule reminder through FollowUp
- Mark outreach complete
- Skip for today when due
- Move to Dormant or Reactivate
- Remove from Reach Out
- Open Person profile
- Resolve provisional identity

### Information hierarchy

1. Person/provisional label and identity status
2. Current Reach Out display status
3. Why I want to reach out
4. Intended next action
5. Linked FollowUp and effective date, when present
6. Context labels
7. Notes
8. Date added and latest completion
9. Reach Out history
10. Actions

### Navigation

From S29, Person Profile, Today, or FollowUp detail. FollowUp actions use S17/S18. Contact uses S21/S22. Resolve identity opens S32. Back preserves Reach Out query/filter/scroll.

### Possible states

- Active with no date
- Active due today
- Waiting
- Snoozed
- Overdue
- Completed
- Dormant
- Removed/read-only through history
- Provisional identity
- Missing reason/action/contact details

### Validation

Reason/action remain optional for quick-captured entries but edits validate their length and enum. Completing requires confirmation; interaction is optional. Moving Dormant or removing with a pending FollowUp requires one confirmation and cancels that FollowUp atomically. Reactivating Dormant returns to Active and does not create a FollowUp automatically.

### Error handling

Compound completion, next-FollowUp, Dormant, removal, and identity-resolution actions are transactional and idempotent. Failures retain the prior state and draft. Broken references show a repair message and never create a duplicate Person.

### Empty state

For incomplete plan: “Finish the plan when you’re ready.” Actions: Add why, Choose next action, Add reminder. The Detail screen itself always has a ReachOutEntry.

### Future extension points

No pipeline stage, owner, value, probability, or organisation account view.

## S32 — Resolve Provisional Person

### Purpose

Complete an incomplete identity or explicitly link it to an existing confirmed Person without duplicating people.

### Primary action

Save completed identity, or Link to selected Person after preview.

### Secondary actions

- Edit display name
- Add contact methods/affiliation
- Search existing People
- Cancel

### Information hierarchy

1. Current provisional label and Reach Out context
2. Choice: Complete this Person / Link to existing Person
3. For completion: confirmed name and optional details
4. For link: candidate People and deterministic duplicate evidence
5. Preview of Reach Out, FollowUps, Interactions, Facts, contact methods, affiliations, and contexts that will remain or move
6. Explicit confirmation

### Navigation

Full screen from provisional Person Profile or S31. Success opens the surviving Person Profile and preserves Reach Out origin for Back.

### Possible states

- Complete in place
- One/multiple existing candidates
- Conflicting contact methods/affiliations
- Linked successfully
- Stale candidate or transaction failure

### Validation

Completion requires a confirmed display name. Link requires one existing confirmed Person. Conflicting fields are never overwritten automatically. The provisional Person is marked merged only after all selected child references move successfully. A merged Person cannot be selected as a target.

### Error handling

Resolution is atomic and idempotent. Any failure leaves both People and every child reference unchanged. A stale target requires reload and renewed confirmation.

### Empty state

If no existing Person matches, show “No existing person found” and keep Complete this Person as the primary path.

### Future extension points

This narrow provisional-resolution flow does not become a general duplicate merge tool without a separate product decision.

## Cross-screen transient states

### Loading

Use skeletons only where stored content is expected. Do not block the whole shell for a secondary section. Avoid spinners that replace saved content during a quick recalculation.

### Save success

Show a brief non-modal confirmation with Undo only when reversal is safe: Skip today, archive fact/contact method, or archive Person. Do not use Undo for restore or import.

### Offline

Do not show a persistent alarming banner because local features work offline. Show offline context only when an external action cannot work or when explaining local-first status.

### Destructive confirmation

Confirm archive Person, delete Interaction, cancel FollowUp, replace data, and discard unsaved changes. State the specific effect, not “Are you sure?” alone.

### Permission

V1 requests no contacts permission. File and external-app choosers are user-initiated platform actions.
