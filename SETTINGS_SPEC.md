# PeopleOS Version 1 Settings Specification

## 1. Purpose and boundary

Settings contains only preferences, status, and actions that apply to the application as a whole. It must not become a second place to configure an individual relationship.

The following always belong on a Person or their related records, never in Settings: importance, tags, cadence, preferred communication method, FollowUps, Reach Out status or reason, Memory Facts, contact details, affiliations, and event context.

V1 has five editable global preferences:

1. Default phone region
2. Capture mode
3. Default “Already contacted” interval
4. Default Reach Out reminder
5. Today summary notifications

All other rows are fixed policy, capability status, navigation to an existing data action, or application information. Settings never changes Relationship Engine priority, relationship stage, memory-cue selection, search ranking, or duplicate evidence.

## 2. Settings screen architecture

Settings is one scrollable primary screen with these sections in order:

1. General
2. Modes
3. Today
4. Reach Out
5. Interactions
6. Notifications
7. Privacy & Security
8. Data
9. About

Each section has a short purpose sentence. Editable rows show their current value and open a focused selection sheet. Action rows open an existing flow. Informational rows are not styled as controls.

There is no screen-level Save button. Each editable preference is committed explicitly in its selection sheet. Back without applying preserves the previous value. A failed save leaves the previous value authoritative and keeps the selection open with Retry.

## 3. General

### Purpose

Control device-independent parsing behavior that must be consistent throughout the application.

### Available options and defaults

| Setting | Options | Default |
|---|---|---|
| Default phone region | Supported country/region list using ISO region codes | Device region when supported; otherwise United Kingdom (`GB`) |
| Timezone | Informational: current device timezone | Current device timezone |
| Date and number format | Informational: follows device locale | Current device locale |

### Deterministic behaviour

- The default phone region is used only when a newly entered phone number is nationally formatted or otherwise ambiguous.
- Canonical E.164 numbers do not depend on this preference.
- Changing the region never rewrites stored canonical phone numbers. It affects future parsing and national-format display fallback only.
- Today and date-only FollowUps use the current device timezone supplied at evaluation time. V1 provides no timezone override.
- Date and number formatting follows the current device locale. V1 provides no language or format override.

### User flows affected

- UF-02 Create first person manually
- UF-03 Manual capture under 20 seconds
- UF-06 Import contacts from vCard
- UF-08 View and edit person
- UF-27 Export backup
- UF-28 Restore backup

## 4. Modes

### Purpose

Choose which existing capture experience opens by default without changing relationship rules or stored Person data.

### Available options and defaults

| Setting | Options | Default |
|---|---|---|
| Capture mode | Standard; Networking | Standard |

### Deterministic behaviour

- Standard makes the global Add person action open normal manual capture.
- Networking makes the global Add person action open batch networking capture with reusable Event context.
- Direct entry points keep their meaning: Add to Reach Out still opens Reach Out Quick Capture, and Add person from People still opens normal manual capture.
- The user may switch capture flow from the opened screen without changing the saved default.
- The setting does not infer when the user is at an event, remember recent behavior, alter defaults per Person, or affect Today ordering.

### User flows affected

- UF-02 Create first person manually
- UF-03 Manual capture under 20 seconds
- UF-04 Quick networking capture
- UF-05 Batch event capture
- UF-32 Quick-capture a provisional Reach Out Person

## 5. Today

### Purpose

Explain the fixed global Today policy and provide a direct route to the full explanation without exposing engine weights or switches.

### Available options and defaults

| Row | Options | Default |
|---|---|---|
| Today ordering | Informational; open “How Today works” | Fixed deterministic policy |
| Daily display | Informational | All eligible People, globally sorted and revealed in groups of five |
| Default “Already contacted” interval | 2 days; 7 days; 14 days; 30 days; Custom | 14 days |

### Deterministic behaviour

