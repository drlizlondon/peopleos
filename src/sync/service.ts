import { getDatabase } from "../data/client";
import { getCloudSyncAdapter, isCloudSyncSupported } from "./capacitorAdapter";
import { runCloudSync, setCloudSyncEnabled } from "./coordinator";
import type { SyncState } from "./types";

type Listener = (state: SyncState | undefined, running: boolean) => void;
type ErrorListener = () => void;
const listeners = new Set<Listener>();
let running = false;
let started = false;
let debounceTimer: number | undefined;
let pollTimer: number | undefined;
let periodicTimer: number | undefined;
let observedRevision = -1;

async function publish(): Promise<void> {
  const state = await (await getDatabase()).get("syncState", "app");
  listeners.forEach((listener) => listener(state, running));
}

export function subscribeToSync(listener: Listener, onError?: ErrorListener): () => void {
  listeners.add(listener);
  void publish().catch(() => onError?.());
  return () => listeners.delete(listener);
}

export async function syncNow(): Promise<void> {
  const adapter = getCloudSyncAdapter();
  if (!adapter || running) return;
  running = true;
  await publish();
  try { await runCloudSync(await getDatabase(), adapter); }
  finally { running = false; await publish(); }
}

export async function enableCloudSync(): Promise<void> {
  if (!isCloudSyncSupported()) return;
  await setCloudSyncEnabled(await getDatabase(), true);
  await publish();
  await syncNow();
}

export async function pauseCloudSync(): Promise<void> {
  await setCloudSyncEnabled(await getDatabase(), false);
  await publish();
}

function scheduleSync(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void syncNow(), 1_500);
}

export function startCloudSyncService(): () => void {
  if (!isCloudSyncSupported()) return () => undefined;
  if (started) return () => undefined;
  started = true;
  const onActive = () => { if (document.visibilityState === "visible") scheduleSync(); };
  const onOnline = () => scheduleSync();
  document.addEventListener("visibilitychange", onActive);
  window.addEventListener("online", onOnline);
  pollTimer = window.setInterval(async () => {
    const db = await getDatabase();
    const metadata = await db.get("metadata", "app");
    const state = await db.get("syncState", "app");
    if (state?.enabled && metadata && observedRevision >= 0 && metadata.datasetRevision !== observedRevision) scheduleSync();
    observedRevision = metadata?.datasetRevision ?? observedRevision;
  }, 2_000);
  periodicTimer = window.setInterval(() => { if (document.visibilityState === "visible") scheduleSync(); }, 5 * 60_000);
  void publish().then(() => scheduleSync()).catch(() => undefined);
  return () => {
    started = false;
    document.removeEventListener("visibilitychange", onActive);
    window.removeEventListener("online", onOnline);
    window.clearInterval(pollTimer); window.clearInterval(periodicTimer); window.clearTimeout(debounceTimer);
  };
}

export { isCloudSyncSupported };
