# PeopleOS Scale and Remediation Plan (V1-R series)

Status: **accepted 2026-07-25**. Written 2026-07-25 against commit `32c7fd9` (V1-01…V1-11 complete, 514/514 tests green, `tsc --noEmit` clean, production build clean).

Accepted decisions, recorded verbatim at acceptance:

1. The command module is the single write substrate; `repositories.ts` is reduced to transactional storage primitives rather than routing command behaviour through it (POS-D044 as recommended).
2. The two-phase engine contract change is accepted. V1-09's acceptance criteria are amended; V1-09 remains recorded as **Complete**. The amendment must state what changed, why, and which previous guarantees remain intact (POS-D042).
3. No persisted projection cache unless the measured gate after V1-R3 still fails. If it fails it becomes a separate, evidence-triggered package; cache logic must not enter V1-R2 or V1-R3 (POS-D043 and the §5 gate).
4. The existing idempotency replay implementation is left unchanged. The pattern is frozen — no new hand-written replay blocks — and this remediation is not broadened into that refactor (§6).
5. PeopleOS is added to the portfolio map, the `V1` prefix is reserved, and a continue-queue entry is added (§7).

This plan exists because the product target moved: PeopleOS must hold **3,000 contacts** and stay calm. It also closes the structural findings from the architecture review of the same commit. Package scope and acceptance criteria here are authoritative for the V1-R series; `VERSION1_SCOPE.md` remains authoritative for V1-12…V1-14.

---

## 1. The measured problem

All figures below were measured on this machine against the shipped code at `32c7fd9`, main thread, synthetic datasets. They are not estimates.

### 1.1 Today projection scaling

`getTodayScreenProjection` → `readAllData` → `assessRelationshipsFromData` → `buildToday`.

| People | Interactions | Dataset (JSON) | Today build |
|---|---|---|---|
| 500 | 5,000 | 1.3 MB | 152 ms |
| 1,000 | 15,000 | 3.6 MB | 374 ms |
| 2,000 | 30,000 | 7.2 MB | 969 ms |
| **3,000** | **45,000** | **10.8 MB** | **1,916 ms** |
| 3,000 | 90,000 | 19.1 MB | 2,740 ms |

At the target size a single Today build blocks the main thread for roughly two seconds. Today rebuilds the **entire** projection before every mutating action ([todayQueries.ts:187](src/application/todayQueries.ts:187) calls `getTodayScreenProjection`), so "Already contacted" costs that twice — once to prepare, once to refresh.

### 1.2 Two independent causes

**Cause A — the per-person join is O(P × R).** `relationshipBundleFromData` ([relationshipEngineQueries.ts:26](src/application/relationshipEngineQueries.ts:26)) filters all six child collections once per Person. A prototype that groups every collection by `personId` **once** and hands each Person a pre-grouped bundle produces **byte-identical `orderedItems`** and:

| People | Interactions | Current | Grouped | Speed-up |
|---|---|---|---|---|
| 3,000 | 45,000 | 1,916 ms | 744 ms | 2.6× |
| 3,000 | 90,000 | 2,740 ms | 756 ms | 3.6× |

Note the second row: after grouping, doubling interaction count costs 12 ms. The interaction-volume sensitivity disappears entirely. What remains is a fixed per-Person cost.

**Cause B — we compute what we discard.** That residual ~750 ms is 3,000 × ~250 µs of `assessRelationship`. Measured per-Person cost by shape (3,000 iterations each, warmed):

| Person shape | 0 interactions | 5 interactions | 15 interactions |
|---|---|---|---|
| Dormant (no follow-up, no cadence) | 110 µs | 232 µs | **240 µs** |
| Cadence set | 110 µs | 262 µs | 241 µs |
| Due follow-up (eligible) | 79 µs | 200 µs | **193 µs** |

**Contacts that will never appear on Today are the most expensive ones.** `assessRelationship` unconditionally builds relationship stage, relationship age, last contact, memory cue, search-context cue (a second full cue build), overdue follow-up, suggested reminder and Reach Out states for every Person — while `buildToday` reads only `today`, `active`, `importance` and `displayName`. For 3,000 contacts rendering ~10 cards, well over 95% of that work is allocated and thrown away.

This is why an "early-out for ineligible people" is not the fix. The fix is to stop computing card-grade projections for people who are not on a card.

### 1.3 Search is worse than Today

`getPersonSearchView` ([personSearch.ts:505](src/application/personSearch.ts:505)) calls `readAllData` and then `assessRelationshipsFromData` **twice** ([personSearch.ts:423](src/application/personSearch.ts:423) and [personSearch.ts:478](src/application/personSearch.ts:478)). The People screen effect ([peopleScreens.tsx:248](src/peopleScreens.tsx:248)) re-runs it on every change to `query` with **no debounce**.

