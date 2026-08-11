# PeopleOS

PeopleOS is a private relationship operating system for remembering and maintaining valuable professional relationships over many years.

It helps answer one question: **Who should I contact today, and why?**

Its first-class **Reach Out** queue also keeps track of people the user has deliberately decided to contact, reconnect with, or build a relationship with—even when all they initially know is a descriptive label.

PeopleOS is not a CRM, sales pipeline, lead-management tool, or a new version of Real Friends. It inherits useful technical foundations from Real Friends, but the products now have separate goals and will evolve independently. Real Friends' product direction is frozen and is not governed by this repository.

## Product principles

- Help people remember people, not manage leads.
- Prefer deterministic, explainable rules to opaque recommendations.
- Treat each Person as the permanent record; contact methods and external accounts are changeable attributes.
- Derive relationship state from interactions instead of duplicating it.
- Never send a message or modify phone contacts without the user's confirmation.
- Keep data private, fast, portable, and predictable.
- Reduce typing and progressively disclose detail.
- Preserve working inherited code where it provides a clear benefit.

## Current status

**PeopleOS is at chargeable iPhone MVP release-candidate stage.** V1-01 through V1-11 and the MVP notification package are implemented: local data and backup, manual capture, duplicate-aware vCard import, interactions and timeline, memory facts and affiliations, follow-ups and cadence, Reach Out, explainable Today, search and profiles, Personal/Professional views, optional private iCloud sync, and optional private local Today reminders.

The repository passes its automated release preflight and an unsigned iOS Release simulator build. It is not yet ready to upload: distribution signing, the production CloudKit schema, App Store Connect commercial setup, and the signed-iPhone notification acceptance matrix remain owner actions. V1-12 batch capture and the V1-13 WhatsApp/templates/vCard-export package are deliberately outside this MVP.

The inherited Real Friends codebase was reviewed from `/Users/lizzie/Documents/real-friends`. PeopleOS has an independent React/Vite PWA with five primary destinations and a Capacitor iPhone wrapper, with no shared runtime, storage, or product logic. The current package ledger is [PACKAGE_STATUS.md](./PACKAGE_STATUS.md); the release source of truth is [docs/APP_STORE_RELEASE_CHECKLIST.md](./docs/APP_STORE_RELEASE_CHECKLIST.md).

## Documentation

### Version 1 product specification

- [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) — complete V1 product behavior
- [SCREEN_SPECIFICATIONS.md](./SCREEN_SPECIFICATIONS.md) — every screen, state, action, validation, and error
- [USER_FLOWS.md](./USER_FLOWS.md) — end-to-end user journeys
- [RELATIONSHIP_ENGINE_SPEC.md](./RELATIONSHIP_ENGINE_SPEC.md) — deterministic behavioral rules and explanations
- [NAVIGATION.md](./NAVIGATION.md) — primary and secondary information architecture
- [SETTINGS_SPEC.md](./SETTINGS_SPEC.md) — minimal global Settings options, defaults, and deterministic effects
- [VERSION1_SCOPE.md](./VERSION1_SCOPE.md) — V1 boundaries and complete implementation order

### Architecture and project context

- [PROJECT.md](./PROJECT.md) — product scope, users, outcomes, and boundaries
- [ARCHITECTURE.md](./ARCHITECTURE.md) — inherited architecture review and target structure
- [DATA_MODEL.md](./DATA_MODEL.md) — minimal proposed schema and deterministic derivations
- [ROADMAP.md](./ROADMAP.md) — small implementation packages and acceptance criteria
- [DECISIONS.md](./DECISIONS.md) — product and architecture decisions
- [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) — accepted, rejected, and unresolved refinements
- [IMPLEMENTATION_READINESS_REVIEW.md](./IMPLEMENTATION_READINESS_REVIEW.md) — final blockers, dependency review, and first vertical slice

## Technical baseline

PeopleOS uses React, TypeScript, Vite, `vite-plugin-pwa`, Vitest, IndexedDB through `idb`, and a local-first PWA deployment model. V1-02 establishes the complete versioned V1 storage contract, runtime validation, optimistic revisions, and atomic JSON backup/restore.

The V1-03 slice adds `/people/new`, `/people/:personId`, and `/people/:personId/contact-methods`. Manual capture writes a Person and any contact methods, first affiliation, and met context through one application command. Phone parsing uses the `libphonenumber-js/min` entry point; each phone row can use the global or an explicitly selected region, and the stored contact preserves the trimmed input alongside canonical E.164 and parsed region data.

V1-04 adds explained duplicate review to Person creation, contact-method changes, and local contact import. `/people/import` accepts user-selected UTF-8 vCard 3.0/4.0 files up to 5 MiB and 5,000 cards, previews every row without writing, detects stored and same-file matches deterministically, and commits one reviewed Person row per transaction. Import sessions remain transient and no contact-book permission, provider link, interaction, follow-up, or merge is created.

V1-05 adds explicit manual Interaction and Note capture, exact Event selection or atomic Event creation, derived last meaningful contact, and a deterministic Timeline at `/people/:personId/timeline`. Person creation is projected rather than stored as an Interaction; notes do not count as contact; linked follow-up and Reach Out lifecycle items are read-only projections.

V1-06 adds structured Memory Facts and complete lightweight affiliation history without introducing a separate Organisation subsystem. Facts can be created, edited, archived, restored, searched through deterministic projections, and explicitly linked to an Interaction; exact duplicates warn without merging. Notes remain unchanged narrative Interactions and can only be promoted through a blank, user-completed Fact editor. `/people/:personId/facts` and `/people/:personId/affiliations` provide the complete secondary views, while the Person profile shows one deterministic Fact cue, up to three other prominent Facts, and one derived current affiliation.

V1-07 adds one-off FollowUps with append-only lifecycle history, atomic create/snooze/reschedule/complete/cancel transitions, retained completion Interactions, a functional Upcoming screen, Person-level planning, and optional 30/90/180/365-day or custom cadence. The existing V1 stores remain unchanged: effective dates and current plans are derived, cadence never creates work automatically, and the reusable Not today command writes one FollowUp transition plus one current-day TodaySkip without changing other plans. Reach Out linkage was intentionally assigned to V1-08. Relationship Engine eligibility, live Today cards, contact handoffs, and notifications remain assigned to V1-09 and later packages.

V1-08 makes Reach Out functional through existing-Person and provisional-Person capture, lightweight contexts, reciprocal linked FollowUps, deterministic queue state, retained completion/Dormant/removal history, Person Profile and Timeline integration, and explicit provisional identity resolution. Reach Out reuses Person, FollowUp, and Interaction rather than creating parallel identity or reminder systems. Its application queries support deterministic status, context, and retained-history retrieval; visible search and filter controls remain V1-11. Today, Contact now, and notification behavior remain in their later packages. No storage migration or new dependency was required.

V1-09 adds the pure, fixed-policy Relationship Engine and a calculate-on-read application query boundary. It derives complete Today eligibility and stable global ordering, structured explanations, intended-action context, stage, relationship age, last contact, memory and search cues, suggested reminder dates, overdue plans, and Reach Out display states from existing records. Person Profile now consumes the same stage, age, last-contact, cue, and suggestion projections; React performs formatting only. The engine writes nothing, accepts no Settings, stores no score or queue, and adds no schema migration or dependency. Live Today cards, Contact now, Not today/Already contacted composition, focused Add phone, interval settings, and pagination remain V1-10.

Development commands:

```sh
npm install
npm run dev
npm run test
npm run build
npm run check
```
