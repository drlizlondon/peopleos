# PeopleOS Roadmap

> Historical architecture roadmap. The accepted Version 1 package sequence is defined in `VERSION1_SCOPE.md` and supersedes package composition below where the two differ.

Reach Out is now an accepted first-class V1 feature. Its authoritative implementation package is V1-08 in `VERSION1_SCOPE.md`; linked reminders remain part of the existing FollowUp and Today packages.

The Settings refinement does not create another package. V1-01 owns the nine-section shell and fixed status copy, V1-02 owns the AppSettings singleton and backup/restore contract, V1-08 consumes the Reach Out reminder default, V1-12 consumes Capture mode routing for global Add, and V1-13 completes selection sheets and end-to-end Settings acceptance. `SETTINGS_SPEC.md` is authoritative for option behavior.

## Execution rules

- Implement one package at a time in order unless a later package is explicitly re-planned.
- Do not alter the Real Friends repository.
- Do not pull later features into an earlier package.
- Each package ends with TypeScript, build, unit tests, and its stated acceptance checks green.
- Product-rule changes require an entry in `DECISIONS.md`.
- Preserve working inherited code unless the package names a concrete benefit and test.

## POS-0 — Establish the independent baseline

**Goal:** Create a runnable PeopleOS repository from the inherited application without preserving a live dependency on Real Friends.

**Scope:** Copy the application baseline; rename package, app, manifest, database, export identifiers, documentation, and icons/placeholders; remove Real Friends constitutional instructions from PeopleOS; preserve basic offline boot, navigation, storage, and backup behavior.

**Acceptance criteria:**

- The PeopleOS repository contains its own source, package files, and git history from this point forward.
- No build/runtime reference identifies the app, database, exports, or manifest as Real Friends.
- Real Friends working tree and git history are unchanged.
- Existing PeopleOS data cannot read or overwrite the Real Friends IndexedDB database.
- `npm run build` and `npx tsc --noEmit` pass.
- The app boots offline after first load at a 390px viewport.

## POS-1 — Storage foundation and inherited behavior tests

**Goal:** Make future schema changes safe before expanding the model.

**Scope:** Add a test runner; introduce versioned repositories and runtime validation; add migration fixtures and export/import round-trip tests; establish permanent Person IDs and repository contracts for child records; define person archive behavior.

**Acceptance criteria:**

- Storage access is not called directly from React components.
- Import rejects malformed or unsupported data without erasing current data.
- A versioned migration upgrades a fixture and preserves every source record.
- Export then import is lossless for the current PeopleOS schema.
- Orphaned interactions or follow-ups cannot be produced by the supported archive/remove flow.
- A ContactMethod or ExternalIdentity cannot exist without its Person.
- Changing or archiving a contact method does not change Person identity.
- Existing navigation, capture, and offline behavior still work.

## POS-2 — People, contact methods, and phone numbers

**Goal:** Capture minimal professional relationship context and trustworthy phone identity.

**Scope:** Implement the agreed Person subset, one-to-many ContactMethod storage, default phone region, libphonenumber parsing/formatting, email canonicalisation, lightweight OrganisationAffiliation, progressively disclosed fields, and duplicate candidate evidence. ExternalIdentity receives a repository contract only; no provider integration.

**Acceptance criteria:**

- `07900123456`, `07900 123456`, `+447900123456`, and `447900123456` can resolve to the same canonical number when the default region is GB.
- Canonical storage is `+447900123456`; display uses a familiar national format.
- Ambiguous or invalid input is explained and never silently rewritten.
- Exact canonical-phone duplicates warn and do not overwrite.
- Exact canonical-email duplicates warn and do not overwrite.
- Similar-name plus same organisation/event produces a lower-confidence review suggestion.
- Name is the only universally required person field.
- Organisation, role, meeting context, importance, and tags are progressively disclosed.
- Multiple contact methods remain attached to one permanent Person ID.
- No Google, LinkedIn, or other external API is called.

## POS-3 — Interactions, reminders, and automatic timeline

**Goal:** Establish trustworthy relationship history and explicit plans.

**Precondition:** POS-D024 resolves introduction semantics. POS-D015 establishes FollowUp as the source of truth.