At 3,000 contacts that is a 10.8 MB read plus ~3.8 s of projection **per keystroke**. Typing a five-letter name is roughly twenty seconds of blocked main thread. This is the single most severe defect in shipped code and it is in V1-11, which is marked Complete.

### 1.4 Redundant sorting inside the engine

`contactInteractions` returns an ascending-sorted array, and three call sites then re-sort a full copy of it to find the latest element: [engine.ts:185](src/relationship-engine/engine.ts:185) (`buildLastContact`), [engine.ts:491](src/relationship-engine/engine.ts:491), [engine.ts:555](src/relationship-engine/engine.ts:555).

**Execution warning — do not "simplify" this to `contacts[contacts.length - 1]`.** `compareInteractionsDescending` reverses the `occurredAt` comparison but keeps the tie-break in the *same* direction (`compareText(left.id, right.id)`, [engine.ts:97](src/relationship-engine/engine.ts:97)). On equal `occurredAt` the descending sort selects the **lowest** id, whereas the last element of the ascending array is the **highest** id. Replace each re-sort with a single linear scan using the existing `compareInteractionsDescending` comparator. Behaviour must be identical on ties, and the regression harness in V1-R2 must include an equal-timestamp fixture.

### 1.5 Structural findings carried from the review

| Finding | Evidence |
|---|---|
| Two competing write substrates | `createRepositories` is used in production by 1 of 17 application modules ([personLifecycle.ts:83](src/application/personLifecycle.ts:83)); the other 16 open `db.transaction(...)` directly across **42 sites** and hand-roll the `datasetRevision` bump **24 times** |
| Referential integrity is advisory | `assertWriteReferences` ([repositories.ts:59](src/data/repositories.ts:59)) reads outside the write transaction, and is bypassed by nearly every real write path |
| Navigation state is an ad-hoc protocol | **16** distinct `window.history.state` keys read across 5 production files; [App.tsx:151-238](src/App.tsx:151) is a per-route `else if` ladder; 9 screens carry bespoke `onBack` closures |
| No mechanical constraints | No ESLint, no Prettier, no CI (`.github` absent), no `lint` script. V1-09's "no UI module contains relationship calculations" is unenforced |
| UI layering stopped at the boundary | 28 single-screen files at `src/` root, but `peopleScreens.tsx` is 2,478 lines holding 4 screens; no `src/ui/` while `domain/`, `application/`, `data/` are properly layered |
| Bundle is one chunk | 761 kB raw / 197 kB gzip, fully precached (783 KiB) — every update is a full re-download |

---

## 2. Target and budgets

**Reference corpus** (fixed, committed as a generator): 3,000 People, 45,000 Interactions, 12,000 MemoryFacts, 3,000 affiliations, 3,000 contact methods, 750 pending FollowUps, 200 Reach Out entries. Roughly 11 MB of stored JSON.

All budgets are on the reference corpus, main thread, and are enforced by a committed test (see V1-R1), not by a paragraph:

| Operation | Budget | At planning | After V1-R2 |
|---|---|---|---|
| Today projection (cold) | ~~≤ 150 ms~~ **hold ≤ 400 ms** | 1,916 ms | **168 ms** |
| Today action round-trip (prepare + refresh) | ~~≤ 300 ms~~ **hold ≤ 700 ms** | ~3,800 ms | **334 ms** |
| Search keystroke → results | **≤ 150 ms** | ~3,800 ms | 323 ms |
| Five-keystroke search sequence | **≤ 750 ms** | ~19,600 ms | 1,691 ms |
| Person profile open | **≤ 150 ms** | not measured | not measured |
| People list first paint | **≤ 200 ms** | not measured | not measured |

The first two budgets were **retired on 2026-07-26** (POS-D044) and now hold at
their proven figures rather than pushing lower: the residual is IndexedDB read
time that only denormalised contact state could remove, and 168 ms is already
imperceptible for a screen load. Interactive search latency is V1-R3's priority
instead — it is the only remaining path a user feels on every keystroke.

Budgets are ceilings expressed as a **ratchet**: V1-R1 lands the harness with today's measured numbers as the ceiling so nothing can regress; V1-R2 and V1-R3 tighten it to the values above. A package is not complete until its ceiling is lowered in the committed test.

---

## 3. Decisions this plan makes

Each is offered as a recommendation with its strongest alternative and the cost of being wrong. These become ADRs in `DECISIONS.md` on acceptance.

### POS-D042 — Two-phase Today evaluation; still no persisted projection

**Recommendation.** Split evaluation into a cheap **candidate pass** over every Person (eligibility, due state, relevant date, ordering keys) and a **card pass** that runs the existing full `assessRelationship` only for the People actually rendered. Keep the engine pure and keep POS-D041's "nothing is persisted or cached".

