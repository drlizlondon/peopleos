import type { LocalDate } from "./domain/schema";
import type { ConversationStarterSuggestion } from "./application/conversationStarterHistory";

const STORAGE_KEY = "peopleos.today.starter-presentation.v1";

type StoredPersonRotation = {
  signature: string;
  orderedKeys: string[];
  selectedKey: string;
};

type StoredState = {
  version: 1;
  localDate: LocalDate;
  people: Record<string, StoredPersonRotation>;
};

export type TodayStarterRotation = {
  suggestions: ConversationStarterSuggestion[];
  selectedStarterId?: string;
};

export type TodayStarterPresentationOptions = {
  storage?: Pick<Storage, "getItem" | "setItem">;
  random?: () => number;
};

type StorageLike = NonNullable<TodayStarterPresentationOptions["storage"]>;

function candidateKey(starter: Pick<ConversationStarterSuggestion, "id" | "template">): string {
  return JSON.stringify([starter.id, starter.template]);
}

function signatureFor(starters: readonly ConversationStarterSuggestion[]): string {
  return JSON.stringify(starters.map(candidateKey).sort());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredPersonRotation(value: unknown): value is StoredPersonRotation {
  return isRecord(value)
    && typeof value.signature === "string"
    && Array.isArray(value.orderedKeys)
    && value.orderedKeys.every((key) => typeof key === "string")
    && typeof value.selectedKey === "string";
}

function isStoredState(value: unknown, localDate: LocalDate): value is StoredState {
  return isRecord(value)
    && value.version === 1
    && value.localDate === localDate
    && isRecord(value.people)
    && Object.values(value.people).every(isStoredPersonRotation);
}

function safeRead(storage: StorageLike, localDate: LocalDate): StoredState {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (isStoredState(parsed, localDate)) return parsed;
  } catch {
    // Corrupt or unavailable storage starts a fresh, in-memory-equivalent day.
  }
  return { version: 1, localDate, people: {} };
}

function safeWrite(storage: StorageLike, state: StoredState): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Today remains usable without persistence. */ }
}

function groupKey(starter: ConversationStarterSuggestion): string {
  return starter.lastUsedAt ? `used:${starter.lastUsedAt}` : "unused";
}

function rankedCandidates(
  starters: readonly ConversationStarterSuggestion[]
): ConversationStarterSuggestion[] {
  return starters
    .map((starter, sourceIndex) => ({ starter, sourceIndex }))
    .sort((left, right) => {
      const leftUsedAt = left.starter.lastUsedAt;
      const rightUsedAt = right.starter.lastUsedAt;
      if (Boolean(leftUsedAt) !== Boolean(rightUsedAt)) return leftUsedAt ? 1 : -1;
      if (leftUsedAt !== rightUsedAt) return (leftUsedAt ?? "").localeCompare(rightUsedAt ?? "");
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ starter }) => starter);
}

function rotateGroup<T>(values: readonly T[], random: () => number): T[] {
  if (values.length < 2) return [...values];
  const start = Math.min(values.length - 1, Math.max(0, Math.floor(random() * values.length)));
  return [...values.slice(start), ...values.slice(0, start)];
}

function makeOrder(
  starters: readonly ConversationStarterSuggestion[],
  random: () => number
): ConversationStarterSuggestion[] {
  const ranked = rankedCandidates(starters);
  const result: ConversationStarterSuggestion[] = [];
  let index = 0;
  while (index < ranked.length) {
    const priority = groupKey(ranked[index]!);
    let end = index + 1;
    while (end < ranked.length && groupKey(ranked[end]!) === priority) end += 1;
    result.push(...rotateGroup(ranked.slice(index, end), random));
    index = end;
  }
  return result;
}

function validRotation(rotation: StoredPersonRotation | undefined, starters: readonly ConversationStarterSuggestion[]): boolean {
  if (!rotation || rotation.signature !== signatureFor(starters)) return false;
  const available = new Set(starters.map(candidateKey));
  return rotation.orderedKeys.length === available.size
    && new Set(rotation.orderedKeys).size === available.size
    && rotation.orderedKeys.every((key) => available.has(key))
    && available.has(rotation.selectedKey);
}

export function todayStarterRotation(
  localDate: LocalDate,
  personId: string,
  starters: readonly ConversationStarterSuggestion[],
  options: TodayStarterPresentationOptions = {}
): TodayStarterRotation {
  if (starters.length === 0) return { suggestions: [] };
  const storage = options.storage ?? window.localStorage;
  const state = safeRead(storage, localDate);
  let rotation = state.people[personId];
  if (!validRotation(rotation, starters)) {
    const ordered = makeOrder(starters, options.random ?? Math.random);
    rotation = {
      signature: signatureFor(starters),
      orderedKeys: ordered.map(candidateKey),
      selectedKey: candidateKey(ordered[0]!)
    };
    state.people[personId] = rotation;
    safeWrite(storage, state);
  }
  const byKey = new Map(starters.map((starter) => [candidateKey(starter), starter]));
  const suggestions = rotation.orderedKeys.flatMap((key) => {
    const starter = byKey.get(key);
    return starter ? [starter] : [];
  });
  return {
    suggestions,
    selectedStarterId: byKey.get(rotation.selectedKey)?.id ?? suggestions[0]?.id
  };
}

export function advanceTodayStarter(
  localDate: LocalDate,
  personId: string,
  starters: readonly ConversationStarterSuggestion[],
  options: Pick<TodayStarterPresentationOptions, "storage"> & { selectedStarterId?: string } = {}
): TodayStarterRotation {
  const storage = options.storage ?? window.localStorage;
  const current = options.selectedStarterId
    ? {
        suggestions: [...starters],
        selectedStarterId: starters.some((starter) => starter.id === options.selectedStarterId)
          ? options.selectedStarterId
          : starters[0]?.id
      }
    : todayStarterRotation(localDate, personId, starters, { storage });
  if (current.suggestions.length === 0) return current;
  const state = safeRead(storage, localDate);
  let rotation = state.people[personId];
  if (!validRotation(rotation, current.suggestions)) {
    const selected = current.suggestions.find((starter) => starter.id === current.selectedStarterId)
      ?? current.suggestions[0]!;
    rotation = {
      signature: signatureFor(current.suggestions),
      orderedKeys: current.suggestions.map(candidateKey),
      selectedKey: candidateKey(selected)
    };
    state.people[personId] = rotation;
  }
  const currentKey = current.suggestions.find((starter) => starter.id === current.selectedStarterId);
  const currentIndex = currentKey
    ? rotation.orderedKeys.indexOf(candidateKey(currentKey))
    : rotation.orderedKeys.indexOf(rotation.selectedKey);
  rotation.selectedKey = rotation.orderedKeys[(currentIndex + 1) % rotation.orderedKeys.length]!;
  safeWrite(storage, state);
  const selectedStarter = current.suggestions.find((starter) => candidateKey(starter) === rotation.selectedKey);
  return {
    suggestions: current.suggestions,
    selectedStarterId: selectedStarter?.id ?? current.suggestions[0]?.id
  };
}

export const TODAY_STARTER_PRESENTATION_STORAGE_KEY = STORAGE_KEY;
