# V1-21 — Regular contact, in one control

**Status:** Proposal for review. Nothing built. Written 2026-08-18 from Lizzie's sketch.

## The sketch, as given

> it should be bespoke, you click on their name, one of the top things visible — regular contact
> on or off toggle. if on drop down sets regularity, every, digit, time/day/week/month … start
> today, defaulted to tick .. if unticked, then would be within week (can randomise day within 4
> days)

## What exists today, and why the sketch is right

Setting someone up as a regular contact currently takes two separate acts, in two places:

1. **A cadence** — `Person.contactCadence`, edited on the Edit screen behind a select labelled
   "How often do you want to contact them?". Reaching it: open the person, tap Edit, scroll, choose,
   Save changes. The profile itself only *displays* it, in a row called "Contact every", below the
   contact methods (`src/peopleScreens.tsx:1419`).
2. **A start** — the first FollowUp, created by `RegularContactStartPrompt`, which offers exactly
   two choices: Start today, Start tomorrow.

The two are separable, and that is the defect. When a cadence exists with no start,
`regularContactSetupState` returns `incomplete`, the engine returns `incomplete_regular_schedule`
(`src/relationship-engine/engine.ts:607`), and **the person never appears in Today**. PeopleOS knows
you want to contact Sarah every three weeks and silently does nothing about it. The Settings
notification status already has dedicated copy for this limbo — "Regular contact needs a start date"
— which is a sign the limbo is common enough to have needed a label.

The sketch's real contribution is not that it is fewer taps. It is that **one control cannot produce
the limbo state.** Turning the toggle on sets the cadence and the start together, atomically, or it
fails and sets neither. `incomplete_regular_schedule` becomes unreachable through the UI.

## Proposed control

At the top of the person screen, above contact details:

```
Regular contact                                    [ ●——]  On

  Every  [ 3 ]  [ weeks ▾ ]

  [x] Start today
      First contact: today

```

Unticked:

```
  [ ] Start today
      First contact: Thursday 21 August
```

**Off → On** writes cadence and the first FollowUp in one command. **On → Off** stops future
scheduling and keeps every record — the existing behaviour when cadence is set to "none", where
follow-ups are completed or cancelled and the timeline is untouched. Nothing is deleted. Ever.

## The randomised start

The sketch says: unticked means within a week, randomising the day within four days.

I read the purpose as spreading load, and it matters far more than it first appears. Every
subsequent date derives from the start, so thirty people started on the same day are not thirty
cards once — they are thirty cards **every cycle, forever**. A randomised start breaks the herd up
permanently, at the only moment it is cheap to do so.

Three things I would change about it:

1. **Show the chosen date immediately**, as above. Randomness the user can see and correct is a
   scheduling convenience; randomness they cannot is a deterministic engine telling them a date it
   will not explain. The whole product is built on being able to answer "why is this person here
   today?", and "we rolled a die in August" is only an acceptable answer if they watched the roll.
2. **Randomise at write time only.** The chosen date is stored on the FollowUp like any other. The
   engine stays pure; nothing downstream ever re-rolls. This follows the existing rule of deriving
   on write and reading from tables.
3. **Inject the randomness**, so the whole thing is testable and the golden fixtures stay stable.

## Open questions — I need answers before this becomes execution-grade

1. **"every, digit, time/day/week/month"** — I read this as a number plus a unit, and the stored
   model already has exactly `days | weeks | months` (`ContactCadenceUnit`). Was "time" a fourth
   unit you meant, or a slip?
2. **Four days or seven?** "within week" and "randomise day within 4 days" give two different
   windows. My recommendation is a **4-day window starting tomorrow** — soon enough to feel like
   you have started, spread enough to break the herd — but say if you meant a week.
3. **What does bulk add default to?** Per-person, "Start today" ticked is clearly right — you are
   looking at one person and deciding about them. For thirty people at once I would invert it and
   default to spreading, because the alternative floods Today on day one. That is a different
   default for the same control, and I would rather you chose it than have me assume.
4. **Does the toggle replace the Edit-screen cadence select, or sit beside it?** My recommendation
   is replace: two places to set the same thing is how the current split happened.

## Acceptance criteria (draft — not yet execution-grade)

- Turning the toggle on writes cadence and the first FollowUp atomically; a failure writes neither.
- No sequence of UI actions can produce `incomplete_regular_schedule`.
- Turning the toggle off removes no Interaction, FollowUpEvent, or timeline entry.
- The first-contact date is visible before the user commits, ticked or unticked.
- An unticked start lands within the agreed window, and the same seed always gives the same date.
- The control is reachable in one tap from the person's name, above contact details.
- Existing people with a cadence and no start are offered the same control, and it fixes them.