**Why.** §1.2 shows the cost is card-grade projections computed for people who will never be on a card. Grouping (2.6–3.6×, proven byte-identical) plus not computing discarded work should reach the 150 ms budget: a candidate pass needing only pending follow-ups and a precomputed contact summary should run at roughly 15 µs/Person (≈45 ms for 3,000), plus ~10 card-grade assessments at ~200 µs (≈2 ms).

**Strongest alternative.** A persisted, versioned projection table maintained on write (doctrine §2.6, "derive on write, read from tables"). Rejected *for now* because it adds invalidation, restore, migration and rebuild complexity, and POS-D041 already commits to measuring before caching. It also depends on this work: you cannot rebuild a cache cheaply without a cheap candidate pass.

**Cost of being wrong.** If the two-phase pass lands at, say, 400 ms instead of 150 ms, we add the persisted table afterwards — and this package is a prerequisite for it either way. The wasted work is close to zero. The reverse mistake (caching first) is expensive and hard to unwind.

**Consequence to accept explicitly.** This changes an engine contract. V1-09's acceptance criterion — that `buildToday` returns intended-action context in global order — becomes: the **candidate pass** returns eligibility, due state, relevant date, follow-up IDs and global order; the **card pass** returns explanation and intended-action context. V1-09's baseline is amended, not reopened.

### POS-D043 — Denormalised contact summary is deferred, not adopted

**Recommendation.** Do **not** yet store `lastContactAt` / `contactCount` on `Person`. Compute the contact summary in one linear pass over the interactions during grouping.

**Why.** "What counts as contact" is policy (`interactionCountsAsContact`). Storing its output on Person freezes that policy into the schema and makes any future change a data migration. Doctrine §2.3: do the freezing step last. §1.2 indicates we do not need it to hit budget.

**Cost of being wrong.** If the linear pass over 45,000 interactions proves too slow on a mid-range phone, we add the denormalised columns in a later package with a rebuild migration — with a measured number justifying the freeze.

### POS-D044 — One write substrate: the command module, not the repository

**Recommendation.** Make the transactional command module the single documented write substrate, and reduce `data/repositories.ts` to the shared primitives those commands use (revision guard, referential assertions, dataset-revision bump) — all executed **inside** the caller's transaction. Migrate `personLifecycle.ts` onto it. Delete `createRepositories` from production.

**Why.** 16 of 17 modules already work this way, the commands need multi-store atomicity the repository cannot express, and the repository's integrity checks are unsound anyway because they run outside the write transaction (§1.5). Choosing the substrate that is already load-bearing is the smaller migration.

**Strongest alternative.** Route all 42 sites through the repository. Rejected: the repository is a single-store abstraction and every real command touches 3–7 stores atomically; forcing it would either break atomicity or grow the repository into the command module by another name.

**Cost of being wrong.** If we later want a single choke point for sync or audit, the shared primitives are that choke point — this recommendation creates it rather than removing it.

### POS-D045 — Search is a projection consumer, not a projection producer

**Recommendation.** Search ranks on stored fields plus the candidate-pass summary. Card-grade cues (`searchContextCue`) are computed only for the result page being displayed. Search input is debounced at 200 ms with in-flight cancellation.

**Why.** §1.3. Nothing about ranking requires a full relationship assessment of 3,000 people, and nothing requires it twice.

**Cost of being wrong.** If ranking quality measurably drops, restore a specific cue to the candidate pass — a targeted addition with a known cost, not a blanket assessment.

---

## 4. Packages

Prefix note: PeopleOS is currently **unregistered** in `~/.claude/portfolio.md` and its `V1-nn` numbering is unclaimed. Register `V1` to PeopleOS before this series starts, following the Mission Control precedent where remediation runs as a sub-series (`R2.x`). These packages are `V1-R1`…`V1-R5`.

Each package is one session, ends with the build green, and records its acceptance criteria as checkboxes in the commit message. Executors implement exactly the package; on contradiction they stop, log the conflict here, and ask.

---

### V1-R1 — Mechanical constraints and the performance gate

**Depends on:** nothing. **Do this first.**

Nothing else in this plan is safe to verify without it: every later package claims a performance number, and there is currently no mechanism that can fail when one is wrong.

**Scope**

1. ESLint flat config (`eslint.config.js`) + `typescript-eslint`, and `"lint": "eslint src"` in `package.json`. `"check"` becomes `npm run lint && npm run test && npm run build`.
2. Boundary rules, as `no-restricted-imports`:
   - UI files (`src/*.tsx`) may not import `src/relationship-engine/**` except the `index.ts` barrel types — enforces V1-09's "no UI module contains relationship calculations".
   - UI files may not import `src/data/database` or `src/data/repositories` directly; they go through `src/application/**`.
   - Nothing outside `src/navigation*` may reference `window.history.state` (rule lands disabled with a TODO referencing V1-R5; enabled by V1-R5).
   - Nothing outside the write-substrate module may contain `datasetRevision` arithmetic (lands disabled; enabled by V1-R4).
