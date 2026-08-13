import type { Person } from "./schema";

/**
 * Safe conversational fallback for legacy records and non-Apple imports.
 * Apple picker imports provide the real given name when available.
 */
export function defaultConversationalName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@") || !/\p{L}/u.test(trimmed)) return trimmed;
  return trimmed.split(/\s+/u)[0] ?? trimmed;
}

export function conversationalNameFor(
  person: Pick<Person, "displayName" | "conversationalName">
): string {
  return person.conversationalName?.trim()
    || defaultConversationalName(person.displayName)
    || person.displayName.trim();
}
