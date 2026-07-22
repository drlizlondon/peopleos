import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FactEditorSheet from "./FactEditorSheet";
import {
  FACT_KIND_OPTIONS,
  DuplicateMemoryFactError,
  archiveMemoryFact,
  listPersonMemoryFacts,
  restoreMemoryFact
} from "./application/memoryFacts";
import { getPersonSummary, type PersonSummary } from "./application/peopleQueries";
import { listActivePersonOptions } from "./application/interactionQueries";
import { getDatabase } from "./data/client";
import type { MemoryFact, MemoryFactKind } from "./domain/schema";
import { personProfilePath } from "./navigation";

type Navigate = (path: string, options?: { replace?: boolean }) => void;

const factLabels = new Map<MemoryFactKind, string>(
  FACT_KIND_OPTIONS.map((option) => [option.value, option.label])
);

function factLabel(kind: MemoryFactKind): string {
  return factLabels.get(kind) ?? kind;
}

function displayValue(fact: MemoryFact): string {
  if (fact.kind !== "communication_preference") return fact.value;
  return fact.value === "whatsapp" ? "WhatsApp" : fact.value === "email" ? "Email" : "Phone";
}

function formatUpdated(instant: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(instant));
}

export default function MemoryFactsScreen({
  personId,
  navigate,
  onBack
}: {
  personId: string;
  navigate: Navigate;
  onBack?: () => void;
}) {
  const [person, setPerson] = useState<PersonSummary | null | undefined>(undefined);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [relatedPersonNames, setRelatedPersonNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<"all" | MemoryFactKind>("all");
  const [editor, setEditor] = useState<MemoryFact | "new" | null>(null);
  const [removedFact, setRemovedFact] = useState<MemoryFact | null>(null);
  const [duplicateRestore, setDuplicateRestore] = useState<MemoryFact | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const db = await getDatabase();
      const [summary, storedFacts, people] = await Promise.all([
        getPersonSummary(db, personId),
        listPersonMemoryFacts(db, personId),
        listActivePersonOptions(db, personId)
      ]);
      setPerson(summary ?? null);
      setFacts([...storedFacts.active, ...storedFacts.archived]);
      setRelatedPersonNames(new Map(people.map((option) => [option.person.id, option.person.displayName])));
    } catch {
      setError("PeopleOS could not load memory facts.");
    }
  }, [personId]);

  useEffect(() => { void load(); }, [load]);

  const active = facts.filter((fact) => !fact.archivedAt);
  const archived = facts.filter((fact) => fact.archivedAt);
  const visible = filter === "all" ? active : active.filter((fact) => fact.kind === filter);
  const groups = useMemo(() => FACT_KIND_OPTIONS
    .map((option) => ({ ...option, facts: visible.filter((fact) => fact.kind === option.value) }))
    .filter((group) => group.facts.length > 0), [visible]);
  const editable = Boolean(person && !person.person.archivedAt && person.person.identityStatus !== "merged");

  function openEditor(value: MemoryFact | "new", opener: HTMLElement) {
    openerRef.current = opener;
    setEditor(value);
  }

  function closeEditor() {
    setEditor(null);
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      else headingRef.current?.focus();
    });
  }

  async function finishEditor(archivedFact: MemoryFact | null = null) {
    setEditor(null);
    await load();
    setRemovedFact(archivedFact);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function archive(fact: MemoryFact) {
    if (busyId) return;
    setBusyId(fact.id);
    setError("");
    try {
      const archivedFact = await archiveMemoryFact(await getDatabase(), fact.id, fact.revision);
      setRemovedFact(archivedFact);
      await load();
    } catch {
      setError("PeopleOS could not archive this fact. Reload and try again.");
    } finally {
      setBusyId("");
    }
  }

  async function restore(fact: MemoryFact, allowDuplicate = false) {
    if (busyId) return;
    setBusyId(fact.id);
    setError("");
    try {
      await restoreMemoryFact(await getDatabase(), fact.id, fact.revision, { allowDuplicate });
      setRemovedFact(null);
      setDuplicateRestore(null);
      await load();
    } catch (caught) {
      if (caught instanceof DuplicateMemoryFactError) setDuplicateRestore(fact);
      else setError("PeopleOS could not restore this fact. Reload and try again.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="screen timeline-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => onBack ? onBack() : navigate(personProfilePath(personId))}>← Person</button>

      {person === undefined && !error && <p role="status">Loading memory facts…</p>}
      {error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {person === null && (
        <section className="profile-card">
          <h2>This person is no longer available.</h2>
          <button type="button" onClick={() => navigate("/people")}>Back to People</button>
        </section>
      )}

      {person && (
        <>
          <header className="page-heading page-heading-with-action compact-heading">
            <div>
              <p className="eyebrow">{person.person.displayName}</p>
              <h2 ref={headingRef} tabIndex={-1}>Memory facts</h2>
              <p>Short, structured details you want to find and remember.</p>
            </div>
            {editable && (
              <button className="primary-action" type="button" onClick={(event) => openEditor("new", event.currentTarget)}>
                Add fact
              </button>
            )}
          </header>

          {removedFact && (
            <div className="undo-message" role="status">
              <span>Fact archived.</span>
              <button type="button" onClick={() => void restore(removedFact)} disabled={busyId === removedFact.id}>Undo</button>
            </div>
          )}

          {duplicateRestore && (
            <section className="confirmation-panel" role="alertdialog" aria-labelledby="restore-duplicate-fact-heading">
              <h3 id="restore-duplicate-fact-heading">This fact is already active</h3>
              <p>An active fact with the same kind and wording already exists. Restore another only when it represents a distinct context you need to keep.</p>
              <div className="button-row compact-buttons">
                <button type="button" autoFocus onClick={() => setDuplicateRestore(null)}>Cancel</button>
                <button className="primary-action" type="button" onClick={() => void restore(duplicateRestore, true)}>Restore anyway</button>
              </div>
            </section>
          )}

          {active.length > 10 && (
            <div className="timeline-year-jump form-field">
              <label htmlFor="memory-fact-filter">Filter facts</label>
              <select id="memory-fact-filter" value={filter} onChange={(event) => setFilter(event.target.value as "all" | MemoryFactKind)}>
                <option value="all">All kinds</option>
                {FACT_KIND_OPTIONS.filter((option) => active.some((fact) => fact.kind === option.value)).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )}

          {active.length === 0 ? (
            <section className="profile-card timeline-empty">
              <h3>Add a fact you’ll want to find later.</h3>
              <p>For example: Based in Bristol or Looking for pilot sites.</p>
              {editable && <button className="text-action" type="button" onClick={(event) => openEditor("new", event.currentTarget)}>Add fact</button>}
            </section>
          ) : visible.length === 0 ? (
            <p className="profile-card muted-copy" role="status">No active facts match this filter.</p>
          ) : (
            <div className="timeline-groups">
              {groups.map((group) => (
                <section className="timeline-group" key={group.value} aria-labelledby={`fact-group-${group.value}`}>
                  <h3 id={`fact-group-${group.value}`}>{group.label}</h3>
                  <ul className="timeline-list">
                    {group.facts.map((fact) => (
                      <li className="timeline-item" key={fact.id}>
                        <div className="timeline-item-heading">
                          <div>
                            <h4>{displayValue(fact)}</h4>
                            <span className="muted-copy">Updated {formatUpdated(fact.updatedAt)}</span>
                          </div>
                          {fact.showAsMemoryCue && <span className="status-chip">Memory cue</span>}
                        </div>
                        {fact.sourceInteractionId && <p className="muted-copy">Linked to an interaction</p>}
                        {fact.relatedPersonId && relatedPersonNames.has(fact.relatedPersonId) && (
                          <p className="muted-copy">Linked person: {relatedPersonNames.get(fact.relatedPersonId)}</p>
                        )}
                        {editable && (
                          <div className="button-row compact-buttons">
                            <button type="button" aria-label={`Edit ${displayValue(fact)}`} onClick={(event) => openEditor(fact, event.currentTarget)}>Edit</button>
                            <button className="danger-text" type="button" aria-label={`Archive ${displayValue(fact)}`} onClick={() => void archive(fact)} disabled={busyId === fact.id}>Archive</button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {archived.length > 0 && (
            <details className="archived-details">
              <summary>Archived facts ({archived.length})</summary>
              <ul>
                {archived.map((fact) => (
                  <li key={fact.id}>
                    <strong>{displayValue(fact)}</strong>
                    <span>{factLabel(fact.kind)} · Not shown in cues or active search</span>
                    {editable && <button type="button" aria-label={`Restore ${displayValue(fact)}`} onClick={() => void restore(fact)} disabled={busyId === fact.id}>Restore</button>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {editor && (
            <FactEditorSheet
              personId={person.person.id}
              personName={person.person.displayName}
              fact={editor === "new" ? undefined : editor}
              onClose={closeEditor}
              onSaved={() => void finishEditor()}
              onArchived={(fact) => void finishEditor(fact)}
            />
          )}
        </>
      )}
    </main>
  );
}
