/**
 * The V1-R performance ratchet: recorded evidence and current ceilings.
 *
 * Three separate things live here and must never be conflated:
 *
 * - `BASELINE` is **evidence**. It is what the shipped code measured on the
 *   reference machine before any remediation. It is a historical record and is
 *   never edited, so the improvement delivered by V1-R2 and V1-R3 stays
 *   provable rather than merely asserted.
 *
 * - `CEILINGS` is the **gate**. A package may only lower a ceiling, and only in
 *   the commit that earns the reduction. Raising one requires a written
 *   decision, not a quiet edit.
 *
 * - `TARGETS` is where SCALE_REMEDIATION_PLAN.md §2 says the ceilings must end
 *   up, so the distance still to travel is visible in the source.
 *
 * All values are milliseconds on the reference machine. The test scales
 * `CEILINGS` by the measured machine factor (see harness.ts) before asserting,
 * so a slower CI runner does not produce a false failure.
 */

export type OperationKey =
  | "todayProjection"
  | "alreadyContactedRoundTrip"
  | "searchKeystrokeSequence"
  | "searchSingleKeystroke";

/**
 * Reference machine: Apple Silicon macOS (Darwin 25.5.0), Node 22, vitest 4 with
 * fake-indexeddb. Recorded 2026-07-25 against commit `82012f1`, which is
 * V1-01…V1-11 complete and pre-V1-R2.
 *
 * Corpus: 3,000 People, 45,000 Interactions, 750 pending FollowUps, 200 Reach
 * Out entries, ~11,900 MemoryFacts — 15.7 MB of stored JSON.
 */
export const BASELINE_COMMIT = "82012f1";
export const BASELINE_RECORDED = "2026-07-25";

/**
 * Median time of `calibrationWorkload()` on the reference machine, measured
 * across five independent trials (11.3, 11.8, 11.6, 11.7, 11.5 ms).
 */
export const REFERENCE_CALIBRATION_MS = 11.6;

/**
 * The fastest run of each operation on the unremediated code — see `measure`
 * in harness.ts for why the fastest run, not the median, is the statistic.
 *
 * Recorded from two full runs of the final harness, taking the worse of the two
 * so the baseline is conservative:
 *
 *   todayProjection            2062 / 2051   -> 2062
 *   alreadyContactedRoundTrip  4360 / 4032   -> 4360
 *   searchKeystrokeSequence   19503 / 20080  -> 20080
 *   searchSingleKeystroke      3817 / 4205   -> 4205
 *
 * The machine was moderately loaded during recording (measured factor 1.03x to
 * 1.13x), so these are if anything slightly pessimistic. Never edit them: they
 * are the evidence that remediation worked.
 */
export const BASELINE: Record<OperationKey, number> = {
  todayProjection: 2062,
  alreadyContactedRoundTrip: 4360,
  searchKeystrokeSequence: 20_080,
  searchSingleKeystroke: 4205
};

/**
 * Current gate, scaled at run time by the measured machine factor.
 *
 * Lowered by V1-R2 (2026-07-25) to roughly 1.4x the measured best, locking in
 * an 8-12x improvement across all four operations:
 *
 *   todayProjection            2062 -> 179ms   (11.5x)
 *   alreadyContactedRoundTrip  4360 -> 341ms   (12.8x)
 *   searchKeystrokeSequence   20080 -> 1698ms  (11.8x)
 *   searchSingleKeystroke      4205 -> 314ms   (13.4x)
 *
 * Two of these still sit above `TARGETS`. See SCALE_REMEDIATION_PLAN.md §4
 * "V1-R2 outcome": the remaining Today cost is dominated by reading the whole
 * dataset out of IndexedDB (105ms of 180ms), which is V1-R3's narrowed-read
 * work, not something further engine optimisation can reach.
 *
 * Headroom is ~2x the measured best rather than the ~1.4x first tried. The
 * search paths are memory- and GC-bound, and under machine load they slow by
 * more than the CPU-bound calibration workload does — a 1.4x ceiling left only
 * 13% margin on a loaded run. Widening keeps the R1 rule that this gate must
 * never fail spuriously, and still locks in a 5-6x improvement over baseline.
 */
export const CEILINGS: Record<OperationKey, number> = {
  todayProjection: 400,
  alreadyContactedRoundTrip: 700,
  searchKeystrokeSequence: 3500,
  searchSingleKeystroke: 700
};

/**
 * Where SCALE_REMEDIATION_PLAN.md §2 requires these to land. The keystroke
 * sequence target is five keystrokes at the 150 ms single-keystroke budget.
 */
export const TARGETS: Record<OperationKey, number> = {
  todayProjection: 150,
  alreadyContactedRoundTrip: 300,
  searchKeystrokeSequence: 750,
  searchSingleKeystroke: 150
};

/** The package that must lower each ceiling to its target. */
export const OWNING_PACKAGE: Record<OperationKey, string> = {
  todayProjection: "V1-R2",
  alreadyContactedRoundTrip: "V1-R2",
  searchKeystrokeSequence: "V1-R3",
  searchSingleKeystroke: "V1-R3"
};
