# PeopleOS Version 1 User Flows

## Flow conventions

- Every save is explicit.
- External handoff is never treated as completed contact.
- Duplicate warnings interrupt creation before persistence but never prevent deliberate creation.
- When a flow recalculates relationship state, the updated result appears immediately after save.
- Cancel and Back preserve previously committed records and discard only the current unsaved change.
- Every Today card uses exactly Contact now, Not today, and Already contacted as its standard actions.

## UF-01 — First launch

1. App opens to an empty Today screen.
2. The screen explains in one sentence: “PeopleOS helps you remember who to contact and why.”
3. Primary action: **Add your first person**.
4. Secondary action: **Import a vCard file**.
5. A short privacy note states: “Your data stays on this device unless you export it.”
6. The user may switch to Reach Out, People, Upcoming, or Settings without completing onboarding.

There is no tutorial carousel, account creation, forced permissions request, or mandatory bulk import.

## UF-02 — Create first person manually

1. Tap Add your first person.
2. Add Person opens with Name focused.
3. User enters Name.
4. Optional quick fields remain visible: Phone or email, Organisation, Where met.
5. User taps Save.
6. Validation and duplicate detection run.
7. If clear, Person is created and profile opens.
8. Profile offers a non-blocking next step: **Plan a follow-up**.

Name-only completion must be possible. The flow must not force cadence, importance, tag, fact, or organisation.

## UF-03 — Manual capture under 20 seconds

Happy path:

1. From any main tab, tap Add → Add person.
2. Type name.
3. Type or paste phone number.
4. Optionally select an existing Event or enter Organisation.
5. Tap Save.
6. Return to the new profile.

Performance target is measured from tapping Add person to successful save for a name and phone on a familiar device. Phone formatting happens without requiring country-code knowledge.

## UF-04 — Quick networking capture

1. Tap Add → Quick networking capture.
2. Enter Name.
3. Enter any one available contact method; it is optional.
4. Select or create Event. Recent Events appear first.
5. Optional one-line “Remember” field can be saved either as a Note or promoted to a chosen Memory Fact.
6. Save person.
7. A confirmation screen offers:
   - Add another from this event
   - Plan follow-up
   - View person
   - Done

Choosing Add another keeps Event and default follow-up suggestion but clears all person-specific fields.

## UF-05 — Batch event capture

1. Tap Add → Quick networking capture → Add several people.
2. Select/create Event once; optional event date defaults to today and remains editable.
3. Add a row using Name plus optional phone/email and memory line.
4. Save row. Duplicate detection runs for that row.
5. Saved person appears in a compact completed list; input clears and remains focused.
6. Repeat.
7. Tap Finish.
8. Summary shows created count, linked-to-existing count, skipped count, and people needing contact details.
9. Optionally accept one shared follow-up date for selected newly created people. It is off by default to avoid bulk task creation.

If the user leaves mid-flow, already saved people remain. The current unsaved row prompts before discard.

## UF-06 — Import contacts from vCard

1. From People or Settings, choose Import contacts.
2. File picker accepts `.vcf`/vCard.
3. File is parsed locally.
4. Preview shows each selected contact's name, phone(s), email(s), and organisation if present.
5. Each row is classified:
   - Ready to create
   - Possible duplicate, with evidence
   - Needs attention, with validation reason
6. User reviews duplicate rows individually: Open existing, Link details to existing, Create separate, or Skip.
7. “Link details to existing” previews only new contact methods/affiliation and requires confirmation; it is not an entity merge.
8. User taps Import selected.
9. Result summary identifies created, updated-with-confirmation, skipped, and failed rows.

Malformed or unsupported files change nothing. Import does not create interactions, follow-ups, stages beyond New, or provider links.

## UF-07 — Duplicate warning during manual entry

1. User taps Save on a new Person.
2. Possible matches appear before creation.
3. Each match explains evidence, for example:
   - “Same phone number: 07900 123456”
   - “Similar name and same organisation: Sarah Jones · NHS England”
4. Actions:
   - Open existing person
   - Add new details to existing
   - Create separate person
   - Go back and edit
5. No action is preselected.

Adding details to existing shows exactly which contact methods or affiliation will be added. Existing values are never overwritten silently.

## UF-08 — View and edit person

