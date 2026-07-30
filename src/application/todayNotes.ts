import type { PeopleOsDatabase } from "../data/database";
import { createRepositories, RecordConflictError } from "../data/repositories";
import type { Person } from "../domain/schema";
import { ValidationError } from "../domain/validation";

export async function saveTodayNote(db: PeopleOsDatabase, personId: string, text: string, now = new Date().toISOString()): Promise<Person> {
  const person = await db.get("people", personId);
  if (!person) throw new RecordConflictError("This person is no longer available.");
  const note = text.trim();
  if (!note || note.length > 240) throw new ValidationError(["Add a note of 240 characters or fewer."]);
  const updated = { ...person, todayNote: note };
  if (note !== person.todayNote) delete updated.todayNoteCompletedAt;
  return createRepositories(db).people.update(updated, person.revision, now);
}

export async function removeTodayNote(db: PeopleOsDatabase, personId: string, now = new Date().toISOString()): Promise<Person> {
  const person = await db.get("people", personId);
  if (!person) throw new RecordConflictError("This person is no longer available.");
  const updated = { ...person };
  delete updated.todayNote;
  delete updated.todayNoteCompletedAt;
  return createRepositories(db).people.update(updated, person.revision, now);
}

export async function setTodayNoteCompleted(db: PeopleOsDatabase, personId: string, completed: boolean, now = new Date().toISOString()): Promise<Person> {
  const person = await db.get("people", personId);
  if (!person?.todayNote) throw new RecordConflictError("This note is no longer available.");
  const updated = { ...person };
  if (completed) updated.todayNoteCompletedAt = now;
  else delete updated.todayNoteCompletedAt;
  return createRepositories(db).people.update(updated, person.revision, now);
}
