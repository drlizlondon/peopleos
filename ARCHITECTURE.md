# PeopleOS Architecture

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

## Target architecture

```text
UI screens and view components
        │ commands                    ▲ view models
        ▼                             │
Application services ───────► Relationship Engine
  person lifecycle              pure deterministic rules
  interaction recording         structured explanations
  follow-up commands             versioned policy
  reach-out intention lifecycle
  import/link workflows
        │
        ▼
Repository interfaces
        │
        ▼
IndexedDB adapters

Integration ports and adapters
  Phone parser | WhatsApp | vCard | Google Contacts (future)
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
type RelationshipEngineInput = {
  person: Person;
  contactMethods: ContactMethod[];
  interactions: Interaction[];
  followUps: FollowUp[];
  reachOutEntries: ReachOutEntry[];
  facts: MemoryFact[];
  affiliations: OrganisationAffiliation[];
  events: Event[];
  now: string;
  timeZone: string;
};
```

Tags, importance, and recurring cadence arrive through Person. Where met, notes, promises, organisation, and relationship age are sourced or derived from the other structured inputs rather than duplicated parameters.

Reach Out does not add an eligibility algorithm. A due Reach Out reminder is a normal pending FollowUp with `reachOutEntryId`; the engine may enrich its explanation with the Reach Out reason and context, but ranking and state transitions remain the existing FollowUp rules.

### Output

```ts
type RelationshipAssessment = {
  today?: {
    priorityBand: "due_commitment" | "new_relationship" | "cadence_due";
    reason: Explanation;
    suggestedAction: SuggestedAction;
  };
  relationshipStage: {
    value: "new" | "growing" | "established" | "long_term";
    explanation: Explanation;
  };
  memoryCue?: { text: string; explanation: Explanation };
  overdueFollowUp?: { followUpId: string; explanation: Explanation };
  suggestedReminder?: { dueDate: string; explanation: Explanation };
  lastContactAt?: string;
  relationshipStartedAt: string;
};

type Explanation = {
  code: string;
  facts: Array<{ label: string; value: string; sourceId?: string }>;
  templateKey: string;
};
```

The engine returns facts and a stable template key, not only finished prose. The presentation layer localises/formats the explanation but cannot change its meaning.

### Today eligibility and order

Avoid a weighted score. Use auditable eligibility rules and ordered bands:

1. Pending explicit FollowUp due now or earlier.
2. Accepted new-relationship follow-up rule is due.
3. Recurring cadence is due from the latest contact-counting Interaction.

Within a band, order by earliest due date, then high importance, then stable Person ID. Importance never makes someone due by itself. Tags, organisation, facts, or event membership may select a relevant rule but never add unexplained points.

Examples of structured explanations:

- Follow-up: planned date + reason + source FollowUp ID.
- Cadence: cadence days + last contact date + elapsed days.
- Promise: pending FollowUp reason “Introduce to Sarah,” not a phrase inferred from notes.

“Overdue” may be a structured output and factual profile detail. On Today, the user-facing explanation should say what was planned and when, without guilt-oriented escalation.

For a linked Reach Out FollowUp, the explanation is still an explicit FollowUp explanation and may add “You added this person to Reach Out because {reason}.” Reach Out does not gain a separate priority band and cannot outrank an older explicit FollowUp merely because it belongs to Reach Out.

## Reach Out architecture

Reach Out is a curated queue of explicit relationship intentions. Its boundary is deliberately narrow:

- `Person` owns identity, including provisional identity.
- `ReachOutEntry` owns why the user wants to act, the intended next action, lightweight notes, context links, and durable Active/Completed/Dormant intention state.
- `FollowUp` owns every reminder date, snooze, reschedule, completion transition, and Today eligibility.
- `Interaction` records contact that actually occurred.
- `ReachOutEvent` preserves outreach-specific history such as added, completed, dormant, reactivated, or removed.

Waiting, Snoozed, and Overdue are projections from an active ReachOutEntry and its linked FollowUp. They must not be stored as competing status fields.

### Provisional people

Incomplete identity creates a normal Person with `identityStatus: "provisional"` and the descriptive label as `displayName`. All Reach Out and FollowUp records reference that Person ID. Completing the identity edits the same Person.

If the provisional Person is later recognised as an existing confirmed Person, an explicit resolution command previews and transactionally reassigns the provisional record's Reach Out entries and selected child history, then marks the provisional Person merged. This is a narrow provisional-resolution workflow, not a general duplicate merge and never runs automatically.

### Context and collections

ReachOutContext provides one lightweight reusable grouping seam for project, organisation, Event, fellowship, or other context. It exists only to label, filter, and group Reach Out entries. It does not create project management, company accounts, pipelines, ownership, or analytics.

### Suggested next action and reminder

Suggestions must map from explicit facts. For example, a pending introduction FollowUp can suggest “Make introduction”; a due cadence can suggest the preferred available communication method. A reminder date can be suggested by an accepted smart-default rule or cadence. The engine never persists or performs the suggestion; application services require user acceptance.

### Relationship stage and memory cue

Stage uses contact-counting interactions and relationship span. Version 1 thresholds and boundary behavior are fixed in `RELATIONSHIP_ENGINE_SPEC.md`; inactivity does not demote a stage in V1.

Memory cues follow a stable priority: due commitment, explicit communication preference, current seeking/interest fact, introduction fact, location, event met, then current affiliation. The output identifies its source. Each Memory Fact has explicit cue eligibility; Family and Other default off. Free-form notes never become compact V1 cues.

### Testing and versioning

- Every rule has table-driven boundary tests.
- Engine outputs include or are evaluated under a policy version.
- The same input, time, timezone, and version produce the same output.
- Rule changes require a decision entry and regression fixtures showing intended changes.
- Derived results are calculated on read initially. Add a rebuildable versioned cache only after profiling.

## Contact identity and actions

ContactMethod supports multiple mutable phones and emails. ExternalIdentity links provider records such as Google Contact or LinkedIn. WhatsApp is initially a capability of a canonical phone number, not a Person identity and not a duplicated contact record.

All outbound actions use ports such as:

```ts
interface MessagingHandoff {
  canHandle(method: ContactMethod): boolean;
  buildDraft(input: DraftInput): Promise<HandoffResult>;
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

The web baseline generates a standards-compliant vCard after a user gesture. A future Capacitor contact adapter must use the same application port and explicit confirmation. Native contact creation is not approved yet.

## Global Settings architecture

Settings is a thin application boundary, not part of the Relationship Engine and not a generic preference framework. One versioned `AppSettings` singleton stores only Default phone region, Capture mode, and the optional default Reach Out reminder interval.

Application services read the relevant preference when beginning a draft or choosing a global capture route:

- phone parsing reads Default phone region only for ambiguous new input
- the global Add action reads Capture mode
- Reach Out creation reads the reminder default to pre-fill a visible draft

After a draft is created, its fields are ordinary explicit domain input. Later Settings changes never rewrite People, contact methods, ReachOutEntries, FollowUps, or Interactions. The Relationship Engine does not accept AppSettings and cannot vary its rules by preference.

Timezone, locale, notification availability, app version, and schema version come from dedicated runtime adapters or build/data metadata. Import, backup, and restore remain application services linked from Settings; they are not AppSettings fields. Avoid a plugin registry, remote configuration system, feature-flag service, adaptive preference layer, or per-setting store in V1.

`SETTINGS_SPEC.md` is the authoritative behavior contract.

## Privacy and future sync

Local-first remains the initial constraint. Before accounts or sync, separately decide encryption, authentication, conflict resolution, deletion, export portability, and migration ownership. No backend is required for the approved initial packages.
