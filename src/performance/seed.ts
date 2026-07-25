/**
 * Seeds the reference corpus straight into object stores.
 *
 * This deliberately bypasses the application command layer: the ratchet
 * measures read and action paths, not fixture construction, and routing 60,000
 * records through per-record command validation would make the gate slower than
 * the thing it guards. `assertCorpusIsWellFormed` re-imposes the guarantees that
 * matters — the corpus must be data the production engine accepts.
 */
import { DATA_STORE_NAMES, type PeopleOsData } from "../domain/schema";
import { createDefaultMetadata, type PeopleOsDatabase } from "../data/database";
import { assertValidRecord } from "../domain/validation";

export async function seedCorpus(
  db: PeopleOsDatabase,
  data: PeopleOsData,
  now = "2026-08-01T09:00:00.000Z"
): Promise<void> {
  const tx = db.transaction([...DATA_STORE_NAMES, "metadata"], "readwrite");
  for (const storeName of DATA_STORE_NAMES) {
    const store = tx.objectStore(storeName);
    await store.clear();
    for (const record of data[storeName]) store.put(record as never);
  }
  await tx.objectStore("metadata").put({ ...createDefaultMetadata(now), datasetRevision: 1 });
  await tx.done;
}

/**
 * Every generated record must satisfy the same validation the production write
 * paths apply. If this fails the corpus is not representative and any timing
 * taken from it is meaningless.
 */
export function assertCorpusIsWellFormed(data: PeopleOsData): void {
  const personIds = new Set(data.people.map((person) => person.id));
  const eventIds = new Set(data.events.map((event) => event.id));
  const contextIds = new Set(data.reachOutContexts.map((context) => context.id));

  for (const storeName of DATA_STORE_NAMES) {
    for (const record of data[storeName]) assertValidRecord(storeName, record as never);
  }
  for (const record of [
    ...data.contactMethods, ...data.affiliations, ...data.interactions,
    ...data.memoryFacts, ...data.followUps, ...data.reachOutEntries
  ]) {
    if (!personIds.has(record.personId)) {
      throw new Error(`Corpus record ${record.id} references missing person ${record.personId}`);
    }
  }
  for (const interaction of data.interactions) {
    if (interaction.eventId && !eventIds.has(interaction.eventId)) {
      throw new Error(`Corpus interaction ${interaction.id} references missing event`);
    }
  }
  for (const entry of data.reachOutEntries) {
    for (const contextId of entry.contextIds) {
      if (!contextIds.has(contextId)) {
        throw new Error(`Corpus Reach Out entry ${entry.id} references missing context`);
      }
    }
  }
}
