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

## Verify locally

Run:

```sh
node marketing/validate.mjs
python3 -m http.server 8080 --directory marketing
```

This surface has no analytics, cookies, form submission or remote fonts. One small local script cycles the homepage through the real PeopleOS loop: add a person, add the phone/contact frequency and starting point needed for regular reminders, opt into private name-free reminders, open Today with a curated conversation starter, then prepare an unsent WhatsApp draft. The visitor can choose each moment directly and cycle the starter. Without JavaScript or when reduced motion is preferred, all five moments remain visible as a static storyboard. The repository-root Vercel configuration owns the combined production routes and security headers.
