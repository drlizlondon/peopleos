# PeopleOS marketing surface

This directory is the source for the public marketing routes:

- `/`
- `/privacy`
- `/support`
- `/download`

There is no custom `/terms` page for this MVP. The release can use Apple's standard EULA unless the commercial setup later requires custom terms.

## How it is deployed

The repository production build combines this directory at the public root with the shared React product under `/app`. Both are deployed from GitHub `main` to one Vercel project:

- marketing: `/`, `/privacy`, `/support`, `/download`;
- web/PWA product: `/app` and its subroutes;
- native: the same product source built separately and copied into Capacitor.

The root service-worker transition is part of the combined build so an older root-scoped PeopleOS installation can move to `/app` without making generated assets an alternative source tree.

## Before publishing

The repository cannot supply these release facts. Add them before public beta or App Store submission:

1. the public TestFlight or App Store URL;
2. a monitored support email;
3. the operator or company's legal name;
4. the final public domain and App Store privacy/support URLs;
5. supported territories, price and public release state.

Until a distribution URL exists, `/download` truthfully explains that the beta link is not live. Once it is available, replace that page with a redirect or a single live Apple CTA while keeping `/download` as the permanent campaign URL.

## Beta waitlist

The homepage contains the iPhone beta waitlist in the hero and final call-to-action section. Formspree is the hosted form backend installed from the PeopleOS Vercel project and connected to the PeopleOS Formspree account. The page posts directly to its public form endpoint, so there are no provider secrets or environment variables:

- `assets/waitlist.js` owns the provider-independent form and success-state behaviour;
- `assets/waitlist-provider.js` is the replaceable Formspree adapter;
- the primary form stores email, optional first name, consent scope and a correlation reference;
- the optional one-tap answer is stored as a second event in the same form archive, with the same correlation reference and without duplicating the email;
- the form uses Formspree’s submission archive and Formshield spam filtering, with an additional honeypot in both request types.

The Formspree form IDs are public submission identifiers rather than secrets. Provider management credentials are not shipped to the browser. If the provider changes, replace the adapter without changing the page markup or interaction controller.

Before promoting the waitlist publicly, use a Formspree plan that supports export and the required retention period. On the free plan, submissions are retained for only 30 days and CSV/JSON export is unavailable.

## Verify locally

Run:

```sh
node marketing/validate.mjs
python3 -m http.server 8080 --directory marketing
```

This surface has no analytics, cookies or remote fonts. One local script cycles the homepage through the real PeopleOS loop: add a person, add the phone/contact frequency and starting point needed for regular reminders, opt into private name-free reminders, open Today with a curated conversation starter, then prepare an unsent WhatsApp draft. A separate local controller submits the beta waitlist to Formspree and keeps both homepage form instances in sync. The visitor can choose each product moment directly and cycle the starter. Without JavaScript or when reduced motion is preferred, all five product moments remain visible as a static storyboard. The repository-root Vercel configuration owns the combined production routes and security headers.
