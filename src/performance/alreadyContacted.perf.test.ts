/**
 * Ratchet: the complete "Already contacted" action path.
 *
 * "Complete" means what the user experiences, not just the write: recalculate
 * the action context, prepare the command, commit it, and re-project the queue
 * they are looking at. Measuring only `alreadyContacted()` would hide the two
 * full projections that dominate the cost.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCorpusFixture, reportAgainstCeiling, type CorpusFixture } from "./fixture";
import { measure } from "./harness";
import { CORPUS_NOW } from "./corpus";
import { getTodayActionContext, getTodayScreenProjection } from "../application/todayQueries";
import { alreadyContacted, prepareAlreadyContactedCommand } from "../application/todayActions";

let fixture: CorpusFixture;

beforeAll(async () => {
  fixture = await createCorpusFixture("peopleos-perf-action");
}, 600_000);

afterAll(async () => {
  await fixture?.close();
});

describe("V1-R ratchet — Already contacted", () => {
  it("completes the full action round trip within the current ceiling", async () => {
    const projection = await getTodayScreenProjection(fixture.db, fixture.clock);
    // Every iteration acts on a different Person, so repeated runs stay valid
    // without a ~2s reseed between them. The cost is dominated by the two
    // projections, not by which record is written.
    const personIds = projection.cards.map((card) => card.person.id);
    expect(personIds.length).toBeGreaterThan(10);

    let sequence = 0;
    let completed = 0;
    const measurement = await measure("alreadyContactedRoundTrip", async (iteration) => {
      const personId = personIds[iteration % personIds.length];
      const context = await getTodayActionContext(fixture.db, personId, fixture.clock);
      if (!context) throw new Error(`No Today action context for ${personId}`);
      const command = prepareAlreadyContactedCommand(context, "2026-08-15", {
        now: CORPUS_NOW,
        idFactory: () => `perf-${iteration}-${(sequence += 1)}`
      });
      await alreadyContacted(fixture.db, command);
      // The round trip is not over until the user sees the refreshed queue.
      await getTodayScreenProjection(fixture.db, fixture.clock);
      completed += 1;
    }, 4, 1);

    const ceiling = reportAgainstCeiling("alreadyContactedRoundTrip", measurement, fixture.factor);
    expect(measurement.bestMs).toBeLessThanOrEqual(ceiling);

    // The path must have actually done its work — a no-op would be fast and
    // wrong. Each iteration records one Contacted Interaction and one next
    // FollowUp for a distinct Person.
    const after = await getTodayScreenProjection(fixture.db, fixture.clock);
    expect(completed).toBeGreaterThanOrEqual(5);
    expect(after.result.totalCount).toBeLessThan(projection.result.totalCount);
  }, 1_800_000);
});
