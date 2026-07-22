# PeopleOS Architecture Refinement Review

Status: planning complete; implementation has not begun.

## Recommendations accepted

- **Person as permanent entity:** `Person.id` is the internal identity. Phones, emails, names, affiliations, and external accounts may change without replacing the Person.
- **Interactions as history:** contact, timeline, last contact, relationship age, and stage derive from Interaction records wherever practical.
- **Single FollowUp authority:** explicit dated intentions live only in FollowUp, not Person.
- **Dedicated Relationship Engine:** a pure, versioned domain service returns structured Today eligibility, explanations, actions, stage, cue, overdue state, and reminder suggestions. UI logic is formatting only.
- **Facts plus notes:** controlled MemoryFacts make durable information searchable; dated free-form notes remain Interaction records. Promotion is explicit.
- **Future-proof contact identity:** ContactMethod supports multiple phones/emails; ExternalIdentity links provider records. WhatsApp is initially derived from phone.
- **Google Contacts boundary:** future import, link, create, and linked-state workflows use a ContactProvider adapter and explicit ExternalIdentity records.
- **Explainable duplicates:** candidates return matched evidence. No automatic merge or overwrite.
- **Explainable Today ordering:** ordered eligibility bands replace weighted scoring.
- **Lightweight organisation history:** affiliations preserve role history without prematurely creating an Organisation subsystem.
- **First-class Reach Out intention:** ReachOutEntry records deliberate outreach without becoming a tag or CRM pipeline; dates and Today behavior reuse FollowUp.
- **Provisional Person identity:** incomplete descriptive labels use the permanent Person model and can be completed or explicitly resolved later.
- **Minimal global Settings:** one AppSettings singleton holds only phone region, capture mode, and the new-Reach-Out reminder default; fixed policy and runtime status remain derived or informational.

## Recommendations rejected or narrowed

- **Phone or email as Person identity:** rejected because contact details change and may be shared or duplicated.
- **A separate WhatsApp identity record now:** rejected as duplication; WhatsApp availability can be derived from a valid phone until provider-specific identity becomes real.
- **Provider-shaped domain models:** rejected; Google and future providers remain adapters.
- **Automatic note-to-fact extraction:** rejected because it would require inference and could create incorrect or sensitive facts.
- **Generic entity-attribute-value facts:** rejected as unnecessary complexity. A controlled vocabulary plus `other` is sufficient.
- **First-class Organisation entity now:** deferred until cross-person organisation behavior justifies the added deduplication and lifecycle rules.
- **Opaque weighted priority/confidence scores:** rejected. Ordered rules and evidence codes are easier to explain and test.
- **Persisted derived projections:** rejected initially. Calculate on read; add a rebuildable versioned cache only after measured need.
- **Two-way Google sync in the initial integration plan:** rejected as an assumption. Import, link, create, and sync are separate future decisions.

## Simplifications made

- Removed phone, organisation, event, introducer, and follow-up fields from Person.
- Replaced editable `meaningful` interaction state with a versioned policy based on interaction kind.
- Kept one Interaction model rather than a table for every channel.
- Kept Settings as one explicit singleton rather than a generic preference registry, remote configuration service, or Person-settings projection.
- Made FollowUp the one dated-plan model and cadence a Person preference.
- Kept organisations as historical text affiliations for now.
- Separated duplicate detection from the Relationship Engine because entity integrity and relationship recommendations are different responsibilities.
- Kept Reach Out durable status to Active/Completed/Dormant and derived Waiting/Snoozed/Overdue from FollowUp.

## Remaining unresolved decisions

The Version 1 specification resolved stage thresholds, split introduction semantics, memory-cue eligibility, and event grouping behavior. Remaining later decisions are:

1. Google OAuth scopes, secure token storage, sync direction, field-conflict policy, and background refresh.
2. Whether edited historical interactions eventually need an audit log; this is not required for V1.
3. Whether explicit Event grouping should later gain evidence-based inference; V1 uses explicit links only.

These unresolved items block only the packages named in `DECISIONS.md` and `ROADMAP.md`. POS-0 through the relevant preconditions may proceed only after the user explicitly authorises implementation.
