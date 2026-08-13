import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import type { Person } from "../domain/schema";
import { conversationalNameFor } from "../domain/personNames";
import { updatePerson } from "./personLifecycle";

const now = "2026-08-13T09:00:00.000Z";
const databaseNames = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

async function openDatabase(): Promise<PeopleOsDatabase> {
  const name = `peopleos-conversational-name-${crypto.randomUUID()}`;
  databaseNames.add(name);
  const db = await openPeopleOsDatabase(name, now);
  connections.add(db);
  return db;
}

function legacyPerson(): Person {
  return {
    id: "person-elizabeth",
    revision: 1,
    displayName: "Elizabeth Soyode",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of databaseNames) await deletePeopleOsDatabase(name);
  databaseNames.clear();
});

describe("editing what I call a Person", () => {
  it("loads a legacy record through the fallback and stores an explicit change", async () => {
    const db = await openDatabase();
    const original = legacyPerson();
    await db.put("people", original);

    expect(conversationalNameFor((await db.get("people", original.id))!)).toBe("Elizabeth");

    const saved = await updatePerson(db, {
      personId: original.id,
      expectedRevision: original.revision,
      draft: {
        displayName: original.displayName,
        conversationalName: "  Lizzie  ",
        importance: original.importance,
        tags: original.tags
      },
      occurredAt: "2026-08-13T10:00:00.000Z"
    });

    expect(saved).toMatchObject({
      displayName: "Elizabeth Soyode",
      conversationalName: "Lizzie",
      revision: 2
    });
    expect(conversationalNameFor(saved)).toBe("Lizzie");
  });
});
