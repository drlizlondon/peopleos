import type { PeopleOsDatabase } from "../data/database";
import { RecordConflictError } from "../data/repositories";
import { localDateForInstant } from "../domain/followUpPolicy";
import type { Person } from "../domain/schema";
import { assertValidRecord } from "../domain/validation";
import {
  resolveRelationshipScheduleState,
  type RelationshipClock,
  type RelationshipPersonBundle
} from "../relationship-engine";

export type BringToTodayHooks = {
  beforeCommit?: () => void | Promise<void>;
};

/**
 * Adds a one-day Today override without changing cadence, plans or contact
 * history. If no contact is recorded, the ordinary schedule resumes unchanged.
 */
export async function bringToToday(
  db: PeopleOsDatabase,
  personId: string,
  clock: RelationshipClock,
  hooks: BringToTodayHooks = {}
): Promise<Person> {
  const localDate = localDateForInstant(clock.now, clock.timeZone);
  const tx = db.transaction(["people", "interactions", "followUps", "todaySkips", "metadata"], "readwrite");
  try {
    const people = tx.objectStore("people");
    const person = await people.get(personId);
    if (!person || person.archivedAt || person.identityStatus === "merged") {
      throw new RecordConflictError("This person is no longer available.");
    }
    if (person.broughtToTodayDate === localDate) {
      const skipStore = tx.objectStore("todaySkips");
      const skipId = `${person.id}:${localDate}`;
      const existingSkip = await skipStore.get(skipId);
      if (!existingSkip) {
        await tx.done;
        return person;
      }
      await skipStore.delete(skipId);
      const metadataStore = tx.objectStore("metadata");
      const metadata = await metadataStore.get("app");
      if (!metadata) throw new Error("PeopleOS metadata is missing");
      await metadataStore.put({
        ...metadata,
        datasetRevision: metadata.datasetRevision + 1,
        updatedAt: clock.now
      });
      await hooks.beforeCommit?.();
      await tx.done;
      return person;
    }
    const [interactions, followUps] = await Promise.all([
      tx.objectStore("interactions").index("by-person").getAll(person.id),
      tx.objectStore("followUps").index("by-person").getAll(person.id)
    ]);
    const bundle: RelationshipPersonBundle = {
      person,
      contactMethods: [],
      interactions,
      followUps,
      reachOutEntries: [],
      facts: [],
      affiliations: [],
      events: []
    };
    const schedule = resolveRelationshipScheduleState(bundle, clock);
    if (schedule.kind !== "scheduled" || schedule.localDate <= localDate) {
      throw new RecordConflictError("This person is no longer in Upcoming.");
    }
    const updated: Person = {
      ...person,
      revision: person.revision + 1,
      broughtToTodayDate: localDate,
      updatedAt: clock.now
    };
    assertValidRecord("people", updated);
    await people.put(updated);
    await tx.objectStore("todaySkips").delete(`${person.id}:${localDate}`);
    const metadataStore = tx.objectStore("metadata");
    const metadata = await metadataStore.get("app");
    if (!metadata) throw new Error("PeopleOS metadata is missing");
    await metadataStore.put({
      ...metadata,
      datasetRevision: metadata.datasetRevision + 1,
      updatedAt: clock.now
    });
    await hooks.beforeCommit?.();
    await tx.done;
    return updated;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed or aborted */ }
    try { await tx.done; } catch { /* expected rollback */ }
    throw error;
  }
}
