import type { PeopleOsDatabase } from "../data/database";
import { createAppendOnlyRecord } from "../data/repositories";
import { localDateForInstant } from "../domain/followUpPolicy";
import type {
  ConversationStarter,
  ConversationStarterUse,
  IsoInstant,
  LocalDate
} from "../domain/schema";

export type ConversationStarterSuggestion = ConversationStarter & {
  lastUsedAt?: IsoInstant;
  lastUsedDate?: LocalDate;
};

function canonicalPersonId(
  personId: string,
  peopleById: ReadonlyMap<string, { mergedIntoPersonId?: string }>
): string {
  const seen = new Set<string>();
  let current = personId;
  while (!seen.has(current)) {
    seen.add(current);
    const next = peopleById.get(current)?.mergedIntoPersonId;
    if (!next) return current;
    current = next;
  }
  return current;
}

function exactUse(
  use: ConversationStarterUse,
  starter: ConversationStarter
): boolean {
  return use.starterId === starter.id
    && use.starterTemplate === starter.template;
}

export function rankConversationStarters(
  starters: readonly ConversationStarter[],
  uses: readonly ConversationStarterUse[],
  personId: string,
  timeZone: string,
  people: readonly { id: string; mergedIntoPersonId?: string }[] = []
): ConversationStarterSuggestion[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const canonicalTarget = canonicalPersonId(personId, peopleById);
  const ranked = starters.map((starter, sourceIndex) => {
    const lastUsedAt = uses
      .filter((use) => exactUse(use, starter)
        && canonicalPersonId(use.personId, peopleById) === canonicalTarget)
      .reduce<string | undefined>((latest, use) => !latest || use.occurredAt > latest
        ? use.occurredAt
        : latest, undefined);
    return { starter, sourceIndex, lastUsedAt };
  });
  ranked.sort((left, right) => {
    if (Boolean(left.lastUsedAt) !== Boolean(right.lastUsedAt)) return left.lastUsedAt ? 1 : -1;
    if (left.lastUsedAt !== right.lastUsedAt) return (left.lastUsedAt ?? "").localeCompare(right.lastUsedAt ?? "");
    return left.sourceIndex - right.sourceIndex || left.starter.id.localeCompare(right.starter.id);
  });
  return ranked.map(({ starter, lastUsedAt }) => ({
    ...starter,
    ...(lastUsedAt ? {
      lastUsedAt,
      lastUsedDate: localDateForInstant(lastUsedAt, timeZone)
    } : {})
  }));
}

export function formatUkLocalDate(localDate: LocalDate): string {
  const [year, month, day] = localDate.split("-");
  return `${day}/${month}/${year}`;
}

export type RecordConversationStarterUseCommand = ConversationStarterUse;

export async function recordConversationStarterUse(
  db: PeopleOsDatabase,
  command: RecordConversationStarterUseCommand
): Promise<void> {
  await createAppendOnlyRecord(db, "conversationStarterUses", command);
}
