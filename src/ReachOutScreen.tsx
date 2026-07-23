import { useCallback, useEffect, useState } from "react";
import EmptyState from "./EmptyState";
import { listReachOut, type ReachOutListItem } from "./application/reachOutQueries";
import { getDatabase } from "./data/client";
import { FOLLOW_UP_ACTION_OPTIONS } from "./domain/followUpPolicy";
import type { FollowUpActionType, LocalDate } from "./domain/schema";
import { personProfilePath, reachOutDetailPath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

function todayLocalDate(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateLabel(value: LocalDate): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00.000Z`));
}

function actionLabel(value: FollowUpActionType | undefined): string {
  return FOLLOW_UP_ACTION_OPTIONS.find((option) => option.value === value)?.label ?? "Choose next action";
}

function statusLabel(item: ReachOutListItem, localDate: LocalDate): string {
  if (item.displayState === "active" && item.relevantDate === localDate) return "Due today";
  return {
    active: "Active",
    waiting: "Waiting",
    snoozed: "Snoozed",
    overdue: "Overdue",
    completed: "Completed",
    dormant: "Dormant"
  }[item.displayState];
}

export default function ReachOutScreen({ navigate, onAdd }: { navigate: Navigate; onAdd: (opener: HTMLElement) => void }) {
  const [items, setItems] = useState<ReachOutListItem[] | undefined>(undefined);
  const [error, setError] = useState("");
  const localDate = todayLocalDate();

  const load = useCallback(async () => {
    setError("");
    setItems(undefined);
    try {
      setItems(await listReachOut(await getDatabase(), { localDate }));
    } catch {
      setError("PeopleOS could not load Reach Out from this device.");
    }
  }, [localDate]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="screen reach-out-screen" id="main-content" tabIndex={-1}>
      {items === undefined && !error && <p role="status">Loading Reach Out…</p>}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {items?.length === 0 && (
        <EmptyState
          eyebrow="Reach Out"
          title="People you mean to contact"
          description="Keep a deliberate list of people you want to contact, reconnect with or build a relationship with."
          note="You can even add someone if all you remember is where you met them."
          action={<button className="primary-action" type="button" onClick={(event) => onAdd(event.currentTarget)}>Add someone</button>}
        />
      )}
      {items && items.length > 0 && (
        <>
          <header className="page-heading page-heading-with-action">
            <div>
              <p className="eyebrow">Reach Out</p>
              <h2>People you mean to contact</h2>
              <p>A deliberate queue of relationships you intend to act on.</p>
            </div>
            <button className="primary-action" type="button" onClick={(event) => onAdd(event.currentTarget)}>Add someone</button>
          </header>
          <ol className="reach-out-list" aria-label="Current Reach Out queue">
            {items.map((item) => (
              <li key={item.entry.id}>
                <article className="reach-out-card">
                  <div className="reach-out-card-heading">
                    <div>
                      <button className="text-action reach-out-person-link" type="button" onClick={() => navigate(personProfilePath(item.person.id))}>
                        {item.person.displayName}
                      </button>
                      {item.person.identityStatus === "provisional" && <span className="status-chip">Identity incomplete</span>}
                      {item.affiliation && <p>{[item.affiliation.role, item.affiliation.organisationName].filter(Boolean).join(" · ")}</p>}
                    </div>
                    <span className={`status-chip reach-out-status-${item.displayState}`}>{statusLabel(item, localDate)}</span>
                  </div>
                  <dl className="profile-details reach-out-summary">
                    <div><dt>Why</dt><dd>{item.entry.reason ?? "Add why"}</dd></div>
                    <div><dt>Next action</dt><dd>{item.entry.actionDetail ?? actionLabel(item.entry.intendedActionType)}</dd></div>
                    {item.relevantDate && <div><dt>Planned</dt><dd><time dateTime={item.relevantDate}>{localDateLabel(item.relevantDate)}</time></dd></div>}
                  </dl>
                  {item.contexts.length > 0 && <p className="reach-out-contexts" aria-label="Contexts">{item.contexts.map((context) => context.label).join(" · ")}</p>}
                  {item.repairNotice && <p className="form-alert" role="alert">{item.repairNotice}</p>}
                  <button className="secondary-action" type="button" onClick={() => navigate(reachOutDetailPath(item.entry.id))}>Open plan</button>
                </article>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}
