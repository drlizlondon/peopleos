# PeopleOS Architecture

> **Current platform ownership:** [docs/platform-architecture.md](./docs/platform-architecture.md) is the concise source of truth for marketing, web/PWA, Capacitor, generated assets, Git, and deployment. This document retains the detailed product/domain architecture.

## Review scope

The inherited Real Friends repository at `/Users/lizzie/Documents/real-friends` was reviewed as a read-only source. It is a compact React 18 and TypeScript PWA using Vite, IndexedDB through `idb`, deterministic client-side queue logic, `wa.me` handoff, and JSON export/import.

PeopleOS should retain this boring, understandable technical baseline while replacing its narrow product model. The Real Friends repository remains unchanged.

## Inherited architecture assessment

### Reuse with adaptation

| Capability | PeopleOS treatment |
| --- | --- |
| React, TypeScript, Vite, PWA | Retain as the initial shell |
| IndexedDB via `idb` | Retain behind versioned repositories and validation |
| Offline installability | Retain and rebrand |
| Fast capture and person editing patterns | Adapt to progressive professional context |
| Deterministic queue concept | Replace with a dedicated Relationship Engine |
| `wa.me` user handoff | Retain through a contact-action adapter |
| JSON backup | Retain with schema versions and referential validation |
| Calm mobile visual primitives | Reuse without preserving Real Friends identity |

### Leave with Real Friends

- The approximately 25-person friend roster and friendship-specific language
- Birthday rotation and birthday message pools as core behavior
- A fixed three-card queue and session-only dismissal
- `Mention` as the main work item
- One phone and one generic note directly on Person
- A hand-written UK phone normaliser
- Real Friends cadences, snooze behavior, branding, storage names, and product constitution
- The rule against displaying dates; PeopleOS needs factual due dates and explanations

## Architectural invariants

1. **Person is the aggregate root.** `Person.id` is the permanent internal identity. All mutable identifiers and histories reference it.
2. **Interactions are authoritative history.** Last contact, relationship age, stage, and timeline are projections, not writable fields.
3. **FollowUp is the authoritative dated intention.** A due date is not duplicated on Person.
4. **The UI contains no relationship rules.** It renders structured Relationship Engine outputs and issues commands through application services.
5. **External providers are adapters.** Google, WhatsApp, LinkedIn, vCard, or a future native shell do not leak provider models into the domain.
6. **Every recommendation carries evidence.** There is no unexplained aggregate score.
7. **Reach Out is intention, not identity or reminders.** ReachOutEntry references the permanent Person and links to the existing FollowUp engine for dates and Today eligibility.
8. **Notifications are delivery only.** They derive a bounded anonymous schedule from authoritative Today eligibility and never copy Person lists, identifiers, notes, reasons, contact details, or relationship rules into notification payloads.

## Target architecture

```text
UI screens and view components
        │ commands                    ▲ view models
        ▼                             │
Application services ───────► Relationship Engine
  person lifecycle              pure deterministic rules
  interaction recording         structured explanations
  follow-up commands             versioned policy
  Today action commands
  reach-out intention lifecycle
  import/link workflows
        │
        ▼
Repository interfaces
        │
        ▼
IndexedDB adapters

Integration ports and adapters
  Phone parser | phone/email handoff | WhatsApp | vCard | notification delivery | Google Contacts (future)
```

### Module boundaries

- `domain/` — persisted domain types and invariants; no React, IndexedDB, or provider SDKs
- `relationship-engine/` — pure input/output contracts and versioned deterministic policies
- `application/` — commands and workflows coordinating repositories, engine, and ports
- `data/` — IndexedDB schema, migrations, repositories, validation, export/import
- `features/` — screens and feature UI consuming view models
- `components/` — genuinely reusable visual primitives
- `integrations/` — provider adapters implementing narrow ports

These boundaries can be introduced incrementally. They do not justify rewriting working layout components.

## Relationship Engine

