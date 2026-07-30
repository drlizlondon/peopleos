# PeopleOS MVP relationship flow

## Product test

The primary journey is:

> Open PeopleOS → see who needs attention → start a message or call in under 15 seconds.

PeopleOS reminds the user who to reconnect with. It does not claim to observe calls, messages, email, or conversations outside the app. Contact history is shown only when the user explicitly records an interaction; the existing **Contacted** action is one explicit way to do that.

## Information architecture

- **Today** — due Keep in touch reminders and deliberate Reach Out items. Message is the primary action.
- **Reach Out** — deliberate one-off intentions to reconnect.
- **People** — the single canonical people database, search, and person creation.
- **Upcoming** — future Keep in touch reminders, ordered by date.
- **Settings** — relationship views, conversation starters, import/backup, and privacy.

Each person exists once. Personal, Professional, and Everyone are filters over that shared record.

## Interaction hierarchy

- **Message** is the primary Today action because it is the quickest, lowest-friction way to begin a reconnection for most users. **Call** remains immediately available as a secondary action.
- Opening Message or Call never claims that contact happened. The reminder remains in Today until the user explicitly chooses **Contacted** or defers it.
- **Not today** is a legitimate one-tap choice when the timing is wrong or the user has already connected elsewhere; it does not fabricate a contact-history entry.
- A person profile shows **Last logged interaction** only when an explicit interaction record exists. With no log, the profile makes no claim about the last real-world conversation.

## Mobile wireframes

### Today

```text
┌─────────────────────────────┐
│ PeopleOS               + Add│
│ Today                       │
│ Who should I contact today? │
│ Everyone ▾                  │
│ ┌─────────────────────────┐ │
│ │ Mum            Due today│ │
│ │ “Hey Mum, thinking of…” │ │
│ │ Another suggestion      │ │
│ │ ☐ Ask about appointment │ │
│ │ [ Message ] [Call] [Not]│ │
│ │                    [•••] │ │
│ └─────────────────────────┘ │
│ Today Reach People Upc Set  │
└─────────────────────────────┘
```

### Person

```text
┌─────────────────────────────┐
│ ← People                    │
│ Mum                         │
│ [ Contact ] [ Log ]   [•••]│
│ ┌ Relationship summary ──┐ │
│ │ Personal                │ │
│ │ Last logged: 28 Jul     │ │
│ └─────────────────────────┘ │
│ ┌ Keep in touch ─ [Change]│ │
│ │ Every 2 weeks           │ │
│ │ Next: 11 Aug            │ │
│ └─────────────────────────┘ │
│ ┌ Reach Out ──────────────┐ │
│ │ Not included       [Add]│ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

### Relationship settings

```text
┌─────────────────────────────┐
│ ← Person                    │
│ Relationship settings       │
│ Appears in                  │
│ ☑ Personal  ☑ Professional │
│ Keep in touch               │
│ ☑ Remind me to stay in touch│
│ How often? [Every 2 weeks ▾]│
│ Start       [Today        ▾]│
│ Reach Out   Not included Add│
│ One-off reminders  View/add │
│ [ Save ] [Cancel]           │
└─────────────────────────────┘
```

## Desktop wireframes

Desktop keeps the same order, actions, and bottom navigation. Content is constrained to a readable column rather than introducing a separate desktop workflow.

```text
┌──────────────────────────────────────────────────────────────┐
│ PeopleOS                                           + Add     │
│ Today                                                        │
│ Who should I contact today?                                  │
│ Everyone ▾                                                   │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Mum · suggestion · note · Message · Call · Not today · •••│ │
│ └──────────────────────────────────────────────────────────┘ │
│          Today · Reach Out · People · Upcoming · Settings    │
└──────────────────────────────────────────────────────────────┘
```

## Visible components removed or demoted

- Multi-action global Add menu → **Add person** only.
- Profile action grid → **Contact**, **Log**, and overflow.
- Profile **Current plan**, **Why now**, and reminder-engine explanations.
- Large empty Reach Out explanation card.
- Full conversation-starter editor on the main Settings page.
- Global default already-contacted interval control.
- Inferred relationship stage, age, and suggested-reminder claims on the person profile.
- Today’s separate “Why this person?” explanation sheet.

The underlying person, interaction, follow-up, memory, Reach Out, and scheduling records remain intact.