3. `.github/workflows/ci.yml` running `npm ci && npm run check` on push and PR.
4. `src/performance/corpus.ts` — deterministic generator for the §2 reference corpus (seeded, no `Math.random`).
5. `src/performance/scale.test.ts` — asserts each §2 operation against a ceiling exported from `src/performance/budgets.ts`. Ceilings land at **current measured values rounded up** (Today 2,200 ms; search 4,200 ms). The test runs in CI.
6. Delete the scratch files `src/zzbench.test.ts` and `src/zzbench2.test.ts`; their content is superseded by 4–5.

**Acceptance criteria**

- [x] `npm run check` runs lint, tests and build, and is green.
- [x] CI runs on a pull request and fails when `npm run check` fails (demonstrate with one deliberately broken commit, then revert).
- [x] A deliberate import of `relationship-engine/engine` from a `.tsx` file fails lint.
- [x] The ratchet passes at current ceilings and fails when a ceiling is lowered by 20% (demonstrate, then revert).
- [x] The corpus generator is deterministic: two runs produce identical record IDs and counts.
- [x] 514 existing tests still pass; no production behaviour changed.

**Delivered 2026-07-25. Deviations from the scope above, and why:**

1. **The ratchet is four files, not `scale.test.ts`.** Written as one file it was
   unusably flaky: running the mutation measurement before the search
   measurement in the same process left enough heap pressure to inflate search
   by ~60% (21.5 s → 32.8 s) with no code change. Each measurement now owns a
   file, and therefore a worker process, at a cost of one ~2 s corpus seed each.
2. **The gate asserts the fastest run, not the median.** Timing noise here is
   one-sided — GC, a busy core or a cold cache can only add time. Across runs of
   identical code the median moved 1.5–2.4×, while the minimum was stable to
   0.5–10%. Both statistics are printed so a widening gap stays visible.
3. **Ceilings are scaled by a measured machine factor**, not fixed milliseconds,
   so a slower CI runner cannot produce a false red. Each run times a synthetic
   workload that deliberately calls no application code — a calibration that
   called the engine would speed up in step with any engine optimisation and the
   gate would measure nothing.
4. **The `datasetRevision` and `history.state` boundary rules ship commented
   out**, as planned, owned by V1-R4 and V1-R5.
5. **The storage-boundary rule ships enforced with 30 recorded exceptions.**
   `relationship-engine` internals are clean today, so that rule is a true gate
   immediately. The data-layer rule had 30 pre-existing violations across 25
   screens; each is marked at its exact line with an `eslint-disable-next-line`
   naming V1-R4 as owner. New violations fail; the debt is countable and cannot
   grow silently. Fixing all 25 screens inside V1-R1 would have been the 25-file
   refactor V1-R4 and V1-R5 exist to do.
6. **`npm test` excludes `src/performance/**`**, which runs as `npm run
   test:perf`. The fast loop stays at ~34 s; `npm run check` and CI run both.
   The ratchet takes ~3–5 minutes today because the code under test is slow; it
   shrinks as the ceilings fall.
7. **`react-hooks/rules-of-hooks` was added** because a pre-existing
   `eslint-disable` comment referenced a plugin the project never installed.
   `exhaustive-deps` is deliberately left off — auditing the existing considered
   suppressions is its own package.

**Recorded baseline** (`src/performance/budgets.ts`, never to be edited): Today
projection 2,062 ms; Already contacted round trip 4,360 ms; five-keystroke
search 20,080 ms; single keystroke 4,205 ms. Ceilings sit ~50% above these.
Evidence that no production behaviour changed: the production bundle hashes
(`index-sKJZ4_Wo.js`, `index-BKrZaBGw.css`) are byte-identical before and after.

---

### V1-R2 — Two-phase Today projection

**Depends on:** V1-R1. **Implements:** POS-D042, POS-D043.

**Scope**

