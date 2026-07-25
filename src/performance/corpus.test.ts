/**
 * The corpus itself is under test: if the fixture drifts, every timing taken
 * from it becomes meaningless. This file makes no timing assertions.
 */
import { describe, expect, it } from "vitest";
import { buildReferenceCorpus, CORPUS_SHAPE } from "./corpus";
import { assertCorpusIsWellFormed } from "./seed";

describe("reference corpus", () => {
  it("is exactly the shape SCALE_REMEDIATION_PLAN.md §2 specifies", () => {
    const data = buildReferenceCorpus();
    expect(data.people).toHaveLength(CORPUS_SHAPE.people);
    expect(data.interactions).toHaveLength(CORPUS_SHAPE.expectedInteractions);
    expect(data.followUps.filter((followUp) => followUp.status === "pending"))
      .toHaveLength(CORPUS_SHAPE.expectedPendingFollowUps);
    expect(data.reachOutEntries).toHaveLength(CORPUS_SHAPE.expectedReachOutEntries);
  });

  it("is deterministic across runs", () => {
    expect(JSON.stringify(buildReferenceCorpus())).toEqual(JSON.stringify(buildReferenceCorpus()));
  });

  it("contains only records the production write paths would accept", () => {
    expect(() => assertCorpusIsWellFormed(buildReferenceCorpus())).not.toThrow();
  });

  it("exercises every Today rule rather than one hot path", () => {
    const data = buildReferenceCorpus();
    const pending = data.followUps.filter((followUp) => followUp.status === "pending");
    // Overdue, due today and future follow-ups must all be present, or the
    // ordering bands in buildToday are never compared against each other.
    expect(pending.some((followUp) => followUp.dueDate < "2026-08-01")).toBe(true);
    expect(pending.some((followUp) => followUp.dueDate === "2026-08-01")).toBe(true);
    expect(pending.some((followUp) => followUp.dueDate > "2026-08-01")).toBe(true);
    expect(pending.some((followUp) => followUp.snoozedUntilDate)).toBe(true);
    // Cadence people, archived people, provisional identities and people with
    // exactly one contact all drive distinct engine branches.
    expect(data.people.some((person) => person.contactCadenceDays)).toBe(true);
    expect(data.people.some((person) => person.archivedAt)).toBe(true);
    expect(data.people.some((person) => person.identityStatus === "provisional")).toBe(true);
    expect(data.people.some((person) => person.importance === "high")).toBe(true);
    const interactionsByPerson = new Map<string, number>();
    for (const interaction of data.interactions) {
      interactionsByPerson.set(
        interaction.personId,
        (interactionsByPerson.get(interaction.personId) ?? 0) + 1
      );
    }
    expect([...interactionsByPerson.values()].some((count) => count === 1)).toBe(true);
    // People with no contact methods at all must exist: they drive the
    // "Add phone number" Today branch.
    const withContact = new Set(data.contactMethods.map((method) => method.personId));
    expect(data.people.some((person) => !withContact.has(person.id))).toBe(true);
  });
});