The Relationship Engine is one domain service, not a collection of calculations scattered across screens. It is pure: callers supply all data, `now`, timezone, and policy version; it performs no storage or network access.

### Input

```ts
type RelationshipPersonBundle = {
  person: Person;
  contactMethods: ContactMethod[];
  interactions: Interaction[];
  followUps: FollowUp[];
  reachOutEntries: ReachOutEntry[];
  facts: MemoryFact[];
  affiliations: OrganisationAffiliation[];
  events: Event[];
  triggeringInteractionId?: string;
};

type RelationshipClock = {
  now: string;
  timeZone: string;
  policyVersion: "peopleos-v1";
};
```

Tags, importance, and recurring cadence arrive through Person. Where met, notes, promises, organisation, and relationship age are sourced or derived from the other structured inputs rather than duplicated parameters.

Reach Out does not add an eligibility algorithm. A due Reach Out reminder is a normal pending FollowUp with `reachOutEntryId`; the engine may enrich its explanation with the Reach Out reason and context, but ranking and state transitions remain the existing FollowUp rules.

### Output

```ts
type TodayEligibilityCode =
  | "explicit_follow_up"
  | "new_relationship"
  | "cadence_due";

type TodayDueState = "overdue" | "due_today" | "rule_due";

type SuggestedAction = {
  code:
    | "message"
    | "email"
    | "call"
    | "arrange_meeting"
    | "make_introduction"
    | "send_update"
    | "research_contact_route"
    | "other"
    | "add_contact_details";
  explanation: Explanation;
};

type TodayAssessment = {
  eligibilityCode: TodayEligibilityCode;
  dueState: TodayDueState;
  relevantDate: string; // YYYY-MM-DD used by deterministic ordering
  primaryFollowUpId?: string;
  additionalDueFollowUpIds: string[];
  explanation: Explanation;
  intendedActionContext: SuggestedAction;
};

type RelationshipAssessment = {
  policyVersion: "peopleos-v1";
  evaluatedAt: string;
  timeZone: string;
  localDate: string;
  personId: string;
  displayName: string; // factual stable-order metadata, not a score
  importance: "normal" | "high";
  active: boolean;
  today?: TodayAssessment;
  relationshipStage: {
    value: "new" | "growing" | "established" | "long_term";
    explanation: Explanation;
  };
  memoryCue?: { text: string; explanation: Explanation };
  searchContextCue?: { text: string; explanation: Explanation };
  overdueFollowUp?: { followUpId: string; explanation: Explanation };
  suggestedReminder?: { dueDate: string; explanation: Explanation };
  lastContact?: { interactionId: string; kind: InteractionKind; occurredAt: string; explanation: Explanation };
  relationshipAge: { startDate: string; elapsedDays: number; estimated: boolean; explanation: Explanation };
  reachOutStates: ReachOutStateProjection[];
  lastContactAt?: string;
  relationshipStartedAt: string;
};

type TodayItem = TodayAssessment & { personId: string };

type TodayResult = {
  orderedItems: TodayItem[];
  totalCount: number;
};

type Explanation = {
  code: string;
  facts: Array<{ label: string; value: string; sourceId?: string }>;
  templateKey: string;
};
```

The engine returns facts and a stable template key, not only finished prose. The presentation layer localises/formats the explanation but cannot change its meaning.

The pure engine exposes two operations. `assessRelationship(personBundle, clock)` produces the per-Person projections above. `buildToday(assessments, todaySkips, clock)` filters and globally sorts the complete Today result. The UI may reveal `orderedItems` in groups of five, but it never reorders or recalculates them. Notification delivery consumes `totalCount` or the complete result before visual pagination. For an explicit FollowUp, `primaryFollowUpId` is the earliest effective due FollowUp after the documented stable tie-break; the remaining due FollowUps appear in the same stable order in `additionalDueFollowUpIds`. New and cadence results have no FollowUp IDs.

