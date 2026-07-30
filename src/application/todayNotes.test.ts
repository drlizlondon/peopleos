import { afterEach, describe, expect, it } from "vitest";
import { createRepositories } from "../data/repositories";
import { deletePeopleOsDatabase, openPeopleOsDatabase } from "../data/database";
import { removeTodayNote, saveTodayNote, setTodayNoteCompleted } from "./todayNotes";

const names = new Set<string>();
afterEach(async () => { for (const name of names) await deletePeopleOsDatabase(name); names.clear(); });

describe("independent Today notes", () => {
  it("toggles only the note and never resolves or reschedules the reminder", async () => {
    const name = `today-note-${crypto.randomUUID()}`; names.add(name);
    const db = await openPeopleOsDatabase(name, "2026-08-14T09:00:00.000Z");
    const repositories = createRepositories(db);
    await repositories.people.create({ id: "person", revision: 1, displayName: "Mum", identityStatus: "confirmed", importance: "normal", tags: [], contactCadenceDays: 14, contactCadenceFirstDueDate: "2026-08-14", createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z" });
    await repositories.followUps.create({ id: "follow-up", revision: 1, personId: "person", dueDate: "2026-08-14", reason: "Ask how the appointment went", actionType: "call", status: "pending", createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z" });
    await saveTodayNote(db, "person", "Ask how the appointment went", "2026-08-14T10:00:00.000Z");
    await setTodayNoteCompleted(db, "person", true, "2026-08-14T10:01:00.000Z");
    expect((await db.get("people", "person"))?.todayNoteCompletedAt).toBe("2026-08-14T10:01:00.000Z");
    expect(await db.getAll("interactions")).toEqual([]);
    expect(await db.get("followUps", "follow-up")).toMatchObject({ status: "pending", dueDate: "2026-08-14" });
    expect(await db.get("people", "person")).toMatchObject({ contactCadenceDays: 14, contactCadenceFirstDueDate: "2026-08-14" });
    await setTodayNoteCompleted(db, "person", false, "2026-08-14T10:02:00.000Z");
    expect((await db.get("people", "person"))?.todayNoteCompletedAt).toBeUndefined();
    await removeTodayNote(db, "person", "2026-08-14T10:03:00.000Z");
    expect((await db.get("people", "person"))?.todayNote).toBeUndefined();
    db.close();
  });
});
