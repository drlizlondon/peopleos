import { useCallback, useEffect, useState } from "react";
import EmptyState from "./EmptyState";
import { ReachOutActions } from "./ReachOutScreen";
import { getReachOutDetail, type ReachOutDetail } from "./application/reachOutQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { LocalDate } from "./domain/schema";
import { personProfilePath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

function todayLocalDate(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function ReachOutDetailScreen({
  entryId,
  navigate,
  onBack
}: {
  entryId: string;
  navigate: Navigate;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<ReachOutDetail | null>();
  const [error, setError] = useState("");
  const [localDate] = useState(todayLocalDate);

  const load = useCallback(async () => {
    setError("");
    try {
      setDetail(await getReachOutDetail(await getDatabase(), entryId, localDate) ?? null);
    } catch {
      setError("PeopleOS could not load this Reach Out item.");
    }
  }, [entryId, localDate]);

  useEffect(() => { void load(); }, [load]);

  const current = Boolean(detail
    && !detail.entry.removedAt
    && detail.entry.intentStatus === "active"
    && !detail.person.archivedAt
    && detail.person.identityStatus !== "merged");

  return (
    <main className="screen reach-out-detail-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={onBack}>← Reach Out</button>
      {detail === undefined && !error && <p role="status">Loading Reach Out…</p>}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {detail === null && !error && (
        <EmptyState
          eyebrow="Reach Out"
          title="Not found"
          description="This saved item is no longer available."
          action={<button className="primary-action" type="button" onClick={() => navigate("/reach-out")}>Open Reach Out</button>}
        />
      )}
      {detail && (
        <>
          <header className="page-heading compact-heading">
            <p className="eyebrow">Reach Out</p>
            <h2>{detail.person.displayName}</h2>
            {detail.entry.reason && <p className="preserve-lines">{detail.entry.reason}</p>}
          </header>

          {detail.repairNotice && <p className="form-alert" role="alert">{detail.repairNotice}</p>}
          {!current && (
            <p className="muted-copy">This person is not on your current Reach Out list.</p>
          )}

          <ReachOutActions item={detail} navigate={navigate} onCompleted={load} />

          <div className="button-row page-actions">
            <button
              type="button"
              onClick={() => navigate(personProfilePath(detail.person.id), {
                state: { fromPath: `/reach-out/${encodeURIComponent(detail.entry.id)}`, profileOriginPrepared: true }
              })}
            >
              Open person
            </button>
          </div>
        </>
      )}
    </main>
  );
}
