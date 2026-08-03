import type { PeopleOsDatabase } from "../data/database";
import { createRepositories, RecordConflictError } from "../data/repositories";
import type { IsoInstant, LocalDate, Person } from "../domain/schema";
import { isLocalDate, ValidationError } from "../domain/validation";

export async function deferRegularReminder(
  db: PeopleOsDatabase,
  personId: string,
  until: LocalDate,
  occurredAt: IsoInstant
): Promise<Person> {
  const person = await db.get("people", personId);
  if (!person) throw new RecordConflictError("This person is no longer available.");
  if (!person.contactCadenceDays) {
    throw new ValidationError(["Turn on Keep in touch before pausing reminders."]);
  }
  if (!isLocalDate(until)) {
    throw new ValidationError(["Choose a valid resume date."]);
  }
  if (person.contactCadenceDeferredUntilDate === until && !person.contactCadencePausedAt) {
    return person;
  }
  const updated: Person = { ...person, contactCadenceDeferredUntilDate: until };
  delete updated.contactCadencePausedAt;
  return createRepositories(db).people.update(
    updated,
    person.revision,
    occurredAt
  );
}

export async function resumeRegularReminder(
  db: PeopleOsDatabase,
  personId: string,
  occurredAt: IsoInstant
): Promise<Person> {
  const person = await db.get("people", personId);
  if (!person) throw new RecordConflictError("This person is no longer available.");
  if (!person.contactCadenceDeferredUntilDate && !person.contactCadencePausedAt) {
    return person;
  }
  const updated: Person = { ...person };
  delete updated.contactCadenceDeferredUntilDate;
  delete updated.contactCadencePausedAt;
  return createRepositories(db).people.update(updated, person.revision, occurredAt);
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
