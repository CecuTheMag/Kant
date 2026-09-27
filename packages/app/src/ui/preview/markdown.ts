/**
 * Markdown → a small, inert syntax tree. Pure — no DOM, no HTML strings.
 *
 * The renderer (Markdown.tsx) turns this tree into React elements, so nothing
 * a sender writes can become markup: raw HTML is shown as literal text, links
 * are kept only for http(s)/mailto (see isSafeExternalUrl), and images are
 * NEVER fetched — a remote image in a received file is a tracking pixel that
 * would reveal your IP address, so it is surfaced as a link you can choose to
 * open instead.
 *
 * Coverage is the CommonMark + GFM subset people actually write in notes and
 * READMEs: ATX/setext headings, paragraphs, hard breaks, emphasis, strong,
 * strikethrough, code spans, fenced and indented code, block quotes, bullet /
 * ordered / task lists with nesting, thematic breaks, pipe tables, links,
 * autolinks and entities. Nesting depth is bounded and every scan is linear or
 * memoised, so a hostile file cannot stall the UI.
 */
import { isSafeExternalUrl } from './sanitize';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'br' };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem { task?: boolean; checked?: boolean; c: Block[] }

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'para'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'hr' }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] };

export interface MarkdownOptions {
  /** Treat single newlines inside a paragraph as line breaks (chat style). Default false (document style). */
  breaks?: boolean;
}

const MAX_BLOCK_DEPTH = 8;
const MAX_INLINE_DEPTH = 12;
/** isSafeExternalUrl rejects anything longer, so scanning further is pointless. */
const MAX_LINK_DEST = 2048;

/* ── Block level ─────────────────────────────────────────────────────── */

const RE_BLANK = /^[ \t]*$/;
const RE_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const RE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_QUOTE = /^ {0,3}> ?/;
const RE_BULLET = /^( {0,3})([-*+])([ \t]+|$)/;
const RE_ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)/;
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RE_INDENTED = /^(?: {4}|\t)/;
const RE_TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Expand leading tabs to 4-column stops so indentation arithmetic is uniform. */
function expandIndent(line: string): string {
  let out = '';
  let col = 0;
  let i = 0;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') { out += ' '; col++; }
    else if (ch === '\t') { const n = 4 - (col % 4); out += ' '.repeat(n); col += n; }
    else break;
  }
  return out + line.slice(i);
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

interface ListMarker { ordered: boolean; bullet: string; delim: string; start: number; indent: number; contentIndent: number; rest: string }

function listMarker(line: string): ListMarker | null {
  let m = RE_BULLET.exec(line);
  if (m) {
    // "* * *" is a thematic break, not a list.
    if (RE_HR.test(line)) return null;
    const spaces = m[3].length;
    const pad = spaces >= 1 && spaces <= 4 ? spaces : 1;
    const markerEnd = m[1].length + 1;
    return { ordered: false, bullet: m[2], delim: '', start: 1, indent: m[1].length, contentIndent: markerEnd + pad, rest: line.slice(markerEnd + Math.min(spaces, pad)) };
  }
  m = RE_ORDERED.exec(line);
  if (m) {
    const spaces = m[4].length;
    const pad = spaces >= 1 && spaces <= 4 ? spaces : 1;
    const markerEnd = m[1].length + m[2].length + 1;
    return { ordered: true, bullet: '', delim: m[3], start: Number(m[2]), indent: m[1].length, contentIndent: markerEnd + pad, rest: line.slice(markerEnd + Math.min(spaces, pad)) };
  }
  return null;
}

function sameList(a: ListMarker, b: ListMarker): boolean {
  return a.ordered === b.ordered && (a.ordered ? a.delim === b.delim : a.bullet === b.bullet);
}

/** Split a table row into raw cell strings on unescaped pipes outside code spans. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let tick = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      if (tick === 0) tick = n; else if (tick === n) tick = 0;
      cur += s.slice(i, i + n);
      i += n - 1;
      continue;
    }
    if (ch === '|' && tick === 0) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function tableAlign(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** Can `line` interrupt a paragraph (and so end it)? */
function interruptsParagraph(line: string): boolean {
  if (RE_FENCE.test(line) || RE_ATX.test(line) || RE_HR.test(line) || RE_QUOTE.test(line)) return true;
  const marker = listMarker(line);
  // Per CommonMark an ordered list may only interrupt a paragraph when it starts at 1,
  // and an empty item never does — otherwise "in 2019. we…" would become a list.
  return !!marker && marker.rest.trim() !== '' && (!marker.ordered || marker.start === 1);
}

