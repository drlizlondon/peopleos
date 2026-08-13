import { useCallback, useEffect, useState } from "react";
import RegularContactStartPrompt from "./RegularContactStartPrompt";
import { getUpcomingPeopleProjection, type UpcomingPeopleProjection } from "./application/upcomingQueries";
import { createRelationshipClock } from "./application/relationshipEngineQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import { personProfilePath } from "./navigation";
import { browserPathForLogicalPath } from "./platformRouting";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T12:00:00.000Z`));
}

export default function UpcomingScreen({
  activeMode = "personal",
  navigate
}: {
  activeMode?: ActiveRelationshipMode;
  navigate: Navigate;
}) {
  const [projection, setProjection] = useState<UpcomingPeopleProjection>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setProjection(await getUpcomingPeopleProjection(
        await getDatabase(),
        createRelationshipClock(),
        activeMode
      ));
    } catch {
      setError("PeopleOS could not load Upcoming from this device.");
    }
  }, [activeMode]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="screen upcoming-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => navigate("/")}>← Today</button>
      <header className="page-heading compact-heading">
        <h2>Upcoming</h2>
        <p>People coming back to mind later.</p>
      </header>

      {error && (
        <div className="section-error">
          <p role="alert">{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {!error && projection === undefined && <p className="screen-status" role="status">Loading Upcoming…</p>}
      {!error && projection && projection.evaluationIssues.length > 0 && (
        <div className="today-evaluation-notice">
          <p role="status">
            {projection.evaluationIssues.length === 1
              ? "One person could not be scheduled"
              : `${projection.evaluationIssues.length} people could not be scheduled`}
          </p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {!error && projection?.incompleteRegularContactPeople[0] && (
        <RegularContactStartPrompt
          personId={projection.incompleteRegularContactPeople[0].id}
          personName={projection.incompleteRegularContactPeople[0].displayName}
          onStarted={load}
        />
      )}

      {!error && projection?.people.length === 0 && projection.incompleteRegularContactPeople.length === 0 && (
        <p className="screen-status">No one is scheduled yet.</p>
      )}

      {!error && projection && projection.people.length > 0 && (
        <ul className="people-list upcoming-people-list" aria-label="People coming up">
          {projection.people.map(({ person, date }) => (
            <li key={person.id}>
              <a
                href={browserPathForLogicalPath(personProfilePath(person.id))}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(personProfilePath(person.id), {
                    state: { fromPath: "/upcoming", navigationOrigin: true }
                  });
                }}
              >
                <span className="person-list-name">{person.displayName}</span>
                <span className="person-list-detail"><time dateTime={date}>{dateLabel(date)}</time></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
