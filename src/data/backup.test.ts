import { afterEach, describe, expect, it } from "vitest";
import { BACKUP_SCHEMA_VERSION, DEFAULT_CONVERSATION_STARTERS } from "../domain/schema";
import { generateBackup, previewBackup, restoreBackup } from "./backup";
import { deletePeopleOsDatabase, openPeopleOsDatabase, readAllData } from "./database";
import { ValidationError } from "../domain/validation";
import { completeData, fixedNow } from "../test/fixtures";
import { regularContactSetupState } from "../domain/regularContactSchedule";
import { legacyInitialScheduleIds } from "./legacyCompatibility";

const names = new Set<string>();
const name = (label: string) => {
  const value = `peopleos-test-${label}-${crypto.randomUUID()}`;
  names.add(value);
  return value;
};

afterEach(async () => {
  for (const databaseName of names) await deletePeopleOsDatabase(databaseName);
  names.clear();
});

function originMainSchemaFourBackupFixture() {
  const current = completeData();
  const {
    todaySummaryNotificationsEnabled: _notificationIntent,
    todaySummaryNotificationTime: _notificationTime,
    conversationStarters: _conversationStarters,
    ...originMainSettings
  } = current.appSettings[0]!;
  const { externalIdentities: _externalIdentities, ...originMainData } = current;
  const base = {
    revision: 4,
    identityStatus: "confirmed" as const,
    relationshipMode: "personal" as const,
    importance: "normal" as const,
    tags: [],
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-02T09:00:00.000Z"
  };
  return {
    product: "peopleos" as const,
    schemaVersion: 4 as const,
    exportedAt: "2026-08-12T09:00:00.000Z",
    data: {
      ...originMainData,
      people: [
        ...current.people,
        {
          ...base,
          id: "main-backup-active",
          displayName: "Main Backup Active",
          contactCadenceDays: 14,
          contactCadenceFirstDueDate: "2026-08-20",
          contactCadenceDeferredUntilDate: "2026-08-25",
          todayNote: "Ask about the new role."
        },
        {
          ...base,
          id: "main-backup-paused",
          displayName: "Main Backup Paused",
          contactCadenceDays: 7,
          contactCadenceFirstDueDate: "2026-08-18",
          contactCadencePausedAt: "2026-08-10T09:00:00.000Z",
          todayNote: "Wait until they are ready.",
          todayNoteCompletedAt: "2026-08-11T09:00:00.000Z"
        }
      ],
      appSettings: [{
        ...originMainSettings,
        relationshipContexts: ["personal", "professional"]
      }]
    }
  };
}