- Ordering remains: overdue explicit FollowUps, due-today explicit FollowUps, new-relationship FollowUps, then cadence due, with the documented tie-breakers.
- Reach Out receives no separate score or boost. A due Reach Out-linked FollowUp participates as an ordinary explicit FollowUp.
- The first five appear initially; “Show more due people” reveals the next five from the same globally sorted result. Paging never changes eligibility or ordering and never hides an eligible Person permanently.
- The default “Already contacted” interval preselects the next-reminder choice after that explicit Today action. Presets add exactly 2, 7, 14, or 30 local calendar days. Custom accepts an integer from 1 to 3,650 and displays both the interval and resulting local date.
- Changing the default affects only future “Already contacted” sheets. It never changes an existing Person, FollowUp, Reach Out entry, Interaction, or open sheet.
- “Already contacted” is not adaptive. PeopleOS does not learn a Person-specific interval or remember repeated choices.
- The user cannot configure weights, bands, stage boundaries, cue ranking, importance strength, or rule exclusions.

### User flows affected

- S01 Today
- UF-12 Contact now from Today
- UF-13 Add a missing phone number from Today
- UF-14 Already contacted
- UF-17 Not today
- UF-33 Reach Out reminder appears in Today

## 6. Reach Out

### Purpose

Set one lightweight default for new Reach Out plans while keeping every intention editable and explicit.

### Available options and defaults

| Setting | Options | Default |
|---|---|---|
| Default reminder for new Reach Out entries | No reminder; Tomorrow; In 7 days; In 14 days; In 30 days | No reminder |

### Deterministic behaviour

- The selected value pre-fills the reminder field only when creating a new Reach Out entry.
- Relative choices use local calendar-date addition from the creation date; “In 7 days” means exactly seven calendar days later.
- The user sees and may change or clear the date before saving.
- No reminder creates no FollowUp. Choosing a date creates exactly one normal FollowUp linked to the ReachOutEntry.
- Changing this setting affects only future drafts. It never changes existing Reach Out entries or FollowUps.
- Reason, intended action, context, status, and per-entry dates remain Reach Out data, not global settings.

### User flows affected

- UF-31 Add an existing Person to Reach Out
- UF-32 Quick-capture a provisional Reach Out Person
- UF-33 Reach Out reminder appears in Today

## 7. Interactions

### Purpose

Explain the fixed rules for recording relationship history and protect the distinction between opening an external app and confirming contact.

### Available options and defaults

| Row | Options | Default |
|---|---|---|
| Contact recording | Informational | Only after an explicit PeopleOS action |
| New Interaction date | Informational | Current local date/time, editable before save |

### Deterministic behaviour

- PeopleOS never records an Interaction merely because WhatsApp or email was opened.
- Returning from a phone, email, or future WhatsApp handoff does not open a confirmation prompt and does not record contact. The Today card remains until the user explicitly chooses Not today, Already contacted, or another available Today action.
- Choosing Already contacted is itself an explicit user action. It records one generic contact-counting `contacted` Interaction at the action time without asking the user to choose a channel or complete an Interaction form.
- A manually logged Interaction starts with the current local date/time; the user may edit it before saving.
- Interaction kinds that count as contact are fixed by the accepted deterministic policy.
- V1 has no global default channel, interaction kind, auto-logging option, or per-Person communication preference here.

### User flows affected

- UF-11 Log an interaction
- UF-14 Already contacted
- UF-16 Complete a follow-up
- UF-34 Complete outreach and decide what happens next

## 8. Notifications

### Purpose

Offer one privacy-preserving Today summary on a supported runtime without turning notifications into a second reminder system.

### Available options and defaults

| Row | Options | Default |
|---|---|---|
| Today summary notifications | Off; On, with separate effective status when permission/capability blocks delivery | Off |
| Reminder time | Any valid local `HH:mm` time | 12:00 in the current device timezone |
| Permission and runtime capability | Informational status | Not requested until the user turns Today summary notifications on |

### Deterministic behaviour

