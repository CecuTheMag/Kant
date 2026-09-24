/**
 * Key fingerprints, done properly.
 *
 * This replaces the FNV-1a placeholder the first prototype shipped. Two things were wrong
 * with that, and both are fixed here:
 *
 *  1. FNV is not a cryptographic hash. Someone able to grind keypairs could find one that
 *     produces the same words. The fingerprint now runs an iterated SHA-512.
 *
 *  2. It derived from ONE key, so each side saw a different word list — two lists, two
 *     comparisons. That is the pre-2016 Signal design, abandoned because it doesn't map onto
 *     what a person is actually trying to do. `pairFingerprint` derives from BOTH identity
 *     keys, sorted, so both devices display the SAME eight words and the ceremony collapses
 *     to one question: do we see the same words?
 *
 * WebCrypto is preferred, but it is unavailable in some insecure LAN browser contexts.
 * libsodium provides an equivalent SHA-512 fallback so the fingerprint is deterministic on
 * every supported surface. The choice of implementation does not affect the output.
 *
 * ITERATIONS follows Signal's 5200. Its purpose is to make offline grinding of a colliding
 * identity key expensive, not to protect a secret — there is no secret here, the inputs are
 * both public keys.
 */

import { BITS_PER_WORD, WORDS } from './wordlist';

const ITERATIONS = 5200;
const DIGEST = 'SHA-512';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
    throw new Error('fingerprint: expected hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function sha512(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest(DIGEST, bytes as unknown as BufferSource);
    return new Uint8Array(buf);
  }

  const mod = await import('libsodium-wrappers-sumo');
  const sodium = (mod as any).default ?? mod;
  await sodium.ready;
  return new Uint8Array(sodium.crypto_hash_sha512(bytes));
}

/**
 * Iterated hash, Signal-style: each round re-feeds the original key material alongside the
 * running digest, so the work can't be shortcut by precomputing a chain.
 */
async function slowHash(seed: Uint8Array, keyMaterial: Uint8Array): Promise<Uint8Array> {
  let d = seed;
  for (let i = 0; i < ITERATIONS; i++) d = await sha512(concat(d, keyMaterial));
  return d;
}

/** Big-endian bit reader — 11 bits per word, unbiased because 2048 is a power of two. */
function wordsFromDigest(digest: Uint8Array, count: number): string[] {
  const out: string[] = [];
  let bitPos = 0;
  for (let w = 0; w < count; w++) {
    let value = 0;
    for (let b = 0; b < BITS_PER_WORD; b++) {
      const byte = digest[(bitPos >> 3) % digest.length];
      const bit = (byte >> (7 - (bitPos & 7))) & 1;
      value = (value << 1) | bit;
      bitPos++;
    }
    out.push(WORDS[value]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The two fingerprints
 * ------------------------------------------------------------------ */

/**
 * THE CEREMONY FINGERPRINT. Symmetric in the two identity keys — sorting them before hashing
 * is what makes both sides compute the same value without exchanging anything.
 *
 * PORTING NOTE: `a` and `b` must be the long-term Ed25519 IDENTITY keys. Never a signed
 * prekey, never a one-time prekey, never anything the Double Ratchet touches — those rotate
 * constantly and the fingerprint would churn, which turns the whole trust system into noise.
 */
export async function pairWords(aHex: string, bHex: string, count = 8): Promise<string[]> {
  const [lo, hi] = [aHex.toLowerCase(), bHex.toLowerCase()].sort();
  const material = concat(hexToBytes(lo), hexToBytes(hi));
  const digest = await slowHash(material, material);
  return wordsFromDigest(digest, count);
}

/**
 * A single key rendered as words, for SHARING — "here is my key, written so you can read it
 * aloud". This is not the ceremony value and the UI must not present it as one: it identifies
 * one party, it does not authenticate a conversation.
 */
export async function keyWordsAsync(hex: string, count = 8): Promise<string[]> {
  const material = hexToBytes(hex);
  const digest = await slowHash(material, material);
  return wordsFromDigest(digest, count);
}

/* ------------------------------------------------------------------ *
 * Visual identity, derived from the same cryptographic digest
 *
 * The glyph and the seal are security signals too — they're what makes a wrong contact
 * noticeable before you've read anything — so they must not be cheap to grind either. Both
 * are now derived from the slow digest rather than from a fast non-cryptographic hash.
 * ------------------------------------------------------------------ */

export interface Identity {
  hex: string;
  /** This key written as words, for sharing. NOT the ceremony value. */
  words: string[];
  /** 25 cells, column-mirrored. Direction A. */
  cells: boolean[];
  hue: number;
  hueAlt: number;
  /** Direction B — wax seal parameters. */
  seal: { hue: number; notches: number; mark: number; rotation: number; monogram: string };
}

const MONO_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O — confusable at seal scale

export async function deriveIdentity(hex: string): Promise<Identity> {
  const material = hexToBytes(hex);
  const digest = await slowHash(material, material);

  const cells: boolean[] = new Array(25).fill(false);
  let bit = 0;
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      const byte = digest[(bit >> 3) % digest.length];
      const on = ((byte >> (7 - (bit & 7))) & 1) === 1;
      bit++;
      cells[row * 5 + col] = on;
      cells[row * 5 + (4 - col)] = on;
    }
  }

  const at = (i: number) => digest[i % digest.length];

  return {
    hex,
    words: wordsFromDigest(digest, 8),
    cells,
    hue: (at(40) * 360) / 256,
    hueAlt: ((at(41) * 360) / 256 + 40) % 360,
    seal: {
      /* Clamped to 150–300° (green → violet). Red and orange are unreachable on purpose:
         a broken seal is red, and an intact seal that came out red would destroy the one
         signal Direction B rests on. */
      hue: 150 + Math.floor((at(42) / 256) * 150),
      notches: 9 + (at(43) % 6),
      mark: at(44) % 6,
      rotation: at(45) % 360,
      monogram: MONO_CHARS[at(46) % MONO_CHARS.length] + MONO_CHARS[at(47) % MONO_CHARS.length],
    },
  };
}

/* ------------------------------------------------------------------ *
 * Display helpers (pure string formatting, no crypto)
 * ------------------------------------------------------------------ */

export function shortKey(hex: string, head = 8, tail = 4): string {
  return hex.length <= head + tail ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function groupedKey(hex: string, group = 4): string {
  return (hex.match(new RegExp(`.{1,${group}}`, 'g')) ?? []).join(' ');
}
