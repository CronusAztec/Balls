import type { ReactNode, SVGProps } from "react";

/*
 * --- site-redesign --- The interface icons: inline SVG on a 20 px grid, 1.5 px strokes in currentColor, decorative
 * (aria-hidden) – the control next to or around them carries the name. No emoji in the chrome: emoji are content only
 * (ball faces, caption text, the emoji picker).
 */

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Icon({ size = 20, children, className, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      {...rest}
    >
      {children}
    </svg>
  );
}

/* Transport */
export const IconPlay = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 4.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L7.4 4.1a.6.6 0 0 0-.9.5Z" fill="currentColor" />
  </Icon>
);
export const IconPause = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="4.5" width="3" height="11" rx="0.8" fill="currentColor" />
    <rect x="11.5" y="4.5" width="3" height="11" rx="0.8" fill="currentColor" />
  </Icon>
);
export const IconRestart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.6 10.4A5.5 5.5 0 1 0 6.3 5.9" />
    <path d="M4.5 3.5v3.3h3.3" />
  </Icon>
);
export const IconRecord = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="4.5" fill="currentColor" stroke="none" />
  </Icon>
);
export const IconStop = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);
export const IconBolt = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11.2 2.5 4.6 11h5l-.9 6.5 6.7-8.5h-5z" />
  </Icon>
);
export const IconTarget = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6" />
    <circle cx="10" cy="10" r="2" />
    <path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4" />
  </Icon>
);
export const IconLink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.3 11.7 11.7 8.3" />
    <path d="M9.3 5.6 10.6 4.3a3.3 3.3 0 0 1 4.7 4.7L14 10.3" />
    <path d="M10.7 14.4 9.4 15.7a3.3 3.3 0 0 1-4.7-4.7L6 9.7" />
  </Icon>
);

/* Navigation and actions */
export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.8" cy="8.8" r="5.3" />
    <path d="m12.8 12.8 3.7 3.7" />
  </Icon>
);
export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 5l10 10M15 5 5 15" />
  </Icon>
);
export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
  </Icon>
);
export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 8 4.5 4.5L14.5 8" />
  </Icon>
);
export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 5.5 4.5 4.5L8 14.5" />
  </Icon>
);
export const IconArrowLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.5 10h-11M9 5.5 4.5 10 9 14.5" />
  </Icon>
);
export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
  </Icon>
);
export const IconExternal = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 4.5h4.5V9M15.5 4.5 9.5 10.5" />
    <path d="M14.5 12.5v2a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 6 5.5h2" />
  </Icon>
);
export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5v9M6 8.8l4 4 4-4M4 16.5h12" />
  </Icon>
);
export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13V4M6 7.5l4-4 4 4M4 16.5h12" />
  </Icon>
);
export const IconCopy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
    <path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6a1.5 1.5 0 0 0 1.5 1.5H7" />
  </Icon>
);
export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);
export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);
export const IconMinus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10h11" />
  </Icon>
);
export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 9.2v4.3M10 6.6v.1" />
  </Icon>
);
export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5 17 16H3z" />
    <path d="M10 8.5v3.5M10 14v.1" />
  </Icon>
);
export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 10h7.4l.8-10" />
  </Icon>
);
export const IconReset = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 8.5A5.5 5.5 0 1 1 5.4 13" />
    <path d="M4.5 4.5v4h4" />
  </Icon>
);
export const IconFolder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2l1.6 1.8h6.2A1.5 1.5 0 0 1 17 8.3v6.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" />
  </Icon>
);
export const IconGlobe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M3 10h14M10 3c1.9 2 2.8 4.3 2.8 7s-.9 5-2.8 7c-1.9-2-2.8-4.3-2.8-7S8.1 5 10 3z" />
  </Icon>
);
export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
    <path d="M3.5 8.5h13M7 2.8v3.4M13 2.8v3.4" />
  </Icon>
);
export const IconFlame = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 17c2.9 0 5-2 5-4.9 0-3-2.2-4.3-3.4-7.1-.6 1.6-1.5 2.5-2.6 3-.6-1.6-.9-3.3-.5-5C5.6 5 5 8.5 5 12.1 5 15 7.1 17 10 17z" />
  </Icon>
);
export const IconKeyboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="15" height="10" rx="2" />
    <path d="M5.5 8h.1M8.5 8h.1M11.5 8h.1M14.5 8h.1M6.5 12h7" />
  </Icon>
);
export const IconSparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.8c.6 3.7 3.5 6.6 7.2 7.2-3.7.6-6.6 3.5-7.2 7.2-.6-3.7-3.5-6.6-7.2-7.2 3.7-.6 6.6-3.5 7.2-7.2z" />
  </Icon>
);
export const IconGrid = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="5" height="5" rx="1" />
    <rect x="11.5" y="3.5" width="5" height="5" rx="1" />
    <rect x="3.5" y="11.5" width="5" height="5" rx="1" />
    <rect x="11.5" y="11.5" width="5" height="5" rx="1" />
  </Icon>
);
export const IconSliders = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6h8.5M15.5 6h1M3.5 14h2M9 14h7.5" />
    <circle cx="13.7" cy="6" r="1.7" />
    <circle cx="7.3" cy="14" r="1.7" />
  </Icon>
);

/* The studio's control groups (rail) */
export const IconBall = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M4.4 7.2c3.6 1.6 7.6 1.6 11.2 0M5.2 14.4c3.1-1.9 6.5-1.9 9.6 0" />
  </Icon>
);
export const IconRings = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6" />
    <path d="M13.4 10a3.4 3.4 0 1 1-1-2.4" />
  </Icon>
);
export const IconWave = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10h1M6 7v6M9 4.5v11M12 6.5v7M15 8.5v3M17.5 10h-.5" />
  </Icon>
);
export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.5" cy="7.5" r="2.7" />
    <path d="M2.8 16c.6-2.6 2.4-4 4.7-4s4.1 1.4 4.7 4" />
    <path d="M12.8 5.2a2.6 2.6 0 0 1 0 4.8M14 12.2c1.6.4 2.8 1.7 3.2 3.8" />
  </Icon>
);
export const IconObstacle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5 16.5 16h-13z" />
    <path d="M6.6 11.5h6.8" />
  </Icon>
);
export const IconCaptions = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <path d="M5.5 12h4M11.5 12h3M5.5 9h9" />
  </Icon>
);
export const IconKeyframes = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 10h15" />
    <path d="M6 7.3 8.7 10 6 12.7 3.3 10z" />
    <path d="M14 7.3l2.7 2.7-2.7 2.7-2.7-2.7z" />
  </Icon>
);
export const IconSplit = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="2" />
    <path d="M10 4v12" />
  </Icon>
);
export const IconVideo = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="11" height="10" rx="2" />
    <path d="m13.5 8.6 4-2.1v7l-4-2.1" />
  </Icon>
);
export const IconBookmark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3.5h9v13l-4.5-3-4.5 3z" />
  </Icon>
);
export const IconDesktop = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
    <path d="M7 16.5h6M10 13.5v3" />
  </Icon>
);