- `todaySummaryNotificationsEnabled` records desired global behavior; effective delivery additionally requires the approved adapter and granted operating-system permission.
- On a supported runtime, explicitly choosing On requests permission in that same user-initiated flow and persists On only when permission is granted. Denial leaves the preference Off, shows “Permission denied,” schedules nothing, and never re-prompts automatically. Turning Off persists `false` and cancels pending PeopleOS summaries without attempting to change the operating-system permission.
- An unsupported runtime does not offer a working On action. If a restored backup contains On, show “On preference — unavailable on this device” and schedule nothing. Restored On with requestable permission shows “Permission required”; only an explicit Enable on this device action may request it.
- The native scheduler forecasts from the same fixed Today eligibility rules and schedules at most 30 one-off daily summaries. It installs and verifies replacements before removing stale requests after launch, foreground/background transition, relationship-mode, Settings, or dataset changes. An empty forecast date produces no notification.
- The title is “PeopleOS”. A same-day occurrence scheduled before its selected time may say “3 people are on your list today.” Future forecast occurrences use “People are waiting on your list today.” Singular grammar uses “1 person is on your list today.”
- Bodies and payloads contain no names, contact details, Person or FollowUp identifiers, reasons, notes, affiliations, relationship details, or other personal data.
- The user-selected reminder time follows the current device timezone when the plan is reconciled. Changing the time cancels and replaces every pending PeopleOS summary.
- Tapping a summary opens the current Today route. The MVP has no notification action buttons, delivery Snooze, automatic contact action, or notification-only Not today command.
- If the user ignores 30 summaries without reopening the app, the bounded local plan ends; reopening or foregrounding PeopleOS replenishes it. The MVP does not claim unlimited or live at-delivery evaluation while closed.
- Notification scheduling and taps never create a TodaySkip, Interaction, FollowUp, FollowUpEvent, ReachOutEvent, or Reach Out transition.
- The browser PWA does not request notification permission. The On control is available only in the iPhone wrapper whose native adapter proves permission, closed-app scheduling, replacement, cancellation, and warm/cold tap handling.

### User flows affected

- UF-38 Review or change global Settings
- UF-33 Reach Out reminder appears in Today
- UF-39 Daily Today summary notification
- UF-40 Open Today from a notification deep link

## 9. Privacy & Security

### Purpose

Make the local-first trust boundary visible and explain protections and limitations.

### Available options and defaults

| Row | Options | Default |
|---|---|---|
| Data location | Informational | Stored locally on this device/browser |
| Network behavior | Informational | No account, sync, analytics, background contact access, or server push |
| Device protection | Informational | Relies on device/browser access controls |
| Privacy explanation | Open privacy detail | Available |

### Deterministic behaviour

- PeopleOS makes no claim that local IndexedDB is encrypted by the application.
- Data leaves PeopleOS only through an explicit user action such as backup export, vCard export, or external message handoff.
- Today summary notification content contains no names, counts, relationship details, or copied Today queue. Notification permission and delivery state remain device-local.
- V1 has no app PIN, biometric lock, hidden mode, analytics consent, cloud encryption, account, or session setting.
- External app and file-system security are owned by the device/platform and described accurately.

### User flows affected

- UF-01 First launch
- UF-12 Contact now from Today
- UF-29 Add to phone contacts
- UF-27 Export backup
- UF-28 Restore backup
- UF-39 Daily Today summary notification

## 10. Data

### Purpose

Provide explicit user-controlled import, portability, backup, and restoration actions.

### Available options and defaults

| Action or status | Options | Default |
|---|---|---|
| Import contacts | Open vCard import | No automatic import |
| Export backup | Create versioned JSON backup | User initiated only |
| Restore backup | Preview and replace current local dataset | No file selected |
| Last successful backup | Informational timestamp | Never, until a valid backup is generated |

### Deterministic behaviour

- Import always previews results and duplicate evidence before persistence.
- Export validates the complete dataset before producing a file and updates the last-successful-backup timestamp only after a valid backup blob is produced.
- Restore validates and previews the whole backup, requires explicit replacement confirmation, and applies atomically. Invalid or cancelled restore changes nothing.
- Settings preferences are included in backup and restore.
- V1 has no automatic backup, cloud destination, scheduled export, merge restore, sync, or “delete all” shortcut.

### User flows affected

- UF-06 Import a vCard
- UF-07 Duplicate warning during manual entry
- UF-27 Export backup
- UF-28 Restore backup

