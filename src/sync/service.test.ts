import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deletePeopleOsDatabase, openPeopleOsDatabase, type PeopleOsDatabase } from "../data/database";
import { setCloudSyncEnabled } from "./coordinator";

const mocks = vi.hoisted(() => ({
  database: undefined as PeopleOsDatabase | undefined
}));

vi.mock("../data/client", () => ({
  getDatabase: vi.fn(async () => {
    if (!mocks.database) throw new Error("Test database is unavailable");
    return mocks.database;
  })
}));

import { pauseCloudSync, subscribeToSync } from "./service";

let databaseName = "";

afterEach(async () => {
  mocks.database?.close();
  mocks.database = undefined;
  if (databaseName) await deletePeopleOsDatabase(databaseName);
  databaseName = "";
});

describe("iCloud Sync service controls", () => {
  it("reports an unreadable sync state instead of leaving an unhandled publication", async () => {
    const onError = vi.fn();
    const unsubscribe = subscribeToSync(vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    unsubscribe();
  });

  it("turns sync off in storage and publishes the paused state", async () => {
    databaseName = `peopleos-sync-service-${crypto.randomUUID()}`;
    mocks.database = await openPeopleOsDatabase(databaseName, "2026-08-01T09:00:00.000Z");
    await setCloudSyncEnabled(mocks.database, true);
    const observed: boolean[] = [];
    const unsubscribe = subscribeToSync((state) => {
      if (state) observed.push(state.enabled);
    });

    await vi.waitFor(() => expect(observed.at(-1)).toBe(true));
    await pauseCloudSync();

    expect((await mocks.database.get("syncState", "app"))?.enabled).toBe(false);
    await vi.waitFor(() => expect(observed.at(-1)).toBe(false));
    unsubscribe();
  });
});
