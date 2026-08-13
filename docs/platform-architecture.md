# PeopleOS platform architecture

PeopleOS is one product with one canonical implementation.

## Public surfaces

- **Marketing:** `/`, `/privacy`, `/support`, `/download`
- **Web/PWA product:** `/app` and product routes below `/app`
- **iPhone:** a Capacitor wrapper around the same React product in `src/`
- **Android (future):** another wrapper around that same product source, not a new app implementation

The marketing source lives in `marketing/`. The shared product UI, application services, domain rules, persistence, and platform adapters live in `src/`.

## Source of truth

GitHub `main` is the only production source of truth. A production web deployment or native build must name a commit that exists on `main`.

Platform-specific capabilities stay behind narrow adapters:

```text
src/                         shared product UI and rules
  contacts/                  Apple Contacts adapter boundary
  notifications/             native local-notification boundary
  sync/                      native CloudKit boundary
marketing/                   public website source
ios/                         tracked native project and Swift plugins
dist*/                       generated web output; never hand-edit
ios/App/App/public/          generated Capacitor output; never hand-edit
```

Web browsers intentionally keep working when a native adapter is unavailable. Native-only controls are hidden or report the capability as unavailable; the shared product must not crash.

CloudKit uses the existing `PeopleOSZoneV1` private zone. New local stores must be introduced with an expand/contract rollout: first release clients that ignore unknown remote stores, then enable uploads for the new store only once that compatibility release is the supported upgrade floor. Enabling a deferred store must also force a one-time full-zone fetch because compatibility clients advance their shared change token past ignored records. Conversation-starter usage is therefore local and included in JSON backups in its first release, but is deliberately not uploaded to the V1 zone yet.

## Build flow

```text
shared source
  -> marketing + /app production build -> Vercel
  -> native web build -> Capacitor sync -> Xcode -> iPhone
```

`dist`, native web output, generated Capacitor configuration, and `ios/App/App/public` are build products. The tracked Xcode project, entitlements, storyboards, assets, and repository-owned Swift plugins are native source and must remain version-controlled.

Use the package scripts rather than copying files by hand. `native:sync` must always build fresh native web assets before running Capacitor sync. The release preflight verifies that the native bundle matches the freshly generated source.

## Feature and release workflow

1. Start a short-lived `codex/<feature>` branch from current `main`.
2. Implement and run the relevant focused checks.
3. Run the repository verification command before merge.
4. Review and merge into `main` without rewriting history.
5. Delete the feature branch after `main` and production are verified.
6. Deploy Vercel production from `main` only.
7. Build iOS from a named `main` commit and record the commit shown in PeopleOS Settings.

An RC branch may be used briefly for testing, but it must never become a second long-lived production line.
