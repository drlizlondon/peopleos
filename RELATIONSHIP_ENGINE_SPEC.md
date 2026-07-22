# PeopleOS Version 1 Relationship Engine Specification

## Purpose

The Relationship Engine converts recorded relationship facts and user intentions into explainable product behavior. It decides whether a person belongs on Today and derives supporting context. It never sends, saves, completes, reschedules, or edits anything.

Every result must answer:

1. What is being suggested or derived?
2. Which recorded facts caused it?
3. Which deterministic rule was applied?

The UI may shorten or format an explanation, but may not replace it with an unexplained label or score.

Global AppSettings is not an engine input. Default phone region, Capture mode, and the Reach Out draft reminder default affect parsing or draft entry only. They cannot change eligibility, ordering, stage, explanations, cues, suggested actions, or suggested dates. The Today section in Settings explains the fixed policy but exposes no weights or switches.

## Shared definitions

### Today

“Today” is the calendar day in the user's configured device timezone. A follow-up due at any time on or before the current local date is eligible. V1 follow-ups are date-based, not time-of-day appointments.

### Contact interaction

Counts as direct contact:

- Met
- WhatsApp message
- Email
- Phone call
- Coffee
- Meeting
- Conference
- Introduction received

Does not count as direct contact:

- Introduction made
- Note added
- Follow-up completed
- Person created

### Relationship start

The earliest contact interaction date. If none exists, Person creation date is used and the explanation states that it is an estimate based on when the person was added.

### Last contact

The most recent contact interaction date. Follow-up completion alone never changes it.

### Active person

A Person without an archive date. Archived people never appear on Today or Upcoming and do not receive suggestions.

### Reach Out intention

A current ReachOutEntry is an explicit outreach intention for a Person. It does not independently make the Person eligible for Today. Only its linked FollowUp can do that.

## Output 1 — Today eligibility

### Inputs

- Active Person
- Pending FollowUps
- Contact cadence
- Contact interactions
- Relationship start
- Current local date
- One-day skip state
- Current ReachOutEntry and linked FollowUp, when any

### Rules

A person is eligible when the first matching rule below applies:

1. At least one pending FollowUp is due today or earlier and is not snoozed to a future date.
2. The person has exactly one contact interaction, that interaction occurred at least 7 calendar days ago, and there is no later completed or cancelled first follow-up. This is the New relationship rule.
3. The person has a cadence, has at least one contact interaction, and calendar days since last contact are greater than or equal to cadence days.

A person skipped for today is ineligible until the next local calendar day. A future pending FollowUp suppresses the New relationship and cadence rules until it becomes due. This prevents the engine recommending contact earlier than the user's explicit plan.

If several FollowUps for one person are due, the person appears once using the earliest due FollowUp as the primary reason. Other due FollowUps are disclosed as “Also due” on the profile, not as extra Today cards.

### Explanation

- Follow-up: “You planned to {reason} on {date}.”
- Reach Out Follow-up: the same FollowUp explanation, optionally followed by “You added this person to Reach Out because {reason}.”
- New relationship: “You met {7+ days} ago and have not recorded a follow-up yet.” If an Event exists: “You met at {event} {days} days ago and have not recorded a follow-up yet.”
- Cadence: “You usually reconnect every {cadence} days. Your last recorded contact was {elapsed} days ago.”

Never show only “Recommended,” “High priority,” or a numeric score.

### Examples

- Sarah has a pending follow-up dated 14 August with reason “Reconnect after the NHS AI Fellowship.” On 14 August: eligible. Explanation: “You planned to reconnect after the NHS AI Fellowship today.”
- Dev has a 90-day cadence and last contact 97 days ago: eligible. Explanation names both 90 and 97 days.
- Mo has a follow-up in five days and cadence became due today: not eligible until the explicit follow-up date.
- Asha was met eight days ago and has no follow-up or later contact: eligible under New relationship.

## Output 2 — Today ordering

### Inputs

- Eligible people and their eligibility reason
- Earliest relevant due date
- Person importance
- Person display name and ID

### Rules

Order by:

1. Explicit overdue FollowUp
2. Explicit FollowUp due today
3. New relationship rule
4. Cadence due

Within explicit overdue FollowUps, older due date first. Within all other bands, high importance first, then relevant date oldest first, then display name alphabetically, then Person ID for stability.

Importance never moves a cadence item ahead of an explicit FollowUp and never creates eligibility.

Reach Out does not add a priority band or tie-breaker. A linked Reach Out FollowUp sorts exactly like any other explicit FollowUp.

### Explanation

Ordering is not normally narrated. If the user opens “Why this order?”, show: “People with plans already due appear first. Then new relationships, then recurring check-ins. Importance only orders people within the same group.”

