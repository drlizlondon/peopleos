import type { Person } from "./schema";

export type RelationshipMode = "personal" | "professional" | "both";
export type ActiveRelationshipMode = "all" | Exclude<RelationshipMode, "both">;

export const RELATIONSHIP_MODE_OPTIONS: ReadonlyArray<{ value: RelationshipMode; label: string }> = [
  { value: "personal", label: "Personal" },
  { value: "professional", label: "Professional" },
  { value: "both", label: "Both" }
];

export function relationshipModeOf(person: Pick<Person, "relationshipMode">): RelationshipMode {
  return person.relationshipMode ?? "personal";
}

export function personMatchesActiveMode(person: Pick<Person, "relationshipMode">, activeMode: ActiveRelationshipMode): boolean {
  const mode = relationshipModeOf(person);
  return activeMode === "all" || mode === "both" || mode === activeMode;
}