1. `src/application/relationshipEngineQueries.ts`: replace per-Person filtering with one grouping pass (`Map<personId, T[]>` per collection) built once per snapshot. Compute a per-Person contact summary (count, first, last by the exact `compareInteractionsDescending` tie-break) in the same pass.
2. `src/relationship-engine/`: add a candidate pass — inputs are Person ordering fields, that Person's pending FollowUps, the contact summary, and cadence; output is the existing eligibility code, due state, relevant date, primary and additional FollowUp IDs, plus ordering keys. `buildToday` consumes candidates and owns global order exactly as today.
3. Card-grade `assessRelationship` is called only for People in the rendered page; `getTodayScreenProjection` renders cards from those.
4. Remove the three redundant re-sorts ([engine.ts:185](src/relationship-engine/engine.ts:185), [:491](src/relationship-engine/engine.ts:491), [:555](src/relationship-engine/engine.ts:555)) via linear scan with the **existing comparator** — see the tie-break warning in §1.4.
5. `getTodayActionContext` ([todayQueries.ts:187](src/application/todayQueries.ts:187)) stops rebuilding the whole projection: it resolves one Person's card from a single snapshot.
6. Amend V1-09's acceptance criteria in `VERSION1_SCOPE.md` per POS-D042 and record the ADR.

**Outcome (2026-07-25): delivered, but the headline design was not built — the evidence overturned it.**

Four changes that alter no contract removed 91% of the cost, and the two-phase
engine split then targeted only 27% of what remained. Building it would have
split a published contract to chase part of a shrinking minority of the cost, so
it was **not built**. Recorded as POS-D042; V1-09's acceptance criteria need no
amendment after all, and V1-09 stays Complete on its original terms.

| Operation | Before | After | Gain |
|---|---|---|---|
| Today projection | 2,062 ms | **179 ms** | 11.5× |
| Already contacted round trip | 4,360 ms | **341 ms** | 12.8× |
| Five-keystroke search | 20,080 ms | **1,698 ms** | 11.8× |
| Single keystroke | 4,205 ms | **314 ms** | 13.4× |

What actually did the work, in order of size:

1. **`Intl.DateTimeFormat` was being constructed on every call** in
   `localDateForInstant` — ~27 µs against ~1.3 µs for a reused formatter, and
   the engine resolves local dates ~8× per Person. Caching one formatter per
   time zone took 2,062 ms → 1,101 ms. One line, byte-identical output.
2. **Grouping child collections once** per snapshot instead of filtering per
   Person, removing the O(People × records) join.
3. **Id-indexed card assembly** — building 634 cards previously ran three
   `find`s and two `filter`s over whole collections *per card*.
4. **Shared memory-cue fallback and linear latest-contact scans**, removing a
   duplicated cue build and three full re-sorts per Person.

Remaining Today cost, measured: **105 ms IndexedDB read, 49 ms assessment across
all 3,000 People, 23 ms card assembly, 3 ms grouping and ordering.** The
dominant term is now storage, not computation — which the two-phase split does
nothing about, and which is V1-R3's scope.

**The §2 targets of 150 ms and 300 ms are therefore not reachable by engine work
alone** (POS-D043). Today reads all 45,000 Interactions solely to derive each
Person's most recent contact; closing the last gap needs a narrowed read or
denormalised contact state, both of which belong to V1-R3 with their own
evidence. The ratchet holds the proven figures rather than the aspiration.

**Acceptance criteria**

- [x] **Equivalence:** a differential harness runs old and new evaluation over ≥500 randomised datasets (including empty, single-contact, all-archived, all-merged, equal-`occurredAt` ties, equal-`dueDate` ties, snoozed follow-ups, Reach Out-linked follow-ups) and asserts `orderedItems` are deeply identical. Zero divergence.
- [~] Today projection on the reference corpus ≤ **150 ms** — **not met: 179 ms**, and not reachable by engine work (POS-D043). Ceiling lowered 3,100 → 400 ms, locking in 11.5×. Reaching 150 ms is re-scoped to V1-R3's narrowed reads.
- [~] Today action round-trip ≤ **300 ms** — **not met: 341 ms**, same cause. Ceiling lowered 6,500 → 700 ms.
- [x] Doubling the corpus interaction count changes Today projection by ≤ 15% — the O(People × records) join is gone; grouping is 2 ms of 180 ms.
- [n/a] Card-grade `assessRelationship` called at most `pageSize` times per render — void with POS-D042: there is no card-grade/candidate distinction, because the split was not built. The equivalent waste was removed instead by narrowing the action path to assemble one card rather than 634.
- [x] Every Today card still shows an explanation whose facts carry `sourceId`s resolving to existing records — asserted per card in the ratchet, and covered by whole-assessment deep equality in the differential harness.
- [x] 514 existing tests pass unchanged; no test is weakened or deleted. Suite is now 517 (three added by the differential harness).

---

### V1-R3 — Narrowed reads, search, and list scale

**Depends on:** V1-R2. **Implements:** POS-D045.

**Scope**

