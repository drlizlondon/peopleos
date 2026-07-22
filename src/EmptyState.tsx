import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description: string;
  note?: string;
  action?: ReactNode;
};

export default function EmptyState({ eyebrow, title, description, note, action }: Props) {
  return (
    <section className="empty-state" aria-labelledby="empty-state-title">
      <div className="empty-mark" aria-hidden="true"><span /><span /><span /></div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 id="empty-state-title">{title}</h2>
      <p className="empty-description">{description}</p>
      {note && <p className="empty-note">{note}</p>}
      {action && <div className="empty-action">{action}</div>}
    </section>
  );
}