1. Open Person from Today, People/Search, or Upcoming.
2. Profile shows identity, best next action, relationship summary, memory, recent timeline, contact details, and current affiliation.
3. Tap Edit.
4. Edit Person handles name, importance, tags, and cadence.
5. Contact methods, facts, affiliations, follow-ups, and interactions are edited from their own section actions.
6. Save returns to recalculated profile.

Changing phone/email may produce duplicate warnings. Changing a name never changes identity or history.

## UF-09 — Add a memory fact

1. From Profile, tap Add memory → Memory fact.
2. Choose kind: Introduced by, Interest, Seeking, Family, Communication preference, Location, Other.
3. Enter a concise value.
4. For Introduced by, optionally link an existing Person.
5. Review “Show as memory cue” default and change if desired.
6. Save.
7. Fact appears in Memory and search immediately; cue recalculates.

The app never converts note prose into facts without this confirmation.

## UF-10 — Add a free-form note

1. From Profile, tap Add memory → Note.
2. Enter narrative text; occurrence date defaults to now and can be changed.
3. Optional Event association.
4. Save.
5. Note appears in Timeline and Search.
6. Optional post-save action: Promote part to memory fact. This opens a blank fact form; it does not extract text automatically.

## UF-11 — Log an interaction

1. From Profile or Add menu, choose Log interaction.
2. Select Person if not already in context.
3. Select kind.
4. Date defaults to now; optional summary and Event are shown.
5. For Introduction received/made, select related Person when known or enter a name in summary.
6. Save.
7. Profile and Relationship Engine outputs recalculate.
8. If eligible, the app offers a suggested follow-up date with its reason. User may Accept, Change date, or Not now.

## UF-12 — Contact now from Today

1. On any Today card, tap Contact now.
2. PeopleOS resolves executable targets from the Person's active valid ContactMethods.
3. If exactly one target exists:
   - Phone opens the device dialler with a canonical `tel:` target.
   - Email opens the default email client with a `mailto:` target.
   - WhatsApp opens only after its later package supplies the approved adapter.
4. If several targets exist, an accessible choice sheet shows every channel, stored method label, and familiar value, with preferred methods ordered first. One phone may supply both Call and WhatsApp targets after V1-13; choose one to continue.
5. If no target exists, open that Person's Contact Methods screen with a blank phone draft already open and the phone-number field focused.
6. The external application opens. The user may or may not communicate.
7. Returning to PeopleOS restores the unchanged Today card. There is no “Did you contact them?” prompt.
8. The card remains until the user explicitly chooses Not today, Already contacted, or changes the underlying relationship plan elsewhere.

If the selected target becomes unavailable or the external app cannot open, PeopleOS remains on Today, records nothing, and offers another target, Copy where useful, or Add contact details.

## UF-13 — Add a missing phone number from Today

1. A Today card with no active valid phone shows Add phone number, even when one or more emails exist.
2. Tap Add phone number.
3. Open the same Person's Contact Methods screen with a new unsaved phone row already created and the number field focused.
4. Enter and save a valid number using the normal region parsing and validation.
5. Return to the same Today list position.
6. The card refreshes immediately. Contact now opens the sole resolved target directly or includes the new phone target in the chooser.

Cancel or Back discards the unsaved row and returns to Today without creating a ContactMethod. A failed save retains the draft and focus; no partial row is stored.

## UF-14 — Already contacted

1. On a Today card, tap Already contacted.
2. The card is visually withdrawn while a bottom sheet asks: “When should I remind you again?” No domain write has occurred yet.
3. Options are 2 days, 7 days, 14 days, 30 days, and Pick a date…. The global default is visibly preselected; the unchanged default is 14 days. A configured custom interval appears as “In {n} days.”
4. If other due FollowUps will remain, show “{count} other plan(s) remain due and may bring {display name} back sooner.” Do not add another decision.
5. Dismiss the sheet to restore the unchanged card and write nothing.
6. Choose a fixed interval or a future local calendar date to save immediately.
7. In one transaction PeopleOS:
   - creates one channel-neutral Contacted Interaction at the current instant without opening an interaction form;
   - completes the primary FollowUp with contact when the card has one and appends its lifecycle event;
   - leaves every other due or future FollowUp unchanged;
   - creates one pending next FollowUp on the selected date, retaining the primary reason/action when present or using reason “Reconnect with {display name}” and action `other` for a New/cadence card;
   - writes the Person/local-date TodaySkip so another independent reason cannot keep the card visible today;
   - when Reach Out-linked, appends completion history, retains the same ReachOutEntry, and assigns the new FollowUp as its `currentFollowUpId`.