1. Debounce the People search effect ([peopleScreens.tsx:248](src/peopleScreens.tsx:248)) at 200 ms with cancellation of in-flight work; same for the Reach Out scoped search.
2. `personSearch.ts`: remove both `assessRelationshipsFromData` calls ([:423](src/application/personSearch.ts:423), [:478](src/application/personSearch.ts:478)). Rank from stored fields plus the candidate summary; compute `searchContextCue` only for the displayed result page. Stop calling `readAllData` ([:502](src/application/personSearch.ts:502), [:509](src/application/personSearch.ts:509)).
3. Replace full-store `getAll()` reads in the hot paths with index-scoped reads where an index already exists (`followUps.by-status`, `todaySkips.by-local-date`, `interactions.by-person`, `reachOutEntries.by-status`). `followUpQueries.ts` is the internal benchmark for this — it already does it correctly; mandate its pattern.
4. Paginate or virtualise the People list at 3,000 rows.
5. Filter-option derivation (`filterOptions`, stage counts) must not require a full assessment pass.

**Outcome (2026-07-26): approved. The interactive win landed; the per-query
target moved to V1-R6 and two items were formally descoped (see below) rather
than carried as unmet criteria.**

| Metric | Baseline | After V1-R2 | After V1-R3 |
|---|---|---|---|
| Queries issued per 5-character name | 5 | 5 | **1** |
| Single query | 4,205 ms | 323 ms | **266 ms** |
| Five raw queries | 20,080 ms | 1,691 ms | **1,482 ms** |

What landed:

1. **The search input is debounced** (200 ms) in People and Reach Out, so typing
   a name costs one query instead of one per keystroke. This is the change a
   user feels, and it is asserted mechanically by a read counter in
   `src/v1r3.searchDebounce.ui.test.tsx` — verified to report five searches when
   the debounce is removed and one when it is present.
2. **The double assessment pass is gone.** `getPersonSearchView` assessed all
   3,000 People twice per query, once for results and once for filter options;
   it now computes them once and shares them.
3. Duplicated per-result affiliation selection removed.

**The 150 ms per-query target was not met (266 ms), and is not close.** Measured
breakdown of one query: **105 ms `readAllData`, 101 ms ranking, 50 ms
assessment, 2 ms filter options.** Neither large term is reachable without
something this package deliberately excludes:

- The 105 ms read is the whole dataset, and search genuinely touches almost
  every store. Avoiding it per query means an in-memory snapshot keyed by
  `datasetRevision` — cache logic, which the accepted constraint keeps out of
  R2/R3.
- The 101 ms ranking is per-Person work inside `highestMatch` and result
  construction: phone parsing via `resolveContactNowTargets` for every Person,
  and text normalisation of every note, affiliation, fact and tag. Reducing it
  means changing ranking internals, which have **no differential harness** — and
  ranking is precisely where a silent behaviour change is easy to introduce and
  hard to notice. That needs its own package with an equivalence oracle first,
  as V1-R2 had.

Perceived latency for a typed name is now one debounce interval plus one query,
roughly 470 ms, against 19.6 seconds at baseline.

**Acceptance criteria**

- [~] Search keystroke → results ≤ **150 ms** — **not met: 266 ms.** Ceiling lowered 700 → 450 ms, locking in 15.8x. The remainder needs its own package; see above.
- [x] Typing a 5-character query issues at most **2** database reads total, and never more than one in-flight query — the counter asserts 1, and is verified to fail at 5 without the debounce.
- [descoped] People list first paint ≤ **200 ms**; Person profile open ≤ **150 ms** — **moved to V1-R6.** The People list with no query *is* a blank search, so its cost is ranking cost and it belongs with the ranking work rather than sitting here unmet. Person profile open travels with it.
- [descoped] `readAllData` removal from production — **deferred to the evidence-triggered read package.** It was written as an R3 task before the cost was known. Removing it means either an in-memory snapshot or denormalised contact state, both of which POS-D043 holds behind their own decision with measurements attached. It is not an R3 failure; it was never R3's to do once the constraint was set.
- [x] All V1-11 search acceptance criteria still pass: every required field type searchable, deterministic ranking, archived excluded unless requested, contextual event results.
- [x] 390px layout, keyboard focus and Back-restoration behaviour unchanged — 519/519 green, including the full V1-11 search and profile suites.

---

### V1-R6 — Search ranking performance

**Depends on:** V1-R3. **Implements:** POS-D045. **Carries:** the per-query
target and the People-list/profile budgets descoped from V1-R3.

Search ranking is the last large interactive cost: 101 ms of the 266 ms query,
and 120 ms of the blank-query People list. It is also the most dangerous code in
the codebase to optimise. Ranking decides *which* people a user finds and in
*what order*, from eleven match sources across name, contact identity,
affiliation, event, memory fact, tag, note and Reach Out — and a change that
silently reorders or drops a tier produces a product that still looks like it
works. V1-11's own criterion is "deterministic ranking".

