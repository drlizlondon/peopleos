/**
 * Ratchet: the two remaining interactive entry points at reference scale —
 * the People list's first paint, and opening a Person profile.
 *
 * Both were descoped from V1-R3 and carried into V1-R6. The People list with no
 * query is a blank search, so it shares search's cost; the profile is a
 * different path, and the one a user hits from every list and every Today card.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCorpusFixture, emit, reportAgainstCeiling, type CorpusFixture } from "./fixture";
import { measure } from "./harness";
import { getPersonSearchView } from "../application/personSearch";
import { getAppSettings, getPersonSummary } from "../application/peopleQueries";
import { getPersonHistory } from "../application/interactionQueries";
import { getRelationshipAssessment } from "../application/relationshipEngineQueries";

let fixture: CorpusFixture;
/** A Person in the middle of the corpus, so lookups are not favoured by position. */
const PROFILE_PERSON_ID = "person-01500";

beforeAll(async () => {
  fixture = await createCorpusFixture("peopleos-perf-list");
}, 600_000);

afterAll(async () => {
  await fixture?.close();
});

describe("V1-R ratchet — People list and Person profile", () => {
  it("returns a usable People list for the whole corpus", async () => {
    const view = await getPersonSearchView(fixture.db, { clock: fixture.clock, query: "" });
    expect(view.totalPersonCount).toBeGreaterThan(2900);
    expect(view.results.length).toBeGreaterThan(2000);
    emit(`People list: ${view.results.length} rows of ${view.totalPersonCount} People`);
  }, 900_000);

  it("paints the People list within the current ceiling", async () => {
    const measurement = await measure("peopleListFirstPaint", () =>
      getPersonSearchView(fixture.db, { clock: fixture.clock, query: "" }), 5, 1);
    const ceiling = reportAgainstCeiling("peopleListFirstPaint", measurement, fixture.factor);
    expect(measurement.bestMs).toBeLessThanOrEqual(ceiling);
  }, 1_800_000);

  it("opens a Person profile within the current ceiling", async () => {
    // Mirrors PersonProfileScreen: summary, settings and the relationship
    // assessment load together, with history alongside them.
    const measurement = await measure("personProfileOpen", async () => {
      await Promise.all([
        getPersonSummary(fixture.db, PROFILE_PERSON_ID),
        getAppSettings(fixture.db),
        getRelationshipAssessment(fixture.db, PROFILE_PERSON_ID, fixture.clock),
        getPersonHistory(fixture.db, PROFILE_PERSON_ID)
      ]);
    }, 5, 1);
    const ceiling = reportAgainstCeiling("personProfileOpen", measurement, fixture.factor);
    expect(measurement.bestMs).toBeLessThanOrEqual(ceiling);
  }, 1_800_000);

  it("loads a real Person for the profile measurement", async () => {
    // A measurement against a missing Person would be fast and meaningless.
    const summary = await getPersonSummary(fixture.db, PROFILE_PERSON_ID);
    expect(summary?.person.id).toBe(PROFILE_PERSON_ID);
    const assessment = await getRelationshipAssessment(fixture.db, PROFILE_PERSON_ID, fixture.clock);
    expect(assessment?.personId).toBe(PROFILE_PERSON_ID);
  }, 900_000);
});