**Scope:** Add Interaction, FollowUp, Event, and MemoryFact; record the agreed interaction kinds; make free-form notes dated interactions; support optional explicit promotion to controlled facts; render an automatic chronological timeline.

**Acceptance criteria:**

- Creating a person produces a visible Created timeline item without duplicate storage.
- User-confirmed contact creates one meaningful interaction.
- Merely opening WhatsApp creates no interaction.
- Completing and rescheduling a follow-up preserve understandable history.
- Last meaningful interaction is derived and covered by tests for each interaction type.
- Timeline order is deterministic when timestamps match.
- No last-contact, stage, timeline, or follow-up date is writable on Person.
- Searchable facts coexist with unchanged free-form note capability.

## POS-4 — Relationship Engine and explainable Today

**Goal:** Make Home answer “Who should I contact today?”

**Scope:** Implement the pure versioned Relationship Engine contract, ordered Today eligibility bands, structured explanations, suggested next actions/dates, due/future separation, reschedule, mark contacted, and profile navigation. Retire Real Friends rotation semantics. UI performs formatting only.

**Acceptance criteria:**

- Every displayed person has at least one visible reason backed by stored facts.
- No React component calculates priority, elapsed cadence, stage, or cue selection.
- Explicit due follow-up outranks new-relationship follow-up, which outranks cadence due.
- Importance only breaks ties and never makes a person due alone.
- Future follow-ups do not appear as due.
- Rescheduling removes the old due item and records the new plan.
- Mark contacted records a meaningful interaction and recalculates priority.
- Boundary dates and time zones are covered by tests using an injected clock.
- The primary action is Message on WhatsApp; secondary actions are Mark contacted, Reschedule, and Open profile.
- Identical inputs, time, timezone, and policy version produce identical structured outputs.
- No opaque aggregate score is stored or displayed.

## POS-5 — Derived relationship context

**Goal:** Help the user recognise relationships without maintaining summaries manually.

**Precondition:** POS-D023 defines relationship-stage thresholds and POS-D025 defines sensitive cue behavior.

**Scope:** Add derived relationship stage, memory cue selection, and explicit/inferred event grouping.

**Acceptance criteria:**

- Stage is derived from interaction facts and cannot be manually edited.
- Every stage boundary has example-based unit tests.
- A memory cue identifies its source fact and updates when that fact changes.
- Structured facts such as communication preference, location, interests, and introductions are searchable without AI.
- People sharing an explicit event appear in an automatic event group.
- Inferred groups show matching evidence and are correctable.
- No grouping is created from a fuzzy name match alone.

## POS-6 — WhatsApp templates and contact export

**Goal:** Make contact actions useful while keeping the user in control.

**Scope:** Add Networking, Coffee, and Custom templates; preview/edit before handoff; generate vCard; define an integration interface for future Capacitor investigation.

**Acceptance criteria:**

- WhatsApp URL uses digits from a validated canonical international number.
- Networking and Coffee templates interpolate only known facts and remain editable.
- Custom text persists only when the user chooses to save it.
- PeopleOS never sends a message automatically.
- A vCard opens/imports with correct name, phone, organisation, role, and note where present.
- Contact creation always begins with an explicit user action and confirmation outside or inside the app.
- Unsupported or absent WhatsApp/contacts behavior has a clear fallback.

## POS-7 — Calm product shell and usability hardening

**Goal:** Complete a coherent PeopleOS experience after core rules are proven.

**Scope:** PeopleOS identity, navigation and search, accessible components, empty/error states, performance and offline checks, and contextual retrieval by event/organisation/introducer.

**Acceptance criteria:**

- The 390px layout has no horizontal overflow and primary actions are reachable.
- Keyboard navigation, focus management, labels, and contrast meet the chosen WCAG target.
- Search finds people by name, organisation, role, event, tag, or introducer.
- Home remains focused on today's people rather than dashboard metrics.
- Storage/import/external-action errors are visible and recoverable.
- The installed PWA works offline for all local features.

## Later planning, not approved implementation

- Capacitor/native contact creation
- Multi-device sync and accounts
- Encrypted backup or hosted storage
- Additional communication channels
- Explicit import from a Real Friends export
- Team or shared relationship spaces
- Google Contacts selected import, link, and create workflows
- LinkedIn integration

Each requires a separate product and architecture decision before entering an implementation package.