## Output 3 — Overdue follow-up

### Inputs

- Pending FollowUp effective date
- Current local date

### Rules

- Due today: due date equals today.
- Overdue: due date is before today.
- Future: due date is after today.
- Snoozed: effective date is the snooze date; original date remains visible in history.

### Explanation

- Due today: “Planned for today.”
- Overdue: “Planned for {date}.” The card may show “Overdue” as a small factual status, but never escalating language, red debt counts, or “You are X days late.”
- Snoozed: “Snoozed until {date}; originally planned for {original date}.”

## Output 4 — Suggested next action

### Inputs

- Primary Today reason
- FollowUp reason and action type, if explicitly selected
- Preferred contact method
- Available validated contact methods
- Communication preference Memory Fact eligible for cues

### Rules

1. An explicit FollowUp action wins: Make introduction, Send update, Arrange meeting, Message, Call, Email, or Other.
2. Otherwise use an explicit communication preference if a matching contact method exists.
3. Otherwise prefer WhatsApp when a valid phone is present.
4. Otherwise prefer Email when an email is present.
5. Otherwise suggest “Add contact details.”

The engine never interprets arbitrary note text to guess an action.

### Explanation

- “Suggested because this follow-up is to introduce them to Sarah.”
- “Suggested because you recorded that they prefer email.”
- “Suggested because WhatsApp is their preferred available contact method.”
- “No contact method is available yet.”

### Examples

- FollowUp action is Make introduction: primary action is “Make introduction,” even when WhatsApp exists.
- Fact says Prefers email but no email is stored: fallback to WhatsApp and explain that the preferred method is unavailable only inside expanded details.

## Output 5 — Relationship stage

### Inputs

- Contact interaction count
- Earliest contact interaction date
- Latest contact interaction date
- Person creation date when no contact exists
- Current local date

### Rules

Evaluate in this order:

1. **Long-term:** at least 5 contact interactions and at least 730 calendar days between earliest and latest contact.
2. **Established:** at least 5 contact interactions and at least 180 calendar days between earliest and latest contact.
3. **Growing:** at least 2 contact interactions and at least 30 calendar days between earliest and latest contact.
4. **New:** all other cases.

Current inactivity does not demote a stage. Notes, completed follow-ups, and created date do not increase contact count.

### Explanation

- New: “New · 1 recorded conversation since you met in July.”
- Growing: “Growing · 3 recorded conversations across 4 months.”
- Established: “Established · 7 recorded conversations across 11 months.”
- Long-term: “Long-term · 12 recorded conversations across 3 years.”

When no contact exists: “New · based on when you added this person; no contact recorded yet.”

The compact profile shows only stage and a short explanation. Full rule detail is available from “Why this stage?”

## Output 6 — Memory cue

### Inputs

- Pending due FollowUps
- Active Memory Facts with `Show as memory cue` enabled
- Event-linked first contact
- Current OrganisationAffiliation

### Rules

Choose exactly one cue using this order:

1. A due FollowUp commitment, displayed as an action cue
2. Communication preference fact
3. Seeking fact
4. Interest fact
5. Introduced by fact
6. Location fact
7. Explicit Event of earliest Met/Conference interaction
8. Current organisation and role

Within the same fact kind, most recently updated active fact wins. Family and Other facts never surface unless the user explicitly enabled `Show as memory cue`. Free-form notes never become compact cues in V1.

### Explanation

Every cue exposes its source on request:

- “Looking for pilot sites” — “From a memory fact you added on 12 July.”
- “Met at HealthTech Fellowship” — “From your first recorded meeting.”
- “Introduced by James” — “From a memory fact linked to James.”

If no eligible source exists, return no cue. Do not invent generic context.

## Output 7 — Suggested reminder date

### Inputs

- Triggering interaction kind and date
- Event context
- Relevant tag or explicit relationship context
- Person cadence
- Existing future FollowUp

### Rules

No suggestion is returned when a future pending FollowUp already exists.

Otherwise:

1. Met or Conference interaction linked to an Event: suggest 7 calendar days later.
2. Introduction received: suggest 30 calendar days later.
3. A completed contact with a cadence: suggest last contact date plus cadence days.
4. No matching rule: no suggestion.

Mentor and Investor labels do not silently create reminders in V1. A user may set a 90-day cadence for a mentor or create a dated funding-update FollowUp. This avoids guessing from tags.

### Explanation

- “Suggested for 19 July: 7 days after you met at HealthTech Fellowship.”
- “Suggested for 30 August: 30 days after your introduction.”
- “Suggested for 4 October: your 90-day contact cadence.”

