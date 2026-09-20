type IconProps = { size?: number };

const base = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconServer({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <circle cx="7" cy="7" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="7" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconEyeOff({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6 0 9.5 5.5 9.5 7a11 11 0 0 1-2.9 3.4M6.5 6.7C4 8.3 2.5 11 2.5 12c0 1.5 3.5 7 9.5 7 1.3 0 2.5-.2 3.6-.6" />
      <path d="M9.6 10a3.2 3.2 0 0 0 4.4 4.4" />
    </svg>
  );
}

export function IconRadar({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12L18 6" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconActivity({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 12h4l2.5-7 4 14 2.5-7H21" />
    </svg>
  );
}

export function IconLayers({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 3l8.5 4.5L12 12 3.5 7.5 12 3z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.8L12 21.3l8.5-4.5" />
    </svg>
  );
}

export function IconLock({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
      <circle cx="12" cy="15.3" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconGrid({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="4.5" r="1.6" />
      <circle cx="19.5" cy="8.7" r="1.6" />
      <circle cx="19.5" cy="15.3" r="1.6" />
      <circle cx="12" cy="19.5" r="1.6" />
      <circle cx="4.5" cy="15.3" r="1.6" />
      <circle cx="4.5" cy="8.7" r="1.6" />
      <path d="M12 4.5L19.5 8.7M19.5 8.7V15.3M19.5 15.3L12 19.5M12 19.5L4.5 15.3M4.5 15.3V8.7M4.5 8.7L12 4.5" />
    </svg>
  );
}

export function IconRoute({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h6a4 4 0 0 1 4 4v0a4 4 0 0 0 4 4h-2" />
    </svg>
  );
}

export function IconFile({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function IconOnion({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.2" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTerminal({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  );
}
