import { openPeopleOsDatabase, type PeopleOsDatabase } from "./database";

let connection: Promise<PeopleOsDatabase> | undefined;

export function getDatabase(): Promise<PeopleOsDatabase> {
  connection ??= openPeopleOsDatabase();
  return connection;
}

export async function closeDatabase(): Promise<void> {
  const db = await connection;
  db?.close();
  connection = undefined;
}
