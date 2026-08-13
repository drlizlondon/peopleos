# PeopleOS Project Definition

## Product vision

PeopleOS is a relationship operating system for people whose professional relationships accumulate across cohorts, events, organisations, introductions, and years.

It should help someone remember context, keep promises to follow up, and maintain relationships thoughtfully. The application should feel calm and organised without turning people into opportunities or demanding administrative work.

## Primary job

When the user opens PeopleOS, it should answer:

> Who should I contact today, and why?

Every recommendation must include an understandable reason derived from recorded facts, for example:

> Due today because you planned to reconnect 14 days after meeting at the NHS AI Fellowship.

## Intended relationships

- Fellowship and accelerator cohorts
- Conference contacts
- Founders and investors
- Clinicians and advisors
- Mentors and collaborators
- Recruiters and potential customers
- People introduced through mutual connections

These are examples of context, not pipeline categories.

## Product boundaries

PeopleOS is not:

- Real Friends v2
- A CRM, lead database, or sales pipeline
- A system for deals, revenue stages, conversion, or outreach campaigns
- An AI assistant or LLM-generated recommendation engine
- An automatic messaging system
- An automatic phone-contact writer

PeopleOS does not need feature parity with Real Friends. Work in this repository must not redesign, migrate, or otherwise alter Real Friends.

## Experience principles

### Calm by default

Show a focused list, not a dashboard full of metrics. Avoid urgency theatre, gamification, and large administrative forms.

### Explainable intelligence

Recommendations, relationship stages, event groups, memory cues, smart defaults, and duplicate warnings must be deterministic. A user should be able to inspect the facts and rule responsible for an outcome.

The explanation is part of the product, not debug information. Today must not show a recommendation whose reason cannot be expressed from named source facts.

### Low-friction capture

Name is the only universally required person field. Ask for useful context at the moment it is known, and disclose advanced fields only when needed.

### User-controlled actions

PeopleOS may open a dialler or email client, prepare a WhatsApp draft, or generate a vCard. Opening another application never proves that contact occurred. On Today, the user explicitly chooses Already contacted; PeopleOS records that low-friction fact without requiring an interaction form.

### Private and portable

Start local-first. Preserve JSON export/import and design all stored data so it can later be migrated without data loss.

## Core product capabilities

1. **People** — maintain one permanent person record while names, contact methods, organisations, and external accounts change around it.
2. **Interactions** — record meaningful relationship events as the source of timeline and relationship-derived state.
3. **Follow-ups** — support explicit dates and recurring cadence.
4. **Today** — select and rank people using objective, inspectable rules, then offer the same three actions: Contact now, Not today, and Already contacted.
5. **Context** — derive relationship stage, event grouping, memory cues, and a timeline.
6. **Contact actions** — resolve phone/email targets, add WhatsApp as another target from canonical phone through the later contact-action package, provide Profile-origin editable composition, and generate a vCard.
7. **Data quality** — canonicalise phone numbers and warn about likely duplicates.
8. **Memory** — combine searchable structured facts with free-form, dated notes.
9. **Reach Out** — maintain a deliberate action queue for existing or provisionally identified people, with dates delegated to FollowUp.
10. **Summary notifications** — on supported platforms, deliver one anonymous prompt to open the existing Today queue without copying or changing relationship state.

## Success measures

Early product validation should focus on behavior, not vanity metrics:

- A new contact can be captured quickly with enough context to recognise them later.
- Every Today item has a correct and useful explanation.
- Already contacted updates the person's history and one chosen next reminder without a channel-selection form; Contact now alone changes nothing.
- Users can find a person from partial remembered context such as event, organisation, or introducer.
- Duplicate warnings prevent accidental fragmentation without blocking legitimate entries.
- Reach Out preserves why a person matters, surfaces linked plans in Today, and never creates a parallel reminder or Person record.
- Settings exposes only global application behavior: phone parsing region, default capture mode, the visible default for new Reach Out reminder drafts, the default Already contacted interval, and the Today-summary notification opt-in. Person-level relationship choices never appear there.
- The iPhone app can schedule an optional anonymous Today summary at a user-selected local time, default 12:00; the browser does not request permission, and notification scheduling/taps never alter individual reminders.
- Export and restore preserve all relationship history.

## Explicitly deferred

- LLM or generative-AI features
- Automatic sending
- Email sequencing and campaigns
- Deal or opportunity tracking
- Team-owned shared contact databases
- Continuous or automatic contact-book/provider synchronisation; the accepted iPhone MVP permits explicit native selection, vCard import, and an optional one-time Apple Contacts write
- PeopleOS accounts, a hosted backend, and collaborative workspaces; optional private iCloud replication remains behind the native sync adapter
