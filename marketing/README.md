# PeopleOS marketing surface

This directory is a separate static marketing deployment. Its only public routes are:

- `/`
- `/privacy`
- `/support`
- `/download`

There is no custom `/terms` page for this MVP. The release can use Apple's standard EULA unless the commercial setup later requires custom terms.

## Why this is separate

The PeopleOS app currently owns `/`, registers a root-scoped PWA service worker, and stores local data against its current origin. Replacing that root with marketing could strand installed-PWA state and IndexedDB data. Deploy this directory as its own static project on the chosen marketing hostname. Leave the existing app/PWA on its current origin unless there is a separately tested migration plan.

If there are no real web/PWA users, the eventual clean structure can be:

- main public domain: this `marketing/` site;
- `app.` subdomain or a retained preview hostname: the existing Vite/PWA app.

Do not point the main domain at this directory until the current PWA-user/origin decision is confirmed.

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

This surface has no analytics, cookies, form submission or remote fonts. One small local script cycles the homepage through the real PeopleOS loop: add a person, add the phone/cadence and starting contact needed for recurring reminders, opt into private name-free reminders, open Today with a curated conversation starter, then prepare an unsent WhatsApp draft. The visitor can choose each moment directly and cycle the starter. Without JavaScript or when reduced motion is preferred, all five moments remain visible as a static storyboard. `marketing/vercel.json` supplies the clean route rewrites and restrictive security headers when this directory is configured as a Vercel project root.