V1-09 implements this boundary in `relationship-engine/` with one calculate-on-read adapter in `application/relationshipEngineQueries.ts`. The adapter reads one consistent domain snapshot and never passes AppSettings into the engine. That single snapshot prevents mixed datasets; assessment date, timezone, and policy metadata prevent projections from different evaluations from being combined by `buildToday`. Duplicate Person assessments or clock mismatches fail explicitly rather than relying on input order. No result is persisted or cached.

### Today eligibility and order

Avoid a weighted score. Use auditable eligibility rules and ordered bands:

1. Pending explicit FollowUp due now or earlier.
2. Accepted new-relationship follow-up rule is due.
3. Recurring cadence is due from the latest contact-counting Interaction.

Within the overdue-explicit band, order by oldest effective due date, high importance, display name, then stable Person ID. Within every other band, order by high importance, then relevant date oldest first, then display name, then stable Person ID. Importance never makes someone due by itself. Tags, organisation, facts, or event membership may select a relevant rule but never add unexplained points.

Examples of structured explanations:

- Follow-up: planned date + reason + source FollowUp ID.
- Cadence: cadence days + last contact date + elapsed days.
- Promise: pending FollowUp reason “Introduce to Sarah,” not a phrase inferred from notes.

“Overdue” may be a structured output and factual profile detail. On Today, the user-facing explanation should say what was planned and when, without guilt-oriented escalation.

For a linked Reach Out FollowUp, the explanation is still an explicit FollowUp explanation and may add “You added this person to Reach Out because {reason}.” Reach Out does not gain a separate priority band and cannot outrank an older explicit FollowUp merely because it belongs to Reach Out.

### Today action commands

Today renders three standard actions, but the UI does not implement their state transitions.

- **Contact now** resolves executable targets from active contact methods. One phone/email target opens directly, several targets open a chooser, and no target navigates to that Person's Contact Methods editor with one empty phone row focused. Opening or returning from an external application writes nothing and leaves the Today card available.
- **Not today** is one atomic application command. It snoozes the primary explicit FollowUp to tomorrow or creates one tomorrow FollowUp for a New/cadence assessment, appends the appropriate FollowUp history, and writes today's Person-scoped TodaySkip so another due reason cannot re-display the card. Other FollowUps are untouched.
- **Already contacted** is one atomic application command after the user chooses a next date. It creates a generic contact-counting `contacted` Interaction, completes the primary FollowUp when present, creates exactly one next FollowUp, writes today's TodaySkip, and updates Reach Out completion/relink history when the primary FollowUp belongs to Reach Out. Other FollowUps are untouched.

Both mutating commands receive the engine assessment and primary FollowUp identity as structured input, validate that the assessment is still current, use prepared stable IDs plus a command identity, increment the dataset revision once, and either commit or roll back every affected record. The Already-contacted sheet itself writes nothing until a date is selected. Its AppSettings default changes only the preselection, not relationship rules.

The sheet also reads `additionalDueFollowUpIds` from the same Today item. When non-empty it discloses their count and that they may return the Person sooner; it never mutates or silently combines them.

## Reach Out architecture

Reach Out is a curated queue of explicit relationship intentions. Its boundary is deliberately narrow:

- `Person` owns identity, including provisional identity.
- `ReachOutEntry` owns why the user wants to act, the intended next action, lightweight notes, context links, and durable Active/Completed/Dormant intention state.
- `FollowUp` owns every reminder date, snooze, reschedule, completion transition, and Today eligibility.
- `Interaction` records contact that actually occurred.
- `ReachOutEvent` preserves outreach-specific history such as added, completed, dormant, reactivated, or removed.

Waiting, Snoozed, and Overdue are projections from an active ReachOutEntry and its linked FollowUp. They must not be stored as competing status fields.

The current-plan link is reciprocal and unique. When `ReachOutEntry.currentFollowUpId` is present, it identifies the sole pending FollowUp whose `reachOutEntryId` names that entry and whose `personId` matches. Create, replace, complete, cancel, and restore validation update both sides atomically. A terminal historical FollowUp may retain its Reach Out link, but cannot remain the entry's current pointer.

