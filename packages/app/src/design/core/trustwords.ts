/**
 * Turning a 64-char hex public key into something a human can actually compare.
 *
 * Why: raw hex is the worst-performing fingerprint format in the literature. Word-based
 * encodings beat it on both attack-detection rate and usability (Dechand et al., USENIX
 * Security '16; Tan et al., CHI '17). Middle-of-string substitutions are the real threat —
 * people reliably check the first and last few characters and skim everything between — so
 * chunked words with equal visual weight per chunk are a genuine security improvement, not
 * decoration.
 *
 * Everything here is deterministic and pure: same key in, same words/glyph/seal out, on every
 * device. No storage, no network.
 *
 * PORTING NOTE: 256 words × 8 = 64 bits of fingerprint. That is fine for this prototype and
 * comparable to pEp's Trustwords (5 × 16 bits). If this ships, swap WORDS for a vetted list
 * (PGP biometric word list, or BIP-39's 2048) and re-derive — the API below does not change.
 */

const WORDS = `
anchor amber anvil apple arbor arrow aspen atlas atom aurora autumn azure bacon badge bamboo banjo
barley basil basin beacon beetle birch bishop bison blade blaze bloom bolt boulder bracket brass bravo
bread brick bridge bronze brook bugle bunker cabin cable cactus cadet camel candle canvas canyon carbon
cargo carpet castle cedar cello cement chalk chapel charm cheese cherry chess chili chorus cider cinema
circus citrus civic clamp clay cliff cloak clover cobalt cocoa comet compass copper coral cotton cougar
cousin coyote crane crater cricket crimson crown crystal cumin curfew cypress dagger dahlia dairy dapper dawn
decoy delta denim desert diesel digit dinner dolphin domain donor dragon drift drum duet dune dusk
eagle easel echo eclipse elbow elder ember emerald enamel engine envoy epic equal escape estate ether
exile fabric falcon fang feast fedora fern ferry fever fiber fiddle field filter finch fjord flame
flask fleet flint flora flute focus folio forest forge fossil frame frost fudge fusion gadget galaxy
gallon gamma garden garlic gasket gavel gecko geyser ghost ginger glacier glider globe glove gopher granite
gravel grotto guitar gutter gypsum hammer hangar harbor harvest hazel helium helmet hermit hickory hollow honey
hornet hostel hunter hurdle icon igloo indigo ingot iris iron ivory jacket jaguar jasmine jelly jersey
jetty jigsaw jockey jungle junior kayak kernel kettle kilo kiosk kitten koala ladder lagoon lantern lapis
larch laser lasso latch lattice laurel lava ledger legacy lemon lentil lever lilac linen lobby locket
lotus lumber lunar lynx magnet mammoth mango mantle maple marble marina marmot mason meadow medal melon
`
  .trim()
  .split(/\s+/);

/** Largest power of two that fits the list, so index extraction stays unbiased. */
const SIZE = 1 << Math.floor(Math.log2(WORDS.length));
const MASK = SIZE - 1;

/** FNV-1a, 32-bit. Deterministic, tiny, no dependencies. Not a security primitive — the key
 *  itself is already the security primitive; this only spreads it across the word list. */
function fnv1a(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A stream of 32-bit values derived from the key — one per requested chunk. */
function stream(hex: string, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(fnv1a(`${hex}:${i}`));
  return out;
}

/**
 * The spoken fingerprint. Eight words, rendered in two rows of four so each chunk carries
 * equal visual weight — that's what defends the middle of the string.
 */
export function keyWords(hex: string, count = 8): string[] {
  return stream(hex, count).map((h) => WORDS[h & MASK]);
}

/** `a1b2c3d4…9e0f` — for dense rows where the full key would dominate. Always monospaced. */
export function shortKey(hex: string, head = 8, tail = 4): string {
  if (hex.length <= head + tail) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** Hex in readable 4-char groups, for when the raw key is deliberately revealed. */
export function groupedKey(hex: string, group = 4): string {
  return (hex.match(new RegExp(`.{1,${group}}`, 'g')) ?? []).join(' ');
}

/* ------------------------------------------------------------------ *
 * Visual identity
 *
 * Two renderings of the same fact, one per design direction:
 *   glyph — Direction A. A 5×5 mirrored matrix. Reads as data.
 *   seal  — Direction B. A wax seal. Reads as an object that can be intact or broken.
 *
 * Both give a pre-attentive signal: you notice a wrong glyph or a wrong seal colour before
 * you've consciously read anything. That's the channel raw hex has none of.
 * ------------------------------------------------------------------ */

export interface KeyGlyph {
  /** 25 cells, column-mirrored so it reads as a face/mark rather than noise. */
  cells: boolean[];
  hue: number;
  hueAlt: number;
}

export function keyGlyph(hex: string): KeyGlyph {
  const s = stream(hex, 4);
  const cells: boolean[] = new Array(25).fill(false);
  // Fill the left three columns from the bit stream, then mirror to columns 4 and 5.
  const bits = (s[0] >>> 0).toString(2).padStart(32, '0') + (s[1] >>> 0).toString(2).padStart(32, '0');
  let b = 0;
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      const on = bits[b++] === '1';
      cells[row * 5 + col] = on;
      cells[row * 5 + (4 - col)] = on;
    }
  }
  return {
    cells,
    hue: s[2] % 360,
    hueAlt: (s[2] % 360 + 40 + (s[3] % 80)) % 360,
  };
}

export interface KeySeal {
  hue: number;
  /** Number of notches around the rim, 9–14. */
  notches: number;
  /** Inner emblem: which of the mark variants, and its rotation. */
  mark: number;
  rotation: number;
  /** Two initials-ish glyphs derived from the key, for the centre of the seal. */
  monogram: string;
}

const MONO_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O — confusable at seal scale

export function keySeal(hex: string): KeySeal {
  const s = stream(hex, 5);
  return {
    hue: s[0] % 360,
    notches: 9 + (s[1] % 6),
    mark: s[2] % 6,
    rotation: s[3] % 360,
    monogram: MONO_CHARS[s[4] % MONO_CHARS.length] + MONO_CHARS[(s[4] >>> 8) % MONO_CHARS.length],
  };
}

/**
 * Do two keys produce a visually confusable identity? Used only by the design-system page to
 * demonstrate that near-collisions look different — an honesty check on the glyph, since a
 * visual fingerprint that collides easily is worse than none at all.
 */
export function glyphSignature(hex: string): string {
  const g = keyGlyph(hex);
  return g.cells.map((c) => (c ? '1' : '0')).join('') + ':' + Math.round(g.hue / 30);
}
