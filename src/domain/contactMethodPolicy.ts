import type { ContactMethod } from "./schema";

/**
 * Stable ordering shared by deterministic action projections. The contact kind
 * is deliberately not a priority: an explicitly preferred method wins, then
 * the user's oldest recorded method, then its permanent ID.
 */
export function compareContactMethodsForAction(
  left: ContactMethod,
  right: ContactMethod
): number {
  if (left.isPreferred !== right.isPreferred) return left.isPreferred ? -1 : 1;
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function activeContactMethodsForAction(
  records: readonly ContactMethod[]
): ContactMethod[] {
  return [...records]
    .filter((record) => !record.archivedAt && Boolean(record.canonicalValue.trim()))
    .sort(compareContactMethodsForAction);
}