8. Today recalculates and the Person leaves the current list. Upcoming, Profile, Timeline, and Reach Out show the same authoritative records.

The command prepares stable child IDs. Retry after failure is idempotent, and failure rolls back every Interaction, FollowUp, lifecycle event, Reach Out event/link, and TodaySkip together while retaining the selected date.

## UF-15 — Create one-off follow-up

1. From Profile or Add menu, tap Add follow-up.
2. Select Person if necessary.
3. Enter reason first.
4. Select action type: Message, Email, Call, Arrange meeting, Make introduction, Send update, Research contact route, Other.
5. Select date; suggested date is shown only when an engine rule applies.
6. Save.
7. Follow-up appears on Profile and Upcoming; it appears on Today only when due.

Reason and date are required. A vague empty “remind me” record cannot be saved.

## UF-16 — Complete a follow-up

1. From Upcoming, Profile, or FollowUp detail, tap Complete. Today uses its standard three-action row instead.
2. Choose:
   - I contacted them
   - Completed without contacting them
3. If contacted, log the interaction type/date and optional summary.
4. If without contact, confirm completion; this creates Follow-up completed but does not update last contact.
5. FollowUp becomes completed and leaves Today/Upcoming.
6. Engine recalculates. A future cadence suggestion may appear but is not auto-saved.

## UF-17 — Not today

1. On any Today card, tap Not today.
2. With no confirmation or follow-up question, PeopleOS performs one idempotent transaction:
   - If the card has a primary explicit FollowUp, keep that FollowUp and move its effective date to tomorrow using the existing snooze field and append-only snooze history.
   - If the card is eligible through the New or cadence rule, create one pending FollowUp for tomorrow with reason “Reconnect with {display name}” and action `other`.
   - Create/reuse the Person/local-date TodaySkip for the current day.
3. Do not create an Interaction, complete outreach, change ReachOutEntry state, or alter any other FollowUp.
4. The card disappears immediately. The moved/created plan appears in Upcoming/Profile and can return to Today tomorrow under normal engine rules.

Failure rolls back the snooze/new FollowUp, lifecycle event, and TodaySkip together and leaves the card visible. Retry reuses the same prepared IDs and never duplicates history.

## UF-18 — Snooze follow-up

1. From FollowUp detail, Upcoming, or Profile, tap Snooze. The Today one-day path is Not today in UF-17.
2. Choose Tomorrow, Next week, In one month, or Pick date.
3. Confirm.
4. FollowUp keeps its original date in history and gains the selected effective date.
5. Person leaves Today unless another independent reason remains eligible.

Snooze changes the active date without pretending the original plan never existed.

## UF-19 — Reschedule follow-up

1. Open FollowUp → Reschedule.
2. Pick a new date and optionally edit reason/action.
3. Save.
4. Old FollowUp is marked superseded; replacement becomes pending.
5. Timeline shows “Follow-up rescheduled from {old} to {new}.”

Use Reschedule when the plan itself changes. Use Snooze for a temporary deferral without changing its meaning.

## UF-20 — Cancel follow-up

1. Open FollowUp → Cancel.
2. Confirm “Cancel this follow-up?”
3. FollowUp becomes cancelled and leaves Today/Upcoming.
4. Engine checks whether New relationship or cadence still makes the Person eligible.

Cancellation never archives the Person or changes contact history.

## UF-21 — Set or change recurring cadence

1. Profile → Edit → Contact cadence.
2. Choose No recurring cadence, Monthly, Every 3 months, Every 6 months, Yearly, or Custom days.
3. Save.
4. Profile explains next expected contact date using last contact.
5. If no contact exists, cadence is saved but does not create Today eligibility; the user is offered an explicit first FollowUp instead.

Changing cadence recalculates eligibility. It does not create a persistent chain of FollowUps.

## UF-22 — Browse Upcoming

1. Open Upcoming tab.
2. See pending FollowUps after today, grouped by month.
3. Optional filters: Next 7 days, Next 30 days, Later, Person, Action type.
4. Tap row to open FollowUp detail or Person name to open Profile.
5. Actions are Reschedule, Complete, or Cancel.

