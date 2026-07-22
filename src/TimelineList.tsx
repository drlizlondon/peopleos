import type { TimelineDisplayItem } from "./application/interactionQueries";
import { timelineMonthKey, timelineMonthLabel } from "./timelineDates";

function dateLabel(instant: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(instant));
}

export default function TimelineList({
  items,
  onOpenInteraction
}: {
  items: TimelineDisplayItem[];
  onOpenInteraction?: (item: TimelineDisplayItem, opener: HTMLElement) => void;
}) {
  const groups = items.reduce<Array<{ key: string; label: string; items: TimelineDisplayItem[] }>>((all, item) => {
    const key = timelineMonthKey(item.occurredAt);
    const current = all[all.length - 1];
    if (current?.key === key) current.items.push(item);
    else all.push({ key, label: timelineMonthLabel(item.occurredAt), items: [item] });
    return all;
  }, []);

  return (
    <div className="timeline-groups">
      {groups.map((group) => (
        <section className="timeline-group" key={group.key} aria-labelledby={`timeline-month-${group.key}`}>
          <h4 id={`timeline-month-${group.key}`} tabIndex={-1}>{group.label}</h4>
          <ol className="timeline-list">
            {group.items.map((item) => (
              <li key={`${item.source}:${item.id}`}>
                <article className="timeline-item">
                  <div className="timeline-item-heading">
                    <div>
                      <h5>{item.title}</h5>
                      <time dateTime={item.occurredAt}>{dateLabel(item.occurredAt)}</time>
                    </div>
                    {item.source === "interaction" && (
                      <span className="status-chip">
                        {item.countsAsContact ? "Counts as contact" : "Context only"}
                      </span>
                    )}
                  </div>
                  {item.summary && <p>{item.summary}</p>}
                  {(item.event || item.relatedPerson) && (
                    <dl className="timeline-context">
                      {item.event && <div><dt>Event</dt><dd>{item.event.name}</dd></div>}
                      {item.relatedPerson && <div><dt>Related person</dt><dd>{item.relatedPerson.displayName}</dd></div>}
                    </dl>
                  )}
                  {item.editable && onOpenInteraction && (
                    <button
                      className="text-action"
                      type="button"
                      onClick={(event) => onOpenInteraction(item, event.currentTarget)}
                    >
                      Edit interaction
                    </button>
                  )}
                </article>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