### Provisional people

Incomplete identity creates a normal Person with `identityStatus: "provisional"` and the descriptive label as `displayName`. All Reach Out and FollowUp records reference that Person ID. Completing the identity edits the same Person.

If the provisional Person is later recognised as an existing confirmed Person, an explicit resolution command previews and transactionally reassigns the provisional record's Reach Out entries and selected child history, then marks the provisional Person merged. This is a narrow provisional-resolution workflow, not a general duplicate merge and never runs automatically.

V1-08 binds provisional linking to an explicit preview. The preview identifies the concrete affected records and captures the source Person revision, target Person revision, and dataset revision. Any intervening dataset mutation makes the preview stale. Two current Reach Out plans block linking, and preferred-contact conflicts require an explicit choice. References that would become invalid self-references remain with the merged source together with their dependency closure; an unsafe lifecycle dependency blocks linking rather than silently dropping history.

Safe child ownership changes commit in one transaction. Rekeying `FollowUpEvent.personId` is the sole ownership-correction exception for append-only lifecycle records: event IDs, kinds, timestamps, dates, Interaction links, and replacement links remain unchanged.

Reach Out create, plan-edit, completion, and durable-status commands prepare stable child IDs and use canonical command fingerprints. Primary ReachOutEvents anchor create, completion, and status retries; the current ReachOutEntry anchors exact plan-edit retries. Provisional identity completion anchors its aggregate fingerprint on the confirmed Person, while provisional linking anchors its fingerprint on the merged source Person. Exact retries succeed only when the fingerprint and every expected child artifact match; incomplete or conflicting state fails. These markers have no product, identity, queue, or Relationship Engine meaning and avoid introducing a generic command bus or command-log subsystem.

### Context and collections

ReachOutContext provides one lightweight reusable grouping seam for project, organisation, Event, fellowship, or other context. It exists only to label, filter, and group Reach Out entries. It does not create project management, company accounts, pipelines, ownership, or analytics.

### Suggested next action and reminder

Suggestions must map from explicit facts. For example, a pending introduction FollowUp can suggest “Make introduction”; a due cadence can suggest the preferred available communication method. A reminder date can be suggested by an accepted smart-default rule or cadence. The engine never persists or performs the suggestion; application services require user acceptance.

### Relationship stage and memory cue

Stage uses contact-counting interactions and relationship span. Version 1 thresholds and boundary behavior are fixed in `RELATIONSHIP_ENGINE_SPEC.md`; inactivity does not demote a stage in V1.

Memory cues follow a stable priority: due commitment, explicit communication preference, current seeking/interest fact, introduction fact, location, explicitly enabled Family/Other fact, earliest Event-linked Met/Conference interaction, then current affiliation. The output identifies its source. Each Memory Fact has explicit cue eligibility; Family and Other default off. Free-form notes never become compact V1 cues.

### Testing and versioning

- Every rule has table-driven boundary tests.
- Engine outputs include or are evaluated under a policy version.
- The same input, time, timezone, and version produce the same output.
- V1 uses fixed policy version `peopleos-v1`; unsupported or mixed versions fail explicitly.
- Rule changes require a decision entry and regression fixtures showing intended changes.
- Derived results are calculated on read initially. Add a rebuildable versioned cache only after profiling.

## Contact identity and actions

ContactMethod supports multiple mutable phones and emails. ExternalIdentity links provider records such as Google Contact or LinkedIn. WhatsApp is initially a capability of a canonical phone number, not a Person identity and not a duplicated contact record.

The Contact now projection is deterministic application logic, not React logic and not a Relationship Engine rule. It first resolves active, valid ContactMethods into executable targets:

```ts
type ContactNowTarget = {
  id: string; // stable `${channel}:${contactMethodId}`
  channel: "phone_call" | "email" | "whatsapp";
  contactMethodId: string;
  label: string;
  familiarValue: string;
  canonicalValue: string;
};
```