function parseBlocks(lines: string[], depth: number, opts: MarkdownOptions): Block[] {
  const blocks: Block[] = [];
  const containers = depth < MAX_BLOCK_DEPTH;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (RE_BLANK.test(line)) { i++; continue; }

    // Fenced code.
    let m = RE_FENCE.exec(line);
    if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
      const indent = m[1].length;
      const fence = m[2];
      const lang = m[3].trim().split(/\s+/)[0] ?? '';
      const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        const l = lines[i];
        body.push(l.slice(Math.min(indent, indentOf(l))));
        i++;
      }
      i++; // closing fence (or end of input)
      blocks.push({ t: 'code', lang: lang.slice(0, 32), v: body.join('\n') });
      continue;
    }

    // ATX heading.
    m = RE_ATX.exec(line);
    if (m) {
      blocks.push({ t: 'heading', level: m[1].length as 1, c: parseInline(m[2] ?? '', opts) });
      i++;
      continue;
    }

    if (RE_HR.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    // Block quote.
    if (containers && RE_QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (RE_QUOTE.test(l)) { inner.push(l.replace(RE_QUOTE, '')); i++; continue; }
        // Lazy continuation: plain text right after quoted paragraph text.
        if (!RE_BLANK.test(l) && inner.length && !RE_BLANK.test(inner[inner.length - 1]) && !interruptsParagraph(l)) {
          inner.push(l); i++; continue;
        }
        break;
      }
      blocks.push({ t: 'quote', c: parseBlocks(inner, depth + 1, opts) });
      continue;
    }

    // List.
    const first = containers ? listMarker(line) : null;
    if (first) {
      const items: ListItem[] = [];
      let marker: ListMarker | null = first;
      while (marker && sameList(first, marker)) {
        const itemLines = [marker.rest];
        const contentIndent: number = marker.contentIndent;
        i++;
        let sawBlank = false;
        while (i < lines.length) {
          const l = lines[i];
          if (RE_BLANK.test(l)) { itemLines.push(''); sawBlank = true; i++; continue; }
          if (indentOf(l) >= contentIndent) { itemLines.push(l.slice(contentIndent)); sawBlank = false; i++; continue; }
          // Lazy continuation of the item's paragraph.
          if (!sawBlank && !interruptsParagraph(l) && !listMarker(l)) { itemLines.push(l.trimStart()); i++; continue; }
          break;
        }
        while (itemLines.length && itemLines[itemLines.length - 1] === '') itemLines.pop();

        const item: ListItem = { c: [] };
        const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(itemLines[0] ?? '');
        if (task) {
          item.task = true;
          item.checked = task[1] !== ' ';
          itemLines[0] = itemLines[0].slice(task[0].length);
        }
        item.c = parseBlocks(itemLines, depth + 1, opts);
        items.push(item);

        if (i >= lines.length) break;
        // A blank line between items keeps the list going; anything else ends it.
        let j = i;
        while (j < lines.length && RE_BLANK.test(lines[j])) j++;
        const next = j < lines.length ? listMarker(lines[j]) : null;
        if (next && sameList(first, next) && next.indent < contentIndent + 4) { i = j; marker = next; }
        else marker = null;
      }
      blocks.push({ t: 'list', ordered: first.ordered, start: first.start, items });
      continue;
    }

    // Indented code (cannot interrupt a paragraph, so reaching here means it starts a block).
    if (RE_INDENTED.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (RE_INDENTED.test(lines[i]) || RE_BLANK.test(lines[i]))) {
        body.push(lines[i].replace(RE_INDENTED, ''));
        i++;
      }
      while (body.length && RE_BLANK.test(body[body.length - 1])) body.pop();
      blocks.push({ t: 'code', lang: '', v: body.join('\n') });
      continue;
    }

    // Pipe table: header row, then a delimiter row with the same number of cells.
    if (line.includes('|') && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1])) {
      const headCells = splitRow(line);
      const delimCells = splitRow(lines[i + 1]);
      if (headCells.length === delimCells.length) {
        const align = delimCells.map(tableAlign);
        const width = headCells.length;
        const rows: Inline[][][] = [];
        i += 2;
        while (i < lines.length && !RE_BLANK.test(lines[i]) && lines[i].includes('|') && !interruptsParagraph(lines[i])) {
          const cells = splitRow(lines[i]);
          const norm = Array.from({ length: width }, (_, k) => parseInline(cells[k] ?? '', opts));
          rows.push(norm);
          i++;
        }
        blocks.push({ t: 'table', align, head: headCells.map(c => parseInline(c, opts)), rows });
        continue;
      }
    }

    // Paragraph (possibly turned into a setext heading by its underline).
    const para: string[] = [line.trim()];
    i++;
    let setext: 1 | 2 | 0 = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (RE_BLANK.test(l)) break;
      const underline = RE_SETEXT.exec(l);
      if (underline) { setext = underline[1][0] === '=' ? 1 : 2; i++; break; }
      if (interruptsParagraph(l)) break;
      if (l.includes('|') && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1])) break;
      para.push(l.trimStart());
      i++;
    }
    const text = para.join('\n');
    blocks.push(setext ? { t: 'heading', level: setext, c: parseInline(text, opts) } : { t: 'para', c: parseInline(text, opts) });
  }
  return blocks;
}

