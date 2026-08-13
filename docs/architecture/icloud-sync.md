# iCloud Sync architecture

Status: implemented architecture contract, reconciled with the canonical application source.

## Product and trust boundary

PeopleOS keeps IndexedDB (`peopleos-v1`) as its canonical operational store. iCloud Sync is an optional replication and recovery feature for the Capacitor iOS build. It uses the signed-in device's iCloud account and only the private CloudKit database. There is no PeopleOS identity, login screen, hosted API, public database, analytics upload, or Contacts permission dependency. Web and unsupported environments remain local-only and keep the existing JSON backup and restore workflow.

The native boundary is a repository-owned Capacitor plugin. JavaScript owns schema validation, reconciliation, merge policy, durable metadata, and scheduling. Swift owns CloudKit account/zone operations, record transport, change tokens, CKRecord system fields, and error classification. Neither side logs record payloads or contact data.

## Existing canonical model and boundaries

The canonical schema is in `src/domain/schema.ts`; validation is in `src/domain/validation.ts`. `src/data/database.ts` opens IndexedDB version 5 and JSON export uses backup schema version 7. Earlier development histories independently used database version 3 and backup schema version 4 for different shapes, so the current migrations inspect and reconcile actual content, add missing Contacts/sync stores and indexes idempotently, and preserve legacy relationship scheduling fields. `src/data/repositories.ts` supplies generic optimistic-revision repositories, but compound application commands also write several stores directly in atomic IndexedDB transactions. Consequently sync capture cannot depend only on repository callbacks.

Every successful domain mutation increments `metadata.app.datasetRevision`. Sync scans every CloudKit-enabled canonical store after that revision changes and at startup, comparing records with durable sync shadows. This makes capture restart-safe even if the app terminates after the domain transaction commits but before an outbox entry is produced. A local action never waits for CloudKit.

Current identifiers are application-generated stable strings. Mutable records contain integer `revision`, ISO-8601 `createdAt`, and ISO-8601 `updatedAt`. Append-only records use stable IDs and an occurrence/creation time but no revision. User-visible removal is generally archival or terminal state, not physical deletion. Physical removals and full restore replacement must be represented by sync tombstones.

## Canonical stores and CloudKit mapping

CloudKit container: `iCloud.com.drlizlondon.peopleos`.

Database and zone: private database only; custom zone `PeopleOSZoneV1`.

Each logical entity is one CloudKit record. It is never aggregated into a database-sized blob. A single envelope record type, `PeopleOSEntityV1`, is used because JavaScript remains the schema authority and all entity kinds need the same transport fields. This avoids a native migration for every domain field while preserving independently addressable records and CloudKit incremental changes.

Record name is a deterministic, collision-safe encoding of `<store>:<entityId>` (base64url UTF-8). Fields are:

| CloudKit field | Meaning |
| --- | --- |
| `store` | Canonical store name from the allow-list below |
| `entityId` | Stable PeopleOS entity ID |
| `schemaVersion` | Sync payload schema, initially 1 |
| `revision` | Mutable local revision, or 0 for immutable records |
| `updatedAt` | Trustworthy application timestamp used for merge ordering |
| `deleted` | Tombstone flag |
| `deletedAt` | Tombstone timestamp when deleted |
| `originDeviceId` | Random installation ID, never an Apple/account identifier |
| `payload` | Validated JSON for exactly one entity; absent on tombstones |

The entity mapping is:

| IndexedDB store | Entity | Merge class | Effective timestamp |
| --- | --- | --- | --- |
| `people` | Person | mutable scalar | `updatedAt` |
| `contactMethods` | ContactMethod | mutable child | `updatedAt` |
| `affiliations` | OrganisationAffiliation | mutable child | `updatedAt` |
| `interactions` | Interaction | independently identified history | `updatedAt` |
| `events` | RelationshipEvent | mutable scalar | `updatedAt` |
| `memoryFacts` | MemoryFact | mutable child | `updatedAt` |
| `followUps` | FollowUp | mutable lifecycle aggregate | `updatedAt` |
| `followUpEvents` | FollowUpEvent | immutable append history | `occurredAt` |
| `conversationStarterUses` | ConversationStarterUse | local append history during compatibility rollout | `occurredAt` |
| `todaySkips` | TodaySkip | immutable append history | `createdAt` |
| `reachOutEntries` | ReachOutEntry | mutable lifecycle aggregate | `updatedAt` |
| `reachOutEvents` | ReachOutEvent | immutable append history | `occurredAt` |
| `reachOutContexts` | ReachOutContext | mutable scalar | `updatedAt` |
| `appSettings` | AppSettings (`app`) | mutable scalar | `updatedAt` |

