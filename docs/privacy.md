# PeopleOS privacy

PeopleOS is local-first. Its operational data is stored in IndexedDB on the device. PeopleOS has no product account, hosted API, advertising profile, or contact-data analytics.

When the user optionally enables **iCloud Sync** in the iPhone app, PeopleOS stores encrypted-in-transit copies of enabled PeopleOS records in that user's private iCloud storage and synchronises them through Apple CloudKit. PeopleOS uses the device-level iCloud account only to establish access; it does not receive or display the user's Apple account identifier. Data is never written to a public CloudKit database or silently sent to another service.

iCloud Sync does not request Contacts permission. Importing contacts remains a separate, explicit workflow. Production diagnostics contain sync state and structured error categories only, never names, phone numbers, email addresses, notes, relationship data, or full record payloads.

Manual JSON export and restore remain available as an independent backup method. iCloud synchronisation is not represented as the only backup. Before a destructive restore while sync is enabled, PeopleOS creates a local recovery snapshot and requires an explicit confirmation.
