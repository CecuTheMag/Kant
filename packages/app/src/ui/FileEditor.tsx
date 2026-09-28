/**
 * Edit a table or a text file, then send the new version into the chat or
 * save a copy. Also used to create a new table or document from scratch.
 *
 * Everything stays in memory: the edited copy becomes an ordinary encrypted
 * attachment when sent, and the original message is never modified — the
 * other side sees the new version arrive as its own file.
 *
 * The table renders cells as plain text and turns only the active cell into
 * an editor, the way spreadsheets do, so a few thousand cells stay smooth on
 * a phone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useStore } from './core/store';
import { Alert, ArrowUp, Check, ChevronUp, Download, Plus, Redo, Spinner, Trash, Undo } from './icons';
import { Confirm, Menu, Segmented, Sheet, SheetHead, useToast } from './parts';
import type { MenuItem } from './parts';
import { Markdown } from './preview/Markdown';
import { parseMarkdown } from './preview/markdown';
import type { Block } from './preview/markdown';
import { PREVIEW_LIMITS } from './preview/fileKind';
import {
  columnLabel, deleteColumn, deleteRow, insertColumn, insertRow, moveRow, serializeCsv, setCell, trimAdded, trimGrid, withExtension,
} from './preview/tableEdit';
import type { Grid } from './preview/tableEdit';

export type TextFlavor = 'markdown' | 'json' | 'code' | 'text' | 'csv';

/** `lineEnding` and `bom` describe the original file, so the edited copy is written the same way. */
export type EditorSource =
  | { kind: 'table'; grid: Grid; delimiter: string; lineEnding: '\n' | '\r\n'; bom?: boolean }
  | { kind: 'text'; text: string; flavor: TextFlavor; lineEnding?: '\n' | '\r\n'; bom?: boolean };

const MIME_BY_EXT: Record<string, string> = {
  csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', markdown: 'text/markdown',
  json: 'application/json', txt: 'text/plain', html: 'text/html', xml: 'application/xml',
};

function mimeFor(name: string, fallback: string): string {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return MIME_BY_EXT[ext] ?? fallback;
}

function defaultExt(source: EditorSource): string {
  if (source.kind === 'table') return source.delimiter === '\t' ? 'tsv' : 'csv';
  return source.flavor === 'markdown' ? 'md' : source.flavor === 'json' ? 'json' : source.flavor === 'csv' ? 'csv' : 'txt';
}

export function FileEditor({ source, name: initialName, mime: originalMime, title, isNew, onSend, onClose }: {
  source: EditorSource;
  name: string;
  mime?: string;
  title: string;
  isNew?: boolean;
  /** Send the edited copy into the current chat. Absent when there is nowhere to send (read-only chat). */
  onSend?: (file: File) => void;
  onClose: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [grid, setGrid] = useState<Grid | null>(source.kind === 'table' ? source.grid : null);
  const [text, setText] = useState(source.kind === 'text' ? source.text : '');
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const initial = useRef({ grid: source.kind === 'table' ? source.grid : null, text: source.kind === 'text' ? source.text : '', name: initialName });

  const dirty = (grid !== null ? grid !== initial.current.grid : text !== initial.current.text) || name !== initial.current.name;
  const hasContent = grid !== null ? grid.some(r => r.some(v => v !== '')) : text.length > 0;

  const build = useCallback((): File => {
    const ext = defaultExt(source);
    const fileName = withExtension(name, ext);
    let body: string;
    if (grid !== null && source.kind === 'table') {
      const out = isNew ? trimGrid(grid) : trimAdded(grid, source.grid.length, source.grid[0]?.length ?? 1);
      body = serializeCsv(out, source.delimiter, source.lineEnding);
    } else {
      // Text areas always use \n; write the file's own line breaks back.
      body = source.kind === 'text' && source.lineEnding === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
    }
    if (source.bom) body = `\uFEFF${body}`;
    const type = mimeFor(fileName, originalMime && !originalMime.startsWith('application/octet') ? originalMime : 'text/plain');
    return new File([body], fileName, { type });
  }, [grid, text, name, source, isNew, originalMime]);

  const send = () => {
    if (!onSend || !hasContent) return;
    onSend(build());
    toast(isNew ? 'Sent' : 'Edited copy sent', <Check size={18} />);
    onClose();
  };

  const saveCopy = async () => {
    setSaving(true);
    try {
      const file = build();
      const ok = await store.saveFile(file.name, file.type, new Uint8Array(await file.arrayBuffer()));
      toast(ok ? 'Saved' : 'Couldn’t save the file', ok ? <Check size={18} /> : <Alert size={18} />);
    } finally { setSaving(false); }
  };

  const requestClose = () => { if (dirty && hasContent) setConfirmClose(true); else onClose(); };

  // Ctrl/⌘+Enter sends, Ctrl/⌘+S saves a copy.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); send(); }
    else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); void saveCopy(); }
  };

  return (
    <Sheet onClose={requestClose} label={title} tall>
      <div className="k-editor" onKeyDown={onKeyDown}>
        <SheetHead
          left={<button type="button" className="k-btn k-btn-plain" onClick={requestClose}>Cancel</button>}
          title={title}
          right={onSend ? (
            <button type="button" className="k-btn k-btn-primary k-btn-sm k-editor-send" onClick={send} disabled={!hasContent || (!dirty && !isNew)}>
              <ArrowUp size={15} /> Send
            </button>
          ) : undefined}
        />
        <div className="k-editor-meta">
          <label className="k-editor-name">
            <span className="k-sr">File name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} spellCheck={false}
              aria-label="File name" onBlur={() => setName(n => withExtension(n, defaultExt(source)))} />
          </label>
          <button type="button" className="k-icon-btn" onClick={() => void saveCopy()} disabled={saving || !hasContent} aria-label="Save a copy to this device">
            {saving ? <Spinner size={18} /> : <Download size={20} />}
          </button>
        </div>
        {grid !== null
          ? <TableEditor grid={grid} onChange={setGrid} autoFocusFirst={isNew} />
          : <TextEditor text={text} onChange={setText} flavor={source.kind === 'text' ? source.flavor : 'text'} />}
      </div>
      {confirmClose && (
        <Confirm title="Discard changes?" message="Your edits haven’t been sent or saved." confirmLabel="Discard" danger
          onClose={() => setConfirmClose(false)} onConfirm={onClose} />
      )}
    </Sheet>
  );
}

