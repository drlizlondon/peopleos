# PeopleOS Version 1 Package Status

Operational ledger only. Package scope and acceptance criteria remain authoritative in `VERSION1_SCOPE.md` and `IMPLEMENTATION_READINESS_REVIEW.md`.

| Package | Name | Status | Commit | Automated tests | Manual verification | Dependencies | Notes / blockers |
|---|---|---|---|---|---|---|---|
| V1-01 | Independent shell and product identity | Complete | `87d40b9` | 5/5 tests; typecheck and production build passed | Five tabs, 390px no overflow, clean-origin PWA offline reload passed | None | Independent PeopleOS identity; no persistence or feature behavior |
| V1-02 | Versioned local data and backup foundation | Complete | `bcd7b40` | 24/24 tests; typecheck, production build, and dependency audit passed | Clean-origin 390px shell/data screens, navigation, semantics, no overflow or console errors; offline reload passed | V1-01; RC-01, RC-02, RC-03, RC-08, RC-09, RC-10, RC-12 | Complete V1 persistence contract and backup/restore foundation; product behavior remains deferred |
| V1-03 | Manual person capture and contact methods | Complete | `b5691ad` | 66/66 tests; typecheck, production build, and dependency audit passed | Clean-origin 390px named/provisional capture, contact management, validation, reload, navigation, Settings/data screens, and console checks passed; timed name + UK phone capture: 6.1s | V1-01–02 | Atomic Person aggregate capture; V1-04 duplicate warnings and vCard import remain deferred |
| V1-04 | Duplicate warning and vCard import | Not started | — | — | — | V1-01–03 | — |
| V1-05 | Interactions and timeline | Not started | — | — | — | V1-01–04 | Includes generic Contacted Interaction used by the explicit Already contacted action |
| V1-06 | Memory facts and affiliations | Not started | — | — | — | V1-01–05 | — |
| V1-07 | Follow-ups and cadence | Not started | — | — | — | V1-01–06 | Owns atomic Not today FollowUp/TodaySkip primitives; other due FollowUps remain untouched |
| V1-08 | Reach Out | Not started | — | — | — | V1-01–07 | Owns reciprocal sole-current-FollowUp invariant plus Already contacted completion history and replacement relinking |
| V1-09 | Relationship Engine core | Not started | — | — | — | V1-01–08 | Owns complete stable `buildToday` DTO/order; suggested intended action remains context |
| V1-10 | Today experience | Not started | — | — | — | V1-01–09 | Owns Contact now, Not today, Already contacted, phone/email target chooser, focused Add phone, interval setting/migration, disclosure, and compound transaction |
| V1-11 | Search and complete person profile | Not started | — | — | — | V1-01–10 | Must preserve the focused Contact Methods route and return-to-Today state |
| V1-12 | Batch networking capture | Not started | — | — | — | V1-01–11 | — |
| V1-13 | Contact actions and product hardening | Not started | — | — | — | V1-01–12 | Adds WhatsApp target resolution, Profile template composition, vCard, and hardening; notifications remain V1-14 |
| V1-14 | Today summary notifications | Not started | — | — | — | V1-01–13 | Mandatory stop unless an approved adapter reliably delivers while PeopleOS is closed; unsupported platforms show Unavailable |
