/**
 * Icon set. Extends the library from the previous design pass (`components/icons.tsx`) —
 * same `{ size, color, strokeWidth }` API, same Lucide-style 24px stroke grid, so the
 * existing call sites keep working. Everything below the divider is new for this pass.
 *
 * Rule inherited and kept: no emoji as UI controls, anywhere.
 *
 * Naming trap carried over from the handoff: `Lock`, `Image` and `Search` collide with DOM
 * globals in some TS scopes — import as `Lock as LockIcon` etc. if TS2607 shows up.
 */
import type { CSSProperties, SVGProps } from 'react';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

function base({ size = 16, color = 'currentColor', strokeWidth = 2, style, className }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style,
    className,
    'aria-hidden': true,
    focusable: false,
  };
}

/* ---------- carried over from the previous pass ---------- */

export function Spinner({ size = 16, color, strokeWidth = 2.5, style }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth, style })} className="kant-spinner">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export const Eye = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOff = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export const Alert = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const Check = (p: IconProps) => (
  <svg {...base({ size: 14, strokeWidth: 2.5, ...p })}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const DoubleCheck = (p: IconProps) => (
  <svg {...base({ size: 14, strokeWidth: 2.5, ...p })}>
    <polyline points="18 7 7 18" />
    <polyline points="23 7 12 18" />
    <polyline points="1 12 4 15" />
  </svg>
);

export const Clock = (p: IconProps) => (
  <svg {...base({ size: 12, ...p })}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const Image = (p: IconProps) => (
  <svg {...base({ strokeWidth: 1.5, ...p })}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

export const Search = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const X = (p: IconProps) => (
  <svg {...base({ size: 14, strokeWidth: 2.5, ...p })}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const Plus = (p: IconProps) => (
  <svg {...base({ size: 14, strokeWidth: 2.5, ...p })}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const Lock = (p: IconProps) => (
  <svg {...base({ size: 14, ...p })}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/* ---------- new for this pass ---------- */

/** Trust: unverified. Deliberately a plain outline — unverified is the normal starting
 *  state, not a failure, and must not be styled like an alarm. */
export const Shield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const ShieldCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <polyline points="9 12 11 14 15.5 9.5" />
  </svg>
);

/** Trust: broken. The only icon in the set allowed to look alarming. */
export const ShieldAlert = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12.5" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export const Route = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="5" cy="6" r="2.5" />
    <circle cx="19" cy="18" r="2.5" />
    <path d="M7.5 6h5a3.5 3.5 0 0 1 0 7h-3a3.5 3.5 0 0 0 0 7h7" />
  </svg>
);

export const QR = (p: IconProps) => (
  <svg {...base({ strokeWidth: 1.7, ...p })}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 17v4" />
  </svg>
);

export const Copy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const Send = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);

export const Paperclip = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.18 5.18l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48" />
  </svg>
);

export const Users = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9.5" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16.5 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const Message = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.1A8.38 8.38 0 0 1 4 11.5a8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z" />
  </svg>
);

export const Settings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const ChevronDown = (p: IconProps) => (
  <svg {...base(p)}><polyline points="6 9 12 15 18 9" /></svg>
);

export const ChevronLeft = (p: IconProps) => (
  <svg {...base(p)}><polyline points="15 18 9 12 15 6" /></svg>
);

export const ChevronRight = (p: IconProps) => (
  <svg {...base(p)}><polyline points="9 18 15 12 9 6" /></svg>
);

export const Pin = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 17v5" />
    <path d="M9 2h6l-1 6 3.5 3.5V14H6.5v-2.5L10 8 9 2z" />
  </svg>
);

export const More = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /><circle cx="5" cy="12" r="1.4" />
  </svg>
);

export const Command = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z" />
  </svg>
);

export const Power = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

export const Trash = (p: IconProps) => (
  <svg {...base(p)}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const Download = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const Globe = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export const Refresh = (p: IconProps) => (
  <svg {...base(p)}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

export const ArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);