Direct launch versus the chooser is based on resolved target count, not ContactMethod row count. Before V1-13, each phone resolves to one Phone call target and each email to one Email target. V1-13 may add a WhatsApp target for a valid canonical phone without creating another ContactMethod; one phone can therefore yield both Call and WhatsApp and must open the chooser. Targets follow ContactMethod order—preferred first, then `createdAt`, then stable ContactMethod ID—and channel order within one method is Phone call then WhatsApp. Labels use the user's ContactMethod label with a kind-based fallback; when two targets share a method, the chooser prefixes the channel so “Call · Mobile” and “WhatsApp · Mobile” remain distinct. One target opens directly, several open the labelled chooser, and none opens the Contact Methods route. The separate Add phone number action uses the same route with a blank unsaved phone row already focused. Phone labels such as Mobile or Work mobile remain labels rather than new contact-method subtypes.

### V1-03 manual capture boundary

The first implemented Person workflow uses three secondary routes: `/people/new`, `/people/:personId`, and `/people/:personId/contact-methods`. The profile at this stage is a recognition summary, not the later complete relationship profile. Screens issue application commands and queries; they do not write to IndexedDB directly.

The manual-capture command creates stable IDs when the draft begins, validates and normalises the whole draft before storage, then uses one IndexedDB transaction across Person, ContactMethod, an optional first OrganisationAffiliation, an optional `met` Interaction, and dataset metadata. Empty optional child records are not written. A retry with the same prepared records is idempotent; an ID collision with different data aborts the transaction. The dataset revision advances once only after all records have been accepted, so a failed write cannot leave a partial Person or orphaned contact method.

Contact-method commands add, edit, choose a preferred method, archive, and restore an immediately archived method for the safe Undo action through the application layer with optimistic revision checks. The first active method of each kind becomes preferred. Choosing another preferred method clears the earlier preference in the same transaction; archiving does not silently select a replacement. These commands preserve one permanent `Person.id` and do not introduce phone- or email-based identity.

The phone and email handoff adapters receive canonical active ContactMethods and return success/failure of opening only. They cannot create Interactions or complete FollowUps. Returning to PeopleOS does not trigger a confirmation sheet; an explicit **Already contacted** action is the only one-tap generic acknowledgement that contact occurred.

All outbound actions use ports such as:

```ts
interface ContactHandoff {
  canHandle(target: ContactNowTarget): boolean;
  open(target: ContactNowTarget): Promise<HandoffResult>;
}

interface MessagingHandoff {
  canHandle(target: ContactNowTarget): boolean;
  buildDraft(input: DraftInput & { target: ContactNowTarget }): Promise<HandoffResult>;
}

interface ContactProvider {
  findCandidates(query: ContactQuery): Promise<ProviderContact[]>;
  get(externalId: string): Promise<ProviderContact>;
  create(draft: ProviderContactDraft): Promise<ProviderContact>;
}
```

Provider DTOs are mapped at the integration boundary. Domain and UI code do not depend on Google resource names or SDK objects.

## Future Google Contacts architecture

Google Contacts is a future adapter, not part of the initial persistence core.

### Planned workflows

1. **Import selected contacts:** adapter reads a user-selected set; mapper normalises phones/emails; duplicate service returns explained candidates; user confirms create or link.
2. **Link existing contact:** user searches/selects a Google Contact; application service verifies `(provider, externalId)` is not already linked and creates ExternalIdentity.
3. **Create Google Contact:** PeopleOS presents the outgoing fields and asks for confirmation; adapter creates it; application service stores the returned ExternalIdentity.
4. **Detect linked state:** query ExternalIdentity by `personId` and provider, never infer linkage from matching fields alone.

### Deliberate constraints

- No background two-way sync is assumed.
- Import, link, create, and later sync are separate use cases.
- Provider access tokens belong in a secure authentication/integration layer, never Person or exports.
- Field conflicts require an explicit preview and per-field choice; provider data does not silently overwrite PeopleOS.
- Google Contact deletion does not delete Person. Unlinking removes or archives ExternalIdentity only.