export function parseMarkdown(src: string, opts: MarkdownOptions = {}): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\u0000/g, '\uFFFD').split('\n').map(expandIndent);
  return parseBlocks(lines, 0, opts);
}

/* ── Inline level ────────────────────────────────────────────────────── */

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const RE_WS = /\s/;
const RE_PUNCT = /[\p{P}\p{S}]/u;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', bull: '•', middot: '·', deg: '°', euro: '€',
};

function decodeEntity(match: string, body: string): string {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
    return String.fromCodePoint(code);
  }
  return NAMED_ENTITIES[body] ?? match;
}

const RE_ENTITY = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g;

interface InlineState {
  opts: MarkdownOptions;
  inLink: boolean;
}

/**
 * Per-string scanning helpers. Every lookup is memoised or precomputed so that
 * adversarial input (thousands of unmatched `[`, backticks or `*`) stays linear
 * instead of rescanning the rest of the string at every position.
 */
interface Scan {
  s: string;
  /** Per delimiter key, the position from which no valid closer exists. */
  noCloser: Map<string, number>;
  /** Per backtick-run length, the position from which no run of that length exists. */
  noTicks: Map<number, number>;
  /** For each `[`, the index of its matching `]` (or -1). Computed on first use. */
  brackets: Int32Array | null;
}

function scanOf(s: string): Scan {
  return { s, noCloser: new Map(), noTicks: new Map(), brackets: null };
}

export function parseInline(src: string, opts: MarkdownOptions = {}): Inline[] {
  return inline(src, 0, { opts, inLink: false });
}

/** Plain text of an inline tree (image alt text, accessible labels). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map(n => n.t === 'text' || n.t === 'code' ? n.v
    : n.t === 'br' ? '\n'
    : n.t === 'image' ? n.alt
    : inlineText(n.c)).join('');
}

function charClass(ch: string | undefined): 'ws' | 'punct' | 'other' {
  if (ch === undefined || RE_WS.test(ch)) return 'ws';
  return RE_PUNCT.test(ch) ? 'punct' : 'other';
}

/** CommonMark flanking rules for a delimiter run occupying [start, end). */
function flanking(s: string, start: number, end: number) {
  const before = charClass(start > 0 ? s[start - 1] : undefined);
  const after = charClass(end < s.length ? s[end] : undefined);
  const left = after !== 'ws' && (after !== 'punct' || before !== 'other');
  const right = before !== 'ws' && (before !== 'punct' || after !== 'other');
  return { left, right, before, after };
}

function canOpen(s: string, start: number, end: number): boolean {
  const f = flanking(s, start, end);
  if (s[start] === '_') return f.left && (!f.right || f.before === 'punct');
  return f.left;
}

function canClose(s: string, start: number, end: number): boolean {
  const f = flanking(s, start, end);
  if (s[start] === '_') return f.right && (!f.left || f.after === 'punct');
  return f.right;
}

function runLength(s: string, i: number): number {
  const ch = s[i];
  let n = 1;
  while (s[i + n] === ch) n++;
  return n;
}

/** Find the code span closer for a backtick run of length n, searching from `from`. */
function findBackticks(sc: Scan, from: number, n: number): number {
  const { s } = sc;
  const known = sc.noTicks.get(n);
  if (known !== undefined && from >= known) return -1;
  let i = s.indexOf('`', from);
  while (i >= 0) {
    const len = runLength(s, i);
    if (len === n) return i;
    i = s.indexOf('`', i + len);
  }
  sc.noTicks.set(n, Math.min(from, known ?? Infinity));
  return -1;
}

