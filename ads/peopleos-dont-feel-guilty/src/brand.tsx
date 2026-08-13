import type {CSSProperties, FC} from "react";

export const BRAND = {
  paper: "#ffffff",
  warmPaper: "#fffaf7",
  surfaceSoft: "#faf7f8",
  ink: "#171316",
  muted: "#6d6267",
  berry: "#ad315d",
  berryDark: "#7f173f",
  blush: "#fbf1f5",
  blushStrong: "#f2dbe4",
  gold: "#c7974f",
  line: "rgba(48, 29, 36, 0.13)"
} as const;

export const FONT = {
  display: 'Georgia, "Times New Roman", serif',
  interface: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
} as const;

export const PeopleOSMark: FC<{size?: number; style?: CSSProperties}> = ({size = 72, style}) => (
  <svg
    aria-label="PeopleOS"
    viewBox="0 0 512 512"
    style={{width: size, height: size, display: "block", flex: "none", ...style}}
  >
    <rect width="512" height="512" rx="112" fill="#A61E4D" />
    <circle cx="196" cy="204" r="68" fill="#C69750" />
    <circle cx="326" cy="204" r="68" fill="#FFF8F1" />
    <path d="M93 394c12-75 56-112 103-112s91 37 103 112" fill="#C69750" />
    <path d="M213 394c12-75 56-112 113-112s91 37 103 112" fill="#FFF8F1" />
  </svg>
);

export const BrandLockup: FC<{
  inverse?: boolean;
  size?: "small" | "large";
  style?: CSSProperties;
}> = ({inverse = false, size = "small", style}) => {
  const large = size === "large";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: large ? 26 : 15,
        color: inverse ? BRAND.paper : BRAND.ink,
        fontFamily: FONT.interface,
        fontSize: large ? 55 : 30,
        fontWeight: 790,
        letterSpacing: "-0.035em",
        ...style
      }}
    >
      <PeopleOSMark size={large ? 104 : 58} />
      <span>PeopleOS</span>
    </div>
  );
};