`ExternalIdentity` has a canonical, empty-capable IndexedDB store and backup field. The current product does not create a continuous provider link, but retaining the store keeps imported legacy data valid and avoids a future transport redesign. Older backups without the field migrate it to `[]`.

`metadata` is device-local and never synchronised. Sync metadata stores are also device-local. `conversationStarterUses` is canonical local data and is included in JSON backups, but its CloudKit upload is deferred for this release so older clients in `PeopleOSZoneV1` never receive an unknown store. This release ignores future remote stores and advances the zone token. A later release may enable starter-history upload only after this compatibility version is the supported floor, and must force a one-time full-zone fetch when doing so.

## Durable local sync state

The current version-5 database contains:

* `externalIdentities`: canonical entity store.
* `syncRecords`: one shadow per `<store>:<id>` containing status, local revision/timestamp/fingerprint, acknowledged remote revision/timestamp, record name, change tag/system fields, retry count, last error category, and acknowledgement time.
* `syncOutbox`: durable create/update/delete operations with payload snapshot, attempt count, next attempt time, and creation/update times.
* `syncTombstones`: durable deletions with store, ID, record name, deleted time, origin device, last acknowledgement and retention time.
* `syncState`: singleton with enabled flag, installation ID, server change token, initial migration phase, scan revision, last attempt/success, current error category, backoff, and account state.

Outbox operation IDs are deterministic (`<recordName>:<logicalVersion>`). Re-scanning updates or reuses the pending operation instead of duplicating it. Successful pushes atomically acknowledge the shadow and remove the outbox item. Partial failures acknowledge only successful items and retain failed items.

## Merge and conflict rules

All incoming values are store-allow-listed, parsed, and passed through the existing record/dataset validation before commit. Cloud reconciliation never invokes duplicate-person matching and never merges people based on names or contact values.

1. Records are matched only by canonical store and stable entity ID.
2. Local-only records are queued for upload. Remote-only records are imported after dependency-safe ordering.
3. Mutable records use `(updatedAt, revision, originDeviceId, canonicalPayload)` as a deterministic descending comparison. Newer `updatedAt` wins; then higher revision; then lexically greater origin device ID; then lexically greater canonical JSON. The winning remote record is written locally unchanged. A local winner is queued for upload.
4. Independently identified history records (`interactions`, `followUpEvents`, `todaySkips`, `reachOutEvents`) coexist by ID. Same-ID identical payloads converge. A same-ID payload collision uses the same deterministic tuple, is surfaced as needs-attention diagnostics, and never replaces a differently identified history record.
5. Child entities and relationships merge by stable entity ID. Import order is parents/contexts/events, then children/aggregates, then append history. Temporarily unresolved references remain pending for the next reconciliation rather than being dropped.
6. Settings are one mutable record with ID `app` and follow scalar rules.
7. A tombstone competes with a live record using its `deletedAt` against the live `updatedAt`. Newer deletion wins. On exact timestamp equality, deletion wins. A later intentional local recreation/update may win only if its `updatedAt` is strictly later than `deletedAt`; it queues a save which clears the remote tombstone.
8. Once a deletion wins, the local live record is removed and its tombstone retained, so an older remote/device copy cannot resurrect it.
9. CloudKit change-tag conflicts are transport conflicts, not domain policy. The adapter returns the server record; JavaScript applies these rules and retries the resulting winner.

## Deletion and compaction

Every scan compares prior sync shadows with canonical stores. A missing previously observed record produces a durable tombstone and delete operation. Remote deletions produce the same local tombstone. Full JSON restore first creates a recovery export, then reconciliation records every displaced prior entity as a tombstone.

