# PeopleOS Version 1 Implementation Readiness Review

Review date: 2026-07-22

Notification sections in this historical readiness review were superseded by POS-D047 on 2026-08-11. The implemented chargeable MVP contract is Off by default, normal iOS permission after explicit opt-in, editable local time defaulting to 12:00, at most 30 verified anonymous native occurrences, and tap-to-Today only.

Documents reviewed in full: `PRODUCT_SPEC.md`, `SCREEN_SPECIFICATIONS.md`, `USER_FLOWS.md`, `RELATIONSHIP_ENGINE_SPEC.md`, `NAVIGATION.md`, `SETTINGS_SPEC.md`, `VERSION1_SCOPE.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `ROADMAP.md`, `PROJECT.md`, `README.md`, and `ARCHITECTURE_REVIEW.md`.

This review challenges implementation readiness without reopening accepted product choices. Product precedence follows `PRODUCT_SPEC.md`: V1 scope, Relationship Engine behavior, screen behavior, flows, and navigation take precedence over older architecture-roadmap wording in that order.

## 1. Verdict

# READY WITH REQUIRED CORRECTIONS

The product is coherent and appropriately constrained, but 12 implementation contracts must be settled before their blocked packages begin. They are gaps where the current documents either contradict each other, cannot represent a required state, or would force an implementer to invent behavior.

V1-01 is safe to begin after this review is accepted. V1-02 and later packages are not safe until the corrections that affect them are incorporated into an authoritative pre-implementation contract or the named specification documents.

## 2. Required corrections

### RC-01 — Fix the temporal contract for follow-ups, cadence, and local days

- **Affected documents:** `DATA_MODEL.md`, `RELATIONSHIP_ENGINE_SPEC.md`, `PRODUCT_SPEC.md`, `SCREEN_SPECIFICATIONS.md`
- **Exact conflict or missing contract:** Product behavior says FollowUps are calendar-date plans evaluated in the device timezone, while the data model uses unconstrained strings named `dueAt` and `snoozedUntil`. Interactions are time-bearing. Cadence offers Monthly, Every 3 months, Every 6 months, and Yearly while the model stores only `contactCadenceDays`. It is undefined whether those labels use calendar arithmetic or 30/90/180/365 days.
- **Recommended resolution:** Store FollowUp `dueDate` and `snoozedUntilDate` as validated `YYYY-MM-DD` calendar dates with no timezone conversion. Store Interaction timestamps as UTC ISO instants. Store skip keys as the user's local `YYYY-MM-DD`. Keep `contactCadenceDays`; map Monthly/3 months/6 months/Yearly to exactly 30/90/180/365 days and display the actual day count in expanded explanations. Date comparison receives the current timezone and local date explicitly.
- **Why it matters:** Different reasonable implementations would surface a person on different days, especially around travel, daylight-saving changes, and month boundaries.
- **Package blocked:** V1-02, V1-03, V1-07, V1-08, V1-09, V1-10
- **Proposed acceptance test:** Given the same date records, injected instants immediately before and after local midnight in Europe/London produce the documented state; changing device timezone does not mutate stored FollowUp dates; cadence presets evaluate at 30/90/180/365 elapsed local calendar days exactly.
- **Strongest alternative considered:** Store all dates as UTC instants and model cadence as calendar intervals.
- **What could make this recommendation wrong:** If V1 later adds time-of-day reminders or cross-timezone shared plans, date-only storage will need an explicit migration. Neither exists in accepted V1.

### RC-02 — Add an append-only FollowUp lifecycle contract and resolve completion duplication

- **Affected documents:** `DATA_MODEL.md`, `PRODUCT_SPEC.md`, `USER_FLOWS.md`, `SCREEN_SPECIFICATIONS.md`
- **Exact conflict or missing contract:** V1 must show repeated snoozes, reschedules, cancellation, completion mode, and lifecycle history. The current FollowUp snapshot preserves only one `snoozedUntil`, status, and timestamps. It cannot reconstruct repeated transitions or cancellation time. The data model says every completion creates `follow_up_completed`, while the product says completion with contact creates a contact Interaction and completion without contact creates `follow_up_completed`; following both would duplicate completion history.
- **Recommended resolution:** Add an append-only `FollowUpEvent` owned by FollowUp with event kinds `created`, `snoozed`, `rescheduled`, `completed_with_contact`, `completed_without_contact`, and `cancelled`; store occurred time and transition-specific from/to dates or linked replacement/Interaction IDs. Keep FollowUp as the current snapshot for queries. Completion with contact creates one contact Interaction linked to the FollowUp and one lifecycle event; it does not create `follow_up_completed`. Completion without contact creates one `follow_up_completed` Interaction and one lifecycle event. Timeline projection coalesces the linked lifecycle event and Interaction into one visible item. Reschedule marks the original superseded, creates the replacement, and links both in one transaction.
- **Why it matters:** Without this, the specified timeline is unrecoverable, retry behavior can duplicate visible history, and last contact can be incorrectly updated.
- **Package blocked:** V1-02, V1-05, V1-07, V1-08, V1-09, V1-10, V1-11
- **Proposed acceptance test:** A FollowUp snoozed twice, rescheduled, and completed with a WhatsApp interaction yields a complete immutable lifecycle, one visible completion timeline item, one contact interaction, the correct final status, and correct last contact. Completion without contact yields no last-contact change.
- **Strongest alternative considered:** Store only the latest FollowUp snapshot and render no lifecycle beyond current status.
- **What could make this recommendation wrong:** If FollowUp lifecycle is removed from Profile and Timeline, the append-only events would be unnecessary. Lifecycle is explicitly accepted V1 behavior.

### RC-03 — Represent Skip for today as durable domain state

- **Affected documents:** `DATA_MODEL.md`, `ARCHITECTURE.md`, `RELATIONSHIP_ENGINE_SPEC.md`, `USER_FLOWS.md`
- **Exact conflict or missing contract:** The engine requires one-day skip state and the flow promises the card stays hidden for the local day, survives recalculation, and can be undone. No entity or engine input represents it. Session-only UI state would reappear on reload and would repeat the inherited Real Friends behavior that PeopleOS intentionally left behind.
- **Recommended resolution:** Add a minimal `TodaySkip` record containing `personId`, `localDate`, and `createdAt`, uniquely keyed by `(personId, localDate)`. Skip is person-scoped because Today displays one card per Person even when several FollowUps are due. Undo deletes that exact record. Expired records may be ignored on read and pruned opportunistically.
- **Why it matters:** The same action currently has different outcomes after navigation, reload, or a second app window.
- **Package blocked:** V1-02, V1-07, V1-08, V1-09, V1-10
- **Proposed acceptance test:** Skip an eligible Person, reload and reopen Today on the same local date, and confirm absence; undo restores the Person; injected next-day date makes the Person eligible without modifying the FollowUp.
- **Strongest alternative considered:** Keep skips in React session state.
- **What could make this recommendation wrong:** If the accepted behavior is changed to “hide only until reload.” It currently promises the remainder of the local day.

### RC-04 — Define capture as an atomic Person-plus-context command

- **Affected documents:** `PRODUCT_SPEC.md`, `SCREEN_SPECIFICATIONS.md`, `USER_FLOWS.md`, `DATA_MODEL.md`
- **Exact conflict or missing contract:** Add Person, Quick Networking Capture, and Batch Event Capture collect “where met” or an Event, but Person intentionally has no event field. Event participation and the seven-day new-relationship rule require an Interaction. No document explicitly says what capture persists, so an implementer could save context nowhere, save it as a prohibited Person field, or create different Interaction kinds.
- **Recommended resolution:** A capture with Where met or Event atomically creates the Person and one contact-counting `met` Interaction. Use the supplied Event date when present, otherwise the user-confirmed capture date; attach `eventId` and store free-text Where met in the Interaction summary. A capture without meeting context creates only Person. Quick and Batch capture always require Event and therefore always create the `met` Interaction. `conference` remains a separately selected Interaction kind when the user explicitly logs attendance as that event.
- **Why it matters:** Event search/grouping, relationship age, stage, duplicate evidence, suggested seven-day reminders, and Today eligibility all depend on this source fact.
- **Package blocked:** V1-03, V1-04, V1-05, V1-09, V1-12
- **Proposed acceptance test:** Save a Person with an Event and confirm one Person and one linked `met` Interaction are committed together; force child persistence failure and confirm neither is saved; seven days later the engine produces the New relationship reason with the Event name.
- **Strongest alternative considered:** Store a lightweight `whereMet` field on Person until Interaction UI exists.
- **What could make this recommendation wrong:** If “where met” is intended as descriptive identity rather than historical contact. The accepted architecture explicitly derives Event participation from Interactions.

### RC-05 — Make the Relationship Engine capable of producing the complete ordered Today result

- **Affected documents:** `ARCHITECTURE.md`, `RELATIONSHIP_ENGINE_SPEC.md`, `SCREEN_SPECIFICATIONS.md`
- **Exact conflict or missing contract:** The architecture accepts one Person at a time and returns a `priorityBand` that cannot distinguish overdue from due-today, expose the relevant ordering date, or identify primary/additional FollowUps. Global ordering would therefore have to occur in the UI or an unspecified service, contradicting the rule that relationship logic belongs in the engine. Architecture and engine specifications also disagree on within-band tie order; the Relationship Engine spec is authoritative.
- **Recommended resolution:** Define two pure engine operations: `assessRelationship(personBundle, clock)` for per-Person projections and `buildToday(assessments, skips, clock, limit)` for eligibility, global ordering, and pagination. Each Today item returns `eligibilityCode`, `dueState`, `relevantDate`, `primaryFollowUpId`, `additionalDueFollowUpIds`, `explanation`, `suggestedAction`, and stable Person ID. Follow `RELATIONSHIP_ENGINE_SPEC.md` ordering exactly: overdue explicit, due-today explicit, New, cadence; then the documented band tie-breakers. Pagination slices the one fully sorted result.
- **Why it matters:** Otherwise Today ordering, “Also due,” and Show more cannot be implemented without placing domain behavior outside its owner.
- **Package blocked:** V1-09, V1-10, V1-11
- **Proposed acceptance test:** A fixture containing all four eligibility bands, equal dates, mixed importance, multiple due FollowUps, and more than ten People produces an exact stable ordered ID list and stable pages independent of input array order.
- **Strongest alternative considered:** Let the application service sort per-Person assessments.
- **What could make this recommendation wrong:** If application services are explicitly declared part of the Relationship Engine boundary. The current invariant says the engine owns relationship logic; naming the batch operation is clearer and easier to test.

### RC-06 — Define when the New relationship rule has already been satisfied

- **Affected documents:** `RELATIONSHIP_ENGINE_SPEC.md`, `DATA_MODEL.md`
- **Exact conflict or missing contract:** The rule excludes a Person when there is a “later completed or cancelled first follow-up,” but FollowUp has no `first follow-up` purpose and `suggestedByRule` is optional. A manual FollowUp could either suppress or fail to suppress the rule depending on implementation.
- **Recommended resolution:** The New relationship rule applies only when the Person has exactly one contact Interaction and no FollowUp of any status was created for that Person after that contact. A pending future FollowUp continues to suppress all other Today reasons. Any completed, cancelled, or superseded later FollowUp permanently satisfies the “follow-up was planned” part of the New rule. `suggestedByRule` remains explanation provenance, not eligibility authority.
- **Why it matters:** Without this, the same history can repeatedly regenerate a first-follow-up prompt or disappear unexpectedly.
- **Package blocked:** V1-07, V1-09
- **Proposed acceptance test:** For a Person with one contact eight days ago, verify eligibility with no later FollowUp; then verify ineligibility for pending, completed, cancelled, and superseded later FollowUps; verify a FollowUp created before the contact does not suppress the rule.
- **Strongest alternative considered:** Add a special `new_relationship_follow_up` purpose field to FollowUp.
- **What could make this recommendation wrong:** If future analytics must distinguish why every manual FollowUp was created. V1 does not require that taxonomy, and `suggestedByRule` already preserves accepted suggestion provenance.

### RC-07 — Define executable action mapping and structured communication preference

- **Affected documents:** `DATA_MODEL.md`, `RELATIONSHIP_ENGINE_SPEC.md`, `SCREEN_SPECIFICATIONS.md`, `USER_FLOWS.md`
- **Exact conflict or missing contract:** Today can suggest Message, Email, Call, Arrange meeting, Make introduction, Send update, Other, or Add contact details, but only WhatsApp and email have complete handoff flows. Communication preference is an unrestricted Fact string, so the engine cannot deterministically match it to a channel. Networking/Coffee/Custom templates have no baseline content or missing-Event behavior.
- **Recommended resolution:** Make Communication preference a controlled V1 value of `whatsapp`, `email`, or `phone`, rendered as a Fact. Treat FollowUp action and communication preference as intended-action context only; neither silently selects a Today control or target. Contact now resolves zero, one, or several executable targets from active methods, opening one directly or requiring an explicit chooser. V1-13 adds WhatsApp as a phone-derived target and makes template composition reachable from a non-Today Profile action. Use fixed editable starting drafts: Networking with Event — “Hi {firstName}, it was lovely meeting you today at {event}. Great chatting with you.”; Networking without Event — “Hi {firstName}, it was lovely meeting you today. Great chatting with you.”; Coffee — “Lovely seeing you today. Let's catch up again soon.”; Custom — blank. Email subject starts blank. Do not add an owner-profile setting or saved-template system.
- **Why it matters:** Several specified primary actions currently lead nowhere or require guessing text/channel behavior.
- **Package blocked:** V1-06, V1-08, V1-09, V1-10, V1-13
- **Proposed acceptance test:** Table-test every FollowUp action and communication-preference value as explanatory context; independently test zero, one, and several resolved contact targets, including one phone producing Call and WhatsApp; assert exact Profile-composition draft for Event/no-Event and that editing is always possible.
- **Strongest alternative considered:** Reduce V1 FollowUp actions to Message and Email.
- **What could make this recommendation wrong:** If V1 intends native call or action-specific composition flows. Those are not specified and would broaden scope.

### RC-08 — Complete deterministic duplicate, import, and retry rules

- **Affected documents:** `PRODUCT_SPEC.md`, `SCREEN_SPECIFICATIONS.md`, `USER_FLOWS.md`, `DATA_MODEL.md`
- **Exact conflict or missing contract:** “Similar name” is undefined; vCard versions and “reasonable” size limits are left to implementation; retrying failed import rows without duplicating successful rows has no identity contract. The duplicate evidence type assumes IDs for an unsaved candidate.
- **Recommended resolution:** In V1, “similar name” means equality after Unicode case folding, diacritic removal, punctuation removal, and whitespace collapse; do not use edit-distance/fuzzy matching. Combine that equality with same normalized current organisation or same explicit Event. Support vCard 3.0 and 4.0, UTF-8, up to 5 MiB and 5,000 cards; reject the whole file before writes when outer limits/version/encoding are unsupported. Assign stable candidate and child IDs during preview. Import selected rows in one transaction per Person; retry reuses those IDs, and successful rows are immutable in the import session. “Add details to existing” adds only non-identical methods/affiliation after field-level confirmation.
- **Why it matters:** Duplicate results and import outcomes would otherwise vary by library or retry timing, and double submission could create duplicate People.
- **Package blocked:** V1-02, V1-04, V1-12
- **Proposed acceptance test:** Golden fixtures cover normalization, same-name-only non-warning, organisation/Event combined warnings, vCard 3/4 parsing, limit rejection before writes, partial row failure, double-click, and retry with unchanged entity counts.
- **Strongest alternative considered:** Use edit distance or a phonetic matching library for names.
- **What could make this recommendation wrong:** If real-world testing shows exact normalized names miss too many valuable warnings. A later deterministic rule can be added with evidence and tests; V1 should favor precision and explainability.

### RC-09 — Define deterministic profile, affiliation, timeline, and People query projections

- **Affected documents:** `DATA_MODEL.md`, `SCREEN_SPECIFICATIONS.md`, `RELATIONSHIP_ENGINE_SPEC.md`
- **Exact conflict or missing contract:** Several current affiliations are allowed, yet Profile/Search/duplicate/cue views use singular “current organisation.” Affiliation can be archived in S20 but has no `archivedAt`. Profile shows “up to three prominent facts” without ranking. Timeline equal-timestamp order is required but undefined. People default order and Missing contact details are underspecified; typo-tolerant search “may” activate.
- **Recommended resolution:** Add `archivedAt` to affiliation. Derive the display affiliation from active current affiliations by latest known `startedOn`, then latest `createdAt`, then ID; list all current affiliations in S20. Rank compact profile facts by the Memory Cue kind order, then `updatedAt` descending, then ID, excluding the already displayed cue; include Family/Other only when cue-enabled. Timeline order is `occurredAt` descending, then visible source rank Interaction before FollowUp lifecycle before Person creation, then ID; linked completion records coalesce under RC-02. People default order is People with a contact Interaction by last contact descending, followed by People without contact by `createdAt` descending, with display name then ID ties. Missing contact details means no active valid phone and no active valid email. Omit typo-tolerant search from V1; direct normalized token/prefix behavior remains.
- **Why it matters:** These views have deterministic acceptance criteria but presently permit different valid outputs. Affiliation archive cannot be represented at all.
- **Package blocked:** V1-02, V1-03, V1-05, V1-06, V1-08, V1-09, V1-11
- **Proposed acceptance test:** Seed multiple current/past/archived affiliations, several same-kind Facts, equal-time timeline events, and People with/without contact; assert exact projections and ordering, including no fuzzy typo result.
- **Strongest alternative considered:** Add user-controlled primary affiliation and fact pinning.
- **What could make this recommendation wrong:** If users need to choose a public professional identity independent of chronology. That is not a V1 requirement and would add more maintenance.

### RC-10 — Specify mutation atomicity, idempotency, stale edits, and backup envelope

- **Affected documents:** `ARCHITECTURE.md`, `DATA_MODEL.md`, `SCREEN_SPECIFICATIONS.md`, `USER_FLOWS.md`, `VERSION1_SCOPE.md`
- **Exact conflict or missing contract:** Compound commands promise no partial records and safe retry, but no command boundary, idempotency strategy, or concurrent-edit policy exists. Restore must be atomic. Settings conditionally promotes backup when none has been made, but no state records successful generation. Backup version/date are displayed but no envelope defines them.
- **Recommended resolution:** Generate stable entity IDs when a draft begins and reuse them on Retry; execute every aggregate command in one IndexedDB read-write transaction. Add integer `revision` to mutable records and require expected revision on update; stale edits fail with “This changed elsewhere—reload and try again,” preserving the user's draft. Compound completion/import commands carry stable child IDs so retry is idempotent without a generic command bus or command log. Define backup envelope `{ product: "peopleos", schemaVersion, exportedAt, data }`; restore validates completely then replaces all stores in one transaction and increments a dataset revision so open views reload. Add `lastBackupGeneratedAt` to Settings, recorded after a valid backup blob is produced.
- **Why it matters:** Double taps, uncertain failures, overlapping tabs, or restore can otherwise duplicate interactions, lose edits, or leave cross-store corruption.
- **Package blocked:** V1-02 and every mutation package after it
- **Proposed acceptance test:** Repeat each create/complete/import command with identical IDs and assert one result; submit stale revisions and assert no overwrite; inject failure halfway through compound commands/restore and assert the original database is byte-equivalent; verify backup metadata and current-schema round trip.
- **Strongest alternative considered:** Rely on disabled buttons, IndexedDB transaction serialization, and last-write-wins.
- **What could make this recommendation wrong:** If V1 explicitly supports only one foreground view with no retry after uncertain failure. The specifications promise Retry and do not prohibit multiple tabs/PWA windows.

### RC-11 — Remove the batch shared-FollowUp action

- **Affected documents:** `USER_FLOWS.md`, `VERSION1_SCOPE.md`, `SCREEN_SPECIFICATIONS.md`
- **Exact conflict or missing contract:** UF-05 allows accepting one shared FollowUp date for selected newly created People. `VERSION1_SCOPE.md`, which has scope precedence, explicitly excludes mass FollowUp creation. S04 does not define the selection or confirmation UI.
- **Recommended resolution:** Remove the shared FollowUp action from Batch completion. The summary may offer “Plan follow-up” for one selected Person at a time, returning to the summary after save. Do not add bulk selection.
- **Why it matters:** Keeping it would violate accepted V1 scope and require an undefined bulk command, partial-failure behavior, and selection UI.
- **Package blocked:** V1-12
- **Proposed acceptance test:** Batch summary contains no multi-Person FollowUp action; planning a FollowUp opens one Person at a time and creates exactly one FollowUp.
- **Strongest alternative considered:** Permit a small Event-scoped batch FollowUp command.
- **What could make this recommendation wrong:** If shared event FollowUps are explicitly promoted into V1 scope later. That would require its own flow and failure contract.

### RC-12 — Repair package boundaries and make final quality criteria testable

- **Affected documents:** `VERSION1_SCOPE.md`, `SCREEN_SPECIFICATIONS.md`, `ROADMAP.md`
- **Exact conflict or missing contract:** V1-02 promises backup/restore before the complete schema exists; V1-03 and V1-06 both own affiliations; V1-07 claims Skip before Today exists; V1-10 requires handoffs whose templates are assigned to V1-13. “Performance checks” and the “chosen WCAG target” are undefined. Some package acceptance relies on functionality scheduled later.
- **Recommended resolution:** Keep the 13 package names/order but fix ownership: V1-02 establishes the complete V1 schema, repositories, validators, migration/backup envelope, Reach Out stores, and domain test fixtures for all entities; later packages add behavior/UI. V1-03 owns capture plus creation of the first current affiliation and provisional Person base. V1-06 owns affiliation-history management. V1-07 owns `TodaySkip` domain storage/commands tested without UI. V1-08 owns Reach Out behavior and linked FollowUp commands. V1-10 owns the complete WhatsApp/email handoff templates and confirmation flow. V1-13 owns vCard contact export plus hardening. V1-05 tests that Interaction creation is explicit, while external-handoff non-recording moves to V1-10. Set accessibility target to WCAG 2.2 AA for applicable criteria. Define a non-flaky performance smoke fixture of 500 People, 10,000 Interactions, 1,000 FollowUps, and 250 Reach Out entries, and require Today, Reach Out, and first Search results within 1 second in the automated reference environment after storage load; treat the under-20-second capture target as a timed manual usability check, not a deterministic unit test.
- **Why it matters:** Packages must be independently testable and must not require future UI or undefined standards to pass.
- **Package blocked:** V1-02 through V1-13 until their package contracts are corrected; V1-01 is unaffected
- **Proposed acceptance test:** A dependency lint/checklist maps every package acceptance item to a prerequisite package or its own scope; no test references a later-owned screen; automated accessibility tests target WCAG 2.2 AA rules and the fixed performance fixture produces a recorded result.
- **Strongest alternative considered:** Reorder the 13 packages substantially around vertical features.
- **What could make this recommendation wrong:** If the team prefers to replace the accepted package sequence entirely. The proposed correction preserves all 13 packages and limits changes to ownership.

## 3. Non-blocking observations

These are not reasons to delay V1-01 or, once the relevant corrections are made, later packages.

1. **The roadmap keeps historical POS packages.** Its header correctly makes `VERSION1_SCOPE.md` authoritative for the accepted implementation sequence. The duplication is navigation overhead, but current behavior and guardrails are aligned and do not require a second implementation path.
2. **README points to the historical roadmap.** The README says implementation should proceed through `ROADMAP.md`, while that document redirects to `VERSION1_SCOPE.md`. The redirect is sufficient, but direct README wording would be clearer later.
3. **ExternalIdentity storage is unnecessary in V1.** Preserve the domain boundary in documentation, but do not create Google/LinkedIn adapters, OAuth infrastructure, provider caches, or sync tables. A type/interface can wait until an approved integration uses it. The strongest alternative is an empty provider store now; that risks cementing guesses about future APIs. This recommendation would be wrong only if an accepted V1 feature needs provider linkage; none does.
4. **Do not build a generic command bus or event-sourcing framework.** RC-02 needs a small FollowUp lifecycle table and RC-10 needs transactional application commands, not CQRS, a universal event store, background projection workers, or plugin registries. The alternative becomes justified only with sync or multi-user coordination, both excluded.
5. **Search does not need a search engine.** Hundreds of People and the fixed V1 fixture can use indexed local records plus deterministic normalized matching. Do not add Elasticsearch-style infrastructure, embeddings, or fuzzy libraries unless profiling disproves this.
6. **Derived projections should remain on read.** Do not persist Today, stage, last contact, relationship age, cue, or search-result explanations. The strongest alternative is a projection cache; it becomes appropriate only after measured performance failure and must remain rebuildable/versioned.
7. **Exact message voice remains editable.** RC-07 supplies deterministic starting text without adding an owner profile. If user testing shows sender identification is essential, revise the template or add a single owner-name setting through a product decision; do not infer it.
8. **Undo duration is presentation detail.** The documents require Undo for safe reversible actions but not a precise toast duration. An accessible confirmation that remains available for the visible toast lifecycle is sufficient; this does not affect stored domain state.
9. **Hard deletion of a Person remains correctly excluded.** Interaction deletion is allowed. When deleting an Interaction referenced by `MemoryFact.sourceInteractionId`, clear the optional source reference and retain the explicitly confirmed Fact; never cascade-delete the Fact. This is a straightforward referential rule, not a reason to delay earlier packages.
10. **The 5 MiB/5,000-card recommendation is a safety bound, not a product limit.** It can be raised later from observed personal exports without changing the import model.

## 4. Package dependency review

“Safe now” means safe against the current documents before the required corrections are incorporated. Later packages can become safe when all prerequisites and named corrections are accepted.

### V1-01 — Independent shell and product identity

- **Package objective:** Establish a separate PeopleOS PWA shell, identity, navigation frame, routes, empty primary destinations, and offline boot.
- **Prerequisites:** Accepted V1 navigation and scope; read-only access to inherited Real Friends source; confirmation that its dirty working tree must not be modified.
- **Expected files or system areas affected:** Package metadata, Vite/PWA configuration, app entry, manifest/icons, navigation shell, route state, Settings section shell/fixed status copy, base styles, service worker configuration, tests.
- **User-visible outcome:** Installable PeopleOS opens to empty Today and can navigate to Reach Out, People, Upcoming, and Settings offline.
- **Required automated tests:** Typecheck/build; route rendering; active-tab semantics; nine Settings sections in required order; informational rows are not controls; no Real Friends runtime/storage/export identifiers; offline asset/service-worker build checks; 390px no-horizontal-overflow smoke.
- **Manual acceptance checks:** Install/open as PWA; reopen offline; browser/device Back between stable routes; verify all five tab labels and empty destinations.
- **Can begin safely:** **Yes.** No required correction changes this shell contract.

### V1-02 — Versioned local data and backup foundation

- **Package objective:** Establish the complete V1 persistence contract, repositories, validation, migrations, transactional commands, and atomic backup/restore foundation.
- **Prerequisites:** V1-01; RC-01, RC-02, RC-03, RC-08, RC-09, RC-10, and the V1-02 ownership correction in RC-12.
- **Expected files or system areas affected:** Domain types, IndexedDB schema/stores/indexes, AppSettings singleton/repository, runtime Settings adapters, validators, migrations/fixtures, transaction helpers, backup metadata, export/restore services and screens.
- **User-visible outcome:** Backup/restore works safely; otherwise the shell remains mostly empty.
- **Required automated tests:** Full-schema referential validation; deterministic Settings defaults; Settings validation/idempotent update/stale revision rejection; migration fixtures; per-command rollback; backup envelope and all-preference round trip; invalid/future-version restore no-op; atomic dataset replacement; skip/lifecycle storage fixtures.
- **Manual acceptance checks:** Export empty and seeded databases; preview counts/date/version; cancel restore; restore valid backup; verify current data survives a deliberately invalid file.
- **Can begin safely:** **No**, until the named foundational corrections are accepted.

### V1-03 — Manual person capture and contact methods

- **Package objective:** Create a permanent Person quickly with contact methods, optional meeting context, and a first current affiliation.
- **Prerequisites:** V1-01–02; RC-01, RC-04, RC-09, RC-10, RC-12.
- **Expected files or system areas affected:** Person/contact/affiliation application commands, libphonenumber integration, email normalization, Add Person screen, minimal Profile summary, duplicate-service hook contract.
- **User-visible outcome:** Name-only or name-plus-contact Person creation under 20 seconds; basic Profile opens; Where met/Event becomes real history.
- **Required automated tests:** Field validation; phone examples; email normalization; atomic Person/contact/met/affiliation save; stable retry IDs; archive/restore Person; contact preference invariants.
- **Manual acceptance checks:** Timed name+phone capture; ambiguous phone correction; name-only save; offline save/reopen; multiple contact-method display.
- **Can begin safely:** **No**, until V1-02 and corrections land.

### V1-04 — Duplicate warning and vCard import

- **Package objective:** Warn with evidence and import reviewed local vCard rows without merging automatically.
- **Prerequisites:** V1-01–03; Event/Interaction schema from V1-02 and capture semantics from V1-03; RC-04, RC-08, RC-10.
- **Expected files or system areas affected:** Duplicate service, name/organisation normalizers, vCard parser/mapper, import session state, preview/results screens, row transaction commands.
- **User-visible outcome:** Users can import or deliberately add/link details while understanding every duplicate warning.
- **Required automated tests:** Golden duplicate evidence; strong/weak/no-warning cases; vCard 3/4 fixtures; file limits; row validation; idempotent retry/double submit; partial failure; no provider links/interactions created.
- **Manual acceptance checks:** Import a representative phone export; review strong and weak duplicates; retry one failed row; verify result counts and existing data preservation.
- **Can begin safely:** **No**, until prerequisites and corrections land.

### V1-05 — Interactions and timeline

- **Package objective:** Record/edit/delete all V1 Interaction kinds and render an automatic trustworthy timeline with Event context and last contact.
- **Prerequisites:** V1-01–03; complete schema from V1-02; RC-02, RC-04, RC-09, RC-10.
- **Expected files or system areas affected:** Interaction/Event commands and queries, contact-kind policy, Timeline projection, Interaction/Event screens, Profile recent-history section.
- **User-visible outcome:** Users can record what happened and see creation/history in deterministic order.
- **Required automated tests:** Every kind's contact semantics; future-date rejection; equal-timestamp ordering; edit/delete recalculation; Event linkage; dangling source cleanup; timeline coalescing fixture contracts even before FollowUp UI.
- **Manual acceptance checks:** Log each kind; edit a contact date and observe last contact; delete with warning; create/select Event; verify creation-only empty state.
- **Can begin safely:** **No**, until foundational corrections and V1-03 land.

### V1-06 — Memory facts and affiliations

- **Package objective:** Add durable searchable Facts, cue eligibility, and full affiliation-history management.
- **Prerequisites:** V1-01–05; V1-03 first-affiliation path; RC-07, RC-09, RC-10, RC-12.
- **Expected files or system areas affected:** Fact/affiliation commands and queries, Fact editor/list, affiliation history, Profile memory/current-affiliation projection, normalization/index helpers.
- **User-visible outcome:** Facts and organisation history are retrievable without replacing narrative Notes.
- **Required automated tests:** Fact defaults by kind; controlled communication preference; exact duplicate Fact warning; archive/undo; cue/promotion ranking; primary display-affiliation derivation; archived exclusion.
- **Manual acceptance checks:** Add/edit/archive each fact kind; promote from Note without extraction; add several current affiliations; verify compact Profile ordering.
- **Can begin safely:** **No**, until prerequisites and corrections land.

### V1-07 — Follow-ups and cadence

- **Package objective:** Create and manage one-off FollowUps, lifecycle history, cadence, Upcoming, and domain-level Skip.
- **Prerequisites:** V1-01–06; RC-01, RC-02, RC-03, RC-06, RC-10, RC-12.
- **Expected files or system areas affected:** FollowUp/FollowUpEvent/TodaySkip stores, transition commands, cadence preferences, Upcoming and FollowUp screens, Profile plan section, timeline projection integration.
- **User-visible outcome:** Users can plan, complete, snooze, reschedule, cancel, and browse future FollowUps consistently.
- **Required automated tests:** Complete transition matrix; invalid transitions; repeated snooze history; replacement links; completion with/without contact; cadence mappings; New-rule suppression history; effective-date queries; skip storage command.
- **Manual acceptance checks:** Exercise every state from Profile/Upcoming; confirm due items leave Upcoming; confirm cancelled/completed records are read-only; verify lifecycle wording.
- **Can begin safely:** **No**, until prerequisites and corrections land.

### V1-08 — Reach Out

- **Package objective:** Deliver the first-class Reach Out queue, provisional People, linked FollowUps, and retained outreach history without creating a second reminder system.
- **Prerequisites:** V1-01–07; RC-01, RC-02, RC-06, RC-08, RC-09, RC-10, RC-12.
- **Expected files or system areas affected:** ReachOutEntry/ReachOutEvent/ReachOutContext repositories and commands, provisional-Person resolution, Reach Out list/quick capture/detail screens, reminder-default draft prefill, Profile Reach Out summary, linked FollowUp commands and queries.
- **User-visible outcome:** Users can add an existing or provisionally identified Person to Reach Out, explain the intention, plan an action, see derived queue state, complete or defer outreach, and retain searchable history.
- **Required automated tests:** One-current-entry invariant; provisional-Person creation and resolution; derived Active/Waiting/Snoozed/Overdue states; every reminder-default mapping and visible override; existing entries unaffected by preference changes; exactly one current linked FollowUp; transactional quick capture; completion with and without a next FollowUp; Dormant/remove cancellation; retained completed/dormant search; retry idempotency; no duplicate Person creation when adding an existing Person.
- **Manual acceptance checks:** Verify the exact Reach Out empty state; add an existing Person; capture “Chief Information Officer at Watford” without contact details; exercise all filters and actions; confirm the Fellowship examples work without being seeded; confirm Profile, Reach Out, Upcoming, and history agree.
- **Can begin safely:** **No**, until prerequisites and corrections land.

### V1-09 — Relationship Engine core

- **Package objective:** Produce pure deterministic per-Person assessments and the globally ordered Today result.
- **Prerequisites:** V1-01–08; all domain records available; RC-01, RC-03, RC-05, RC-06, RC-07, RC-09.
- **Expected files or system areas affected:** Pure engine types/functions, explanation templates, fixed policy version, clock/timezone adapters at the application boundary, table fixtures.
- **User-visible outcome:** Profile-derived stage/cue/reason data becomes available; Today engine result is ready for UI.
- **Required automated tests:** Every required engine example; all date/stage boundaries; all four bands and ties; multiple FollowUps; future suppression; skip; suggested actions/dates; cue ranking; stable pagination; randomized input-order invariance.
- **Manual acceptance checks:** Inspect explanations against seeded scenarios; verify they name visible facts and contain no score or invented note content.
- **Can begin safely:** **No**, until prerequisites and engine corrections land.

### V1-10 — Today experience

- **Package objective:** Render Today and complete the three-action phone/email and reminder loop without pulling WhatsApp/template work forward.
- **Prerequisites:** V1-01–09; RC-02, RC-03, RC-05, RC-07, RC-10, RC-12.
- **Expected files or system areas affected:** Today query/view model, cards and states, Explanation sheet, phone/email target resolver and handoff adapters, S33 chooser, focused Contact Methods route, Already-contacted interval sheet/setting migration, compound command wiring, pagination.
- **User-visible outcome:** Every card explains itself and exposes Contact now, Not today, and Already contacted; cards and normal reminder/history views remain consistent after each explicit action.
- **Required automated tests:** Every Today state; exact order/pages; complete Today DTO use; zero/one/several phone/email targets; no Interaction on external open; focused Add phone save/cancel; atomic/idempotent Not today and Already contacted; additional-due disclosure; interval-setting migration/backup; list recalculation and multiple-due handling.
- **Manual acceptance checks:** Phone/email return flows; labelled chooser; failure Copy fallback; focused Add phone; all interval choices/dismissal; other-plan disclosure; 390px action reachability and keyboard focus.
- **Can begin safely:** **No**, until V1-09 and corrections land.

### V1-11 — Search and complete person profile

- **Package objective:** Deliver deterministic full-context retrieval and all Profile summary/secondary views.
- **Prerequisites:** V1-01–10; RC-02, RC-05, RC-09, RC-10.
- **Expected files or system areas affected:** Search query/index service, filters, People screen, complete Profile queries/sections, archived filter/restore, secondary routes and back-state restoration.
- **User-visible outcome:** Users can find People from context and see consistent identity, plans, memory, relationship state, and history.
- **Required automated tests:** Every ranking tier; default order; filter algebra; archived behavior; matching-source explanation; Profile fact/affiliation/timeline limits; missing-contact definition; route state restoration.
- **Manual acceptance checks:** Search each source type; combine filters; Back restores query/scroll; archive/restore Person; verify all sparse/error Profile states.
- **Can begin safely:** **No**, until V1-10 and query corrections land.

### V1-12 — Batch networking capture

- **Package objective:** Reuse one explicit Event while rapidly adding several People with duplicate review.
- **Prerequisites:** V1-01–11; RC-04, RC-08, RC-10, RC-11.
- **Expected files or system areas affected:** Batch session UI/state, global Add capture-mode routing, capture command reuse, Event selector, duplicate flow integration, completion summary.
- **User-visible outcome:** Five Event contacts can be saved without re-entering shared context; committed rows survive exit.
- **Required automated tests:** Standard/Networking global Add routing; direct People and Reach Out entry points ignore the global mode; shared Event reuse; one `met` Interaction per created Person; double-submit idempotency; row failure isolation; duplicate choices; unsaved-row discard; exact summary reconciliation; no bulk FollowUp command.
- **Manual acceptance checks:** Timed five-person batch; leave mid-row; finish with mixed created/linked/skipped rows; plan one individual FollowUp from summary.
- **Can begin safely:** **No**, until prerequisites and batch contradiction are corrected.

### V1-13 — Contact actions and product hardening

- **Package objective:** Add WhatsApp target resolution, reachable Profile-origin WhatsApp/email composition, previewed vCard export, and final product hardening.
- **Prerequisites:** V1-01–12; RC-07, RC-10, RC-12.
- **Expected files or system areas affected:** Contact target resolver, WhatsApp adapter, S21/S33 Profile composition flow, deterministic draft templates, vCard generator/preview, Settings selection sheets/status rows, accessibility/focus, error recovery, performance fixtures, responsive/offline and end-to-end tests.
- **User-visible outcome:** A phone can offer Call and WhatsApp distinctly, Profile can compose editable WhatsApp/email content, Today remains unchanged after handoff, and contact cards export safely.
- **Required automated tests:** Target-count cardinality including Call plus WhatsApp from one phone; canonical WhatsApp URL; exact Event/no-Event Networking, Coffee, Custom, and blank-email-subject drafts; direct Today email bypass; no contact mutation on handoff; vCard field/privacy fixtures; exact Settings behavior; WCAG 2.2 AA rules; performance, offline-local, error-recovery, and critical-path E2E.
- **Manual acceptance checks:** Exercise Profile email/WhatsApp composition and Copy fallback; return to unchanged Today; import a generated vCard; keyboard-only and screen-reader focus journey; installed-PWA offline pass; 390px visual review.
- **Can begin safely:** **No**, until all earlier packages and final quality contracts land.

### Package safety summary

- **Safe to begin now:** V1-01 only.
- **Safe after required corrections and prerequisites:** V1-02 through V1-13 in order.
- **Historical at the review date; notification clause superseded by the post-review amendment below. Never pulled into the original V1 scope:** Google Contacts, LinkedIn, contact permissions/native writes, sync/accounts, notification delivery/permissions, AI, scoring, fuzzy Event grouping, automatic Fact extraction, bulk messaging, or bulk FollowUps.

## 5. Recommended first vertical slice

### Objective

Prove the smallest end-to-end PeopleOS loop with manual creation rather than import:

1. Create Sarah with a phone and “Met at AI Fellowship.”
2. Confirm the atomic `met` Interaction appears in Sarah's Profile/Timeline.
3. Add Sarah to Reach Out with the reason “Share the NHS AI pilot update.”
4. Create a linked dated FollowUp: “Send the pilot update.”
5. Inject the due local date and surface Sarah in Today with the exact reason.
6. Exercise Complete with contact, Snooze, Skip for today, and Reschedule on separate seeded FollowUps.
7. Confirm Reach Out, Today, People, Upcoming, Profile, Timeline, last contact, and FollowUp detail remain consistent after every action and reload.

### Required package scope

This is a milestone across deliberately narrow portions of existing packages; it does not authorize combining them in one working session:

- **V1-01 complete:** shell, routes, five tabs, empty states, offline identity.
- **V1-02 complete after corrections:** complete schema, transactions, revisions, backup-safe repositories, FollowUpEvent, TodaySkip, and fixtures.
- **V1-03 partial:** manual Person, one phone, Event/Where-met capture, minimal Profile identity.
- **V1-05 partial:** `met`, `whatsapp_message`, and `follow_up_completed` Interactions plus recent/full Timeline projection.
- **V1-07 partial:** create, complete, snooze, reschedule, cancel, Skip domain command, cadence omitted from the slice, and Upcoming.
- **V1-08 partial:** ReachOutEntry creation for an existing Person, linked FollowUp, derived queue state, completion history, and the Profile Reach Out summary; provisional capture and full filtering remain in the complete package.
- **V1-09 partial:** explicit-FollowUp Today band, Reach Out-aware explanation input, ordering, last contact, and stage New; no shortcut that bypasses the final engine contract.
- **V1-10 partial:** Today card, Explanation sheet, Skip/Undo, transition actions, WhatsApp editable handoff, and confirmation.
- **V1-11 partial:** only the Profile and People views needed to prove identity, Reach Out plan, current plan, relationship summary, and recent Timeline consistency.

V1-04 import/duplicates, V1-06 Facts/full affiliations, full cadence/New rules, full Search, batch capture, contact-card export, and hardening remain in their original V1 scope and follow after the core loop milestone. No feature is removed; the milestone merely proves architecture earlier.

### Slice acceptance scenario

Use an injected clock and fixed IDs:

1. On 1 August, create Sarah with `+447900123456` and AI Fellowship dated 1 August. Assert one Person and one `met` Interaction.
2. Add that existing Person to Reach Out with reason “Share the NHS AI pilot update.” Assert no second Person is created.
3. Create the linked FollowUp for 8 August with reason “Send the pilot update” and action Send update.
4. On 7 August, Reach Out shows Waiting, Sarah appears in Upcoming, and she does not appear in Today.
5. On 8 August, Reach Out shows Active and Sarah appears once at the correct Today position with “You planned to send the pilot update today.”
6. Skip and reload: Sarah stays hidden from Today but remains in Reach Out; Undo restores her.
7. Snooze to 9 August: Reach Out shows Snoozed, Sarah leaves Today on the 8th, and returns on the 9th with original-date history.
8. Reschedule to 12 August: the original FollowUp becomes superseded, its replacement appears in Upcoming, and Profile history shows one reschedule item.
9. Open WhatsApp: no Interaction or completion exists yet. Confirm contact and complete outreach without a next FollowUp: one WhatsApp Interaction is created, the FollowUp and ReachOutEntry complete, last contact becomes the confirmed time, and Sarah leaves Today and the active Reach Out list while remaining in completed history.
10. Repeat completion without contact and with a next FollowUp on fixtures: the first preserves last contact; the second reactivates the same ReachOutEntry with one new linked FollowUp rather than creating a duplicate entry.
11. At every step, reload Reach Out, Today, People, Upcoming, and Profile and assert the same state.

This slice proves the product's differentiating loop without importing Search, Facts, Google, native contacts, analytics, or any excluded scope.

## 6. Implementation guardrails

1. The accepted V1 specification remains authoritative. Apply its precedence order when historical documents differ.
2. One implementation package—or one explicitly approved partial package from the vertical-slice milestone—per working session.
3. Start no blocked package until its required corrections and prerequisites are accepted.
4. Do not add unapproved scope, even when an abstraction makes it convenient.
5. **Historical guardrail at the review date; notification clause superseded by the post-review amendment below.** Do not implement speculative integrations, provider stores, OAuth, Google Contacts, LinkedIn, native contact permissions, sync, notification delivery/permissions, or background jobs. The Settings notification row was informational only under the original accepted scope.
6. Do not introduce a scoring system where deterministic eligibility bands and ordering are specified.
7. Do not generate or surface cues from free-form Notes. Only explicit cue-enabled Memory Facts and specified structured context may become cues.
8. Do not perform fuzzy Event grouping. Event membership is explicit through Interactions.
9. Do not perform automatic Fact extraction, duplicate merge, message sending, or contact writing.
10. Do not store derived Today results, last contact, relationship age, stage, cue, or Timeline as authoritative state.
11. Keep Person as the permanent root; no phone, email, provider ID, or affiliation becomes identity.
12. Use transactions for compound mutations and stable IDs for retry. Never hide a partial failure behind success UI.
13. Preserve the Real Friends repository and its product direction. Copy only the explicitly reused technical baseline into PeopleOS.
14. Prefer small pure functions and direct application services over generic buses, plugin systems, event-sourcing frameworks, background projection infrastructure, or premature caches.
15. Run the package's automated checks plus typecheck/build before declaring it complete; run its named manual acceptance checks before handoff.
16. Stop and report any new contradiction rather than inventing behavior. Record the affected documents, blocked package, smallest recommended resolution, strongest alternative, and what evidence could reverse the recommendation.

## Final readiness summary

- **Verdict:** READY WITH REQUIRED CORRECTIONS
- **Required corrections:** 12
- **Packages currently safe to begin:** V1-01 only
- **Recommended first implementation package:** V1-01 — Independent shell and product identity
- **Recommended first vertical-slice milestone:** corrected V1-01 and V1-02, followed by the explicitly bounded partial scopes of V1-03, V1-05, V1-07, V1-08, V1-09, V1-10, and V1-11 listed above
- **Readiness artifact:** `IMPLEMENTATION_READINESS_REVIEW.md`
- **Specification amendment:** Reach Out is now reflected across the product, screen, flow, engine, navigation, scope, architecture, data-model, decision, roadmap, project, and repository documents; no application implementation is implied.
- **Application code or dependencies added:** none

## Post-review implementation-readiness amendment — 2026-07-22

### Status and precedence

This section records an accepted product change after the original readiness verdict. It does not reduce the original 12 corrections, rewrite the historical package analysis, or reopen completed V1-01 through V1-03. Where this section conflicts with the earlier notification exclusion, this dated amendment and the current authoritative specification documents take precedence.

The implementation order now contains 14 packages. V1-04 — Duplicate warning and vCard import remains the next package. V1-14 — Today summary notifications follows V1-13 and is the only package authorised to implement notification permission or delivery.

### Accepted Today contract and package delta

- **V1-05 — Interactions and timeline:** add generic `contacted` as a direct-contact Interaction kind. Already contacted creates it from the explicit tap without requiring a type/date/summary form. External handoff still creates nothing.
- **V1-07 — Follow-ups and cadence:** own the atomic Not today primitives. For a primary explicit FollowUp, snooze it to tomorrow. For New/cadence eligibility, create one explicit tomorrow FollowUp. In both cases create current-day TodaySkip suppression, leave every other due FollowUp unchanged, and preserve complete history.
- **V1-08 — Reach Out:** enforce a reciprocal sole-current-FollowUp link. When Already contacted resolves a linked plan and creates a next FollowUp, append the completion event, retain the current ReachOutEntry as active, and atomically relink `currentFollowUpId`. Do not create another entry or reminder type.
- **V1-09 — Relationship Engine core:** return the complete stable `buildToday` DTO and ordering, including primary/additional due FollowUp IDs. Keep suggested intended action as structured explanatory context while the Today UI always renders Contact now, Not today, and Already contacted. Notification eligibility is exactly the ordinary Today projection, not a new engine output or stored queue.
- **V1-10 — Today experience:** own the three standard card actions, direct `tel:`/`mailto:` target resolution and chooser, focused Add phone number entry and return, the Already contacted interval sheet/additional-plan disclosure and compound transaction, the new setting field/migration, recalculation, idempotency, and error recovery.
- **V1-11 — Search and complete person profile:** preserve the stable focused Contact Methods route and return-to-Today state when the complete Profile replaces the minimal V1-03 view.
- **V1-13 — Contact actions and product hardening:** add WhatsApp as a target derived from canonical phone, route one phone with Call plus WhatsApp through the chooser, expose editable email/WhatsApp templates from non-Today Profile composition, add vCard export, and harden. It does not own notification delivery.
- **V1-14 — Today summary notifications:** own the global Off-by-default preference, permission, scheduler adapter, delivery-only state/actions, deep links, retries, timezone handling, capability reporting, and platform tests.

### Compound Today command contract

Contact now makes no domain mutation. Not today commits its FollowUp/TodaySkip changes once and removes the card only after success.

Already contacted opens the reminder-interval sheet with the saved global default preselected. The card may hide optimistically, but no domain mutation is authoritative until the user selects 2, 7, 14, 30 days or a valid Custom interval. The selection commits one transaction with stable command and child IDs:

1. Create one generic Contacted Interaction at the supplied current time.
2. Complete the primary due FollowUp when one exists; other due FollowUps remain untouched.
3. Append/relink Reach Out completion state when the primary FollowUp belongs to Reach Out.
4. Create one next FollowUp at the chosen local calendar date; never store that date on Person or ReachOutEntry.
5. Record current-day TodaySkip so the Person remains absent for the rest of the current local day even when another independent due reason exists.
6. Increment the dataset revision once.

Dismissal before interval selection changes nothing and restores the card. A failed transaction changes nothing, restores the card, retains the sheet selection, and offers Retry with the same IDs. Repeated taps or retries cannot create duplicate Interactions, FollowUps, ReachOutEvents, or TodaySkip records.

The default interval is a global AppSettings draft default: 14 days initially, with 2, 7, 14, 30, or validated Custom days. It is included in backup/restore, affects only future sheets, and is not a Relationship Engine input or Person preference.

### V1-14 — Today summary notifications

- **Package objective:** Deliver one privacy-preserving prompt to open the existing Today queue without creating notification-specific relationship logic.
- **Prerequisites:** V1-01–13; the V1-10 Today query/action contract; an explicitly approved target-platform adapter capable of reliable closed-app delivery.
- **Expected files or system areas affected:** AppSettings migration and Settings Notifications row; notification scheduler port; supported platform adapter/service-worker or native bridge; device-local delivery coordination repository; permission/capability adapter; deep-link router; notification action handlers; deterministic clock/timezone fixtures; integration and platform tests.
- **User-visible outcome:** Notifications are Off until the user enables them. On supported platforms, PeopleOS evaluates Today at 09:00 local time, sends nothing when empty, or sends one summary saying “You have people to reach out to today. Open PeopleOS to see who's on your list.” No names appear. Open routes to Today; Not today schedules the next summary evaluation for 09:00 tomorrow; Snooze re-shows it two hours later that same local day.
- **Delivery-state boundary:** Store only device-local coordination such as scheduled occurrence key, last delivered occurrence, day suppression, and snoozed-until instant. Do not duplicate enabled intent from AppSettings, store a notification queue, use Person IDs as reminder ownership, or copy Today. Permission remains runtime/provider state. The global preference is backed up; permission, subscription tokens, and delivery coordination are not.
- **Idempotency:** Use a stable occurrence identity derived from notification kind plus scheduled local date/time. Re-evaluation, retry, service-worker restart, repeated action delivery, or app reopen cannot create another summary for the same unsnoozed occurrence. Snooze creates one explicitly linked replacement occurrence, not another individual reminder.
- **Timezone and late-day behavior:** Recalculate future schedules when device timezone changes; never reinterpret FollowUp dates. A two-hour Snooze that would cross midnight creates no same-day re-notification; the ordinary 09:00 next-day evaluation remains. There is no missed-notification catch-up after 09:00; the next ordinary evaluation is the next day unless a same-day Snooze remains valid.
- **Required automated tests:** Off default; permission requested only after a user gesture; denied/revoked/unsupported capability; denied and restored-On intent with no delivery or automatic prompt; empty versus non-empty Today; exactly one anonymous payload; no names in title/body/data; Open route; optional valid/invalid Person target; Not today and Snooze delivery-state transitions; repeated delivery/action idempotency; timezone and midnight boundaries; queue becomes empty before delivery; adapter failure/retry; notification preference backup round trip; delivery-state exclusion from backup; byte-for-byte unchanged Person, Reach Out, FollowUp, and Interaction stores for every notification action.
- **Manual acceptance checks:** Install on each supported target; enable/deny/revoke permission; receive the 09:00 summary with the app closed; verify no notification for empty Today; exercise Open, Not today, and Snooze; inspect privacy content; change timezone; verify unsupported runtime copy; verify all Today cards and individual plans remain unchanged after notification actions.
- **Can begin safely:** **No**, until V1-01–13 are complete and a reliable target adapter is explicitly approved.
- **Mandatory stop condition:** If the selected runtime cannot reliably deliver while PeopleOS is closed, stop and report the capability gap. Do not substitute foreground timers, polling, a speculative backend, silent pushes, a native shell, or sync without separate approval. Unsupported platforms must show Unavailable.

### Alternatives and reversal conditions

1. **Not today as TodaySkip only:** simpler and preserves every FollowUp unchanged, but it does not fulfil the accepted requirement that the primary plan move to tomorrow. The chosen combined transition would be wrong if the product later changes the promise to “hide this card today without changing the plan”; then TodaySkip alone should replace it.
2. **Not today as FollowUp snooze only:** preserves primary FollowUp history, but cannot handle New/cadence cards and cannot guarantee the Person leaves Today when another due reason exists. It becomes viable only if Today is later restricted to exactly one explicit FollowUp per card.
3. **Require interaction classification after Already contacted:** richer channel data, but unnecessary friction after an explicit truthful contact assertion. The generic Contacted kind becomes wrong only if V1 gains a genuine channel-specific reporting or compliance requirement.
4. **Store the next reminder on Person/ReachOutEntry:** superficially simpler query, but duplicates FollowUp authority and creates competing state. Reconsider only if the product removes FollowUp as the single dated-plan model.
5. **Keep notifications inside V1-13:** fewer package labels, but it makes the hardening package depend on an unresolved platform capability and weakens its stop line. V1-14 is preferable because it isolates permissions, platform delivery, retries, and deep-link verification after the core product is complete. This separation becomes unnecessary only if a reliable notification adapter is already part of the approved runtime before V1-13 begins.

### Amended safety summary

- Completed baselines remain V1-01 through V1-03; no completed commit is amended or reopened.
- V1-04 remains the next package and can be assessed against its existing prerequisites.
- V1-05 through V1-13 remain sequential, with the ownership deltas above incorporated before each package begins.
- V1-14 is blocked until V1-13 completes and the notification-adapter stop condition is resolved.
- The historical prohibition on all notification work is replaced only for V1-14. Notification code, permissions, background delivery, or speculative infrastructure must not be pulled into V1-04 through V1-13.
