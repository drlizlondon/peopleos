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

**V1-01 — Independent shell and product identity, V1-02 — Versioned local data and backup foundation, V1-03 — Manual person capture and contact methods, and V1-04 — Duplicate warning and vCard import are complete. V1-05 and later packages remain unimplemented.**

The inherited Real Friends codebase was reviewed from `/Users/lizzie/Documents/real-friends`. PeopleOS now has an independent React/Vite PWA shell with five primary destinations and no shared runtime, storage, or product logic. Further implementation must proceed only through the packages in [VERSION1_SCOPE.md](./VERSION1_SCOPE.md), subject to the required corrections in [IMPLEMENTATION_READINESS_REVIEW.md](./IMPLEMENTATION_READINESS_REVIEW.md).

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

V1-04 adds explained duplicate review to Person creation, contact-method changes, and local contact import. `/people/import` accepts user-selected UTF-8 vCard 3.0/4.0 files up to 5 MiB and 5,000 cards, previews every row without writing, detects stored and same-file matches deterministically, and commits one reviewed Person row per transaction. Import sessions remain transient and no contact-book permission, provider link, interaction, follow-up, or merge is created. General interaction capture, follow-ups, relationship intelligence, Today recommendations, and Reach Out workflows remain assigned to later packages.

Development commands:

```sh
npm install
npm run dev
npm run test
npm run build
npm run check
```