/** Match every `[` to its `]` in one pass, honouring escapes and code spans. */
function matchBrackets(sc: Scan): Int32Array {
  if (sc.brackets) return sc.brackets;
  const { s } = sc;
  const match = new Int32Array(s.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      const n = runLength(s, i);
      const close = findBackticks(sc, i + n, n);
      i = (close >= 0 ? close + n : i + n) - 1;
      continue;
    }
    if (c === '[') stack.push(i);
    else if (c === ']' && stack.length) match[stack.pop()!] = i;
  }
  sc.brackets = match;
  return match;
}

/**
 * Find a closing delimiter run for `ch` after `from`. `exact` requires the run to
 * be exactly `len` long; otherwise any closable run of at least `len` qualifies.
 * Code spans and escapes are skipped so `*a `*` b*` behaves.
 */
function findCloser(sc: Scan, from: number, ch: string, len: number, exact: boolean): number {
  const { s } = sc;
  const key = `${ch}${len}${exact ? '=' : '+'}`;
  const known = sc.noCloser.get(key);
  if (known !== undefined && from >= known) return -1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      const n = runLength(s, i);
      const close = findBackticks(sc, i + n, n);
      i = (close >= 0 ? close + n : i + n) - 1;
      continue;
    }
    if (c !== ch) continue;
    const n = runLength(s, i);
    if ((exact ? n === len : n >= len) && canClose(s, i, i + n)) return i;
    i += n - 1;
  }
  sc.noCloser.set(key, Math.min(from, known ?? Infinity));
  return -1;
}

