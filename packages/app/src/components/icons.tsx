// Shared SVG icon set — no emoji-as-icons anywhere. Lucide-style strokes.
import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}

function base(props: IconProps) {
  const { size = 16, color = 'currentColor', strokeWidth = 2, style, className } = props;
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
    className,
  };
}

/** Rotating loading spinner (replaces the ⟳ character everywhere). */
export function Spinner({ size = 16, color, strokeWidth = 2.5, style }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth, style })} className="kant-spinner">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export function Eye({ size = 16, color, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOff({ size = 16, color, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function Alert({ size = 16, color, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Single check — sent. */
export function Check({ size = 14, color, strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Double check — delivered / read (read gets accent color from caller). */
export function DoubleCheck({ size = 14, color, strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <polyline points="18 7 7 18" />
      <polyline points="23 7 12 18" />
      <polyline points="1 12 4 15" />
    </svg>
  );
}

export function Clock({ size = 12, color, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function Image({ size = 16, color, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export function Search({ size = 16, color, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function X({ size = 14, color, strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function Plus({ size = 14, color, strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function Lock({ size = 14, color, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base({ size, color, strokeWidth })}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