Due and overdue items are excluded because they belong on Today. If Today items exist, Upcoming may show a quiet link “View due follow-ups” without duplicating rows.

## UF-23 — Search for a person from remembered context

1. Open People.
2. Enter query such as “pilot sites,” “Bristol,” “NHS,” or “HealthTech Fellowship.”
3. Results update after meaningful input.
4. Each result explains the matching field: “Seeking · pilot sites,” “Based in Bristol,” “NHS England,” or “Met at HealthTech Fellowship.”
5. Tap result to open Profile.
6. Back returns to query, filters, result position.

## UF-24 — Filter People

1. Open filter sheet from People.
2. Available filters: Tag, Current organisation, Event, Relationship stage, Has due follow-up, Missing contact details, Archived.
3. Apply.
4. Active filters appear as removable chips.
5. Search ranking operates within the filtered set.
6. Clear all returns to active People.

Filters are session-preserved but not configurable saved views in V1.

## UF-25 — View timeline and edit an interaction

1. Profile shows five most recent timeline items.
2. Tap See full timeline.
3. Timeline displays creation, interactions, and FollowUp lifecycle events newest first.
4. Tap editable interaction.
5. Edit kind, date, summary, Event, or related Person.
6. Save and recalculate derived state.
7. Delete requires confirmation explaining that stage, last contact, and Today may change.

FollowUp lifecycle entries open the relevant FollowUp but are not directly editable as interactions.

## UF-26 — Archive and restore person

1. Profile → Edit → Archive person.
2. Confirmation explains removal from Today, Upcoming, and default Search while preserving history.
3. Archive.
4. Archived profile remains readable.
5. People → Filters → Archived → open Profile → Restore person.
6. Restore re-enables engine evaluation; previous FollowUps keep their statuses.

No hard delete is offered in V1 outside full backup restore/replacement policy.

## UF-27 — Export backup

1. Settings → Export backup.
2. Screen explains what is included and that the file contains personal information.
3. Tap Create backup.
4. A versioned JSON file is generated locally.
5. User chooses where to save/share it using browser/device controls.

Export does not change data or imply cloud backup.

## UF-28 — Restore backup

1. Settings → Restore backup.
2. Select PeopleOS JSON backup.
3. Validate without changing current data.
4. Preview shows backup date/version and counts of people, interactions, facts, follow-ups, events, affiliations, Reach Out entries, Reach Out history events, and Reach Out contexts.
5. User confirms Replace current PeopleOS data.
6. A second explicit confirmation warns that current local data will be replaced and recommends exporting first.
7. Restore runs atomically.
8. Result confirms success; failure leaves original data intact.

V1 restore replaces the dataset. Merge restore is excluded.

## UF-29 — Add to phone contacts

1. Profile → More → Add to phone contacts.
2. Preview the vCard fields.
3. Tap Download/Open contact card.
4. Device contact UI handles final creation and confirmation.

PeopleOS never assumes the contact was created and does not store a provider link.

## UF-30 — Recover from save error

1. A local save fails.
2. Stay in the current flow with entered data intact.
3. Show plain error: “PeopleOS could not save this yet.”
4. Actions: Try again, Copy entered text where useful, or Cancel.
5. Never show success, close the flow, or create partial child records.

## UF-31 — Add an existing Person to Reach Out

1. Open Person Profile and tap Add to Reach Out, or Reach Out → Add someone.
2. Select the existing Person if not already in context.
3. Optionally enter why they matter, intended next action, context/notes, and reminder date.
4. Save.
5. One ReachOutEntry is created referencing the existing `Person.id`.
6. If a reminder date was selected, one linked FollowUp is created through the normal FollowUp command and both records point to each other as the sole current plan.
7. Profile and Reach Out show the same plan; no Person is duplicated.

If a current Reach Out entry already exists, open it for editing rather than creating another.

## UF-32 — Quick-capture a provisional Reach Out Person

1. Open Reach Out → Add someone.
2. Enter a descriptive label such as “Chief Information Officer at Watford.”
3. Review existing Person/provisional duplicate candidates.
4. Choose Use as temporary description.
5. Optionally add why, intended action, reminder shortcut, notes, and Fellowship/Event/organisation/project context.
6. Save.
7. PeopleOS atomically creates a provisional Person, ReachOutEntry, optional context link, and optional reciprocally linked sole current FollowUp.
8. Reach Out displays the label with “Identity incomplete.”

