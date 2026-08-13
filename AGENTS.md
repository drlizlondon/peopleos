# PeopleOS repository rules

Read [docs/platform-architecture.md](docs/platform-architecture.md) before changing platform, routing, deployment, or native build behavior.

- GitHub `main` is the only production source of truth.
- Shared product UI and business rules live in `src/`; do not fork them by platform.
- Native capabilities belong behind the existing Contacts, notifications, and sync adapters.
- `marketing/` owns the public website. The browser product lives under `/app`.
- Never hand-edit `dist*`, `ios/App/App/public`, generated Capacitor JSON/XML, DerivedData, or other generated web/native output.
- Run the repository verification command before merging.
- Vercel production and native release builds must be traceable to a commit on `main`.
- Use short-lived feature branches; merge them, verify `main`, then delete them.