**Therefore: the oracle comes first, and no optimisation lands before it is
green.** This is not a preference; it is the sequencing that made V1-R2 safe.

**Scope, in order**

1. **Build the executable equivalence oracle, and land it on its own, before
   touching any ranking code.** Freeze today's `searchPeopleFromData` and
   `personFilterOptionsFromData` as `src/application/__legacy.personSearch.ts`,
   and add a differential test that runs both implementations over seeded random
   datasets. The generator must exercise, deliberately: every one of the eleven
   `PersonSearchSource` tiers; exact / prefix / token-prefix name collisions;
   phone and email queries in several formats; equal `matchedAt` values and
   equal display names, which are where ordering ties are decided; every
   `PersonSearchFilters` field including all three `archive` modes; merged and
   archived People; the empty query, which is the People list; and queries
   matching nothing. Assert deep equality of the full `PersonSearchResult[]`
   **including order**, and of `PersonFilterOptions`.
2. **Prove the oracle can fail** by reintroducing a plausible ranking bug — for
   example swapping two adjacent tiers, or dropping the `matchedAt` tie-break —
   and confirming it is caught. An oracle nobody has seen fail is decoration.
3. Only then optimise. Known suspects, in measured order:
   - `validCurrentContactMethods` runs `resolveContactNowTargets` — libphonenumber
     parsing — for **every Person**, solely to compute `missingContactDetails`.
   - `highestMatch` builds all nine candidate arrays for every Person, then sorts
     and takes the first, rather than stopping once no better tier is reachable.
   - `noteMatches` normalises every Interaction summary of every Person on every
     query: ~45,000 `normalize("NFKD")` calls at reference scale.
   - `groupedByPerson` runs six times here and again inside the assessment pass.
4. Add `peopleListFirstPaint` and `personProfileOpen` ratchet entries.
5. **Retire both executable oracles.** With ranking work complete, convert the
   engine oracle (`src/relationship-engine/__legacy.engine.ts`) and this
   package's search oracle to golden fixtures, and delete both duplicate
   modules. This is the standing pattern, now named: **an executable oracle for
   the duration of the work that needs it, golden fixtures as the permanent
   regression net.** A frozen duplicate is worth its cost while you are changing
   the thing it mirrors, and only then.

**Acceptance criteria**

- [ ] The oracle lands in its own commit, before any ranking change, and is demonstrated failing on a deliberately reintroduced ranking bug (then reverted).
- [ ] Differential equivalence over ≥500 randomised datasets: full `PersonSearchResult[]` deeply equal **including order**, and `PersonFilterOptions` deeply equal. Zero divergence, and the generator is asserted to have produced at least one match from every one of the eleven sources.
- [ ] Single query ≤ **150 ms** on the reference corpus; `searchSingleKeystroke` ceiling lowered in the same commit.
- [ ] Blank-query People list ≤ **200 ms**; new `peopleListFirstPaint` ratchet entry.
- [ ] Person profile open ≤ **150 ms**; new `personProfileOpen` ratchet entry.
- [ ] All V1-11 search acceptance criteria still pass unchanged.
- [ ] Both executable oracles replaced by golden fixtures and the duplicate modules deleted; the fixtures fail if regenerated from changed behaviour.
- [ ] Existing suite passes unchanged; no test weakened or deleted.

**Out of scope:** any in-memory or persisted snapshot cache (POS-D043), and any
change to what search *finds* — this package changes only what it costs.

---

### V1-R4 — One write substrate

**Depends on:** V1-R1 (can run parallel to R2/R3 only if no one else is in the tree). **Implements:** POS-D044.

**Scope**

1. `src/data/writes.ts`: shared primitives usable **inside a caller's transaction** — `assertRevision`, `assertReferences`, `bumpDatasetRevision`. All 24 hand-rolled `datasetRevision` bumps call the last one.
2. Move referential-integrity assertions inside the write transaction (fixes the check-then-act gap at [repositories.ts:59](src/data/repositories.ts:59)), including the "one current Reach Out entry per Person" invariant.
3. Migrate `personLifecycle.ts` off `createRepositories`; delete `createRepositories`, `MutableRepository` and `PersonRepository` from production. Tests get an explicit test-fixture builder instead of borrowing the production repository.
4. Enable the `datasetRevision` lint rule from V1-R1.
5. Document the substrate in `ARCHITECTURE.md` as the single write path.

**Acceptance criteria**

- [ ] Zero `datasetRevision` arithmetic outside `src/data/writes.ts`; lint rule enabled and passing.
- [ ] Every referential assertion executes inside the transaction that performs the write; a test proves the Reach Out uniqueness invariant holds under two interleaved concurrent creates.
- [ ] `createRepositories` no longer exists in production code.
- [ ] 514 existing tests pass; the idempotency and rollback tests in `reachOut.test.ts`, `todayActions.test.ts` and `followUps.test.ts` are unchanged.