Only the descriptive label is required. The app never invents a name, organisation, contact method, or relationship fact.

## UF-33 — Reach Out reminder appears in Today

1. Add Aaron to Reach Out with reason “Interested in NHS AI,” action Message, and reminder next week.
2. Before the reminder date, Aaron appears as Waiting in Reach Out and in Upcoming, not Today.
3. On the reminder date, the same linked FollowUp appears in Today under the normal explicit-FollowUp band.
4. The Today card explains the planned action/date and may also show the Reach Out reason.
5. The card has the same Contact now, Not today, and Already contacted actions as every other Today card.
6. Contact now changes nothing. Not today uses UF-17 while retaining the same Reach Out-linked FollowUp. Already contacted uses UF-14, appends Reach Out completion history, and links the selected next FollowUp to the same ReachOutEntry.
7. Move to Dormant or Remove from Reach Out remains available from Reach Out Detail/Profile rather than competing with the three Today actions; confirmation cancels the pending linked FollowUp and clears the current pointer atomically.

Reach Out never creates a second Today card or a separate reminder.

## UF-34 — Complete outreach and decide what happens next

1. From Reach Out Detail or Person Profile, tap Mark outreach complete. From Today, Already contacted follows UF-14's frictionless path.
2. Confirm completion date.
3. Choose whether to log an Interaction:
   - Log contact and select kind/date/summary
   - Complete without interaction
4. PeopleOS records a ReachOut completion event and optional Interaction.
5. Ask “Do you want another follow-up?”
6. If No, the ReachOutEntry becomes Completed, records `lastCompletedAt`, clears `currentFollowUpId`, and leaves the default active Reach Out list.
7. If Yes, create/edit one FollowUp using the existing FollowUp flow; the ReachOutEntry returns/remains Active, links that FollowUp reciprocally as its sole current plan, retains completion history, and displays Waiting when the date is future.
8. Today, Upcoming, Profile, Timeline, and Reach Out recalculate from the same records.

Outreach completion without an Interaction does not change last contact or relationship stage.

Already contacted is different: it is the user's explicit confirmation that contact occurred, so UF-14 creates the channel-neutral Contacted Interaction automatically without requiring the full interaction form.

## UF-35 — Move Reach Out to Dormant, reactivate, or remove

1. Open Reach Out item overflow or Detail.
2. Choose Move to Dormant.
3. If a pending FollowUp exists, confirmation explains it will be cancelled.
4. Confirm. ReachOutEntry becomes Dormant, the linked pending FollowUp is cancelled, and `currentFollowUpId` is cleared atomically.
5. Dormant entry remains searchable/filterable and visible in Person history.
6. Reactivate returns it to Active with no automatic reminder; user may add one.
7. Remove from Reach Out requires confirmation, archives the entry, cancels a pending linked FollowUp, clears `currentFollowUpId`, and removes it from Reach Out search/filter results without deleting Person or history.

## UF-36 — Complete or link a provisional identity

1. Open a provisional Reach Out Person and tap Complete identity.
2. Either enter the confirmed name/details and save on the same Person ID, or search for an existing confirmed Person.
3. When linking, review the surviving Person and every Reach Out/FollowUp/Interaction/Fact/contact/affiliation/context record that will move or remain.
4. Resolve field conflicts explicitly; no value is overwritten by default.
5. Confirm.
6. The transaction moves selected child records to the surviving Person, marks the provisional Person merged, and preserves all history.
7. Reach Out/Profile open the surviving Person.

Retry uses the same resolution command ID. Failure leaves both People unchanged. This is not a general-purpose merge flow.

## UF-37 — Search and filter Reach Out

1. Open Reach Out.
2. Search by name/provisional label, role, organisation, reason, notes, or context.
3. Results identify the matching source.
4. Apply one or more status filters: Due, Overdue, Upcoming, Waiting, Snoozed, Dormant, Completed.
5. Optionally filter by a Reach Out context such as Fellowship.
6. Open an item and Back to restore query, filters, and scroll.

Status filters use derived display state. Completed and Dormant remain searchable; removed entries do not.

## UF-38 — Review or change global Settings

