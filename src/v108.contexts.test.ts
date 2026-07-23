import { afterEach, describe, expect, it } from "vitest";
import { deletePeopleOsDatabase, openPeopleOsDatabase, type PeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import { createReachOut, prepareCreateReachOutCommand } from "./application/reachOut";
import { listReachOutContexts } from "./application/reachOutQueries";
import type { Person } from "./domain/schema";

const databases = new Map<string, PeopleOsDatabase>();

function person(id: string, displayName: string, now: string): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now
  };
}

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

afterEach(async () => {
  for (const [name, db] of databases) {
    db.close();
    await deletePeopleOsDatabase(name);
  }
  databases.clear();
});

describe("Reach Out context recency", () => {
  it("lists recently used contexts first with deterministic label and ID ties", async () => {
    const name = `peopleos-reach-out-contexts-${crypto.randomUUID()}`;
    const db = await openPeopleOsDatabase(name, "2026-08-01T09:00:00.000Z");
    databases.set(name, db);
    const repositories = createRepositories(db);
    const older = person("person-older", "Older", "2026-08-01T09:00:00.000Z");
    const newer = person("person-newer", "Newer", "2026-08-01T09:00:00.000Z");
    await repositories.people.create(older);
    await repositories.people.create(newer);

    await createReachOut(db, prepareCreateReachOutCommand({
      person: older,
      newContexts: [{ kind: "event", label: "Earlier event" }]
    }, {
      now: "2026-08-01T10:00:00.000Z",
      localDate: "2026-08-01",
      idFactory: sequence("older")
    }));
    await createReachOut(db, prepareCreateReachOutCommand({
      person: newer,
      newContexts: [{ kind: "fellowship", label: "Recent fellowship" }]
    }, {
      now: "2026-08-03T10:00:00.000Z",
      localDate: "2026-08-03",
      idFactory: sequence("newer")
    }));

    expect((await listReachOutContexts(db)).map((context) => context.label)).toEqual([
      "Recent fellowship",
      "Earlier event"
    ]);
  });
});