/* ── Table ────────────────────────────────────────────────────────── */

interface History { past: Grid[]; future: Grid[]; lastCell: string | null }

function TableEditor({ grid, onChange, autoFocusFirst }: { grid: Grid; onChange: (g: Grid) => void; autoFocusFirst?: boolean }) {
  const [active, setActive] = useState<{ r: number; c: number } | null>(autoFocusFirst ? { r: 0, c: 0 } : null);
  const [editing, setEditing] = useState(!!autoFocusFirst);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const history = useRef<History>({ past: [], future: [], lastCell: null });
  const [, force] = useState(0);
  const editStart = useRef<string>('');
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const tableRef = useRef<HTMLDivElement>(null);

  const rows = grid.length;
  const cols = grid[0]?.length ?? 1;

  /** Record `next` as a change. Consecutive typing in one cell is one undo step. */
  const commit = useCallback((next: Grid, cellKey: string | null) => {
    if (next === gridRef.current) return;
    const h = history.current;
    if (!(cellKey && h.lastCell === cellKey)) {
      h.past.push(gridRef.current);
      if (h.past.length > 200) h.past.shift();
    }
    h.future = [];
    h.lastCell = cellKey;
    gridRef.current = next;
    onChange(next);
    force(n => n + 1);
  }, [onChange]);

  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(gridRef.current);
    h.lastCell = null;
    gridRef.current = prev;
    onChange(prev);
    force(n => n + 1);
  }, [onChange]);
  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(gridRef.current);
    h.lastCell = null;
    gridRef.current = next;
    onChange(next);
    force(n => n + 1);
  }, [onChange]);

  // Keep the selection inside the table after rows/columns are removed.
  useEffect(() => {
    setActive(a => (a ? { r: Math.min(a.r, rows - 1), c: Math.min(a.c, cols - 1) } : a));
  }, [rows, cols]);

  const focusCell = (r: number, c: number, edit: boolean) => {
    setActive({ r, c });
    setEditing(edit);
    history.current.lastCell = null;
    if (edit) editStart.current = gridRef.current[r]?.[c] ?? '';
    requestAnimationFrame(() => {
      const td = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`);
      td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (!edit) td?.focus();
    });
  };

  const move = (dr: number, dc: number, edit: boolean) => {
    if (!active) return;
    let r = active.r + dr;
    let c = active.c + dc;
    if (c >= cols) { c = 0; r += 1; }
    if (c < 0) { c = cols - 1; r -= 1; }
    if (r >= rows && dr > 0 && dc === 0) {
      // Enter on the last row adds a row, like a spreadsheet.
      commit(insertRow(gridRef.current, rows), null);
    } else if (r >= rows || r < 0) {
      return;
    }
    focusCell(Math.max(0, r), Math.max(0, c), edit);
  };

  const onEditorKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (mod && (e.key === 'y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (e.key === 'Enter' && !e.altKey && !mod) { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0, true); return; }
    if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, true); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (active) commit(setCell(gridRef.current, active.r, active.c, editStart.current), null);
      focusCell(active!.r, active!.c, false);
    }
  };

  const onCellKey = (e: ReactKeyboardEvent<HTMLElement>, r: number, c: number) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dr, dc] = arrows[e.key];
      const nr = Math.min(rows - 1, Math.max(0, r + dr));
      const nc = Math.min(cols - 1, Math.max(0, c + dc));
      focusCell(nr, nc, false);
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); focusCell(r, c, true); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commit(setCell(gridRef.current, r, c, ''), null); return; }
    if (e.key.length === 1 && !mod && !e.altKey) {
      // Typing on a selected cell replaces it, as in any spreadsheet.
      e.preventDefault();
      editStart.current = gridRef.current[r][c];
      commit(setCell(gridRef.current, r, c, e.key), `${r}:${c}`);
      setActive({ r, c });
      setEditing(true);
    }
  };

  const rowMenu = (r: number, at: { x: number; y: number }) => setMenu({ at, items: [
    { label: 'Insert row above', onSelect: () => commit(insertRow(gridRef.current, r), null) },
    { label: 'Insert row below', onSelect: () => commit(insertRow(gridRef.current, r + 1), null) },
    ...(r > 0 ? [{ label: 'Move up', icon: <ChevronUp size={18} />, onSelect: () => { commit(moveRow(gridRef.current, r, r - 1), null); focusCell(r - 1, active?.c ?? 0, false); } }] : []),
    ...(r < rows - 1 ? [{ label: 'Move down', onSelect: () => { commit(moveRow(gridRef.current, r, r + 1), null); focusCell(r + 1, active?.c ?? 0, false); } }] : []),
    { label: 'Clear row', onSelect: () => commit(gridRef.current.map((row, i) => (i === r ? row.map(() => '') : row)), null) },
    { label: 'Delete row', icon: <Trash size={18} />, danger: true, onSelect: () => commit(deleteRow(gridRef.current, r), null) },
  ] });
  const colMenu = (c: number, at: { x: number; y: number }) => setMenu({ at, items: [
    { label: 'Insert column left', onSelect: () => commit(insertColumn(gridRef.current, c), null) },
    { label: 'Insert column right', onSelect: () => commit(insertColumn(gridRef.current, c + 1), null) },
    { label: 'Clear column', onSelect: () => commit(gridRef.current.map(row => row.map((v, j) => (j === c ? '' : v))), null) },
    { label: 'Delete column', icon: <Trash size={18} />, danger: true, onSelect: () => commit(deleteColumn(gridRef.current, c), null) },
  ] });
  const menuAt = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  };

  const h = history.current;
  const cellCount = rows * cols;

  return (
    <>
      <div className="k-editor-tools" role="toolbar" aria-label="Table">
        <button type="button" className="k-btn k-btn-secondary k-btn-sm" onClick={() => {
          const at = active ? active.r + 1 : rows;
          commit(insertRow(gridRef.current, at), null);
          focusCell(at, active?.c ?? 0, true);
        }}><Plus size={16} /> Row</button>
        <button type="button" className="k-btn k-btn-secondary k-btn-sm" onClick={() => {
          const at = active ? active.c + 1 : cols;
          commit(insertColumn(gridRef.current, at), null);
          focusCell(active?.r ?? 0, at, true);
        }}><Plus size={16} /> Column</button>
        <span className="k-editor-count">{rows} × {cols}</span>
        <button type="button" className="k-icon-btn" onClick={undo} disabled={!h.past.length} aria-label="Undo"><Undo size={20} /></button>
        <button type="button" className="k-icon-btn" onClick={redo} disabled={!h.future.length} aria-label="Redo"><Redo size={20} /></button>
      </div>
      <div className="k-editor-grid" ref={tableRef}>
        <table role="grid" aria-rowcount={rows} aria-colcount={cols}>
          <thead>
            <tr>
              <th className="k-grid-corner" aria-hidden="true" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} scope="col" className={active?.c === c ? 'is-active' : undefined}>
                  <button type="button" onClick={(e) => colMenu(c, menuAt(e))} aria-label={`Column ${columnLabel(c)} options`}>{columnLabel(c)}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r} className={r === 0 ? 'is-header-row' : undefined}>
                <th scope="row" className={active?.r === r ? 'is-active' : undefined}>
                  <button type="button" onClick={(e) => rowMenu(r, menuAt(e))} aria-label={`Row ${r + 1} options`}>{r + 1}</button>
                </th>
                {row.map((value, c) => {
                  const isActive = active?.r === r && active?.c === c;
                  if (isActive && editing) {
                    return (
                      <td key={c} data-cell={`${r}:${c}`} className="is-active is-editing">
                        <CellInput value={value} label={`${columnLabel(c)}${r + 1}`}
                          onChange={(v) => commit(setCell(gridRef.current, r, c, v), `${r}:${c}`)}
                          onKeyDown={onEditorKey}
                          onBlur={() => setEditing(false)} />
                      </td>
                    );
                  }
                  return (
                    <td key={c} data-cell={`${r}:${c}`} className={isActive ? 'is-active' : undefined}
                      tabIndex={isActive || (!active && r === 0 && c === 0) ? 0 : -1} role="gridcell"
                      aria-label={`${columnLabel(c)}${r + 1}${value ? `, ${value}` : ', empty'}`}
                      onClick={() => focusCell(r, c, true)}
                      onFocus={() => { if (!isActive) setActive({ r, c }); }}
                      onKeyDown={(e) => onCellKey(e, r, c)}>
                      {value || (r === 0 && cellCount <= 400 ? <span className="k-grid-ph">{`Column ${columnLabel(c)}`}</span> : '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {menu && <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}

function CellInput({ value, label, onChange, onKeyDown, onBlur }: {
  value: string; label: string; onChange: (v: string) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void; onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* not focusable yet */ }
  }, []);
  const lines = Math.min(6, Math.max(1, value.split('\n').length));
  return (
    <textarea ref={ref} className="k-grid-input" value={value} rows={lines} aria-label={`Cell ${label}`} data-autofocus
      spellCheck={false} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onBlur={onBlur} />
  );
}

/* ── Text ─────────────────────────────────────────────────────────── */

function TextEditor({ text, onChange, flavor }: { text: string; onChange: (t: string) => void; flavor: TextFlavor }) {
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [previewBlocks, setPreviewBlocks] = useState<Block[] | null>(null);
  const [jsonState, setJsonState] = useState<{ ok: boolean; message?: string }>({ ok: true });
  const ref = useRef<HTMLTextAreaElement>(null);
  const mono = flavor !== 'markdown' && flavor !== 'text';

  // Parse for preview/validation after typing pauses, not on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      if (flavor === 'markdown' && view === 'preview') {
        setPreviewBlocks(text.length <= PREVIEW_LIMITS.markdownChars ? parseMarkdown(text) : null);
      }
      if (flavor === 'json') {
        if (!text.trim()) { setJsonState({ ok: true }); return; }
        try { JSON.parse(text); setJsonState({ ok: true }); }
        catch (error: any) { setJsonState({ ok: false, message: String(error?.message ?? 'Not valid JSON').slice(0, 120) }); }
      }
    }, flavor === 'markdown' && view === 'preview' ? 0 : 300);
    return () => clearTimeout(t);
  }, [text, flavor, view]);

  const lineCount = useMemo(() => (text ? text.split('\n').length : 1), [text]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
    // Tab indents inside the editor instead of leaving it. insertText keeps native undo.
    e.preventDefault();
    const inserted = document.execCommand?.('insertText', false, flavor === 'markdown' || flavor === 'text' ? '  ' : '\t');
    if (!inserted) {
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = el;
      onChange(`${text.slice(0, s)}\t${text.slice(en)}`);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 1; });
    }
  };

  const format = () => {
    try { onChange(`${JSON.stringify(JSON.parse(text), null, 2)}\n`); } catch { /* invalid — button is disabled */ }
  };

  return (
    <>
      <div className="k-editor-tools">
        {flavor === 'markdown' ? (
          <Segmented label="Mode" value={view} onChange={setView}
            options={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} />
        ) : flavor === 'json' ? (
          <>
            <span className={`k-editor-status ${jsonState.ok ? 'is-ok' : 'is-bad'}`} role="status">
              {jsonState.ok ? <><Check size={14} /> Valid JSON</> : <><Alert size={14} /> {jsonState.message}</>}
            </span>
            <button type="button" className="k-btn k-btn-secondary k-btn-sm" onClick={format} disabled={!jsonState.ok || !text.trim()}>Format</button>
          </>
        ) : null}
        <span className="k-editor-count">{lineCount.toLocaleString()} line{lineCount === 1 ? '' : 's'} · {text.length.toLocaleString()} characters</span>
      </div>
      {view === 'preview' && flavor === 'markdown' ? (
        <div className="k-preview-body">
          {previewBlocks === null
            ? <div className="k-preview-state"><p>Too long to preview here.</p></div>
            : previewBlocks.length
              ? <div className="k-preview-doc"><Markdown blocks={previewBlocks} onLink={() => {}} /></div>
              : <div className="k-preview-state"><p>Nothing to preview yet.</p></div>}
        </div>
      ) : (
        <textarea ref={ref} className={`k-editor-text${mono ? ' is-mono' : ''}`} value={text} autoFocus data-autofocus
          onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
          spellCheck={flavor === 'markdown' || flavor === 'text'} aria-label="File contents"
          placeholder={flavor === 'markdown' ? '# Title\n\nWrite in Markdown…' : 'Start typing…'} />
      )}
    </>
  );
}
