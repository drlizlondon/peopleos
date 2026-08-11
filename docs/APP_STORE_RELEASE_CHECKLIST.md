# PeopleOS TestFlight and App Store release checklist

This is the release source of truth for the chargeable iPhone MVP. Run it for every archive; do not rely on the README or an older package ledger.

## Repository gate

Run:

```sh
npm run release:preflight
```

The command runs all functional and performance tests, lint, type checking, marketing validation and the production build. It then synchronises that exact build into the Capacitor iOS wrapper, verifies the release inputs below, and compiles the unsigned native Release configuration for the iPhone simulator:

- package and native marketing version agree;
- every native configuration uses the same positive build number;
- generated native web assets match the production build;
- the local-notifications Swift package is embedded;
- no Contacts or remote-push permission has been introduced;
- the MVP advertises only the tested iPhone portrait scope.

The native build number must be increased before every App Store Connect upload.

## Apple Developer and CloudKit — owner actions

- [ ] Select the correct Apple Developer team for `com.drlizlondon.peopleos` in Xcode.
- [ ] Create or refresh an App Store distribution profile with the PeopleOS iCloud container.
- [ ] Confirm the signed Release archive contains the expected iCloud entitlements and no `aps-environment` entitlement.
- [ ] Confirm `iCloud.com.drlizlondon.peopleos` is assigned to the App ID and target.
- [ ] In CloudKit Console, deploy the `PeopleOSEntityV1` Development schema and fields to **Production**.
- [ ] Test an App Store/TestFlight-style build against the Production private database. An unsigned simulator build does not prove this.
- [ ] Decide the export-compliance answer. If the owner confirms PeopleOS uses only exempt Apple/platform encryption, add the matching `ITSAppUsesNonExemptEncryption` declaration; the repository does not make that legal declaration automatically.
- [ ] Publish the final public `/privacy` URL and link to it from inside the app. The published policy must identify the operator/contact, explain the 180-day/30-day deletion-marker retention, explain that pausing sync does not erase existing iCloud records, and give a working route for iCloud deletion assistance.

## Signed iPhone notification acceptance

Use a fresh install and set the reminder a few minutes ahead while Today contains at least one due person.

- [ ] Permission granted: one private local summary arrives in background and after force-quit.
- [ ] Permission denied: PeopleOS stays Off, does not repeatedly prompt, and explains the iPhone Settings route.
- [ ] Default time is 12:00 local; changing the time replaces the pending plan without duplicates.
- [ ] Turning reminders Off cancels pending PeopleOS summaries.
- [ ] An empty Today plan creates no notification.
- [ ] Lock-screen title is `PeopleOS`; the body contains no names, reasons, notes or relationship details.
- [ ] Warm tap and cold-start tap both open Today.
- [ ] Changing time zone and then reopening PeopleOS rebuilds reminders in the new local zone.

## App Store Connect and commercial setup — owner actions

- [ ] Create/confirm the App Store Connect record, Apple ID and bundle ID.
- [ ] Accept the current Paid Apps Agreement and complete banking and tax details.
- [ ] Choose a paid-upfront price and territories, or explicitly commission a separate StoreKit package if subscriptions/IAP are required. TestFlight itself is not a chargeable channel.
- [ ] Complete DSA trader status, age rating, category, App Privacy answers and export compliance.
- [ ] Supply final iPhone screenshots, description, keywords, review contact and review notes.
- [ ] For external TestFlight, supply the beta description, What to Test notes and a monitored feedback email, then submit the first eligible build for TestFlight Beta App Review.
- [ ] Publish a monitored support email and operator/legal name on `/support` and `/privacy`.
- [ ] Point `/download` to the public TestFlight link for beta, then the App Store product page at release.
- [ ] Put the marketing site on its chosen public hostname without moving an existing PWA origin until the IndexedDB/PWA-user decision is confirmed.

## Terms

The smallest paid-upfront MVP uses Apple's standard EULA, so a custom `/terms` route is deliberately absent. Add custom terms only if the final commercial/legal setup genuinely requires them.
