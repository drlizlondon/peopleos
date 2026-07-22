import type { DuplicateMatch } from "../domain/duplicates";

/**
 * Signals that a write found one or more possible duplicate People that the
 * user has not reviewed. Callers must show the evidence rather than retrying
 * or merging automatically.
 */
export class DuplicateReviewRequiredError extends Error {
  constructor(public readonly matches: DuplicateMatch[]) {
    super("Review possible duplicate People before saving.");
    this.name = "DuplicateReviewRequiredError";
  }
}

export function requireReviewedDuplicateMatches(
  matches: DuplicateMatch[],
  acknowledgedPersonIds: readonly string[]
): void {
  const acknowledged = new Set(acknowledgedPersonIds);
  const unreviewed = matches.filter((match) => !acknowledged.has(match.person.id));
  if (unreviewed.length) throw new DuplicateReviewRequiredError(unreviewed);
}
