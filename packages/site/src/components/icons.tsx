import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function Svg({ size = 20, className, children, stroke = 1.7 }: IconProps & { children: ReactNode; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function IconChevron({ size = 14, className = "chev" }: IconProps) {
  return (
    <Svg size={size} className={className} stroke={2.2}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function IconCheck({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} className={className} stroke={2.6}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function IconX({ size = 12, className }: IconProps) {
  return (
    <Svg size={size} className={className} stroke={2.6}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconDownload({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className} stroke={2}>
      <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
    </Svg>
  );
}

export function IconLock({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </Svg>
  );
}

export function IconKey({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
    </Svg>
  );
}

export function IconChat({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M20 11.5a7.5 7.5 0 0 1-11.2 6.5L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5z" />
    </Svg>
  );
}

export function IconSend({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className} stroke={2.2}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  );
}

export function IconPhoneOff({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

export function IconUsers({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.3a6.5 6.5 0 0 1 3.5 5.7" />
    </Svg>
  );
}

export function IconGlobe({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </Svg>
  );
}

export function IconCode({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" />
    </Svg>
  );
}

export function IconShield({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z" />
      <path d="M8.8 12l2.2 2.2 4.2-4.4" />
    </Svg>
  );
}

export function IconNews({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 5.5h13v13a1.5 1.5 0 0 0 1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5v-13z" />
      <path d="M17 9h3v9.5a1.5 1.5 0 0 1-3 0M7.5 9h6M7.5 12.5h6M7.5 16h4" />
    </Svg>
  );
}

export function IconBuilding({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4.5 21V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15.5 5v16M15.5 9.5H18a1.5 1.5 0 0 1 1.5 1.5v10M3 21h18" />
      <path d="M8 7.5h1M11 7.5h1M8 11h1M11 11h1M8 14.5h1M11 14.5h1" />
    </Svg>
  );
}

export function IconBook({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13z" />
    </Svg>
  );
}

export function IconHeart({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10z" />
    </Svg>
  );
}

export function IconWifi({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.8 4.8 0 0 1 6.4 0" />
      <circle cx="12" cy="19.2" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconAndroid({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.87 3.24a11.4 11.4 0 0 0-9.82 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
    </svg>
  );
}

export function IconLinux({ size = 22, className }: IconProps) {
  return (
    <Svg size={size} className={className} stroke={1.7}>
      <path d="M12 2.8c-2.3 0-3.6 1.9-3.6 4.4 0 1.4.3 2.3-.6 3.7-1.2 1.8-2.8 3.6-2.8 6.1 0 1 .3 1.8.8 2.4M12 2.8c2.3 0 3.6 1.9 3.6 4.4 0 1.4-.3 2.3.6 3.7 1.2 1.8 2.8 3.6 2.8 6.1 0 1-.3 1.8-.8 2.4" />
      <path d="M4.5 18.2c.9-.4 2.1.2 2.6 1.2.5 1 .1 2-.9 2.3-1 .3-2.4-.3-2.9-1.2-.4-.9.3-1.9 1.2-2.3zM19.5 18.2c-.9-.4-2.1.2-2.6 1.2-.5 1 -.1 2 .9 2.3 1 .3 2.4-.3 2.9-1.2.4-.9-.3-1.9-1.2-2.3zM7.2 20.5h9.6" />
      <circle cx="10.4" cy="7" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="13.6" cy="7" r="0.6" fill="currentColor" stroke="none" />
      <path d="M10.6 9.2l1.4.8 1.4-.8" />
    </Svg>
  );
}

export function IconDiscord({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1a16.6 16.6 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.8 16.8a16.7 16.7 0 0 0 5 2.5l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.8 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5-2.5c.5-4.4-.8-8.2-2.9-11.5zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z" />
    </svg>
  );
}

export function IconGithub({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    </svg>
  );
}

export function IconFolder({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V7z" />
    </Svg>
  );
}

/* ── Technical icons used on the inner pages ── */

export function IconServer({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3.5" y="4" width="17" height="6.5" rx="2" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" />
      <circle cx="7.5" cy="7.25" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="16.75" r="0.8" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconEyeOff({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6 0 9.5 5.5 9.5 7a11 11 0 0 1-2.9 3.4M6.5 6.7C4 8.3 2.5 11 2.5 12c0 1.5 3.5 7 9.5 7 1.3 0 2.5-.2 3.6-.6" />
      <path d="M9.6 10a3.2 3.2 0 0 0 4.4 4.4" />
    </Svg>
  );
}

export function IconRadar({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12L18 6" />
    </Svg>
  );
}

export function IconActivity({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 12h4l2.5-7 4 14 2.5-7H21" />
    </Svg>
  );
}

export function IconLayers({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 3l8.5 4.5L12 12 3.5 7.5 12 3z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.8L12 21.3l8.5-4.5" />
    </Svg>
  );
}

export function IconGrid({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="4.5" r="1.6" />
      <circle cx="19.5" cy="8.7" r="1.6" />
      <circle cx="19.5" cy="15.3" r="1.6" />
      <circle cx="12" cy="19.5" r="1.6" />
      <circle cx="4.5" cy="15.3" r="1.6" />
      <circle cx="4.5" cy="8.7" r="1.6" />
      <path d="M12 4.5L19.5 8.7M19.5 8.7V15.3M19.5 15.3L12 19.5M12 19.5L4.5 15.3M4.5 15.3V8.7M4.5 8.7L12 4.5" />
    </Svg>
  );
}

export function IconRoute({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h6a4 4 0 0 1 4 4v0a4 4 0 0 0 4 4h-2" />
    </Svg>
  );
}

export function IconFile({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
    </Svg>
  );
}

export function IconOnion({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.2" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconTerminal({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </Svg>
  );
}
