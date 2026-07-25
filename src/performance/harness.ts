/**
 * Timing harness for the V1-R performance ratchet.
 *
 * Two problems have to be solved for a performance test to be a usable CI gate
 * rather than a source of random red builds:
 *
 * 1. **Run-to-run noise.** Handled by discarding warm-up iterations and taking
 *    the median of the remainder, never the mean and never a single sample.
 *
 * 2. **Machine speed.** A CI runner is typically slower than a development
 *    laptop, so an absolute millisecond ceiling is either too loose to catch
 *    regressions locally or too tight to survive CI. Handled by calibrating:
 *    every run measures a fixed synthetic workload and scales the ceilings by
 *    how much slower this machine is than the one that recorded the baseline.
 *
 * The calibration workload deliberately touches **no application code**. If it
 * called the engine, optimising the engine would speed the calibration up by
 * the same factor it speeds the measurement up, the ceiling would shrink in
 * step, and the gate would measure nothing.
 */

export type Measurement = {
  label: string;
  samples: number[];
  /** The statistic the gate asserts on. See `measure` for why it is the minimum. */
  bestMs: number;
  medianMs: number;
};

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export const WARM_UP_RUNS = 2;
export const MEASURED_RUNS = 3;

/**
 * Run `operation` and report both the minimum and the median of the measured
 * iterations. `iteration` is passed through so callers whose operation mutates
 * state can act on a different record each time.
 *
 * **The gate asserts on the minimum, deliberately.** Timing noise here is
 * one-sided: a garbage collection, a busy core or a cold cache can only ever
 * make a run slower, never faster. The fastest observed run is therefore the
 * closest estimate of the operation's true cost and by far the most
 * reproducible statistic. Measured on this corpus, the median moved 1.5-2.4x
 * between runs of the same unchanged code, while the minimum was stable to
 * within a few per cent.
 *
 * Two warm-up iterations are discarded rather than one: the first measured
 * sample was consistently an outlier with a single warm-up (3,093 ms against a
 * 1,730 ms floor for the Today projection).
 */
export async function measure(
  label: string,
  operation: (iteration: number) => Promise<unknown> | unknown,
  runs = MEASURED_RUNS,
  warmUps = WARM_UP_RUNS
): Promise<Measurement> {
  for (let index = 0; index < warmUps; index += 1) await operation(index);
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    await operation(warmUps + index);
    samples.push(performance.now() - start);
  }
  return { label, samples, bestMs: Math.min(...samples), medianMs: median(samples) };
}

/**
 * Deterministic, allocation-and-sort-heavy workload standing in for "how fast
 * is this machine at the kind of work PeopleOS does". Returns a checksum so no
 * engine can eliminate it as dead code.
 */
export function calibrationWorkload(): number {
  let checksum = 0;
  for (let round = 0; round < 12; round += 1) {
    const records: { id: string; key: string; value: number }[] = [];
    for (let index = 0; index < 4000; index += 1) {
      const value = (index * 2654435761) % 100000;
      records.push({ id: `record-${index}`, key: `key-${value}`, value });
    }
    records.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    for (const record of records) checksum = (checksum + record.value) % 1_000_003;
  }
  return checksum;
}

/** Median calibration time for this machine, in milliseconds. */
export function calibrate(runs = 5, warmUps = 2): number {
  for (let index = 0; index < warmUps; index += 1) calibrationWorkload();
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    calibrationWorkload();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

/**
 * How much slower this machine is than the baseline machine.
 *
 * Clamped so the gate degrades safely in both directions: a pathologically slow
 * or noisy runner cannot inflate ceilings without limit (and so cannot silently
 * disable the gate), and a faster machine than the baseline never tightens
 * ceilings below the recorded intent.
 */
export const MIN_MACHINE_FACTOR = 1;
export const MAX_MACHINE_FACTOR = 6;

export function machineFactor(calibrationMs: number, referenceMs: number): number {
  const raw = calibrationMs / referenceMs;
  return Math.min(MAX_MACHINE_FACTOR, Math.max(MIN_MACHINE_FACTOR, raw));
}
