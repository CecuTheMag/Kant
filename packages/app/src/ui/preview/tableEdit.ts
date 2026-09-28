/**
 * The model behind the table editor: an immutable grid of strings plus the
 * operations the editor offers, and RFC 4180 serialisation that round-trips
 * through parseCsv. Pure — no DOM.
 */
import { parseCsv } from './csv';

export type Grid = string[][];

/** Past this many cells the editor gets sluggish on a phone; such files stay read-only. */
export const MAX_EDIT_CELLS = 20_000;
/** Bounds for parsing a file into the editor (beyond them it is not editable here). */
export const EDIT_LIMITS = { maxRows: 5_000, maxCols: 200, maxCellChars: 20_000 } as const;

/** Every row as wide as the widest, and never smaller than 1×1. */
export function normalizeGrid(rows: readonly (readonly string[])[]): Grid {
  const width = Math.max(1, ...rows.map(r => r.length));
  const out = rows.map(r => Array.from({ length: width }, (_, c) => r[c] ?? ''));
  return out.length ? out : [['']];
}

export function blankGrid(rows: number, cols: number): Grid {
  return Array.from({ length: Math.max(1, rows) }, () => new Array(Math.max(1, cols)).fill(''));
}

export function setCell(grid: Grid, row: number, col: number, value: string): Grid {
  if (grid[row]?.[col] === undefined || grid[row][col] === value) return grid;
  return grid.map((r, i) => (i === row ? r.map((v, j) => (j === col ? value : v)) : r));
}

export function insertRow(grid: Grid, at: number): Grid {
  const width = grid[0]?.length ?? 1;
  const i = Math.max(0, Math.min(at, grid.length));
  return [...grid.slice(0, i), new Array(width).fill(''), ...grid.slice(i)];
}

export function deleteRow(grid: Grid, at: number): Grid {
  if (grid.length <= 1) return [new Array(grid[0]?.length ?? 1).fill('')];
  return grid.filter((_, i) => i !== at);
}

export function insertColumn(grid: Grid, at: number): Grid {
  return grid.map(r => {
    const i = Math.max(0, Math.min(at, r.length));
    return [...r.slice(0, i), '', ...r.slice(i)];
  });
}

export function deleteColumn(grid: Grid, at: number): Grid {
  if ((grid[0]?.length ?? 0) <= 1) return grid.map(() => ['']);
  return grid.map(r => r.filter((_, j) => j !== at));
}

/** Move a row up or down by one; out-of-range moves are no-ops. */
export function moveRow(grid: Grid, from: number, to: number): Grid {
  if (from === to || from < 0 || to < 0 || from >= grid.length || to >= grid.length) return grid;
  const next = [...grid];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

/** Drop empty rows and columns from the end (never below 1×1) — a new table has spare ones. */
export function trimGrid(grid: Grid): Grid {
  let rows = grid.length;
  while (rows > 1 && grid[rows - 1].every(v => v === '')) rows--;
  let cols = grid[0]?.length ?? 1;
  while (cols > 1 && grid.slice(0, rows).every(r => (r[cols - 1] ?? '') === '')) cols--;
  return grid.slice(0, rows).map(r => r.slice(0, cols));
}

/**
 * Drop rows and columns the editor appended beyond the file's original size
 * that were left empty (Enter on the last row adds one). The file's own rows
 * and columns are kept exactly, empty or not.
 */
export function trimAdded(grid: Grid, originalRows: number, originalCols: number): Grid {
  let rows = grid.length;
  while (rows > Math.max(1, originalRows) && grid[rows - 1].every(v => v === '')) rows--;
  let cols = grid[0]?.length ?? 1;
  while (cols > Math.max(1, originalCols) && grid.slice(0, rows).every(r => (r[cols - 1] ?? '') === '')) cols--;
  return grid.slice(0, rows).map(r => r.slice(0, cols));
}

function quoteField(value: string, delimiter: string): string {
  const needs = value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
    || value !== value.trim();
  return needs ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180 text for a grid. Ends with a line break, as spreadsheet exports do. */
export function serializeCsv(grid: Grid, delimiter = ',', lineEnding: '\n' | '\r\n' = '\r\n'): string {
  return grid.map(row => row.map(v => quoteField(v, delimiter)).join(delimiter)).join(lineEnding) + lineEnding;
}

/** Keep the file's own line endings when writing it back. */
export function detectLineEnding(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n');
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

/** Tab for .tsv, otherwise comma; the parser detects `;` and `|` from content. */
export function delimiterForName(name: string): string {
  return /\.tsv$/i.test(name.trim()) ? '\t' : ',';
}

/** A, B, … Z, AA, AB … like every spreadsheet. */
export function columnLabel(index: number): string {
  let n = Math.max(0, Math.floor(index)) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export interface EditableTable {
  grid: Grid;
  delimiter: string;
  lineEnding: '\n' | '\r\n';
}

/**
 * Parse a file's full text for editing. Returns null when the file is bigger
 * than the editor handles — editing a silently truncated copy would lose data.
 */
export function tableForEditing(text: string, name: string, delimiterHint?: string): EditableTable | null {
  const parsed = parseCsv(text, { delimiter: delimiterHint, ...EDIT_LIMITS });
  if (parsed.truncatedRows || parsed.truncatedCols) return null;
  if (parsed.rows.some(r => r.some(v => v.length > EDIT_LIMITS.maxCellChars))) return null;
  const grid = normalizeGrid(parsed.rows);
  if (grid.length * grid[0].length > MAX_EDIT_CELLS) return null;
  return { grid, delimiter: parsed.delimiter || delimiterForName(name), lineEnding: detectLineEnding(text) };
}

/** Ensure a user-typed file name keeps a sensible extension. */
export function withExtension(name: string, ext: string): string {
  const trimmed = name.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').slice(0, 120) || 'Untitled';
  return new RegExp(`\\.${ext}$`, 'i').test(trimmed) || /\.[a-z0-9]{1,8}$/i.test(trimmed) ? trimmed : `${trimmed}.${ext}`;
}
