/**
 * RFC 4180 CSV parsing for the spreadsheet preview. Pure — no DOM.
 *
 * Quoted fields, doubled quotes, delimiters and newlines inside quotes, CRLF,
 * and an unterminated quote (the rest of the file becomes that field instead
 * of throwing) are all handled. The delimiter is detected, because European
 * spreadsheet exports use `;` and TSV uses tabs. Output is bounded so a huge
 * file cannot lock up the UI.
 */

export interface CsvTable {
  rows: string[][];
  /** Width of the widest parsed row (bounded by maxCols). */
  columns: number;
  truncatedRows: boolean;
  truncatedCols: boolean;
  delimiter: string;
}

export interface CsvOptions {
  delimiter?: string;
  maxRows: number;
  maxCols: number;
  maxCellChars: number;
}

const CANDIDATES = [',', ';', '\t', '|'];

/** Count each candidate per line (outside quotes) over the first lines; pick the most consistent. */
export function detectDelimiter(text: string): string {
  const counts = CANDIDATES.map(() => [] as number[]);
  let line = CANDIDATES.map(() => 0);
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 20 && i < 64 * 1024; i++) {
    const ch = text[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (inQuotes) continue;
    if (ch === '\n') {
      line.forEach((n, k) => counts[k].push(n));
      line = CANDIDATES.map(() => 0);
      lines++;
      continue;
    }
    const k = CANDIDATES.indexOf(ch);
    if (k >= 0) line[k]++;
  }
  if (line.some(n => n > 0)) line.forEach((n, k) => counts[k].push(n));

  let best = ',';
  let bestScore = 0;
  CANDIDATES.forEach((cand, k) => {
    const perLine = counts[k];
    if (!perLine.length) return;
    // Mode of the non-zero per-line counts.
    const freq = new Map<number, number>();
    for (const n of perLine) if (n > 0) freq.set(n, (freq.get(n) ?? 0) + 1);
    let mode = 0, modeFreq = 0;
    for (const [n, f] of freq) if (f > modeFreq || (f === modeFreq && n > mode)) { mode = n; modeFreq = f; }
    const score = modeFreq * 1000 + mode;
    if (score > bestScore) { best = cand; bestScore = score; }
  });
  return best;
}

export function parseCsv(text: string, options: CsvOptions): CsvTable {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let fieldChars = 0;
  let inQuotes = false;
  let truncatedCols = false;
  let truncatedRows = false;
  let columns = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const pushChar = (ch: string) => {
    if (fieldChars < options.maxCellChars) field += ch;
    fieldChars++;
  };
  const endField = () => {
    if (row.length < options.maxCols) {
      row.push(fieldChars > options.maxCellChars ? `${field}…` : field);
    } else {
      truncatedCols = true;
    }
    field = '';
    fieldChars = 0;
  };
  const endRow = (): boolean => {
    endField();
    // A lone trailing newline must not produce an extra empty row.
    if (!(row.length === 1 && row[0] === '')) {
      if (rows.length >= options.maxRows) { truncatedRows = true; return false; }
      rows.push(row);
      if (row.length > columns) columns = row.length;
    }
    row = [];
    return true;
  };

  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { pushChar('"'); i++; }
        else inQuotes = false;
      } else {
        pushChar(ch);
      }
      continue;
    }
    if (ch === '"' && fieldChars === 0) { inQuotes = true; continue; }
    if (ch === delimiter) { endField(); continue; }
    if (ch === '\r' && text[i + 1] === '\n') continue;
    if (ch === '\n' || ch === '\r') {
      if (!endRow()) break;
      continue;
    }
    pushChar(ch);
  }
  if (!truncatedRows && (fieldChars > 0 || row.length > 0)) endRow();

  return { rows, columns, truncatedRows, truncatedCols, delimiter };
}
