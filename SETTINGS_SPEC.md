# PeopleOS Version 1 Settings Specification

## 1. Purpose and boundary

Settings contains only preferences, status, and actions that apply to the application as a whole. It must not become a second place to configure an individual relationship.

The following always belong on a Person or their related records, never in Settings: importance, tags, cadence, preferred communication method, FollowUps, Reach Out status or reason, Memory Facts, contact details, affiliations, and event context.

V1 has three editable global preferences:

1. Default phone region
2. Capture mode
3. Default Reach Out reminder

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

- UF-02 Create first Person manually
- UF-03 Add another Person manually
- UF-06 Import a vCard
- UF-08 Add or edit contact methods
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

- UF-02 Create first Person manually
- UF-03 Add another Person manually
- UF-30 Batch networking capture
- UF-32 Quick-capture a provisional Reach Out Person

## 5. Today

### Purpose

Explain the fixed global Today policy and provide a direct route to the full explanation without exposing engine weights or switches.

### Available options and defaults

| Row | Options | Default |
|---|---|---|
| Today ordering | Informational; open “How Today works” | Fixed deterministic policy |
| Daily display | Informational | All eligible People, globally sorted and revealed in groups of five |

### Deterministic behaviour

- Ordering remains: overdue explicit FollowUps, due-today explicit FollowUps, new-relationship FollowUps, then cadence due, with the documented tie-breakers.
- Reach Out receives no separate score or boost. A due Reach Out-linked FollowUp participates as an ordinary explicit FollowUp.
- The first five appear initially; “Show more due people” reveals the next five from the same globally sorted result. Paging never changes eligibility or ordering and never hides an eligible Person permanently.
- The user cannot configure weights, bands, stage boundaries, cue ranking, importance strength, or rule exclusions.

### User flows affected

- UF-16 Review Today
- UF-17 Understand why someone appears
- UF-18 Complete a FollowUp from Today
- UF-19 Snooze a FollowUp
- UF-20 Skip for today
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
| Contact confirmation | Informational | Always required after an external handoff |
| New Interaction date | Informational | Current local date/time, editable before save |

### Deterministic behaviour

- PeopleOS never records an Interaction merely because WhatsApp or email was opened.
- Returning from an external handoff always asks the user whether contact occurred.
- A manually logged Interaction starts with the current local date/time; the user may edit it before saving.
- Interaction kinds that count as contact are fixed by the accepted deterministic policy.
- V1 has no global default channel, interaction kind, auto-logging option, or per-Person communication preference here.

### User flows affected

- UF-12 Log an Interaction
- UF-13 Edit or delete an Interaction
- UF-18 Complete a FollowUp from Today
- UF-22 Message on WhatsApp
- UF-23 Email a Person
- UF-34 Complete outreach and decide what happens next

## 8. Notifications

### Purpose

State notification capability honestly without requesting permissions or implying that background reminders exist.

### Available options and defaults

| Row | Options | Default |
|---|---|---|
| Notifications | Informational only | Off; unavailable in Version 1 |

### Deterministic behaviour

- V1 sends no browser, push, email, SMS, or background notifications.
- The section does not request operating-system permission and contains no disabled toggle that suggests the feature is available.
- Due items appear when PeopleOS is opened and Today is evaluated.
- Adding notifications later requires a separate product, permission, delivery, timezone, retry, and privacy decision.

### User flows affected

- UF-01 First launch
- UF-16 Review Today
- UF-33 Reach Out reminder appears in Today

## 9. Privacy & Security

### Purpose

Make the local-first trust boundary visible and explain protections and limitations.

### Available options and defaults

| Row | Options | Default |
|---|---|---|
| Data location | Informational | Stored locally on this device/browser |
| Network behavior | Informational | No account, sync, analytics, or background contact access |
| Device protection | Informational | Relies on device/browser access controls |
| Privacy explanation | Open privacy detail | Available |

### Deterministic behaviour

- PeopleOS makes no claim that local IndexedDB is encrypted by the application.
- Data leaves PeopleOS only through an explicit user action such as backup export, vCard export, or external message handoff.
- V1 has no app PIN, biometric lock, hidden mode, analytics consent, cloud encryption, account, or session setting.
- External app and file-system security are owned by the device/platform and described accurately.

### User flows affected

- UF-01 First launch
- UF-22 Message on WhatsApp
- UF-23 Email a Person
- UF-24 Add to phone contacts
- UF-27 Export backup
- UF-28 Restore backup

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
- UF-07 Review a possible duplicate
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
  reachOutDefaultReminderDays?: 1 | 7 | 14 | 30;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
```

Absence of `reachOutDefaultReminderDays` means No reminder. Device timezone, device locale, notification availability, application version, and schema version are runtime facts and must not be duplicated into this record. `lastBackupGeneratedAt` remains backup metadata as defined by the readiness correction, not a user preference.

The record is included in backup/restore. If it is missing after first launch or migration, the application creates it with deterministic defaults. Unknown future fields are handled by schema migration rather than silently interpreted.

## 13. Validation and acceptance

- Region must be an ISO region supported by the bundled phone-number library.
- Capture mode must be one of the two defined values.
- Reach Out reminder days must be absent, 1, 7, 14, or 30.
- A stale revision cannot overwrite a newer preference value.
- Repeating the same save with the same revision/command identity produces one resulting update.
- Backup/restore round-trips every editable preference.
- Settings remains usable offline.
- Every informational row is announced as text, not as a disabled control.
- No Settings row reads or modifies a specific Person.
- No setting changes deterministic Relationship Engine rules.

## 14. Explicit exclusions

- Per-Person cadence, importance, tags, channel preference, Reach Out plan, or reminder
- Relationship Engine weights, ordering, stage boundaries, cues, or scoring
- AI, inferred defaults, recommendations based on usage, or “remember my last choice” behavior
- Theme and cosmetic customization
- Accounts, sync, provider integrations, analytics, or marketing preferences
- Notification permissions or delivery
- App PIN, biometric lock, or application-managed encryption
- Automatic backup, restore merge, or destructive clear-all action
