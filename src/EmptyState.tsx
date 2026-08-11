import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description: string;
  note?: string;
  action?: ReactNode;
  mark?: "default" | "check";
};

export default function EmptyState({ eyebrow, title, description, note, action, mark = "default" }: Props) {
  return (
    <section className={`empty-state${mark === "check" ? " empty-state-complete" : ""}`} aria-labelledby="empty-state-title">
      {mark === "check"
        ? <div className="empty-check" aria-hidden="true">✓</div>
        : <div className="empty-mark" aria-hidden="true"><span /><span /><span /></div>}
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 id="empty-state-title">{title}</h2>
      <p className="empty-description">{description}</p>
      {note && <p className="empty-note">{note}</p>}
      {action && <div className="empty-action">{action}</div>}
    </section>
  );
}