/** Parse `[label](dest "title")` starting at the `[` at index i. */
function parseLinkAt(sc: Scan, i: number): { label: string; dest: string; end: number } | null {
  const { s } = sc;
  const j = matchBrackets(sc)[i];
  if (j < 0) return null;
  if (s[j + 1] !== '(') return null;
  const label = s.slice(i + 1, j);
  let k = j + 2;
  while (s[k] === ' ' || s[k] === '\t' || s[k] === '\n') k++;
  let dest = '';
  // Destinations and titles are length-bounded: an unterminated `[a](` repeated
  // thousands of times would otherwise rescan the rest of the input each time.
  if (s[k] === '<') {
    const close = s.indexOf('>', k);
    if (close < 0 || close - k > MAX_LINK_DEST) return null;
    dest = s.slice(k + 1, close);
    if (dest.includes('\n')) return null;
    k = close + 1;
  } else {
    let parens = 0;
    const startDest = k;
    const limit = Math.min(s.length, k + MAX_LINK_DEST);
    for (; k < limit; k++) {
      const c = s[k];
      if (c === '\\') { k++; continue; }
      if (c === '(') parens++;
      else if (c === ')') { if (parens === 0) break; parens--; }
      else if (RE_WS.test(c)) break;
    }
    dest = s.slice(startDest, k);
  }
  while (s[k] === ' ' || s[k] === '\t' || s[k] === '\n') k++;
  // Optional title — parsed so it doesn't break the link, then discarded.
  const q = s[k];
  if (q === '"' || q === "'" || q === '(') {
    const closeCh = q === '(' ? ')' : q;
    let t = k + 1;
    const limit = Math.min(s.length, k + MAX_LINK_DEST);
    for (; t < limit; t++) {
      if (s[t] === '\\') { t++; continue; }
      if (s[t] === closeCh) break;
    }
    if (t >= limit) return null;
    k = t + 1;
    while (s[k] === ' ' || s[k] === '\t' || s[k] === '\n') k++;
  }
  if (s[k] !== ')') return null;
  return { label, dest: dest.replace(/\\([!-/:-@[-`{-~])/g, '$1'), end: k + 1 };
}

const RE_AUTOLINK = /^<((?:https?|mailto):[^\s<>]*)>/i;
const RE_BARE_URL = /^https?:\/\/[^\s<]+/i;

/** GFM extended autolink: trim trailing punctuation and unbalanced closing parens. */
function trimBareUrl(url: string): string {
  let u = url.replace(/[?!.,:*_~'"]+$/, '');
  while (u.endsWith(')')) {
    const open = (u.match(/\(/g) ?? []).length;
    const close = (u.match(/\)/g) ?? []).length;
    if (close <= open) break;
    u = u.slice(0, -1).replace(/[?!.,:*_~'"]+$/, '');
  }
  return u;
}

function inline(s: string, depth: number, st: InlineState): Inline[] {
  const sc = scanOf(s);
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) { out.push({ t: 'text', v: text.replace(RE_ENTITY, decodeEntity) }); text = ''; }
  };
  if (depth > MAX_INLINE_DEPTH) return [{ t: 'text', v: s }];

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === '\\') {
      const next = s[i + 1];
      if (next === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }
      if (next !== undefined && ESCAPABLE.includes(next)) {
        // Escaped characters must not be entity-decoded later: flush around them.
        flush(); out.push({ t: 'text', v: next }); i++; continue;
      }
      text += ch;
      continue;
    }

    if (ch === '\n') {
      // Two+ trailing spaces before a newline are a hard break.
      if (text.endsWith('  ')) { text = text.replace(/ +$/, ''); flush(); out.push({ t: 'br' }); continue; }
      text = text.replace(/ +$/, '');
      if (st.opts.breaks) { flush(); out.push({ t: 'br' }); } else text += '\n';
      continue;
    }

    if (ch === '`') {
      const n = runLength(s, i);
      const close = findBackticks(sc, i + n, n);
      if (close < 0) { text += s.slice(i, i + n); i += n - 1; continue; }
      let code = s.slice(i + n, close).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      flush(); out.push({ t: 'code', v: code });
      i = close + n - 1;
      continue;
    }

    if (ch === '!' && s[i + 1] === '[') {
      const link = parseLinkAt(sc, i + 1);
      if (link) {
        flush();
        const alt = inlineText(inline(link.label, depth + 1, st));
        out.push({ t: 'image', src: isSafeExternalUrl(link.dest) ? link.dest : '', alt });
        i = link.end - 1;
        continue;
      }
    }

    if (ch === '[' && !st.inLink) {
      const link = parseLinkAt(sc, i);
      if (link) {
        flush();
        const children = inline(link.label, depth + 1, { ...st, inLink: true });
        if (isSafeExternalUrl(link.dest)) out.push({ t: 'link', href: link.dest, c: children });
        else out.push(...children);
        i = link.end - 1;
        continue;
      }
    }

    if (ch === '<') {
      const m = RE_AUTOLINK.exec(s.slice(i, i + 2100));
      if (m && !st.inLink && isSafeExternalUrl(m[1])) {
        flush(); out.push({ t: 'link', href: m[1], c: [{ t: 'text', v: m[1].replace(/^mailto:/i, '') }] });
        i += m[0].length - 1;
        continue;
      }
      text += ch;
      continue;
    }

    if ((ch === 'h' || ch === 'H') && !st.inLink && s.slice(i, i + 4).toLowerCase() === 'http'
      && (i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1]))) {
      const m = RE_BARE_URL.exec(s.slice(i, i + 2100));
      if (m) {
        const url = trimBareUrl(m[0]);
        if (isSafeExternalUrl(url)) {
          flush(); out.push({ t: 'link', href: url, c: [{ t: 'text', v: url }] });
          i += url.length - 1;
          continue;
        }
      }
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      const n = runLength(s, i);
      if (ch === '~') {
        if (n === 2 && canOpen(s, i, i + 2)) {
          const close = findCloser(sc, i + 2, '~', 2, true);
          if (close > i + 2) {
            flush();
            out.push({ t: 'del', c: inline(s.slice(i + 2, close), depth + 1, st) });
            i = close + 1;
            continue;
          }
        }
        text += s.slice(i, i + n); i += n - 1;
        continue;
      }
      if (canOpen(s, i, i + n)) {
        const use = Math.min(n, 3);
        let close = findCloser(sc, i + n, ch, use, true);
        if (close < 0) close = findCloser(sc, i + n, ch, use, false);
        if (close > i + n) {
          flush();
          // Surplus opener characters beyond `use` stay literal.
          if (n > use) out.push({ t: 'text', v: ch.repeat(n - use) });
          const inner = inline(s.slice(i + n, close), depth + 1, st);
          out.push(use === 1 ? { t: 'em', c: inner }
            : use === 2 ? { t: 'strong', c: inner }
            : { t: 'strong', c: [{ t: 'em', c: inner }] });
          // A longer closer run leaves its surplus in the input for later.
          i = close + use - 1;
          continue;
        }
      }
      text += s.slice(i, i + n); i += n - 1;
      continue;
    }

    text += ch;
  }
  flush();
  return out;
}
