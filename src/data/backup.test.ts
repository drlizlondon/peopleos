import { afterEach, describe, expect, it } from "vitest";
import { BACKUP_SCHEMA_VERSION } from "../domain/schema";
import { generateBackup, previewBackup, restoreBackup } from "./backup";
import { deletePeopleOsDatabase, openPeopleOsDatabase, readAllData } from "./database";
import { ValidationError } from "../domain/validation";
import { completeData, fixedNow } from "../test/fixtures";

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

describe("PeopleOS backup and restore", () => {
  it("round-trips the complete V1 schema and global preferences losslessly", async () => {
    const source = await openPeopleOsDatabase(name("source"), fixedNow);
    await restoreBackup(source, previewBackup({ product: "peopleos", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: fixedNow, data: completeData() }), fixedNow);
    const generated = await generateBackup(source, "2026-08-02T10:00:00.000Z");
    expect(generated.envelope.schemaVersion).toBe(4);
    expect(generated.envelope.data.appSettings[0]).toMatchObject({
      captureMode: "standard",
      alreadyContactedDefaultReminderDays: 14,
      reachOutDefaultReminderDays: 7
    });
    expect((await source.get("metadata", "app"))?.lastBackupGeneratedAt).toBe("2026-08-02T10:00:00.000Z");

    const target = await openPeopleOsDatabase(name("target"), fixedNow);
    await restoreBackup(target, previewBackup(generated.json), "2026-08-03T10:00:00.000Z");
    expect(await readAllData(target)).toEqual(completeData());
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
    const { alreadyContactedDefaultReminderDays: _newDefault, ...legacySettings } = current.appSettings[0]!;
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
      alreadyContactedDefaultReminderDays: 14
    });
    expect("alreadyContactedDefaultReminderDays" in legacy.data.appSettings[0]).toBe(false);

    const currentPreview = previewBackup(first.envelope);
    expect(currentPreview.migratedFromVersion).toBeUndefined();
    expect(currentPreview.envelope).toEqual(first.envelope);
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
