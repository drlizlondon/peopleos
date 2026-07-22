import { afterEach, describe, expect, it } from "vitest";
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
    await restoreBackup(source, previewBackup({ product: "peopleos", schemaVersion: 1, exportedAt: fixedNow, data: completeData() }), fixedNow);
    const generated = await generateBackup(source, "2026-08-02T10:00:00.000Z");
    expect(generated.envelope.data.appSettings[0]).toMatchObject({ captureMode: "standard", reachOutDefaultReminderDays: 7 });
    expect((await source.get("metadata", "app"))?.lastBackupGeneratedAt).toBe("2026-08-02T10:00:00.000Z");

    const target = await openPeopleOsDatabase(name("target"), fixedNow);
    await restoreBackup(target, previewBackup(generated.json), "2026-08-03T10:00:00.000Z");
    expect(await readAllData(target)).toEqual(completeData());
    source.close();
    target.close();
  });

  it("rejects corrupt, wrong-product, and future-version backups before writes", async () => {
    expect(() => previewBackup("not-json")).toThrow(ValidationError);
    expect(() => previewBackup({ product: "other", schemaVersion: 1 })).toThrow(/not a PeopleOS backup/);
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
    expect(preview.envelope.data.followUps).toEqual([]);
  });

  it("leaves the original database unchanged when restore fails before commit", async () => {
    const db = await openPeopleOsDatabase(name("rollback"), fixedNow);
    const initial = await readAllData(db);
    const preview = previewBackup({ product: "peopleos", schemaVersion: 1, exportedAt: fixedNow, data: completeData() });
    await expect(restoreBackup(db, preview, fixedNow, { beforeCommit: () => { throw new Error("injected failure"); } })).rejects.toThrow("injected failure");
    expect(await readAllData(db)).toEqual(initial);
    db.close();
  });

  it("does not change current data when preview validation fails", async () => {
    const db = await openPeopleOsDatabase(name("invalid"), fixedNow);
    const before = await readAllData(db);
    const invalid = completeData();
    invalid.people = [];
    expect(() => previewBackup({ product: "peopleos", schemaVersion: 1, exportedAt: fixedNow, data: invalid })).toThrow(ValidationError);
    expect(await readAllData(db)).toEqual(before);
    db.close();
  });
});