describe("PeopleOS backup and restore", () => {
  it("round-trips the complete V1 schema and global preferences losslessly", async () => {
    const source = await openPeopleOsDatabase(name("source"), fixedNow);
    await restoreBackup(source, previewBackup({ product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: fixedNow, data: completeData() }), fixedNow);
    const generated = await generateBackup(source, "2026-08-02T10:00:00.000Z");
    expect(generated.envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(generated.envelope.data.appSettings[0]).toMatchObject({
      captureMode: "standard",
      alreadyContactedDefaultReminderDays: 14,
      reachOutDefaultReminderDays: 7,
      todaySummaryNotificationsEnabled: false,
      todaySummaryNotificationTime: "12:00",
      conversationStarters: DEFAULT_CONVERSATION_STARTERS
    });
    expect((await source.get("metadata", "app"))?.lastBackupGeneratedAt).toBe("2026-08-02T10:00:00.000Z");

    const target = await openPeopleOsDatabase(name("target"), fixedNow);
    await restoreBackup(target, previewBackup(generated.json), "2026-08-03T10:00:00.000Z");
    expect(await readAllData(target)).toEqual(completeData());
    source.close();
    target.close();
  });

  it("round-trips a custom conversation-starter bank without deriving it from People data", async () => {
    const data = completeData();
    const customBank = [
      { id: "custom-personal", template: "Thinking of you, {name}.", relationshipMode: "personal" as const },
      { id: "custom-professional", template: "How is the work going, {name}?", relationshipMode: "professional" as const },
      { id: "custom-shared", template: "How are things, {name}?", relationshipMode: "both" as const }
    ];
    data.appSettings[0]!.conversationStarters = customBank;

    const source = await openPeopleOsDatabase(name("starter-source"), fixedNow);
    await restoreBackup(source, previewBackup({
      product: "peopleos",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: fixedNow,
      data
    }), fixedNow);
    const generated = await generateBackup(source, "2026-08-02T10:00:00.000Z");
    expect(generated.envelope.data.appSettings[0]?.conversationStarters).toEqual(customBank);

    const target = await openPeopleOsDatabase(name("starter-target"), fixedNow);
    await restoreBackup(target, previewBackup(generated.json), "2026-08-03T10:00:00.000Z");
    expect((await target.get("appSettings", "app"))?.conversationStarters).toEqual(customBank);
    source.close();
    target.close();
  });

  it("round-trips a structured contact cadence without flattening its unit", async () => {
    const data = completeData();
    data.people[0] = {
      ...data.people[0]!,
      contactCadence: { value: 4, unit: "weeks" },
      contactCadenceDays: undefined
    };
    const source = await openPeopleOsDatabase(name("cadence-source"), fixedNow);
    await restoreBackup(source, previewBackup({ product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: fixedNow, data }), fixedNow);
    const generated = await generateBackup(source, "2026-08-02T10:00:00.000Z");
    expect(generated.envelope.data.people[0]?.contactCadence).toEqual({ value: 4, unit: "weeks" });

    const target = await openPeopleOsDatabase(name("cadence-target"), fixedNow);
    await restoreBackup(target, previewBackup(generated.json), "2026-08-03T10:00:00.000Z");
    expect((await target.get("people", data.people[0]!.id))?.contactCadence).toEqual({ value: 4, unit: "weeks" });
    source.close();
    target.close();
  });

  it("rejects corrupt, wrong-product, and future-version backups before writes", async () => {
    expect(() => previewBackup("not-json")).toThrow(ValidationError);
    expect(() => previewBackup({ product: "other", schemaVersion: BACKUP_SCHEMA_VERSION })).toThrow(/not a PeopleOS backup/);
    expect(() => previewBackup({ product: "peopleos", schemaVersion: 99 })).toThrow(/newer unsupported/);
  });

  it("migrates a schema-zero backup by filling deterministic empty stores and Settings", () => {
    const preview = previewBackup({
      product: "peopleos", schemaVersion: 0, exportedAt: fixedNow,
      data: { people: completeData().people }
    });
    expect(preview.migratedFromVersion).toBe(0);
    expect(preview.envelope.data.people).toHaveLength(1);
    expect(preview.envelope.data.appSettings).toHaveLength(1);
    expect(preview.envelope.data.appSettings[0]?.alreadyContactedDefaultReminderDays).toBe(14);
    expect(preview.envelope.data.followUps).toEqual([]);
  });

  it("migrates schema-one Settings deterministically without mutating the source", () => {
    const current = completeData();
    const {
      alreadyContactedDefaultReminderDays: _newDefault,
      todaySummaryNotificationsEnabled: _notificationIntent,
      todaySummaryNotificationTime: _notificationTime,
      conversationStarters: _conversationStarters,
      ...legacySettings
    } = current.appSettings[0]!;
    const legacy = {
      product: "peopleos",
      schemaVersion: 1,
      exportedAt: fixedNow,
      data: { ...current, appSettings: [legacySettings] }
    } as const;

    const first = previewBackup(legacy);
    const retry = previewBackup(legacy);
    expect(first).toEqual(retry);
    expect(first.migratedFromVersion).toBe(1);
    expect(first.envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(first.envelope.data.appSettings[0]).toEqual({
      ...legacySettings,
      alreadyContactedDefaultReminderDays: 14,
      todaySummaryNotificationsEnabled: false,
      todaySummaryNotificationTime: "12:00",
      conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter }))
    });
    expect("alreadyContactedDefaultReminderDays" in legacy.data.appSettings[0]).toBe(false);
    expect("todaySummaryNotificationsEnabled" in legacy.data.appSettings[0]).toBe(false);
    expect("conversationStarters" in legacy.data.appSettings[0]).toBe(false);

    const currentPreview = previewBackup(first.envelope);
    expect(currentPreview.migratedFromVersion).toBeUndefined();
    expect(currentPreview.envelope).toEqual(first.envelope);
  });

  it("migrates schema-four backups to private notifications Off at 12:00", () => {
    const current = completeData();
    const {
      todaySummaryNotificationsEnabled: _notificationIntent,
      todaySummaryNotificationTime: _notificationTime,
      ...legacySettings
    } = current.appSettings[0]!;
    const preview = previewBackup({
      product: "peopleos",
      schemaVersion: 4,
      exportedAt: fixedNow,
      data: { ...current, appSettings: [legacySettings] }
    });
    expect(preview.migratedFromVersion).toBe(4);
    expect(preview.envelope.data.appSettings[0]).toMatchObject({
      todaySummaryNotificationsEnabled: false,
      todaySummaryNotificationTime: "12:00"
    });
  });

  it("accepts a main-line schema-three backup without ExternalIdentity data", () => {
    const current = completeData();
    const { externalIdentities: _externalIdentities, ...mainSchemaThreeData } = current;
    const preview = previewBackup({
      product: "peopleos",
      schemaVersion: 3,
      exportedAt: fixedNow,
      data: mainSchemaThreeData
    });

    expect(preview.migratedFromVersion).toBe(3);
    expect(preview.envelope.data.externalIdentities).toEqual([]);
  });

  it("migrates a real origin/main schema-four backup losslessly without sync stores or silent reactivation", async () => {
    const legacy = originMainSchemaFourBackupFixture();
    const sourceBefore = JSON.stringify(legacy);

    const preview = previewBackup(legacy);
    expect(JSON.stringify(legacy)).toBe(sourceBefore);
    expect(preview.migratedFromVersion).toBe(4);
    expect(preview.envelope.data.externalIdentities).toEqual([]);
    expect(preview.envelope.data.appSettings[0]).toMatchObject({
      relationshipContexts: ["personal", "professional"],
      todaySummaryNotificationsEnabled: false,
      todaySummaryNotificationTime: "12:00",
      conversationStarters: DEFAULT_CONVERSATION_STARTERS
    });

    const active = preview.envelope.data.people.find((person) => person.id === "main-backup-active")!;
    expect(active).toMatchObject({
      revision: 4,
      contactCadence: { value: 14, unit: "days" },
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-08-20",
      contactCadenceDeferredUntilDate: "2026-08-25",
      todayPausedUntilDate: "2026-08-25",
      todayNote: "Ask about the new role."
    });
    const activeIds = legacyInitialScheduleIds(active.id);
    expect(preview.envelope.data.followUps).toContainEqual(expect.objectContaining({
      id: activeIds.followUpId,
      personId: active.id,
      dueDate: "2026-08-20",
      suggestedByRule: "initial_schedule",
      status: "pending"
    }));
    expect(preview.envelope.data.followUpEvents).toContainEqual(expect.objectContaining({
      id: activeIds.followUpEventId,
      followUpId: activeIds.followUpId,
      kind: "created",
      toDate: "2026-08-20"
    }));

    const paused = preview.envelope.data.people.find((person) => person.id === "main-backup-paused")!;
    expect(paused).toMatchObject({
      contactCadence: { value: 7, unit: "days" },
      contactCadenceFirstDueDate: "2026-08-18",
      contactCadencePausedAt: "2026-08-10T09:00:00.000Z",
      todayNote: "Wait until they are ready.",
      todayNoteCompletedAt: "2026-08-11T09:00:00.000Z"
    });
    expect(preview.envelope.data.followUps.some((followUp) =>
      followUp.id === legacyInitialScheduleIds(paused.id).followUpId
    )).toBe(false);
    expect(regularContactSetupState(paused, [], [])).toBe("incomplete");
    expect(preview.envelope.data.interactions.some((interaction) =>
      interaction.personId === active.id || interaction.personId === paused.id
    )).toBe(false);

    const db = await openPeopleOsDatabase(name("origin-main-schema-four"), fixedNow);
    await restoreBackup(db, preview, "2026-08-13T09:00:00.000Z");
    const restored = await readAllData(db);
    expect(restored.people).toHaveLength(preview.envelope.data.people.length);
    expect(restored.people.find((person) => person.id === active.id)).toEqual(active);
    expect(restored.people.find((person) => person.id === paused.id)).toEqual(paused);
    expect(restored.contactMethods.some((contact) => contact.id === "contact-sarah-phone")).toBe(true);
    expect(restored.followUps.some((followUp) => followUp.id === "follow-up-sarah")).toBe(true);
    expect(restored.followUps.find((followUp) => followUp.id === activeIds.followUpId))
      .toEqual(preview.envelope.data.followUps.find((followUp) => followUp.id === activeIds.followUpId));
    expect(await db.get("syncState", "app")).toMatchObject({ enabled: false });

    const generated = await generateBackup(db, "2026-08-13T10:00:00.000Z");
    expect(generated.envelope.data.people.find((person) => person.id === paused.id)).toEqual(paused);
    expect(generated.envelope.data.interactions.some((interaction) =>
      interaction.personId === active.id || interaction.personId === paused.id
    )).toBe(false);
    db.close();
  });

  it("migrates schema-five backups to the deterministic starter bank without mutating the source", () => {
    const current = completeData();
    const { conversationStarters: _conversationStarters, ...legacySettings } = current.appSettings[0]!;
    const legacy = {
      product: "peopleos",
      schemaVersion: 5,
      exportedAt: fixedNow,
      data: { ...current, appSettings: [legacySettings] }
    } as const;

    const first = previewBackup(legacy);
    const retry = previewBackup(legacy);
    expect(first).toEqual(retry);
    expect(first.migratedFromVersion).toBe(5);
    expect(first.envelope.data.appSettings[0]?.conversationStarters)
      .toEqual(DEFAULT_CONVERSATION_STARTERS);
    expect("conversationStarters" in legacy.data.appSettings[0]).toBe(false);
  });

  it("imports older backups as Personal without overwriting an assigned relationship mode", () => {
    const oldData = completeData();
    const oldPerson = { ...oldData.people[0]! };
    delete oldPerson.relationshipMode;
    const migrated = previewBackup({
      product: "peopleos",
      schemaVersion: 2,
      exportedAt: fixedNow,
      data: { ...oldData, people: [oldPerson] }
    });
    expect(migrated.envelope.data.people[0]?.relationshipMode).toBe("personal");

    const professional = previewBackup({
      product: "peopleos",
      schemaVersion: 2,
      exportedAt: fixedNow,
      data: { ...oldData, people: [{ ...oldPerson, relationshipMode: "professional" }] }
    });
    expect(professional.envelope.data.people[0]?.relationshipMode).toBe("professional");
  });

  it("rejects a current schema backup when the required interval is missing", () => {
    const current = completeData();
    const { alreadyContactedDefaultReminderDays: _missing, ...invalidSettings } = current.appSettings[0]!;
    expect(() => previewBackup({
      product: "peopleos",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: fixedNow,
      data: { ...current, appSettings: [invalidSettings] }
    })).toThrow(/appSettings\[0\] is invalid/);
  });

  it("rejects a current schema backup when notification settings are missing or invalid", () => {
    const current = completeData();
    const { todaySummaryNotificationTime: _missing, ...missingTime } = current.appSettings[0]!;
    expect(() => previewBackup({
      product: "peopleos",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: fixedNow,
      data: { ...current, appSettings: [missingTime] }
    })).toThrow(/appSettings\[0\] is invalid/);
    expect(() => previewBackup({
      product: "peopleos",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: fixedNow,
      data: { ...current, appSettings: [{ ...current.appSettings[0]!, todaySummaryNotificationTime: "25:00" }] }
    })).toThrow(/appSettings\[0\] is invalid/);
  });

  it("rejects a current schema backup when the conversation-starter bank is missing", () => {
    const current = completeData();
    const { conversationStarters: _missing, ...missingBank } = current.appSettings[0]!;
    expect(() => previewBackup({
      product: "peopleos",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: fixedNow,
      data: { ...current, appSettings: [missingBank] }
    })).toThrow(/appSettings\[0\] is invalid/);
  });

  it("leaves the original database unchanged when restore fails before commit", async () => {
    const db = await openPeopleOsDatabase(name("rollback"), fixedNow);
    const initial = await readAllData(db);
    const preview = previewBackup({ product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: fixedNow, data: completeData() });
    await expect(restoreBackup(db, preview, fixedNow, { beforeCommit: () => { throw new Error("injected failure"); } })).rejects.toThrow("injected failure");
    expect(await readAllData(db)).toEqual(initial);
    db.close();
  });

  it("does not change current data when preview validation fails", async () => {
    const db = await openPeopleOsDatabase(name("invalid"), fixedNow);
    const before = await readAllData(db);
    const invalid = completeData();
    invalid.people = [];
    expect(() => previewBackup({ product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: fixedNow, data: invalid })).toThrow(ValidationError);
    expect(await readAllData(db)).toEqual(before);
    db.close();
  });

  it("rejects broken Reach Out reciprocal graphs during preview", () => {
    const cases: Array<{ name: string; mutate: (data: ReturnType<typeof completeData>) => void; message: RegExp }> = [
      {
        name: "missing current FollowUp",
        mutate: (data) => { data.reachOutEntries[0]!.currentFollowUpId = "missing-follow-up"; },
        message: /currentFollowUpId/
      },
      {
        name: "FollowUp missing its reciprocal entry",
        mutate: (data) => { delete data.followUps[0]!.reachOutEntryId; },
        message: /currentFollowUpId|reciprocal/
      },
      {
        name: "link event points elsewhere",
        mutate: (data) => { data.reachOutEvents.find((event) => event.kind === "follow_up_linked")!.followUpId = "missing-follow-up"; },
        message: /followUpId/
      }
    ];
    for (const candidate of cases) {
      const data = completeData();
      candidate.mutate(data);
      expect(() => previewBackup({ product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: fixedNow, data }), candidate.name)
        .toThrow(candidate.message);
    }
  });
});
