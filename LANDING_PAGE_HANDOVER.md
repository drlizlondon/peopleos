# Historical PeopleOS chargeable MVP handover

> This is a dated 11 August 2026 snapshot, not current branch, deployment, signing, or release evidence. GitHub `main` is now the only production source of truth. Use [docs/platform-architecture.md](./docs/platform-architecture.md) for the operating model and [docs/APP_STORE_RELEASE_CHECKLIST.md](./docs/APP_STORE_RELEASE_CHECKLIST.md) for current release acceptance.

- **Prepared:** 11 August 2026
- **Repository:** `/Users/lizzie/Documents/PeopleOS`
- **Historical source branch:** `codex/capacitor-cloudkit-sync`
- **Release candidate:** PeopleOS 1.0.0, native build 1
- **Readiness at the time:** repository gate passed; external signing, production CloudKit and App Store setup remained

## Outcome

PeopleOS now contains the smallest complete iPhone MVP agreed for this pass:

- the existing relationship product through Today, Reach Out, People, Upcoming and Settings;
- Personal, Professional and combined views;
- optional private local Today reminders;
- optional private iCloud sync with a visible off control;
- an in-app privacy screen;
- a four-route marketing surface combined with the web product at `/app`;
- a repeatable Release preflight.

At the time of this snapshot, the product code was credible as a release candidate but could not be described as TestFlight-tested or App Store-ready. Current signing/device state must be established from the canonical checklist rather than inferred from this handover, and production CloudKit deployment still cannot be verified from source control alone.

## Historical work references

- `ca3e94c` — Refine relationship modes and contact cadence
- `47aa9e4` — Add private iOS Today reminders
- `29875ab` — Add focused marketing download surface
- Release hardening — version/device scope, privacy and iCloud controls, Release preflight and this handover. This snapshot did not record a final canonical commit and must not be used as provenance for a new build.

## Notification behaviour

- Reminders are **Off by default** and the default time is **12:00 local time**.
- Only an explicit action in the iPhone app requests normal iOS notification permission.
- A denied permission leaves reminders off and does not create a repeated prompt loop.
- The user can change the time or turn reminders off in Settings.
- PeopleOS schedules only device-local notifications through Apple's notification framework. There is no backend, APNs entitlement or remote push service.
- The scheduler builds a safely replaceable rolling plan of at most 30 one-off reminders — the chosen time and a reminder every three hours until 22:00. It only includes dates on which the selected Personal/Professional view has at least one person in Today.
- A same-day reminder uses the current count where practical, with correct singular/plural wording. Forecast reminders use the approved private fallback: `People are waiting on your list today.`
- Notification payloads contain no person IDs, names, contact details, reasons, notes, affiliations or relationship details.
- Tapping a PeopleOS reminder opens Today, including a retained cold-start action. A tap is queued if the app is temporarily protecting an unfinished edit.
- The plan is reconciled on startup, app state changes, relationship-mode changes, settings changes, local-date changes and dataset revisions. Reopening after travel rebuilds it for the new local time zone.
- After 30 consecutive ignored days the user must reopen PeopleOS to replenish the local plan. Unlimited live evaluation while the app never opens would require a different architecture and is not claimed.

Automated coverage includes defaults and migrations, permission states, privacy of payloads, scheduling/replacement verification, cancellation, relationship modes, future eligibility, lifecycle refresh and tap routing. Delivery while backgrounded or force-quit still requires the signed-iPhone matrix below.

## Marketing routes and hosting structure

The marketing source is the static project in `marketing/`:

- `/` — concise homepage
- `/privacy`
- `/support`
- `/download`

There is deliberately no `/terms`; the smallest paid-upfront release uses Apple's standard EULA.

The canonical production build serves marketing at `/` and the shared PeopleOS PWA at `/app` on the same origin. IndexedDB remains on the same origin. A root service-worker retirement path handles older root-scoped PWA installations; Capacitor packages a separate native build of the same product source and never loads marketing.

The homepage uses the approved copy, a realistic Today representation with `Sarah` and `Follow up about digital health project`, the three requested benefits and the compact feature strip. It deliberately omits a trust line, testimonials, invented metrics, founder story, comparison table, long FAQ and unsupported claims.

Before publishing:

- replace the `/download` placeholder with the public TestFlight link, then the App Store product page;
- add the monitored support email and operator/legal identity to `/support` and `/privacy`;
- keep Vercel production connected to GitHub `main` and verify the legacy root-PWA transition before removing its compatibility worker.

## Historical release verification snapshot

Run `npm run release:preflight` from a clean, named commit on `main` before every archive. On 11 August 2026, the then-current branch reported:

- 604/604 functional tests;
- 10/10 performance tests;
- lint and type checking;
- marketing validation for all four routes;
- production PWA build;
- exact then-current web/native bundle verification;
- unsigned iPhone Release simulator build.

The native target is intentionally iPhone-only and portrait-only for the tested MVP. Selective picking uses Apple's permission-free system picker; optional one-time contact creation uses the declared Contacts permission and never writes PeopleOS-only metadata. Local notifications add no remote-push entitlement. Package and native marketing versions now agree at 1.0.0.

## Remaining submission blockers

These are owner/external actions, not hidden code-complete items:

1. Select the Apple Developer team and obtain valid distribution signing for `com.drlizlondon.peopleos` with the iCloud container.
2. Deploy the `PeopleOSEntityV1` schema and fields to the **Production** CloudKit environment and verify a signed build against it.
3. Archive and upload a new build number. Build 1 is currently configured; increment it if App Store Connect has already seen build 1.
4. Run the signed physical-iPhone/TestFlight notification matrix: grant, deny, changed time, Off, empty Today, background, force-quit, lock-screen privacy, warm tap and cold tap.
5. Complete the App Store Connect app record, Paid Apps Agreement, banking/tax, price and territories, DSA trader status, age rating, category, privacy answers, screenshots, review details and export-compliance answer.
6. For external TestFlight, provide the beta description, What to Test notes and a monitored feedback email, then complete the first-build Beta App Review.
7. Publish working privacy, support and download URLs with the missing operator/contact details; link the public privacy policy from inside the app and provide an iCloud deletion-assistance route.

TestFlight is beta distribution and is not the chargeable channel. The smallest commercial route is a paid-upfront App Store download. A subscription or in-app purchase would be a separate StoreKit package and is not implemented.

The step-by-step owner checklist is [docs/APP_STORE_RELEASE_CHECKLIST.md](./docs/APP_STORE_RELEASE_CHECKLIST.md).

## Deliberately outside this MVP

- remote/server push;
- notification names or personal context;
- automatic WhatsApp sending or automation (user-controlled WhatsApp/message preparation is retained);
- AI-generated suggestions or messages;
- automatic contact actions or inferred contact events;
- batch networking capture;
- vCard export;
- contact-book/provider sync;
- shared workspaces;
- StoreKit subscriptions or in-app purchases;
- custom legal terms.

## Safe next task

Start with the owner checklist, not more product scope. Once signing and CloudKit Production are ready, create a signed archive, run the physical-iPhone notification matrix, complete the public contact/download details, and submit the paid-upfront build. Do not add speculative features before those gates are closed.
