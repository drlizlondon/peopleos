/**
 * Ratchet: one debounced search at the 3,000-contact reference size.
 *
 * This measurement intentionally has its own process and corpus fixture. The
 * five-query sequence is allocation- and GC-heavy; running this operation
 * after it would violate the performance harness's isolation contract and can
 * make an unchanged single query appear slower under combined-suite load.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCorpusFixture, reportAgainstCeiling, type CorpusFixture } from "./fixture";
import { measure } from "./harness";
import { getPersonSearchView } from "../application/personSearch";

let fixture: CorpusFixture;

beforeAll(async () => {
  fixture = await createCorpusFixture("peopleos-perf-search-single");
}, 600_000);

afterAll(async () => {
  await fixture?.close();
});

describe("V1-R ratchet — single search", () => {
  it("handles a single keystroke within the current ceiling", async () => {
    const measurement = await measure("searchSingleKeystroke", () =>
      getPersonSearchView(fixture.db, { clock: fixture.clock, query: "sarah" }), 5, 1);
    const ceiling = reportAgainstCeiling("searchSingleKeystroke", measurement, fixture.factor);
    expect(measurement.bestMs).toBeLessThanOrEqual(ceiling);
  }, 1_800_000);
});
