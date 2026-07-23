import { afterEach, describe, expect, it } from "vitest";
import { generateBackup, previewBackup, restoreBackup } from "./data/backup";
import { deletePeopleOsDatabase, openPeopleOsDatabase, readAllData, type PeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import {
  completeReachOut,
  createReachOut,
  prepareCompleteReachOutCommand,
  prepareCreateReachOutCommand
} from "./application/reachOut";
import {
  completeProvisionalPerson,
  getProvisionalResolutionPreview,
  linkProvisionalPerson,
  prepareCompleteProvisionalPersonCommand,
  prepareLinkProvisionalPersonCommand
} from "./application/reachOutIdentity";
import type { Person } from "./domain/schema";
import { validatePeopleOsData } from "./domain/validation";

const now = "2026-08-01T09:00:00.000Z";
const later = "2026-08-02T09:00:00.000Z";
const names = new Set<string>();
const connections = new Set<PeopleOsDatabase>();

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function person(id: string, displayName: string, identityStatus: Person["identityStatus"]): Person {
  return { id, revision: 1, displayName, identityStatus, importance: "normal", tags: [], createdAt: now, updatedAt: now };
}

async function database(label: string): Promise<PeopleOsDatabase> {
  const name = `peopleos-v108-persistence-${label}-${crypto.randomUUID()}`;
  names.add(name);
  const db = await openPeopleOsDatabase(name, now);
  connections.add(db);
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await deletePeopleOsDatabase(name);
  names.clear();
});

describe("V1-08 persistence compatibility", () => {
  it("round-trips completed, replacement-linked and resolved provisional Reach Out graphs", async () => {
    const source = await database("source");
    const repositories = createRepositories(source);
    const sarah = person("person-sarah", "Sarah Jones", "confirmed");
    const target = person("person-aaron", "Aaron Patel", "confirmed");
    const completedIdentity = person("person-watford", "Watford CIO", "provisional");
    await repositories.people.create(sarah);
    await repositories.people.create(target);
    await repositories.people.create(completedIdentity);
    const identityCommand = prepareCompleteProvisionalPersonCommand(
      completedIdentity,
      "Alex Morgan",
      "2026-08-01T10:00:00.000Z",
      {
        contactMethods: [{
          id: "contact-watford",
          personId: completedIdentity.id,
          kind: "email",
          value: "alex@watford.example",
          createdAt: "2026-08-01T10:00:00.000Z"
        }]
      }
    );
    await completeProvisionalPerson(source, identityCommand);

    const first = await createReachOut(source, prepareCreateReachOutCommand({
      person: sarah,
      reason: "Send the pilot update",
      intendedActionType: "send_update",
      reminderDate: "2026-08-02",
      newContexts: [{ kind: "fellowship", label: "AI Fellowship" }]
    }, { now, localDate: "2026-08-01", idFactory: sequence("sarah-create") }));
    const completed = await completeReachOut(source, prepareCompleteReachOutCommand(
      first.entry,
      sarah,
      first.followUp,
      {
        logInteraction: { kind: "email", occurredAt: later, summary: "Sent the update" },
        nextFollowUp: { dueDate: "2026-08-14", reason: "Ask about the pilot", actionType: "email" }
      },
      { now: later, localDate: "2026-08-02", idFactory: sequence("sarah-complete") }
    ));

    const provisional = await createReachOut(source, prepareCreateReachOutCommand({
      person: { provisionalLabel: "Aaron from the hackathon" },
      reason: "Reconnect after the event"
    }, { now: "2026-08-03T09:00:00.000Z", localDate: "2026-08-03", idFactory: sequence("aaron-create") }));
    const preview = await getProvisionalResolutionPreview(source, provisional.person.id, target.id);
    await linkProvisionalPerson(source, prepareLinkProvisionalPersonCommand(preview, {
      now: "2026-08-04T09:00:00.000Z"
    }));

    const before = await readAllData(source);
    expect(validatePeopleOsData(before)).toBeTruthy();
    const generated = await generateBackup(source, "2026-08-05T09:00:00.000Z");
    const restored = await database("restored");
    await restoreBackup(restored, previewBackup(generated.json), "2026-08-06T09:00:00.000Z");
    const after = await readAllData(restored);
    expect(after).toEqual(before);
    expect(validatePeopleOsData(after)).toBeTruthy();

    const restoredEntry = after.reachOutEntries.find((entry) => entry.id === first.entry.id)!;
    expect(restoredEntry.currentFollowUpId).toBe(completed.nextFollowUp!.id);
    expect(after.followUps.filter((followUp) => followUp.reachOutEntryId === restoredEntry.id && followUp.status === "pending"))
      .toEqual([expect.objectContaining({ id: completed.nextFollowUp!.id })]);
    expect(after.reachOutEvents.filter((event) => event.reachOutEntryId === restoredEntry.id && event.kind === "completed")).toHaveLength(1);
    expect(after.people.find((record) => record.id === provisional.person.id)).toMatchObject({
      identityStatus: "merged",
      mergedIntoPersonId: target.id
    });
    expect(after.people.find((record) => record.id === completedIdentity.id)).toMatchObject({
      identityStatus: "confirmed",
      identityCompletionFingerprint: identityCommand.commandFingerprint
    });
    expect(after.reachOutEntries.find((entry) => entry.id === provisional.entry.id)?.personId).toBe(target.id);
  });
});