OAuth, token storage, sync direction, conflict policy, and Google API scopes require a separate decision before implementation.

## Duplicate detection service

Duplicate detection is a deterministic domain service separate from the Relationship Engine because it concerns entity integrity, not relationship recommendations.

It returns candidate Person IDs plus evidence codes:

- same linked Google Contact — strongest warning
- exact canonical phone — strong warning
- exact canonical email — strong warning
- similar normalised name plus same current organisation — review suggestion
- similar normalised name plus same Event-linked interaction — review suggestion
- similar name alone — no warning

Several signals may change the presentation order, but no hidden numeric confidence is shown. The service never merges. A future merge workflow must preview every retained, moved, or conflicting record.

## Risks and simplifications

### Simplifications accepted

- Keep organisation as affiliation text until a real Organisation entity is justified.
- Derive WhatsApp availability from phone instead of storing a duplicate WhatsApp identity.
- Keep one Interaction table with a controlled kind union rather than separate tables per channel.
- Use controlled MemoryFact kinds plus free notes; do not create a generic knowledge graph.
- Calculate engine projections on read before introducing caches or background jobs.
- Keep one FollowUp model and remove follow-up fields from Person.

### Risks to manage

- Interaction semantics: kinds that count as contact must be explicit and stable.
- Timeline audit: editing past interactions changes derived outcomes; retain updated timestamps and consider edit history only if needed.
- Provider privacy: future Google integration introduces OAuth and token-storage obligations.
- Local-first scale: interaction queries and projections require indexes; measure before caching.
- Name and organisation similarity can produce false positives; weak matches remain suggestions.
- Structured facts can become burdensome forms; promotion from notes must be optional and quick.
- Relationship-stage labels may imply certainty; show an explanation and resolve thresholds before implementation.

## Phone numbers and native contacts

Use a libphonenumber implementation with default region input. Store canonical E.164 including `+`, preserve raw input, display a familiar national format, and never silently repair ambiguity.

V1-03 implements this port with the `libphonenumber-js/min` entry point. New input uses the global default region when the number is ambiguous, while each phone row lets the user choose a different region without having to translate a national number into international notation. Common international input without a leading `+` is retried only when its digits begin with that selected region's calling code; parsing and validity still come from the library. The ContactMethod stores trimmed `rawValue`, E.164 `canonicalValue`, and the parsed region when known. Familiar national or international display is derived at read time. Email input is trimmed, preserves the user's case in `rawValue`, and stores a lowercase canonical value for future comparison.

The web baseline keeps user-selected vCard import as a bulk fallback. The Capacitor Contacts adapter reuses the same import, normalisation, duplicate-review, and explicit-confirmation boundaries. The native contact picker shares only the contacts the user finishes choosing; optional one-time contact creation transfers conventional contact fields only and never creates continuous synchronisation.

## Global Settings architecture

Settings is a thin application boundary, not part of the Relationship Engine and not a generic preference framework. One versioned `AppSettings` singleton stores Default phone region, Capture mode, the Default Already contacted interval, the optional default Reach Out reminder interval, explicit Today summary notification intent, and its local `HH:mm` reminder time.

Application services read the relevant preference when beginning a draft or choosing a global capture route:

- phone parsing reads Default phone region only for ambiguous new input
- the global Add action reads Capture mode
- the Already-contacted sheet reads its default interval only when it opens
- Reach Out creation reads the reminder default to pre-fill a visible draft
- the notification application service reads Today summary intent and time before consulting runtime permission/capability

After a draft or sheet is created, its fields are ordinary explicit domain input. Later Settings changes never rewrite People, contact methods, ReachOutEntries, FollowUps, or Interactions. The Relationship Engine does not accept AppSettings and cannot vary its rules by preference. Notification intent gates delivery only; it does not change Today eligibility.

Timezone, locale, notification permission/capability, app version, and schema version come from dedicated runtime adapters or build/data metadata. Import, backup, and restore remain application services linked from Settings; they are not AppSettings fields. Avoid a plugin registry, remote configuration system, feature-flag service, adaptive preference layer, or per-setting store in V1.