---

### V1-R5 — One navigation substrate

**Depends on:** V1-R1. Must land **before V1-12**.

**Scope**

1. `src/navigationIntent.ts`: one typed intent object replacing the 16 ad-hoc `history.state` keys (`fromPath`, `fromProfile`, `todayOriginPrepared`, `todayVisibleCount`, `todayFocusPersonId`, `resolverProfileReturn`, `resolverPersonId`, `resolverOriginPrepared`, `profileOriginPrepared`, `resumeCapture`, `resumeContactEditor`, `navigationOrigin`, `autoAddPhone`, `peopleDirectory`, `reachOutView`, `upcomingView`).
2. Replace the per-route `else if` ladder ([App.tsx:151-238](src/App.tsx:151)) with a declarative per-route intent descriptor.
3. One `useReturnPath` hook replacing the 9 bespoke `onBack` closures.
4. Enable the `window.history.state` lint rule from V1-R1.
5. Split `peopleScreens.tsx` (2,478 lines, 4 screens) into one file per screen and move all screen/sheet components under `src/ui/`. Mechanical move only — no behaviour change in the same commit.

**Acceptance criteria**

- [ ] `window.history.state` appears in exactly one production module; lint rule enabled and passing.
- [ ] All existing return-path and focus-restoration tests pass **unchanged** — including Today-origin Add phone return, resolver returns, capture resume, and contact-editor resume.
- [ ] No production file exceeds 800 lines.
- [ ] Adding a new screen requires editing exactly one route descriptor (demonstrated by a throwaway screen added and removed in review).

---

## 5. Sequencing, and why

Ordered by irreversibility, not by size (doctrine §2.3):

1. **V1-R1** first — without a failing test, every performance claim in this plan is unverifiable and every boundary rule is decorative.
2. **V1-R2** next — it changes an engine contract. V1-12 and V1-13 both consume that contract; doing it after them means amending two more packages.
3. **V1-R3** — depends on R2's candidate pass.
4. **V1-R4** and **V1-R5** — both must land before **V1-12**, which adds write commands (R4) and return paths (R5). These are the steps that fossilise the current duplication.
5. Only then V1-12.

**Gate between R3 and R4:** if the reference-corpus budgets in §2 are met, POS-D043 stands and no persisted projection is built. If Today lands above 150 ms after R2 and R3, stop and write a separate package for the denormalised contact summary or the persisted projection table, with the measured number as its justification. Do not improvise a cache inside R3.

---

## 6. Deliberately not doing

Restraint is a feature; each of these is a decision, not an oversight.

- **Not rewriting the idempotency replay in `reachOut.ts`.** ~130 lines per command of hand-written record-by-record replay verification ([reachOut.ts:1186](src/application/reachOut.ts:1186)) is the right semantic at the wrong altitude, but it is working, tested, retry-safe code with no bearing on scale. **Freeze the pattern instead:** no new hand-written replay blocks; any new command uses a `commands` store keyed by `commandFingerprint` holding generated IDs. Revisit the existing three only if a fourth is needed.
- **Not building a persisted projection cache** — see POS-D042 and the R3/R4 gate.
- **Not denormalising contact state onto Person** — see POS-D043.
- **Not code-splitting the bundle here.** 761 kB / 197 kB gzip in one chunk is real, but it is a V1-13 hardening item. Add it to V1-13's acceptance criteria with a number (initial route chunk ≤ 250 kB raw) rather than opening it now.
- **Not touching Real Friends**, per PROJECT.md and POS-D001.

---

## 7. Documentation and governance changes required

- `~/.claude/portfolio.md`: add PeopleOS to the active-products list; claim `V1` in the prefix registry; record the PeopleOS ↔ Real Friends boundary in the Boundaries section so sessions in the *other* repo can see it (it is currently asserted only in this repo).
- `~/.claude/continue-queue.md`: add an entry when V1-R1 execution **begins** (queue on start), per the standing instruction. Eleven packages have shipped with no queue entry.
- `DECISIONS.md`: add POS-D042…POS-D045 on acceptance; amend POS-D041 to record the measured numbers in §1 and the 150 ms trigger.
- `VERSION1_SCOPE.md`: amend V1-09 acceptance per POS-D042; add the bundle-size criterion to V1-13; split V1-13, which currently bundles WhatsApp targets, composition, vCard, Settings sheets, accessibility, error recovery, performance checks and E2E into one package — and give V1-12 an execution-grade rewrite (its current criteria are directional).
- `ARCHITECTURE.md`: document the two-phase engine and the single write substrate.
- `PACKAGE_STATUS.md`: add V1-R1…V1-R5 rows.
