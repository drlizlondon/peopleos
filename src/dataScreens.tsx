import { useEffect, useState } from "react";
import type { BackupCounts, BackupPreview } from "./domain/schema";
import { countData, generateBackup, previewBackup, restoreBackup } from "./data/backup";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { DATA_STORE_NAMES } from "./domain/schema";
import { ValidationError } from "./domain/validation";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { readAllData } from "./data/database";

type Navigate = (path: string) => void;

const labels: Record<keyof BackupCounts, string> = {
  people: "People",
  contactMethods: "Contact methods",
  externalIdentities: "External identities",
  affiliations: "Affiliations",
  interactions: "Interactions",
  events: "Events",
  memoryFacts: "Memory facts",
  followUps: "Follow-ups",
  followUpEvents: "Follow-up history",
  conversationStarterUses: "Conversation starter history",
  todaySkips: "Today skips",
  reachOutEntries: "Reach Out entries",
  reachOutEvents: "Reach Out history",
  reachOutContexts: "Reach Out contexts",
  appSettings: "Application settings"
};

function DataCounts({ counts }: { counts: BackupCounts }) {
  return (
    <dl className="data-counts">
      {DATA_STORE_NAMES.map((store) => (
        <div key={store}><dt>{labels[store]}</dt><dd>{counts[store]}</dd></div>
      ))}
    </dl>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationError) return error.issues[0] ?? "The backup is invalid.";
  return error instanceof Error ? error.message : "PeopleOS could not complete this action.";
}

export function ExportBackupScreen({ navigate }: { navigate: Navigate }) {
  const [state, setState] = useState<"ready" | "generating" | "generated" | "failed">("ready");
  const [counts, setCounts] = useState<BackupCounts | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDatabase().then(readAllData).then((data) => setCounts(countData(data))).catch((caught) => {
      setError(errorMessage(caught));
      setState("failed");
    });
  }, []);

  async function createBackup() {
    setState("generating");
    setError("");
    try {
      const backup = await generateBackup(await getDatabase());
      setCounts(backup.counts);
      const blob = new Blob([backup.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setState("generated");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("failed");
    }
  }

  return (
    <main className="screen data-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => navigate("/settings")}>← Settings</button>
      <header className="page-heading">
        <p className="eyebrow">Data</p>
        <h2>Export backup</h2>
        <p>Create a complete local copy of your PeopleOS data and global preferences.</p>
      </header>
      <section className="data-panel" aria-labelledby="export-includes">
        <h3 id="export-includes">What is included</h3>
        <p>People, relationship history, plans, Reach Out records, contexts, and Settings are included. The file contains personal information; store it somewhere you trust.</p>
        {counts && <DataCounts counts={counts} />}
        {state === "generated" && <p className="success-message" role="status">Backup created successfully.</p>}
        {state === "failed" && <p className="error-message" role="alert">{error} Current data was not changed.</p>}
        <button className="primary-action" type="button" onClick={createBackup} disabled={state === "generating"}>
          {state === "generating" ? "Creating backup…" : state === "failed" ? "Try again" : "Create backup"}
        </button>
      </section>
    </main>
  );
}

export function RestoreBackupScreen({ navigate }: { navigate: Navigate }) {
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [state, setState] = useState<"choose" | "validating" | "valid" | "confirm" | "restoring" | "failed">("choose");
  const [error, setError] = useState("");

  useEffect(() => () => setPreview(null), []);

  async function chooseFile(file?: File) {
    if (!file) return;
    setState("validating");
    setError("");
    setPreview(null);
    try {
      const next = previewBackup(await file.text());
      setPreview(next);
      setState("valid");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("failed");
    }
  }

  async function replaceData() {
    if (!preview) return;
    setState("restoring");
    setError("");
    try {
      const db = await getDatabase();
      const syncState = await db.get("syncState", "app");
      if (syncState?.enabled) {
        const recovery = await generateBackup(db);
        const recoveryBlob = new Blob([recovery.json], { type: "application/json" });
        const recoveryUrl = URL.createObjectURL(recoveryBlob);
        const recoveryLink = document.createElement("a");
        recoveryLink.href = recoveryUrl;
        recoveryLink.download = recovery.fileName.replace("peopleos-backup-", "peopleos-pre-restore-recovery-");
        recoveryLink.click();
        URL.revokeObjectURL(recoveryUrl);
      }
      await restoreBackup(db, preview);
      navigate("/");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("failed");
    }
  }

  return (
    <main className="screen data-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => navigate("/settings")}>← Settings</button>
      <header className="page-heading">
        <p className="eyebrow">Data</p>
        <h2>Restore backup</h2>
        <p>Validate and preview a PeopleOS backup before replacing the current local dataset.</p>
      </header>
      <section className="data-panel" aria-labelledby="restore-file">
        <h3 id="restore-file">Choose a PeopleOS backup file</h3>
        <p>Nothing changes while the file is being checked.</p>
        <label className="file-control">
          <span>Choose file</span>
          <input type="file" accept="application/json,.json" onChange={(event) => chooseFile(event.target.files?.[0])} />
        </label>
        {state === "validating" && <p role="status">Validating backup…</p>}
        {state === "failed" && <p className="error-message" role="alert">{error} Your current data is unchanged.</p>}
      </section>

      {preview && (
        <section className="data-panel" aria-labelledby="restore-preview">
          <h3 id="restore-preview">Backup preview</h3>
          <p>Exported {new Date(preview.envelope.exportedAt).toLocaleString()} · schema {preview.envelope.schemaVersion}</p>
          {preview.migratedFromVersion !== undefined && <p>This backup will be migrated from schema {preview.migratedFromVersion}.</p>}
          <DataCounts counts={preview.counts} />
          {state === "valid" && <button className="danger-action" type="button" onClick={() => setState("confirm")}>Prepare to replace current data</button>}
          {state === "confirm" && (
            <div className="confirmation-panel" role="alert">
              <strong>Replace current PeopleOS data?</strong>
              <p>The selected backup will be retained. This replaces every current local record. When iCloud Sync is on, PeopleOS first downloads a local recovery snapshot of the current data.</p>
              <div className="button-row">
                <button type="button" onClick={() => setState("valid")}>Cancel</button>
                <button className="danger-action" type="button" onClick={replaceData}>Replace current data</button>
              </div>
            </div>
          )}
          {state === "restoring" && <p role="status">Restoring…</p>}
        </section>
      )}
    </main>
  );
}