## 11. About

### Purpose

Identify the product and make its governing principles and technical version visible.

### Available options and defaults

| Row | Options | Default |
|---|---|---|
| PeopleOS version | Informational | Installed application version |
| Data schema version | Informational | Current local schema version |
| About PeopleOS | Open concise product explanation | Available |
| Open-source licences | Open licence notices when dependencies exist | Available when applicable |

### Deterministic behaviour

- Version values come from build and data metadata, not editable storage.
- About describes PeopleOS as a relationship operating system that helps users remember people; it does not describe it as a CRM.
- No feedback account, marketing subscription, analytics identifier, or update checker is introduced in V1.

### User flows affected

- UF-38 Review or change global Settings
- Support and diagnostic conversations using visible version information

## 12. Persistence contract

Editable preferences use one versioned singleton `AppSettings` record:

```ts
type AppSettings = {
  id: "app";
  defaultPhoneRegion: string;
  captureMode: "standard" | "networking";
  alreadyContactedDefaultReminderDays: number;
  reachOutDefaultReminderDays?: 1 | 7 | 14 | 30;
  todaySummaryNotificationsEnabled: boolean;
  todaySummaryNotificationTime: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
```

`alreadyContactedDefaultReminderDays` defaults to 14. Absence of `reachOutDefaultReminderDays` means No reminder. `todaySummaryNotificationsEnabled` defaults to `false` and `todaySummaryNotificationTime` defaults to `12:00`. Enabled intent is not proof of permission or runtime capability. Device timezone, device locale, notification permission/capability, application version, and schema version are runtime facts and must not be duplicated into this record. `lastBackupGeneratedAt` remains backup metadata as defined by the readiness correction, not a user preference.

The record is included in backup/restore. Restore never requests notification permission; restored On intent remains ineffective until the runtime already has permission or the user explicitly chooses Enable on this device in Settings. Device-local `TodayNotificationState` is not part of AppSettings and is excluded from backup/restore. If AppSettings is missing after first launch, the application creates the defaults known to the current package.

Migration is deliberately staged. V1-10 adds the Already-contacted default of 14. The chargeable MVP migration adds notification intent Off and reminder time 12:00, preserving every older preference. Backups through schema 4 receive those defaults while current schema 5 requires both fields.

## 13. Validation and acceptance

- Region must be an ISO region supported by the bundled phone-number library.
- Capture mode must be one of the two defined values.
- The Already contacted default must be an integer from 1 to 3,650; presets are 2, 7, 14, and 30.
- Reach Out reminder days must be absent, 1, 7, 14, or 30.
- Today summary notification intent must be boolean. Effective delivery additionally requires granted permission and a supported reliable adapter; blocked/unavailable projections follow the Notifications section exactly.
- Today summary notification time must be a valid zero-padded 24-hour `HH:mm` value.
- A stale revision cannot overwrite a newer preference value.
- Repeating the same save with the same revision/command identity produces one resulting update.
- Backup/restore round-trips every editable preference.
- Backup/restore excludes device-local notification scheduling and delivery state and never triggers a permission prompt.
- Settings remains usable offline.
- Every informational row is announced as text, not as a disabled control.
- No Settings row reads or modifies a specific Person.
- No setting changes deterministic Relationship Engine rules.
- Notification scheduling and taps leave all Person, Interaction, FollowUp, TodaySkip, Reach Out, and Relationship Engine inputs unchanged.

## 14. Explicit exclusions

- Per-Person cadence, importance, tags, channel preference, Reach Out plan, or reminder
- Relationship Engine weights, ordering, stage boundaries, cues, or scoring
- AI, inferred defaults, recommendations based on usage, or “remember my last choice” behavior
- Theme and cosmetic customization
- Accounts, sync, provider integrations, analytics, or marketing preferences
- Per-Person notification settings, names or relationship details in notification content, notification action buttons, and configurable snooze duration
- Browser/server push, notification analytics, or a backend solely for notification delivery
- App PIN, biometric lock, or application-managed encryption
- Automatic backup, restore merge, or destructive clear-all action
