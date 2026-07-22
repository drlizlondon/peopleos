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

**Implementation has begun. V1-01 — Independent shell and product identity is complete; later product packages are not implemented.**

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

PeopleOS uses React, TypeScript, Vite, `vite-plugin-pwa`, Vitest, and a local-first PWA deployment model. V1-01 deliberately includes no persistence or relationship behavior; IndexedDB begins in V1-02 after the required data-contract corrections are accepted.

Development commands:

```sh
npm run dev
npm run test
npm run build
npm run check
```
