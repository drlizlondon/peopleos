import type { ReactNode, SVGProps } from "react";

type IconName = "today" | "reach-out" | "people" | "upcoming" | "settings" | "plus";

const paths: Record<IconName, ReactNode> = {
  today: <path d="M12 21s-7-4.35-9.25-8.45C.83 9.05 2.1 5 6.4 5c2.18 0 3.38 1.25 4.1 2.35C11.22 6.25 12.42 5 14.6 5c4.3 0 5.57 4.05 3.65 7.55C16 16.65 9 21 9 21" transform="translate(1.5 0)" />,
  "reach-out": <><path d="M4 12h14"/><path d="m14 7 5 5-5 5"/><circle cx="5" cy="12" r="2"/></>,
  people: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6"/><path d="M15 15c3 0 4.5 1.6 5 4.5"/></>,
  upcoming: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="M8 15h3M8 18h6"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7L0 10.5v3l2 .7a7 7 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2h3l.7-2a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.7z" transform="translate(1.5 0) scale(.88)"/></>,
  plus: <path d="M12 5v14M5 12h14" />
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
