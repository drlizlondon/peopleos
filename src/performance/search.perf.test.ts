/**
 * Ratchet: search at the 3,000-contact reference size.
 *
 * The sequence measurement is the important one. A single query understates
 * what the People screen actually does today: its effect re-runs on every
 * change to the query string with no debounce, so typing a five-letter name
 * issues five full searches. V1-R3 both debounces the input and stops search
 * running relationship assessments, and must lower both ceilings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCorpusFixture, emit, reportAgainstCeiling, type CorpusFixture } from "./fixture";
import { measure } from "./harness";
import { getPersonSearchView } from "../application/personSearch";

/** One character at a time, exactly as the UI issues it. */
const KEYSTROKE_SEQUENCE = ["s", "sa", "sar", "sara", "sarah"] as const;

let fixture: CorpusFixture;

beforeAll(async () => {
  fixture = await createCorpusFixture("peopleos-perf-search");
}, 600_000);

afterAll(async () => {
  await fixture?.close();
});

describe("V1-R ratchet — search", () => {
  it("returns correct results at scale", async () => {
    const view = await getPersonSearchView(fixture.db, { clock: fixture.clock, query: "sarah" });
    expect(view.totalPersonCount).toBeGreaterThan(2900);
    expect(view.results.length).toBeGreaterThan(0);
    for (const result of view.results) {
      expect(result.person.displayName.toLowerCase()).toContain("sarah");
    }
    emit(`search "sarah": ${view.results.length} results of ${view.totalPersonCount} People`);
  }, 900_000);

  it("handles a five-keystroke sequence within the current ceiling", async () => {
    // More samples and fewer warm-ups than elsewhere: each sample is expensive,
    // and because the gate takes the best sample a slow cold run is discarded
    // for free rather than needing a dedicated warm-up.
    const measurement = await measure("searchKeystrokeSequence", async () => {
      for (const query of KEYSTROKE_SEQUENCE) {
        await getPersonSearchView(fixture.db, { clock: fixture.clock, query });
      }
    }, 4, 1);
    const ceiling = reportAgainstCeiling("searchKeystrokeSequence", measurement, fixture.factor);
    expect(measurement.bestMs).toBeLessThanOrEqual(ceiling);
  }, 1_800_000);

  it("handles a single keystroke within the current ceiling", async () => {
    const measurement = await measure("searchSingleKeystroke", () =>
      getPersonSearchView(fixture.db, { clock: fixture.clock, query: "sarah" }), 5, 1);
    const ceiling = reportAgainstCeiling("searchSingleKeystroke", measurement, fixture.factor);
    expect(measurement.bestMs).toBeLessThanOrEqual(ceiling);
  }, 1_800_000);
});
