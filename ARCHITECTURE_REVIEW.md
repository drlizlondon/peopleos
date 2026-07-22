# PeopleOS Architecture Refinement Review

Status: historical architecture review. Implementation subsequently completed through V1-03. The dated amendment below records the accepted Today refinement without rewriting the original findings.

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
- **Minimal global Settings (historical):** the original review limited AppSettings to phone region, capture mode, and the new-Reach-Out reminder default. The dated amendment below supersedes that field list while retaining the single minimal singleton boundary.

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

## Post-review amendment — 2026-07-22

The accepted Today refinement keeps the original architectural invariants and changes these product contracts:

- Every Today card has the stable actions Contact now, Not today, and Already contacted. The Relationship Engine still derives eligibility, order, explanation, and suggested intended action; the suggestion is context rather than a variable button label.
- Contact now is a provider handoff through executable targets derived from active ContactMethods. One phone/email target opens directly and several open a labelled chooser. V1-13 can derive Call and WhatsApp targets from one phone without duplicating it. With no usable target it opens the existing Contact Methods flow with an unsaved phone row focused; any card with no active phone also exposes that focused Add phone number route independently. Handoff creates no Interaction or reminder transition.
- Not today is implemented through the existing FollowUp and TodaySkip authorities. The primary explicit FollowUp moves to tomorrow; a New/cadence recommendation gains one explicit tomorrow FollowUp; current-day TodaySkip guarantees card removal; other due FollowUps remain unchanged.
- Already contacted is explicit contact evidence, so the action creates one generic Contacted Interaction without asking the user to classify or log it. The chosen interval creates one normal FollowUp; a linked ReachOutEntry records completion and points reciprocally to the replacement FollowUp in the same transaction. Other due plans remain untouched and are disclosed before the date choice because they may return the Person sooner.
- `buildToday` is the sole complete ordering operation and returns the stable Person, eligibility/due state, relevant date, primary/additional due FollowUp IDs, explanation, and intended-action context needed by screens and commands.
- V1-13 keeps sole Today phone/email launch direct while making editable WhatsApp/email templates reachable from a non-Today Profile Compose flow.
- AppSettings gains a global Default Already contacted interval in V1-10. Default is 14 days; 2, 7, 14, 30, and validated Custom intervals are available. It is a draft preselection, not an engine input or Person preference.
- V1-14 adds an Off-by-default Today-summary notification preference and a downstream scheduler port. The scheduler consumes the ordinary Today projection at 09:00 local time, sends no notification for an empty queue and one name-free summary otherwise, and stores delivery coordination separately from relationship data. Open navigates to Today; notification Not today and two-hour Snooze change delivery state only.

This adds no second reminder system, notification-specific Person state, provider-shaped domain object, or persisted Today projection.

### Strongest alternatives considered

- **Use TodaySkip alone for card Not today.** This was simpler and would naturally resurface the Person tomorrow, but was rejected because the accepted behavior says the primary plan is rescheduled. The combined FollowUp transition plus TodaySkip preserves that history and also guarantees card removal when another eligibility reason exists. This choice would be wrong if product wording later changes to “hide this card today without changing the plan”; in that case TodaySkip alone is preferable.
- **Require an Interaction form after Already contacted.** This preserves a specific channel, but was rejected because the user has already made the only required factual assertion and the extra form defeats the low-friction purpose. The generic Contacted kind would be wrong if channel-specific reporting becomes a genuine product need; V1 has no such reporting.
- **Store a next-reminder date on Person or ReachOutEntry.** Rejected because FollowUp is already the authoritative dated intention. This would be reconsidered only if FollowUp ceased to model individual dated plans.
- **Use foreground web timers for notifications.** Rejected because they cannot provide reliable closed-app delivery. V1-14 has a mandatory stop condition until an approved runtime adapter can meet the contract. A native or server-backed adapter may be approved later, but must not be inferred from this amendment.

### Remaining notification decision

V1-14 cannot begin safely until the target platform has an approved adapter that can reliably deliver while PeopleOS is closed, request permission after a user gesture, handle timezone changes and retries idempotently, and preserve the local-first privacy boundary. Unsupported platforms must show Unavailable rather than simulate support.
