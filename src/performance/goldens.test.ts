/**
 * Golden fixtures for engine projections and search ranking.
 *
 * These replaced the executable oracles (`__legacy.engine.ts`,
 * `__legacy.personSearch.ts`) at the end of V1-R6. See `goldens/README.md` for
 * why the pattern changes at that point.
 *
 * Coverage is two-layered on purpose: a digest for every seed, so nothing is
 * unguarded, plus full readable rows for a sample, so the common failure gives
 * a diff a human can actually assess rather than "a hash changed".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  digest,
  engineDataset,
  engineGoldenRow,
  GOLDEN_CLOCK,
  GOLDEN_FILTER_SETS,
  GOLDEN_QUERIES,
  searchDataset,
  searchGoldenRow
} from "./goldenSources";
import { assessRelationship, buildToday } from "../relationship-engine";
import { relationshipBundleFromData } from "../application/relationshipEngineQueries";
import { assessmentsForSearch, searchPeopleFromData } from "../application/personSearch";
import type { PeopleOsData, Person } from "../domain/schema";

const SEEDS = 500;
/** Seeds whose full row is stored, so a failure yields a readable diff. */
const SAMPLE_SEEDS = 25;

type Golden = {
  seeds: number;
  sampleSeeds: number;
  digests: Record<string, string>;
  samples: Record<string, unknown>;
};

/**
 * Declared locally rather than pulling @types/node into the whole project,
 * which would add `process` and `Buffer` to the app's global type space and
 * blur the browser/Node boundary this codebase keeps sharp.
 */
declare const process: { env: Record<string, string | undefined>; cwd(): string };

const UPDATE = Boolean(process.env.PEOPLEOS_UPDATE_GOLDENS);

/** Vitest runs with the project root as cwd. */
function goldenPath(name: string): string {
  return `${process.cwd()}/src/performance/goldens/${name}.json`;
}

function build(name: "engine" | "search"): Golden {
  const row = name === "engine" ? engineGoldenRow : searchGoldenRow;
  const digests: Record<string, string> = {};
  const samples: Record<string, unknown> = {};
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const value = row(seed);
    digests[seed] = digest(value);
    if (seed <= SAMPLE_SEEDS) samples[seed] = value;
  }
  return { seeds: SEEDS, sampleSeeds: SAMPLE_SEEDS, digests, samples };
}

function loadOrWrite(name: "engine" | "search"): { expected: Golden; actual: Golden } {
  const actual = build(name);
  if (UPDATE) {
    writeFileSync(goldenPath(name), `${JSON.stringify(actual, null, 2)}\n`);
    return { expected: actual, actual };
  }
  return { expected: JSON.parse(readFileSync(goldenPath(name), "utf8")) as Golden, actual };
}

function comparePersonId(left: Person, right: Person): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

describe.each(["engine", "search"] as const)("%s goldens", (name) => {
  const { expected, actual } = loadOrWrite(name);

  it("matches the recorded sample rows", () => {
    // Compared before the digests so a real behaviour change surfaces as a
    // readable diff rather than a pair of hex strings.
    expect(actual.samples).toEqual(expected.samples);
  });

  it("matches the recorded digest for every seed", () => {
    const changed = Object.keys(actual.digests)
      .filter((seed) => actual.digests[seed] !== expected.digests[seed]);
    expect(
      changed,
      `digests changed for seeds ${changed.slice(0, 10).join(", ")}. `
      + "Regenerate with PEOPLEOS_UPDATE_GOLDENS=1 only if the behaviour change was deliberate, "
      + "and read the diff before committing."
    ).toEqual([]);
  });

  it("covers the number of seeds it claims to", () => {
    expect(Object.keys(actual.digests)).toHaveLength(SEEDS);
    expect(Object.keys(actual.samples)).toHaveLength(SAMPLE_SEEDS);
  });
});

/**
 * Properties the executable oracles used to cover directly. They need no frozen
 * copy — they compare the current implementation against itself under a
 * transformation that must not matter.
 */
describe("order independence", () => {
  function shuffled(data: PeopleOsData): PeopleOsData {
    return {
      ...data,
      interactions: [...data.interactions].reverse(),
      followUps: [...data.followUps].reverse(),
      memoryFacts: [...data.memoryFacts].reverse(),
      affiliations: [...data.affiliations].reverse(),
      contactMethods: [...data.contactMethods].reverse(),
      reachOutEntries: [...data.reachOutEntries].reverse()
    };
  }

  it("produces the same Today result whatever order the records arrive in", () => {
    for (const seed of [3, 17, 42, 88, 123]) {
      const data = engineDataset(seed);
      const build = (input: PeopleOsData) => {
        const people = [...input.people].sort(comparePersonId);
        return buildToday({
          assessments: people.map((person) =>
            assessRelationship(relationshipBundleFromData(input, person), GOLDEN_CLOCK)),
          todaySkips: input.todaySkips,
          clock: GOLDEN_CLOCK
        });
      };
      expect(build(shuffled(data)), `Today depended on input order for seed ${seed}`)
        .toEqual(build(data));
    }
  });

  it("produces the same search results whatever order the records arrive in", () => {
    for (const seed of [5, 23, 61]) {
      const data = searchDataset(seed);
      const rearranged = shuffled(data);
      for (const query of GOLDEN_QUERIES.slice(0, 6)) {
        for (const filters of GOLDEN_FILTER_SETS.slice(0, 4)) {
          const options = { clock: GOLDEN_CLOCK, query, filters };
          expect(
            searchPeopleFromData(rearranged, options, assessmentsForSearch(rearranged, GOLDEN_CLOCK)),
            `search depended on input order for seed ${seed}, query "${query}"`
          ).toEqual(searchPeopleFromData(data, options, assessmentsForSearch(data, GOLDEN_CLOCK)));
        }
      }
    }
  });
});
