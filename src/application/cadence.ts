import type { PeopleOsDatabase } from "../data/database";
import { createRepositories, RecordConflictError } from "../data/repositories";
import type { IsoInstant, LocalDate, Person } from "../domain/schema";

export async function deferRegularReminder(
  db: PeopleOsDatabase,
  personId: string,
  until: LocalDate,
  occurredAt: IsoInstant
): Promise<Person> {
  const person = await db.get("people", personId);
  if (!person) throw new RecordConflictError("This person is no longer available.");
  return createRepositories(db).people.update(
    { ...person, contactCadenceDeferredUntilDate: until },
    person.revision,
    occurredAt
  );
}

export async function pauseRegularReminder(
  db: PeopleOsDatabase,
  personId: string,
  occurredAt: IsoInstant
): Promise<Person> {
  const person = await db.get("people", personId);
  if (!person) throw new RecordConflictError("This person is no longer available.");
  return createRepositories(db).people.update(
    { ...person, contactCadencePausedAt: occurredAt },
    person.revision,
    occurredAt
  );
}
