/**
 * Turn attachment bytes into previewable text. Pure — no DOM.
 *
 * Handles the byte-order marks real files carry (UTF-8, UTF-16 LE/BE), stops
 * at a character boundary when truncating, normalises line endings, and
 * refuses to "preview" binary data as a wall of replacement characters.
 */

export interface DecodedText {
  text: string;
  /** The input was longer than the limit; `text` covers only the start. */
  truncated: boolean;
  /** Looks like binary data — do not show `text`. */
  binary: boolean;
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
  /** The file's own line break (`text` always uses \n), so an edited copy can keep it. */
  lineEnding: '\n' | '\r\n';
  /** The file started with a byte-order mark (spreadsheet apps rely on it to read UTF-8). */
  bom: boolean;
}

const SNIFF_BYTES = 8192;

function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, SNIFF_BYTES);
  if (end === 0) return false;
  let control = 0;
  for (let i = 0; i < end; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    // C0 controls other than tab, LF, VT, FF, CR and ESC (ANSI colours in logs).
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 11 && b !== 12 && b !== 13 && b !== 27) control++;
  }
  return control / end > 0.1;
}

export function decodeTextPreview(bytes: Uint8Array, maxBytes: number): DecodedText {
  let encoding: DecodedText['encoding'] = 'utf-8';
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; start = 2; }
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; start = 2; }

  const body = bytes.subarray(start);
  // NUL bytes are normal in UTF-16, so only sniff UTF-8 input.
  if (encoding === 'utf-8' && looksBinary(body)) return { text: '', truncated: false, binary: true, encoding, lineEnding: '\n', bom: start > 0 };

  const truncated = body.length > maxBytes;
  let cut = Math.min(body.length, maxBytes);
  if (truncated) {
    if (encoding === 'utf-8') {
      // Step back off UTF-8 continuation bytes so the last character is whole.
      let back = 0;
      while (cut > 0 && back < 4 && (body[cut] & 0xc0) === 0x80) { cut--; back++; }
    } else {
      cut -= cut % 2;
      // Don't split a surrogate pair.
      const hi = encoding === 'utf-16le' ? body[cut - 1] : body[cut - 2];
      if (cut >= 2 && hi >= 0xd8 && hi <= 0xdb) cut -= 2;
    }
  }

  const raw = new TextDecoder(encoding, { fatal: false }).decode(body.subarray(0, cut));
  const firstBreak = raw.indexOf('\n');
  const lineEnding = firstBreak > 0 && raw[firstBreak - 1] === '\r' ? '\r\n' : '\n';
  return { text: raw.replace(/\r\n?/g, '\n'), truncated, binary: false, encoding, lineEnding, bom: start > 0 };
}
