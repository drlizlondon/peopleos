/**
 * Shared setup for the V1-R performance ratchet.
 *
 * Each measured operation lives in its own test file, and therefore its own
 * worker process. That isolation is not tidiness — it is required for the gate
 * to be stable. Measured on this corpus, running the mutation path before the
 * search path in one process left enough heap pressure to inflate search by
 * ~60% (21.5s -> 32.8s) with no code change at all. Per-file isolation costs
 * one ~2s corpus seed per file and removes that entire class of false failure.
 */
import { buildReferenceCorpus, CORPUS_NOW, CORPUS_TIME_ZONE } from "./corpus";
import { assertCorpusIsWellFormed, seedCorpus } from "./seed";
import { CEILINGS, OWNING_PACKAGE, BASELINE, REFERENCE_CALIBRATION_MS, TARGETS, type OperationKey } from "./budgets";
import { calibrate, machineFactor, type Measurement } from "./harness";
import { deletePeopleOsDatabase, openPeopleOsDatabase, type PeopleOsDatabase } from "../data/database";
import { createRelationshipClock } from "../application/relationshipEngineQueries";
import type { RelationshipClock } from "../relationship-engine";

/**
 * Report ratchet evidence. Vitest buffers console output and surfaces it only
 * around failures by default, which would hide these numbers on exactly the
 * green runs where they matter; `disableConsoleIntercept` in vite.config.ts
 * turns that buffering off.
 */
export function emit(line: string): void {
  console.log(`[ratchet] ${line}`);
}

export type CorpusFixture = {
  db: PeopleOsDatabase;
  clock: RelationshipClock;
  factor: number;
  close: () => Promise<void>;
};

/**
 * Seed the reference corpus into a database named for the calling file, so
 * concurrently-running files can never share state.
 */
export async function createCorpusFixture(databaseName: string): Promise<CorpusFixture> {
  const calibrationMs = calibrate();
  const factor = machineFactor(calibrationMs, REFERENCE_CALIBRATION_MS);
  emit(
    `calibration ${calibrationMs.toFixed(1)}ms vs reference `
    + `${REFERENCE_CALIBRATION_MS}ms -> machine factor ${factor.toFixed(2)}x`
  );

  const data = buildReferenceCorpus();
  assertCorpusIsWellFormed(data);
  await deletePeopleOsDatabase(databaseName);
  const db = await openPeopleOsDatabase(databaseName, CORPUS_NOW);
  await seedCorpus(db, data, CORPUS_NOW);

  return {
    db,
    clock: createRelationshipClock({ now: CORPUS_NOW, timeZone: CORPUS_TIME_ZONE }),
    factor,
    close: async () => {
      db.close();
      await deletePeopleOsDatabase(databaseName);
    }
  };
}

/**
 * Report a measurement and return the machine-scaled ceiling it must satisfy.
 * The gate compares `bestMs`; the median is printed alongside so a widening
 * gap between them is visible as the warning sign it is.
 */
export function reportAgainstCeiling(
  key: OperationKey,
  measurement: Measurement,
  factor: number
): number {
  const ceiling = CEILINGS[key] * factor;
  emit(
    `${key}: best ${measurement.bestMs.toFixed(0)}ms `
    + `median ${measurement.medianMs.toFixed(0)}ms `
    + `(samples ${measurement.samples.map((value) => value.toFixed(0)).join(", ")}) `
    + `ceiling ${ceiling.toFixed(0)}ms baseline ${BASELINE[key]}ms `
    + `target ${TARGETS[key]}ms (${OWNING_PACKAGE[key]})`
  );
  return ceiling;
}
