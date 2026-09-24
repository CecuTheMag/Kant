/**
 * Icon set — one stroke weight, rounded caps, drawn on a 24px grid so they sit
 * next to system text the way SF Symbols do. Decorative by default
 * (aria-hidden); the control that wraps an icon carries the label.
 */
import type { CSSProperties, ReactNode } from 'react';

export interface IconProps { size?: number; stroke?: number; style?: CSSProperties; className?: string }

function Svg({ size = 22, stroke = 1.9, style, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style} className={className}>
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => <Svg stroke={2.4} {...p}><path d="M15 5l-7 7 7 7" /></Svg>;
export const ChevronRight = (p: IconProps) => <Svg size={14} stroke={2.4} {...p}><path d="M9 5l7 7-7 7" /></Svg>;
export const Close = (p: IconProps) => <Svg stroke={2.2} {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const Plus = (p: IconProps) => <Svg stroke={2.2} {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const Check = (p: IconProps) => <Svg stroke={2.4} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
export const CheckDouble = (p: IconProps) => <Svg stroke={2.2} {...p}><path d="M2.5 12.5l4.5 4.5L16.5 7.5M11.5 16.5l.5.5 9.5-9.5" /></Svg>;
export const Compose = (p: IconProps) => (
  <Svg {...p}><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" /><path d="M17.8 3.7a2 2 0 0 1 2.5 2.5L12 14.5l-3.5 1 1-3.5z" /></Svg>
);
export const Search = (p: IconProps) => <Svg stroke={2.2} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>;
export const Lock = (p: IconProps) => <Svg {...p}><rect x="5" y="10.5" width="14" height="10" rx="2.6" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></Svg>;
export const LockFill = ({ size = 22, style, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={style} className={className}>
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10h.5A2.5 2.5 0 0 1 19 12.5v6a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-6A2.5 2.5 0 0 1 7.5 10zm1.8 0h4.4V7.5a2.2 2.2 0 0 0-4.4 0z" />
  </svg>
);
export const Shield = (p: IconProps) => <Svg {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /></Svg>;
export const ShieldCheck = (p: IconProps) => <Svg {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12l2.2 2.2 4.2-4.4" /></Svg>;
export const ShieldAlert = (p: IconProps) => <Svg {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M12 8.5v4M12 15.8v.2" /></Svg>;
export const VerifiedSeal = ({ size = 16, style, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style} className={className}>
    <path fill="currentColor" d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-.9 2.8.9 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7.9-2.8-.9-2.8 2.5-1.7.9-2.9 3 .2z" />
    <path d="M8.5 12.2l2.4 2.3 4.6-4.9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const QR = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="4" width="6" height="6" rx="1.2" /><rect x="14" y="4" width="6" height="6" rx="1.2" /><rect x="4" y="14" width="6" height="6" rx="1.2" /><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h.01M20 14h.01" /></Svg>
);
export const Scan = (p: IconProps) => <Svg {...p}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10" /></Svg>;
export const Link = (p: IconProps) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.3 1.3" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.3-1.3" /></Svg>;
export const Copy = (p: IconProps) => <Svg {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2.4" /><path d="M15.5 8.5V6.9A2.4 2.4 0 0 0 13.1 4.5H6.9A2.4 2.4 0 0 0 4.5 6.9v6.2a2.4 2.4 0 0 0 2.4 2.4h1.6" /></Svg>;
export const Share = (p: IconProps) => <Svg {...p}><path d="M12 3.5v11M8 7.5l4-4 4 4" /><path d="M8 11H6.5A2 2 0 0 0 4.5 13v5.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13a2 2 0 0 0-2-2H16" /></Svg>;
export const ArrowUp = (p: IconProps) => <Svg stroke={2.6} {...p}><path d="M12 19V5.5M6 11l6-6 6 6" /></Svg>;
export const Paperclip = (p: IconProps) => <Svg {...p}><path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" /></Svg>;
export const Photo = (p: IconProps) => <Svg {...p}><rect x="3.5" y="5" width="17" height="14" rx="2.6" /><circle cx="9" cy="10" r="1.7" /><path d="M20.5 16l-4.5-4.5-8.5 7.5" /></Svg>;
export const Doc = (p: IconProps) => <Svg {...p}><path d="M7 3.5h6.5l4.5 4.5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13.5a2 2 0 0 1 2-2z" /><path d="M13.5 3.5V8H18" /></Svg>;
export const Download = (p: IconProps) => <Svg stroke={2.1} {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" /></Svg>;
export const Person = (p: IconProps) => <Svg {...p}><circle cx="12" cy="8" r="3.8" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></Svg>;
export const PersonAdd = (p: IconProps) => <Svg {...p}><circle cx="10" cy="8" r="3.8" /><path d="M3 20a7 7 0 0 1 12.2-4.7M19 14v6M16 17h6" /></Svg>;
export const People = (p: IconProps) => <Svg {...p}><circle cx="9" cy="8" r="3.4" /><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0" /><path d="M16 4.8a3.4 3.4 0 0 1 0 6.4M18 13.8a6.5 6.5 0 0 1 3.5 5.7" /></Svg>;
export const Bubble = (p: IconProps) => <Svg {...p}><path d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1.1 0-2.2-.2-3.1-.6L4 19.5l1.3-3.6A7.2 7.2 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5z" /></Svg>;
export const Gear = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>
);
export const Globe = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z" /></Svg>;
export const Onion = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></Svg>;
export const Bell = (p: IconProps) => <Svg {...p}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Svg>;
export const Moon = (p: IconProps) => <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Svg>;
export const Info = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></Svg>;
export const Trash = (p: IconProps) => <Svg {...p}><path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 11.6A2 2 0 0 0 9.3 20.5h5.4a2 2 0 0 0 2-1.9L17.5 7" /></Svg>;
export const Block = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></Svg>;
export const Pencil = (p: IconProps) => <Svg {...p}><path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z" /></Svg>;
export const Leave = (p: IconProps) => <Svg {...p}><path d="M14 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7M10 12h10M17 8.5l3.5 3.5-3.5 3.5" /></Svg>;
export const Wave = (p: IconProps) => <Svg {...p}><path d="M3 12h3l2.5-6 4 12 3-9 2 3H21" /></Svg>;
export const Refresh = (p: IconProps) => <Svg {...p}><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" /></Svg>;
export const Eye = (p: IconProps) => <Svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const EyeOff = (p: IconProps) => <Svg {...p}><path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Svg>;
export const Alert = (p: IconProps) => <Svg {...p}><path d="M10.3 4.3L2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 16.8v.2" /></Svg>;
export const Clock = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
export const Reply = (p: IconProps) => <Svg {...p}><path d="M9.5 6.5L4 12l5.5 5.5" /><path d="M4.5 12H14a6 6 0 0 1 6 6v1" /></Svg>;
export const More = ({ size = 20, style, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={style} className={className}>
    <circle cx="5.5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18.5" cy="12" r="1.8" />
  </svg>
);
export const Key = (p: IconProps) => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></Svg>;
export const Camera = (p: IconProps) => <Svg {...p}><path d="M4 8.5A2 2 0 0 1 6 6.5h1.8l1.5-2h5.4l1.5 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.4" /></Svg>;

export function Spinner({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
      strokeLinecap="round" aria-hidden="true" style={style} className={`k-spin ${className ?? ''}`}>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  );
}
