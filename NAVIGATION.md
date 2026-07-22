# PeopleOS Version 1 Navigation

## Navigation principle

Navigation should reflect the user's recurring questions, not the data model.

- **Today:** Who should I contact today?
- **Reach Out:** Who have I deliberately decided to contact or reconnect with?
- **People:** Who do I know, and what do I remember about them?
- **Upcoming:** What have I planned for later?
- **Settings:** How is my local data protected and configured?

There is no Dashboard, Events, Facts, Interactions, or Organisations primary tab. Those concepts support people and plans; they are not destinations by themselves.

## Primary navigation

Persistent bottom navigation on phone-sized screens:

1. **Today** — default launch destination
2. **Reach Out** — curated outreach intentions
3. **People** — person directory and search
4. **Upcoming** — future follow-ups
5. **Settings** — global application preferences, trust status, data, and app information

The active tab is always visibly and programmatically identified. Switching tabs preserves each tab's top-level scroll position for the current session but closes transient menus.

On wider screens the same five destinations may use a side rail. Labels and information architecture do not change.

## Global create action

A persistent **Add** action is available from Today, Reach Out, People, and Upcoming. It opens an action sheet with:

- Add person
- Quick networking capture
- Log interaction
- Add follow-up
- Import contacts
- Add to Reach Out

Context narrows the choices:

- From a Person profile, Add offers Log interaction, Add note, Add memory fact, and Add follow-up for that person.
- From Reach Out, Add someone is first and opens Reach Out Quick Capture.
- From Upcoming, Add follow-up is first.
- Import contacts is available from People and Settings, but is last in the global action sheet.

The action sheet is not a new navigation destination. Dismissal returns to the exact previous screen and state.

## Search entry points

### People tab

Search is always visible at the top of People. It searches the full V1 index.

### Global person picker

Flows requiring a Person—Log interaction and Add follow-up—open a person picker using name-first search. The picker does not search notes or facts because its purpose is selection, not discovery. It shows current organisation and memory cue to disambiguate.

### No search field on Today

Today remains focused. The user goes to People to find someone who is not due.

### Reach Out search

Search is always visible within Reach Out and is scoped to Reach Out entries, including Completed and Dormant when their filters are active. It searches Person/provisional label, role, organisation, Reach Out reason, notes, and context.

## Navigation hierarchy

```text
Today
  ├─ Person profile
  ├─ Contact-target chooser
  ├─ Phone / email / future WhatsApp handoff
  ├─ Contact Methods editor, opened in add-phone mode
  ├─ Already contacted reminder sheet
  └─ Why this person? sheet

Reach Out
  ├─ Reach Out quick capture
  ├─ Reach Out detail / edit plan
  ├─ Person profile
  ├─ Follow-up detail
  ├─ Complete outreach sheet
  └─ Provisional identity resolution

People
  ├─ Search and scoped filters
  ├─ Person profile
  │   ├─ Compose message → target chooser → editable handoff
  │   ├─ All memory facts
  │   ├─ Full timeline
  │   ├─ Follow-ups
  │   ├─ Contact methods
  │   ├─ Affiliations
  │   └─ Edit person
  ├─ Add person
  ├─ Quick networking capture
  ├─ Batch event capture
  └─ Import contacts

Upcoming
  ├─ Follow-up detail
  ├─ Person profile
  └─ Add follow-up

Settings
  ├─ General
  │   └─ Default phone region
  ├─ Modes
  │   └─ Capture mode
  ├─ Today
  │   ├─ How Today works
  │   └─ Default Already contacted interval
  ├─ Reach Out
  │   └─ Default reminder
  ├─ Interactions
  ├─ Notifications
  │   └─ Today summary notifications
  ├─ Privacy & Security
  ├─ Data
  │   ├─ Import contacts
  │   ├─ Export backup
  │   └─ Restore backup
  └─ About
```

## Screen versus sheet rules

Use a full screen when the task:

- Requires multiple fields or review
- Has its own navigable state
- May take more than one decision
- Needs browser back support

Use a modal sheet when the task:

- Is a short choice or confirmation
- Belongs to the current Person/card
- Can be safely discarded on dismissal

### Full screens

- Person profile
- Reach Out
- Reach Out detail
- Provisional identity resolution
- Add/Edit person
- Quick networking capture
- Batch event capture
- Import preview and results
- Full timeline
- All facts
- Follow-up list/detail when reached from profile
- Restore preview

### Sheets

