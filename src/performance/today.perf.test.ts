/**
 * Ratchet: the Today projection at the 3,000-contact reference size.
 *
 * Isolated in its own file so no other measurement's heap state can influence
 * it — see fixture.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCorpusFixture, emit, reportAgainstCeiling, type CorpusFixture } from "./fixture";
import { measure } from "./harness";
import { getTodayScreenProjection } from "../application/todayQueries";

let fixture: CorpusFixture;

beforeAll(async () => {
  fixture = await createCorpusFixture("peopleos-perf-today");
}, 600_000);

afterAll(async () => {
  await fixture?.close();
});

describe("V1-R ratchet — Today", () => {
  it("produces a correct Today queue from the corpus", async () => {
    const projection = await getTodayScreenProjection(fixture.db, fixture.clock);
    expect(projection.evaluationIssues).toHaveLength(0);
    expect(projection.result.totalCount).toBeGreaterThan(0);
    expect(projection.cards).toHaveLength(projection.result.totalCount);
    // Every card carries a reason traceable to stored records. This is the
    // product promise and the thing an optimisation is most likely to break
    // quietly, so the performance gate asserts it too.
    for (const card of projection.cards) {
      expect(card.item.explanation.facts.length).toBeGreaterThan(0);
      expect(card.item.intendedActionContext.explanation.facts).toBeDefined();
    }
    emit(
      `corpus: ${projection.activePersonCount} active People, `
      + `${projection.result.totalCount} Today items, 0 evaluation issues`
    );
  }, 600_000);

  it("builds Today within the current ceiling", async () => {
    const measurement = await measure(
      "todayProjection",
      () => getTodayScreenProjection(fixture.db, fixture.clock)
    );
    const ceiling = reportAgainstCeiling("todayProjection", measurement, fixture.factor);
    expect(measurement.bestMs).toBeLessThanOrEqual(ceiling);
  }, 900_000);
});