`SETTINGS_SPEC.md` is the authoritative behavior contract.

## Today summary notification architecture

```text
Person / Interaction / FollowUp / Reach Out stores
                      │
                      ▼
       nextTodayEligibleLocalDate (engine policy)
                      │ bounded anonymous plan
                      ▼
          notification application service
                      │
                      ▼
       Capacitor LocalNotifications adapter
                      │
                      ▼
        iOS UNUserNotificationCenter
```

`nextTodayEligibleLocalDate` is a pure projection beside the Relationship Engine and is exhaustively tested against `buildToday` eligibility. It applies the same pending-FollowUp suppression, new-relationship, cadence, archive, and merge rules without running the complete engine once per forecast day. Date-specific TodaySkips and the selected Personal/Professional/All view are applied by the notification policy. Each forecast date carries its whole reminder ladder — the user's chosen time, then a reminder every three hours, never at or after 22:00 local. The result is at most 30 one-off occurrences in total, so a five-step ladder forecasts roughly six days. Both old and replacement plans therefore fit below iOS's 64-pending-request ceiling while the replacement is installed and verified.

The narrow adapter keeps native delivery out of the domain:

```ts
interface TodayNotificationAdapter {
  checkPermission(): Promise<"prompt" | "granted" | "denied">;
  requestPermission(): Promise<"prompt" | "granted" | "denied">;
  pendingIds(): Promise<number[]>;
  cancel(ids: number[]): Promise<void>;
  schedule(entries: Array<{
    id: number;
    at: Date;
    title: "PeopleOS";
    body: string;
    extra: { kind: "today-summary"; destination: "today" };
  }>): Promise<void>;
  addTodayTapListener(listener: () => void): Promise<() => void>;
}
```

The default reminder time is 12:00 local. A same-day occurrence scheduled ahead of that time may use the exact current count; forecast occurrences use generic copy because `UNUserNotificationCenter` content is static while PeopleOS is closed. Stable IDs are derived from local dates, and the service cancels/replaces its own IDs before every schedule. Pending requests and operating-system permission are not backup data. Restore never requests permission.

The service reconciles on startup, foreground/background transition, relationship-mode change, Settings revision, dataset revision, and local-date change. It installs and verifies a replacement before removing stale requests; an incomplete native install is treated as an error and leaves the previous plan available. Taps and the View Today action carry only the semantic Today destination and replace the current route with `/`. The Not Now action is inert: the rest of the day's ladder is already installed, so dismissing, ignoring and Not Now are identical (POS-D048). Opening PeopleOS after an occurrence has elapsed ends that local date's cycle and cancels its remaining reminders; that cycle is one in-memory local date, never persisted. There is no delivery Snooze and no notification-only Not today command. Scheduling and taps never call Person, Interaction, FollowUp, TodaySkip, Reach Out, or Relationship Engine mutation commands. After the bounded plan is exhausted without reopening, reopening the app replenishes it. Occurrences are calculated in the device time zone when the plan is built; after travel, foregrounding PeopleOS rebuilds them for the new local zone.

### Reliable-adapter stop condition

The browser PWA cannot claim reliable cross-platform closed-app scheduling, so it does not request notification permission. The approved iPhone adapter is Capacitor Local Notifications, which delegates to `UNUserNotificationCenter` and retains tap events for cold-launch delivery to JavaScript. Local notifications require no APNs entitlement or remote push service. A backend remains rejected because it would add subscriptions, network delivery, privacy, retry, and likely account decisions solely to wake the app. Unsupported runtimes report the native boundary while preserving all Today behavior.

## Privacy and future sync

Local-first remains the product constraint. Optional iCloud Sync is a native adapter over the user's private CloudKit database; IndexedDB remains the operational store and browser builds remain local-only. The product has no PeopleOS account or hosted relationship-data backend. Notification delivery is device-local and requires no backend.
