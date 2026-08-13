import type {FC} from "react";
import type {DayMomentKind} from "./config";

type IconProps = {kind: DayMomentKind; size?: number; color?: string};

export const DayIcon: FC<IconProps> = ({kind, size = 76, color = "currentColor"}) => {
  const common = {
    fill: "none",
    stroke: color,
    strokeWidth: 2.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  return (
    <svg viewBox="0 0 64 64" style={{width: size, height: size, display: "block"}}>
      {kind === "morning" && (
        <>
          <circle cx="32" cy="30" r="10" {...common} />
          <path d="M32 8v7M32 45v7M10 30h7M47 30h7M17 15l5 5M42 40l5 5M47 15l-5 5M22 40l-5 5" {...common} />
          <path d="M13 54h38" {...common} />
        </>
      )}
      {kind === "work" && (
        <>
          <rect x="10" y="13" width="44" height="31" rx="4" {...common} />
          <path d="M6 50h52M26 44l-3 6M38 44l3 6" {...common} />
          <path d="M20 25h8M20 32h18" {...common} />
        </>
      )}
      {kind === "errands" && (
        <>
          <path d="M17 22h30l4 34H13l4-34Z" {...common} />
          <path d="M24 23v-5a8 8 0 0 1 16 0v5" {...common} />
          <path d="M23 35h18M23 44h12" {...common} />
        </>
      )}
      {kind === "evening" && (
        <>
          <path d="M9 31 32 12l23 19" {...common} />
          <path d="M15 27v28h34V27" {...common} />
          <path d="M27 55V39h10v16" {...common} />
        </>
      )}
      {kind === "late" && (
        <>
          <path d="M45 44a20 20 0 1 1-19-31 21 21 0 0 0 19 31Z" {...common} />
          <path d="m47 13 1.5 4.5L53 19l-4.5 1.5L47 25l-1.5-4.5L41 19l4.5-1.5L47 13Z" {...common} />
        </>
      )}
    </svg>
  );
};

export const MessageIcon: FC<{size?: number; color?: string}> = ({size = 38, color = "currentColor"}) => (
  <svg viewBox="0 0 48 48" style={{width: size, height: size, display: "block"}}>
    <path d="M9 10h30a5 5 0 0 1 5 5v17a5 5 0 0 1-5 5H22L11 44v-7H9a5 5 0 0 1-5-5V15a5 5 0 0 1 5-5Z" fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
    <path d="M14 20h20M14 27h13" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const PhoneIcon: FC<{size?: number; color?: string}> = ({size = 38, color = "currentColor"}) => (
  <svg viewBox="0 0 48 48" style={{width: size, height: size, display: "block"}}>
    <path d="M15 6c2-1 5 7 6 10 .5 2-4 4-5 5 4 8 7 11 15 15 1-1 3-6 5-5 3 1 11 4 10 6-1 4-4 8-9 8C23 43 5 25 6 11c0-5 5-7 9-5Z" fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
  </svg>
);