Suggested dates are not saved until the user accepts or edits them.

## Output 8 — Relationship age

### Inputs

- Earliest contact interaction
- Person creation date fallback
- Current local date

### Rules

Return the earliest contact date and a human-readable duration. If using creation date, mark the result estimated. Relationship age is informational and does not independently make someone eligible for Today.

### Explanation

- “Known for about 14 months · first met 3 May 2025.”
- “Added 12 days ago · no meeting recorded yet.”

## Output 9 — Last contact

### Inputs

- Contact interactions

### Rules

Return the newest contact interaction. If none, return no last-contact date. Interaction edits or deletion recalculate the result immediately.

### Explanation

- “Last contact: Coffee on 8 July.”
- “No contact recorded yet.”

## Output 10 — Search context cue

Search ranking is defined in `SCREEN_SPECIFICATIONS.md`, but the engine supplies a deterministic recognition cue for each Person result using the same Memory Cue rules, excluding due FollowUps. Search should not display private action commitments as identity context.

## Output 11 — Reach Out display state

### Inputs

- ReachOutEntry durable intention state
- Removed state
- Linked pending FollowUp, if any
- FollowUp effective date and snooze state
- Current local date

### Rules

Evaluate in this order:

1. Removed entries are excluded from Reach Out results.
2. Durable Completed returns Completed.
3. Durable Dormant returns Dormant.
4. Active with pending FollowUp effective before today returns Overdue.
5. Active with pending FollowUp snoozed to a future date returns Snoozed.
6. Active with pending FollowUp due after today returns Waiting.
7. Active otherwise returns Active, including due today and no reminder.

“Due” and “Upcoming” are filter predicates, not extra stored statuses. Due means effective date equals today. Upcoming means pending effective date after today.

### Explanation

- Active: “In Reach Out because you chose to contact this person.”
- Waiting: “Planned for {date}.”
- Snoozed: “Snoozed until {date}; originally planned for {original date}.”
- Overdue: “Planned for {date}.”
- Completed: “Outreach completed on {date}.”
- Dormant: “Kept for later with no active plan.”

### Examples

- “Hackathon organiser” with no reminder is Active and does not appear in Today.
- Aaron with a FollowUp next week is Waiting and appears in Upcoming.
- Simon with a FollowUp due today is Active, matches the Due filter, and appears in Today once.
- Chief Information Officer at Watford with a past-due linked FollowUp is Overdue.

## Behavior after user actions

### Contact recorded

After the user confirms an interaction:

- The interaction is added.
- Any FollowUp explicitly selected as fulfilled is completed.
- Last contact, stage, cadence eligibility, memory cue, and suggested reminder are recalculated.
- The person normally leaves Today unless another due FollowUp remains.
- If another due FollowUp remains, the same person can remain with the next reason after the completion confirmation closes.
- When the completed FollowUp is linked to Reach Out, outreach completion follows UF-34: record the completion event and either mark the entry Completed or keep it active with the explicitly accepted next FollowUp.

### Follow-up rescheduled or snoozed

The current effective date changes through the documented FollowUp transition. Today recalculates immediately and removes the person unless another rule remains eligible. A future explicit FollowUp suppresses cadence and New relationship recommendations.

### Skip once

The person disappears from Today for the remainder of the local day. No interaction or FollowUp state changes. They may return tomorrow if still eligible.

### Follow-up cancelled

The FollowUp no longer creates eligibility. The engine then evaluates New relationship or cadence rules; cancellation does not automatically silence those independent reasons.

## Prohibited behavior

- No hidden numerical relationship score
- No priority derived from opening the app or viewing a profile
- No inference from arbitrary note prose
- No stage edited by the user
- No “days late” debt counter
- No contact assumed from opening WhatsApp or email
- No recommendation for archived people
- No Today eligibility merely because a Person is in Reach Out
- No automatic persistence of suggested reminders
- No random ordering

## Required acceptance examples

Before V1 completion, behavior tests must cover:

- Today, overdue, future, snoozed, skipped, cancelled, and completed FollowUps
- Multiple due FollowUps for one Person
- Future FollowUp suppressing cadence
- Importance tie-breaking without creating eligibility
- Every interaction kind's contact semantics
- Stage boundaries at 1/2/5 contacts and 29/30/179/180/729/730 days
- Memory cue ordering and sensitive-fact defaults
- Preferred method present and unavailable
- Event, introduction, cadence, and no-suggestion reminder cases
- Timezone boundary immediately before and after local midnight
- Archived Person exclusion
- Reach Out display-state boundaries and filters
- Reach Out FollowUp using the normal explicit-FollowUp band without duplicate cards or priority boost
- Completed outreach with and without a next FollowUp
