# PeopleOS TestFlight and App Store release checklist

This is the release source of truth for the chargeable iPhone MVP. Run it for every archive from a clean commit on GitHub `main`; do not rely on the README, an older package ledger, or a build whose commit cannot be proved.

## Repository gate

Run:

```sh
npm run release:preflight
```

The command runs all functional and performance tests, lint, type checking, marketing validation, and the production build containing marketing at `/` and the web product at `/app`. It separately builds the same shared product source for Capacitor, synchronises that native bundle into the iOS wrapper, verifies the release inputs below, and compiles the unsigned native Release configuration for the iPhone simulator:

- package and native marketing version agree;
- every native configuration uses the same positive build number;
- generated native web assets match the freshly built native product bundle rather than the combined marketing/web deployment;
- the embedded build commit matches the clean `main` commit being released;
- the local-notifications Swift package is embedded;
- the selective Contacts picker and explicit one-time contact writer are compiled, the Contacts usage description is present, and no Contacts-notes or remote-push entitlement has been introduced;
- the MVP advertises only the tested iPhone portrait scope.

The native build number must be increased before every App Store Connect upload. Record the release provenance before continuing:

- GitHub `main` commit: _pending_
- Working tree clean: _pending_
- Embedded PeopleOS build commit: _pending_
- CI result for that commit: _pending_

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

## Signed iPhone Contacts acceptance

Use real, non-sensitive test contacts on a signed physical iPhone. Record the test context below. Mark an item complete only after it passes; otherwise append **FAIL** or **BLOCKED** with concise evidence. The unsigned simulator build proves compilation only; it does not prove the system picker, permission state or Contacts database behaviour.

- Device model: _pending reconfirmation_ (previous development device: iPhone 15 Pro Max)
- iOS version: _pending reconfirmation_ (previous development device: 26.5.2)
- PeopleOS version/build: _pending final `main` build_
- GitHub `main` commit shown by the installed build: _pending_
- Tester: _pending_
- Date: _pending_
- Run status: **NOT YET RUN FOR THE RECONCILED `main` BUILD.** A previous Personal Team build was signed, installed, and launched with CloudKit disabled only for that configuration, but its exact installed commit was not provable and it is not final release evidence. Re-run every item below on the final signed physical-iPhone build. CloudKit remains a separate paid-team/production verification item.

- [ ] 1. Open Add person → Choose from iPhone Contacts and confirm the native picker opens correctly.
- [ ] 2. Select one contact and confirm it reaches the existing PeopleOS preview.
- [ ] 3. Select multiple contacts and confirm every selection reaches the same preview.
- [ ] 4. Cancel the picker and confirm PeopleOS data and any in-progress import remain unchanged.
- [ ] 5. Select a contact with multiple phone numbers and confirm every supported phone value appears in the preview and saved Person.
- [ ] 6. Select a contact with multiple email addresses and confirm every supported email value appears in the preview and saved Person.
- [ ] 7. Confirm organisation and job title appear correctly in the preview and saved Person.
- [ ] 8. Select a contact whose exact canonical phone already belongs to a PeopleOS Person and confirm duplicate review; when saving manually against an accessible Apple contact with that exact phone, confirm no second Apple card is created.
- [ ] 9. Select a contact whose exact canonical email already belongs to a PeopleOS Person and confirm duplicate review; when saving manually against an accessible Apple contact with that exact email, confirm no second Apple card is created.
- [ ] 10. Select a same-name contact with no exact phone/email match and confirm it is not incorrectly treated as a duplicate.
- [ ] 11. With full Contacts permission, create a contact through the explicit save option and confirm the operation succeeds.
- [ ] 12. On iOS 18 or later, test limited Contacts access; confirm creation succeeds and record that duplicate checks can see only contacts shared with PeopleOS.
- [ ] 13. Deny Contacts permission; confirm the PeopleOS Person remains saved and the UI gives the correct iPhone Settings guidance.
- [ ] 14. Test a restricted or unavailable Contacts state; confirm the PeopleOS Person remains saved and the UI does not offer a retry that cannot succeed.
- [ ] 15. Create a Person with Save to iPhone Contacts too Off; confirm PeopleOS saves them, no Contacts prompt appears and no Apple contact is created.
- [ ] 16. Create a Person with Save to iPhone Contacts too On; confirm PeopleOS saves first and then attempts Apple contact creation.
- [ ] 17. Force Apple contact creation to fail and confirm the PeopleOS Person still exists after closing and reopening the app.
- [ ] 18. Complete a successful save and confirm the new contact is visible in the native Contacts app.
- [ ] 19. Confirm the Apple contact contains only name, phone numbers, email addresses, organisation and job title.
- [ ] 20. Confirm cadence, reminders, notes, memories/history, conversation starters, Reach Out state and all other PeopleOS metadata are absent from the Apple contact.
- [ ] 21. Import a user-selected vCard and confirm the existing preview, duplicate review and import still work.
- [ ] 22. After physical acceptance, run `npm run release:preflight` and record the final result.

## App Store Connect and commercial setup — owner actions

- [ ] Create/confirm the App Store Connect record, Apple ID and bundle ID.
- [ ] Accept the current Paid Apps Agreement and complete banking and tax details.
- [ ] Choose a paid-upfront price and territories, or explicitly commission a separate StoreKit package if subscriptions/IAP are required. TestFlight itself is not a chargeable channel.
- [ ] Complete DSA trader status, age rating, category, App Privacy answers and export compliance.
- [ ] Supply final iPhone screenshots, description, keywords, review contact and review notes.
- [ ] For external TestFlight, supply the beta description, What to Test notes and a monitored feedback email, then submit the first eligible build for TestFlight Beta App Review.
- [ ] Publish a monitored support email and operator/legal name on `/support` and `/privacy`.
- [ ] Point `/download` to the public TestFlight link for beta, then the App Store product page at release.
- [ ] Verify marketing at `/`, the web product at `/app`, and the legacy root service-worker transition on the production origin.

## Terms

The smallest paid-upfront MVP uses Apple's standard EULA, so a custom `/terms` route is deliberately absent. Add custom terms only if the final commercial/legal setup genuinely requires them.
