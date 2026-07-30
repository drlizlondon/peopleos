import type { ActiveRelationshipMode } from "./domain/relationshipMode";

export const RELATIONSHIP_MODE_PREFERENCE_KEY = "peopleos.relationshipView.v2";

export function readActiveRelationshipMode(storage?: Pick<Storage, "getItem">): ActiveRelationshipMode {
  const available = storage ?? (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" ? localStorage : undefined);
  const stored = available?.getItem(RELATIONSHIP_MODE_PREFERENCE_KEY);
  return stored === "all" || stored === "personal" || stored === "professional" ? stored : "all";
}

export function writeActiveRelationshipMode(mode: ActiveRelationshipMode, storage?: Pick<Storage, "setItem">): void {
  const available = storage ?? (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function" ? localStorage : undefined);
  available?.setItem(RELATIONSHIP_MODE_PREFERENCE_KEY, mode);
}
