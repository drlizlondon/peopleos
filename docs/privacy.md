# PeopleOS privacy

Last updated: 11 August 2026

PeopleOS is local-first. Its operational data is stored in IndexedDB on the device. PeopleOS has no product account, hosted API, advertising profile, or contact-data analytics.

When the user optionally enables **iCloud Sync** in the iPhone app, PeopleOS stores encrypted-in-transit copies of enabled PeopleOS records in that user's private iCloud storage and synchronises them through Apple CloudKit. PeopleOS uses the device-level iCloud account only to establish access; it does not receive or display the user's Apple account identifier. Data is never written to a public CloudKit database or silently sent to another service.

iCloud Sync does not request Contacts permission. Importing contacts remains a separate, explicit workflow. Production diagnostics contain sync state and structured error categories only, never names, phone numbers, email addresses, notes, relationship data, or full record payloads.

Manual JSON export and restore remain available as an independent backup method. iCloud synchronisation is not represented as the only backup. Before a destructive restore while sync is enabled, PeopleOS creates a local recovery snapshot and requires an explicit confirmation.

## Local notifications

Today reminders are optional and available only in the native iPhone app. PeopleOS checks notification permission on launch but requests normal iOS permission only after the user explicitly turns reminders on. The default time is 12:00 local and can be changed; turning reminders off cancels pending PeopleOS summaries.

Scheduling and delivery use Apple's on-device `UNUserNotificationCenter` through the official Capacitor local-notifications adapter. PeopleOS does not use a notification backend, remote push service, advertising identifier, or notification analytics. It precomputes a bounded set of up to 30 anonymous daily occurrences and refreshes that set when the app launches, changes foreground/background state, or its local data/settings change. A plan is calculated in the device's current time zone; after travel, opening PeopleOS refreshes it for the new local zone.

The notification title is `PeopleOS`. The body contains either a current same-day count or the general wording “People are waiting on your list today.” It does not contain names, phone numbers, email addresses, Person or FollowUp identifiers, reasons, notes, affiliations, memory facts, or relationship details. Tapping carries only a semantic instruction to open Today and never contacts anyone or records an interaction.

## Control and deletion

PeopleOS data remains on the device until the user edits/deletes records, restores a different backup, clears the site's/app's local storage, or removes the app and its data through the operating system. JSON backups remain wherever the user chooses to save them. When iCloud Sync is enabled, copies remain in the user's private iCloud storage under Apple's controls; pausing sync stops PeopleOS from sending further changes but does not silently delete existing iCloud records.

Notification permission can be revoked in iPhone Settings at any time. Turning reminders off in PeopleOS cancels the app's pending local summaries. Removing delivered notifications remains under the user's normal iOS Notification Centre controls.

PeopleOS does not sell personal data, share relationship data with advertisers, or use contact data for marketing. A public support contact and operator identity must be published with the App Store release; those release details are not yet present in this repository.