Tombstones are retained locally for at least 180 days after their deletion and at least 30 days after a confirmed CloudKit acknowledgement, whichever is later. They are compacted only after a successful full-zone reconciliation proves no older live record remains. Remote records use tombstone envelopes rather than immediate CloudKit hard deletion during normal operation; this allows other devices to learn the deletion. A future explicit zone-reset recovery may physically remove records only after a local recovery snapshot and user choice.

## Initial enablement and migration contract

Initial phases are durable: `notStarted -> readingRemote -> reconciling -> uploading -> verifying -> complete`. Each phase may repeat safely.

1. Verify an available iCloud account and ensure `PeopleOSZoneV1`.
2. Fetch the complete remote zone without changing local data.
3. Scan the complete local canonical dataset and create shadows.
4. Reconcile the union by stable store/ID using the rules above.
5. Apply remote winners in dependency-safe IndexedDB transactions; never replace populated local data merely because remote is empty.
6. Queue and push local winners/local-only records in bounded batches.
7. Fetch changes again from the initial boundary; reconcile anything concurrent.
8. Persist the final server change token and mark `complete` only after all applicable operations are acknowledged and validation succeeds.

An interruption resumes from the stored phase. Stable record names, deterministic operations, idempotent CloudKit saves, and union reconciliation prevent duplication. Pending operations survive schema migration. Migrations first transform their payload snapshots using the same versioned payload migrator, or retain them as needs-attention if no safe migration exists.

## Native plugin contract

`PeopleOSCloudSync` exposes `getAccountStatus`, `ensureZone`, `pushOperations`, `fetchChanges`, `fetchAllRecords`, and `getSyncHealth`. Inputs have explicit size and type bounds. Results contain no unparsed Swift errors. Error categories are `no_account`, `restricted`, `temporarily_unavailable`, `network_unavailable`, `quota_exceeded`, `authentication_changed`, `partial_failure`, `rate_limited`, `server_rejected`, `change_token_expired`, `record_conflict`, `malformed_payload`, and `unknown`.

Push batches are capped at 100 records and payloads at 900 KiB. Fetch pages are bounded. Change tokens and archived CKRecord system fields are base64 strings. Diagnostics contain category, retryability, retry-after time, and operation IDs only—never payloads, names, telephone numbers, email addresses, notes, or Apple account identifiers.

## Scheduling and states

Sync runs after a short debounced local dataset revision change, on app activation, on browser `online`, on `Sync Now`, and every five minutes while active. Only one run is allowed at a time. Push/fetch batches are bounded. Retry uses exponential backoff from 5 seconds to 6 hours with full jitter and honours CloudKit retry-after values. There is no promise of continuous background execution.

Settings maps internal state to exactly one user-facing state: Stored on this iPhone only, Setting up iCloud Sync, Syncing, Up to date, Sync paused, or Sync needs attention. Dates use `en-GB`. Technical identifiers, record counts, and CloudKit terms are omitted. Manual JSON export/restore remains visible.

## iOS capabilities and owner-controlled provisioning

The target keeps bundle ID `com.drlizlondon.peopleos`. Required entitlements are:

* `com.apple.developer.icloud-container-identifiers = [iCloud.com.drlizlondon.peopleos]`
* `com.apple.developer.icloud-services = [CloudKit]`
* `com.apple.developer.ubiquity-kvstore-identifier = $(TeamIdentifierPrefix)com.drlizlondon.peopleos`
* `aps-environment` is not required for this foreground-first slice.

The owner must register/enable the iCloud container for the existing App ID in Apple Developer, assign it to the target's signing team, regenerate provisioning profiles, and deploy the Development CloudKit schema to Production before App Store distribution. These are portal actions; the repository must not invent or change a signing team, bundle ID, production schema, or app identity.

## Safety, recovery, privacy, and limitations

JSON export/import remains an independent backup. Restore creates and downloads a local recovery snapshot before replacement when sync is enabled, pauses sync during replacement, and resumes with tombstone-aware reconciliation after explicit confirmation. Empty remote never clears populated local data. No production control casually deletes cloud data; a DEBUG-only native zone-reset path may be used by integration tests.

The feature depends on an iCloud account, available quota/network, correct entitlements, and owner provisioning. Simulator CloudKit integration requires a signed build and an iCloud account; deterministic application tests use a fake adapter. CloudKit provides synchronisation, not collaborative multi-user sharing. iOS controls execution time, so foreground and resume sync are the reliable paths.
