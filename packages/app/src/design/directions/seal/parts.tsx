import { useId } from 'react';
import type { Contact, TrustState } from '../../core/types';
import { useStore } from '../../core/store';

/* ==================================================================== *
 * The wax seal — Direction B's signature.
 *
 * One object carries the entire trust state, physically:
 *
 *   none    — an unstamped impression. Faint, embossed, no wax. Reads as "not yet", not as
 *             "danger". Unverified is where every contact starts and must not look like a
 *             failure, or people learn to click past failures.
 *   intact  — pressed wax, colour and rim derived from the key, monogram in the middle.
 *   broken  — cracked in half, the two pieces separated and tilted.
 *
 * The reason this is worth doing: the reported failure mode of Signal's ceremony is that
 * success and failure look nearly the same at a glance and both flash past in a couple of
 * seconds, so people confirm on autopilot. A broken seal is not something you can mistake for
 * an intact one — it fails in shape, not just in colour, so it survives being glanced at,
 * being seen in peripheral vision, and being colour-blind.
 * ==================================================================== */

export function WaxSeal({
  hex,
  state,
  size = 44,
  animate = false,
}: {
  hex: string;
  state: TrustState;
  size?: number;
  animate?: boolean;
}) {
  const derived = useStore().identity(hex);
  const uid = useId().replace(/:/g, '');
  const r = 50;
  const cx = 60, cy = 60;

  const broken = state === 'changed';
  const intact = state === 'verified';

  /* Rim notches — the count and phase come from the key, so two different keys give visibly
     different silhouettes even before you read the colour. */
  const notches = Array.from({ length: derived?.seal.notches ?? 12 }, (_, i) => {
    const a = (i / (derived?.seal.notches ?? 12)) * Math.PI * 2 + ((derived?.seal.rotation ?? 0) * Math.PI) / 180;
    return {
      x1: cx + Math.cos(a) * (r - 3),
      y1: cy + Math.sin(a) * (r - 3),
      x2: cx + Math.cos(a) * (r + 5),
      y2: cy + Math.sin(a) * (r + 5),
    };
  });

  /*
   * The wax hue is derived from the key so every contact's seal is their own — but it is
   * clamped to 150–300° (green → teal → blue → violet). Red and orange are deliberately
   * unreachable: a broken seal is red, and an intact seal that happened to come out red would
   * destroy the one signal this whole direction rests on.
   */
  const hue = derived?.seal.hue ?? 210;
  const wax = intact ? `hsl(${hue} 42% 38%)` : broken ? 'var(--seal-broken)' : 'transparent';
  const waxDark = intact ? `hsl(${hue} 45% 28%)` : broken ? 'var(--wax-7)' : 'transparent';
  const ink = intact || broken ? 'rgba(255,255,255,0.9)' : 'var(--seal-none)';

  /* A jagged fracture down the middle, deterministic per key so a given contact's broken seal
     always breaks the same way. */
  const crack = `M 60 6 L ${58 + ((derived?.seal.mark ?? 0) % 3)} 30 L ${63 - ((derived?.seal.mark ?? 0) % 4)} 46 L 57 62 L ${64 - ((derived?.seal.mark ?? 0) % 3)} 80 L 59 96 L 61 114`;

  const body = (half?: 'l' | 'r') => (
    <g clipPath={half ? `url(#${uid}-${half})` : undefined}>
      {notches.map((n, i) => (
        <line key={i} x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} stroke={waxDark} strokeWidth={7} strokeLinecap="round" />
      ))}
      <circle cx={cx} cy={cy} r={r} fill={wax} stroke={waxDark} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={r - 9} fill="none" stroke={ink} strokeWidth={1.6} opacity={intact || broken ? 0.55 : 0.4} />
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={ink}
        style={{ fontFamily: 'Newsreader, Georgia, serif', fontSize: 30, letterSpacing: '0.02em' }}
      >
        {derived?.seal.monogram ?? ""}
      </text>
    </g>
  );

  if (state === 'unverified') {
    /* Unstamped: a debossed impression in the paper. No wax at all. */
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Not verified — no seal">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--rule-strong)" strokeWidth={2} strokeDasharray="5 6" />
        <circle cx={cx} cy={cy} r={r - 9} fill="none" stroke="var(--rule-strong)" strokeWidth={1.2} opacity={0.7} />
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--fg-faint)"
          style={{ fontFamily: 'Newsreader, Georgia, serif', fontSize: 30 }}
        >
          {derived?.seal.monogram ?? ""}
        </text>
      </svg>
    );
  }

  if (broken) {
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Key changed — seal broken">
        <defs>
          <clipPath id={`${uid}-l`}>
            <path d={`${crack} L 0 120 L 0 0 Z`} />
          </clipPath>
          <clipPath id={`${uid}-r`}>
            <path d={`${crack} L 120 120 L 120 0 Z`} />
          </clipPath>
        </defs>
        <g style={{ animation: 'seal-crack-l var(--dur-base) var(--ease-soft) both' }}>{body('l')}</g>
        <g style={{ animation: 'seal-crack-r var(--dur-base) var(--ease-soft) both' }}>{body('r')}</g>
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Verified — seal intact"
      className={animate ? 'anim-stamp' : undefined}
    >
      {body()}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

export const SEAL_COPY: Record<TrustState, { label: string; long: string }> = {
  verified: {
    label: 'Sealed',
    long: 'You compared words with this person and sealed them. The seal breaks by itself if their key ever changes.',
  },
  unverified: {
    label: 'Unsealed',
    long: 'You have not compared words yet. Messages are still encrypted — you just cannot prove who is on the other end.',
  },
  changed: {
    label: 'Seal broken',
    long: 'The key changed after you sealed this contact. It could be a new device. It could also be someone else.',
  },
};

export function SealBadge({ state }: { state: TrustState }) {
  const cls = state === 'verified' ? 'is-intact' : state === 'changed' ? 'is-broken' : 'is-none';
  return (
    <span className={`sealbadge ${cls}`} title={SEAL_COPY[state].long}>
      {SEAL_COPY[state].label}
    </span>
  );
}

/** Small seal + name, used in list rows and headers. */
export function Sender({ contact, size = 40 }: { contact: Contact; size?: number }) {
  return (
    <span className="sender">
      <WaxSeal hex={contact.publicKeyHex} state={contact.trust} size={size} />
      {contact.online && <span className="sender-here" role="img" aria-label="Online" />}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Words
 *
 * Same eight-word fingerprint as Direction A — the research doesn't change between design
 * languages. What changes is the presentation: here they're set as a line of verse rather
 * than a grid of chips, because you are meant to read them aloud to someone.
 * ------------------------------------------------------------------ */

export function Words({ words, compare }: { words: string[]; compare?: string[] | null }) {
  const other = compare ?? null;
  return (
    <div className="words">
      {words.map((w, i) => {
        const state = other ? (other[i] === w ? 'ok' : 'bad') : '';
        return (
          <span key={i} className={`word ${state}`}>
            <span className="word-n">{i + 1}</span>
            {w}
          </span>
        );
      })}
    </div>
  );
}