- Global Add menu
- Contact-target choice
- Already contacted next-reminder choice
- Add quick note
- Add/edit a single Memory Fact
- Add/reschedule/snooze/cancel FollowUp
- Reach Out quick capture
- Settings preference selection
- Complete outreach / move dormant / remove confirmations
- Log a simple Interaction
- Duplicate warning
- Why this recommendation/stage/cue
- Destructive confirmations

On small screens, the same interaction may be implemented as a full-height sheet. Its product role remains modal.

## Person profile secondary navigation

The profile is a summary, not a tabbed mini-application. It contains ordered sections with “See all” links:

1. Identity and primary actions
2. Today's reason or next FollowUp, when present
3. Reach Out summary, when present
4. Relationship summary
5. Memory
6. Recent timeline
7. Contact details
8. Current affiliation

Secondary screens are opened only when the section exceeds its compact limit or needs editing. Do not add permanent Profile tabs in V1.

## Back behavior

- Browser/device Back returns to the previous meaningful screen, preserving search query, filters, and scroll position.
- Back from a profile opened from Today returns to the same Today list position unless engine-changing data was saved; then it returns to the recalculated list.
- Returning from a phone, email, or future WhatsApp handoff returns to the same Today position. The card remains because opening another app does not record contact.
- Back from Profile-origin message composition preserves the editable draft until discard is confirmed; returning from its external handoff restores Profile and records nothing.
- Back or dismissal from the Already contacted reminder sheet writes nothing and leaves the card unchanged. Selecting an interval commits the atomic action and returns to recalculated Today.
- Back from the Contact Methods editor opened by Add phone number returns to Today after save or cancel. Save recalculates the card immediately; cancel preserves it unchanged.
- Back from a profile opened from Search returns to the same results and query.
- Back from a modal sheet dismisses it. If unsaved edits exist, ask “Discard changes?”
- Back from the first step of Add person or capture dismisses the flow after discard confirmation if anything was entered.
- Back from a completed save returns without confirmation.
- Switching primary tabs while a full-screen edit has unsaved changes asks for confirmation; switching tabs is otherwise immediate.

## Deep links and reload behavior

V1 supports stable internal routes for:

- Today at `/`
- Reach Out
- People
- Person profile by internal Person ID
- Upcoming
- Settings

Edit sheets and unsaved capture state are not deep-linkable. Reloading a profile returns to the profile. Reloading a transient flow returns to the nearest safe parent and does not create partial data.

Today summary notifications use a versioned payload equivalent to `{ destination: "today", personId?: string }`. The V1 summary omits `personId` and always opens `/`. A notification click first hydrates the local stores, activates Today, and then handles an optional Person only when the ID exists, is active, and is still represented in the current Today result. A valid optional Person opens their profile over Today so Back returns to Today. A missing, archived, merged, or no-longer-due Person falls back to Today without opening another Person or the previously active tab.

Warm-start handling focuses the existing PeopleOS client before routing. Cold-start handling opens `/` and applies the payload only after hydration. Notification Open is a navigation action. Notification Not today and Snooze are delivery-state commands rather than routes and never navigate to or mutate an individual Person.

## Archived people navigation

Archived people are excluded from Today, active Reach Out, Upcoming, default People results, and person pickers. People filters include “Archived.” Opening an archived profile displays a clear archived state and only these primary actions:

- Restore person
- Export contact

History remains readable. New interactions and FollowUps cannot be added until restored.

## Error and offline navigation

- Local features remain navigable offline.
- An unavailable external handoff shows an inline error and stays on the current screen.
- Unsupported, denied, revoked, or failed notification capability is reported in Settings and leaves Today fully usable. It never triggers a permission loop or a fallback server notification.
- A storage failure does not navigate away or imply a save succeeded.
- A missing/deleted Person route returns to People with “This person is no longer available.”
- Invalid restored routes never show a blank screen.

## Accessibility navigation requirements

- Focus moves to the heading when a full screen opens.
- Focus moves into a modal and returns to its trigger when dismissed.
- Bottom-navigation order is stable.
- Escape dismisses non-destructive modals on keyboard-capable devices.
- Every icon action has a visible or accessible name.
- No essential action relies on swipe gestures.

## Future extension points

- A provider-link screen may later appear under Contact details; it does not create another primary tab.
- Event detail may become a navigable secondary screen if event grouping proves useful.
- Notification delivery remains capability-gated. The provider-neutral deep-link and delivery contracts do not authorise implementation until a reliable adapter passes the platform stop condition in `ARCHITECTURE.md`.
- Accounts/sync may add an Account destination without changing the five primary jobs; this requires a new product review.