1. Open Settings.
2. Review the nine sections in order: General, Modes, Today, Reach Out, Interactions, Notifications, Privacy & Security, Data, About.
3. Select Default phone region, Capture mode, Default Reach Out reminder, Default “Already contacted” interval, Daily Today summary, or its reminder time.
4. Choose a value and apply it explicitly.
5. The saved value appears immediately on Settings and affects only the documented future global behavior.
6. Back without applying preserves the previous value.
7. A failed save retains the previous value and offers Retry; a stale edit offers Reload instead of overwriting.

Changing Default phone region never rewrites stored canonical phone numbers. Changing Capture mode changes only the default global Add destination. Changing the Reach Out reminder default affects only new drafts and never edits existing entries or FollowUps. Changing the Already contacted default only changes the preselected choice on future UF-14 sheets. Turning the daily summary On starts the explicit notification-permission/capability flow; it never changes Today eligibility.

Today, Interactions, Privacy & Security, and About also show their fixed policy or runtime information. Notifications exposes working controls only in the native iPhone app; the browser reports that boundary without requesting permission. Data actions continue through UF-06, UF-27, and UF-28.

## UF-39 — Daily Today summary notification

1. Open Settings → Notifications.
2. PeopleOS checks the approved native adapter without requesting permission. The browser shows that reminders are available in the iPhone app and offers no working switch.
3. In the iPhone app, turn Today reminders On.
4. PeopleOS requests normal iOS permission only after this explicit action and persists On only after permission is granted.
5. If permission is denied, remain Off, show “Permission denied,” schedule nothing, and do not re-prompt automatically.
6. With permission granted, choose a reminder time. The default is 12:00 in the device's current local timezone.
7. PeopleOS derives up to 30 one-off daily occurrences from the same deterministic eligibility rules as Today. Empty forecast dates produce no occurrence; launch, foreground/background transition, mode, Settings, and dataset changes safely replace the plan.
8. A scheduled summary uses:
   - Title: PeopleOS
   - Same-day body when trustworthy: “3 people are on your list today.”
   - Forecast body: “People are waiting on your list today.”
9. Do not include names, contact details, reasons, notes, affiliations, relationship details, or Person/FollowUp IDs. Do not create one notification per Person.
10. Tap the summary, or its View Today action, to open Today. Not Now leaves everything unchanged and the next reminder arrives three hours later, up to the 22:00 cut-off. Opening PeopleOS ends that day's reminders; dismissing or ignoring one does not. The MVP adds no configurable snooze, automatic messaging, or notification-only Not today command.
11. Change the time to cancel and replace the pending plan. Turn reminders Off to cancel every pending PeopleOS summary.
12. After 30 ignored occurrences the bounded plan ends; reopening PeopleOS replenishes it. Do not claim unlimited or live at-delivery evaluation while the app remains closed.

Notification scheduling and taps never create or edit Person, Interaction, FollowUp, FollowUpEvent, TodaySkip, ReachOutEntry, ReachOutEvent, or engine output.

## UF-40 — Open Today from a notification deep link

1. The MVP summary notification carries a semantic Today target and no Person ID.
2. Tap the notification body.
3. PeopleOS validates the target and opens Today, even after a cold launch or reload.
4. Today is recalculated from current records; it may now be empty.
5. Foreign or malformed notification payloads are ignored. PeopleOS never opens a Person through notification fallback matching.

Phone numbers, email addresses, display names, and external-provider identifiers are never used as deep-link identity. Opening a deep link never performs a notification action or relationship mutation.

## UF-41 — Compose a templated message from Profile

1. From Person Profile or another non-Today contact surface, choose Compose message.
2. Choose an available Email or WhatsApp target. WhatsApp appears only after V1-13 and only for a valid canonical phone.
3. Choose Networking, Coffee, or Custom.
4. PeopleOS shows deterministic editable content: Networking uses “Hi {first name}, it was lovely meeting you today at {event}. Great chatting with you.” and omits the Event phrase when unavailable; Coffee uses “Lovely seeing you today. Let's catch up again soon.”; Custom starts blank. Email subject starts blank; email body and WhatsApp text use the chosen content.
5. Edit or continue, then explicitly open the external application.
6. If the target application cannot open, keep the draft and offer Copy.
7. Returning to PeopleOS restores the origin and records nothing.

Today Contact now does not enter this flow: its sole phone/email target launches directly, while several executable targets use S33. Templates are composition conveniences, not saved relationship state, evidence of contact, or a second Today action.
