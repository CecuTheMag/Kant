/**
 * In-app preview for a received or sent attachment.
 *
 * The file is decrypted into memory only — nothing is written to disk to show
 * it. Every format renders through inert elements (text nodes, <img>, <audio>,
 * <video>, the Markdown/CSV trees), so a hostile file can't run code or phone
 * home: HTML is shown as source, remote images in Markdown are never fetched,
 * and links ask before leaving the app. PDFs and anything else unpreviewable go
 * to "Open with…" (another app) or Save.
 *
 * Tables and text files can be edited (FileEditor); the edited copy is sent as
 * a new attachment, never written over the original.
 */
import { useEffect, useState } from 'react';
import { useStore } from './core/store';
import type { AttachmentData } from './core/store';
import type { MessageAttachment } from './core/types';
import { fileSize } from './core/format';
import { Alert, Check, Doc, Download, Pencil, Share, Spinner } from './icons';
import { Confirm, Segmented, Sheet, SheetHead, useToast } from './parts';
import { csvDelimiterHint, isTextKind, kindLabel, previewKind, PREVIEW_LIMITS } from './preview/fileKind';
import type { PreviewKind } from './preview/fileKind';
import { decodeTextPreview } from './preview/textDecode';
import { parseCsv } from './preview/csv';
import type { CsvTable } from './preview/csv';
import { parseMarkdown } from './preview/markdown';
import type { Block } from './preview/markdown';
import { Markdown } from './preview/MarkdownView';
import { displayFileName, sanitizeMime } from './preview/sanitize';
import { openExternalUrl } from '../lib/fileActions';
import { FileEditor } from './FileEditor';
import type { EditorSource } from './FileEditor';
import { tableForEditing } from './preview/tableEdit';

/** Beyond this many cells a phone WebView stalls laying out the table. */
const MAX_TABLE_CELLS = 50_000;

/** How the original file wrote text, so an edited copy is written the same way. */
interface TextFormat { lineEnding: '\n' | '\r\n'; bom: boolean }

type Content =
  | ({ kind: 'markdown'; text: string; blocks: Block[] | null; truncated: boolean } & TextFormat)
  | ({ kind: 'csv'; text: string; table: CsvTable; truncated: boolean } & TextFormat)
  | ({ kind: 'json'; text: string; raw: string; valid: boolean; truncated: boolean } & TextFormat)
  | ({ kind: 'code' | 'text'; text: string; truncated: boolean } & TextFormat)
  | { kind: 'image' | 'audio' | 'video'; url: string }
  | { kind: 'binary' }
  | { kind: 'external'; previewKind: PreviewKind };

function buildContent(kind: PreviewKind, data: AttachmentData, name: string): Content {
  if (isTextKind(kind)) {
    const decoded = decodeTextPreview(data.bytes, PREVIEW_LIMITS.textBytes);
    if (decoded.binary) return { kind: 'binary' };
    const { text, truncated } = decoded;
    const format: TextFormat = { lineEnding: decoded.lineEnding, bom: decoded.bom };
    switch (kind) {
      case 'markdown':
        return { kind, text, truncated, ...format, blocks: text.length <= PREVIEW_LIMITS.markdownChars ? parseMarkdown(text) : null };
      case 'csv': {
        const table = parseCsv(text, {
          delimiter: csvDelimiterHint(name),
          maxRows: PREVIEW_LIMITS.csvRows,
          maxCols: PREVIEW_LIMITS.csvCols,
          maxCellChars: PREVIEW_LIMITS.csvCellChars,
        });
        const rowCap = Math.max(1, Math.floor(MAX_TABLE_CELLS / Math.max(1, table.columns)));
        if (table.rows.length > rowCap) { table.rows = table.rows.slice(0, rowCap); table.truncatedRows = true; }
        return { kind, text, table, truncated, ...format };
      }
      case 'json': {
        if (truncated || text.length > PREVIEW_LIMITS.jsonPrettyChars) return { kind, text, raw: text, valid: true, truncated, ...format };
        try { return { kind, text: JSON.stringify(JSON.parse(text), null, 2), raw: text, valid: true, truncated, ...format }; }
        catch { return { kind, text, raw: text, valid: false, truncated, ...format }; }
      }
      default:
        return { kind: kind === 'code' ? 'code' : 'text', text, truncated, ...format };
    }
  }
  if (kind === 'image' || kind === 'audio' || kind === 'video') {
    // Only pass the sender's type through when it agrees with the kind; the
    // element sniffs the real format either way.
    const mime = sanitizeMime(data.mime);
    const type = mime.startsWith(`${kind}/`) ? mime : '';
    return { kind, url: URL.createObjectURL(new Blob([data.bytes as BlobPart], type ? { type } : {})) };
  }
  return { kind: 'external', previewKind: kind };
}

/**
 * What the editor should open for this preview, or a reason it can't be edited.
 * Anything truncated for preview is refused: editing a partial copy would lose data.
 */
function editorSourceFor(content: Content | null, name: string): EditorSource | 'too-large' | null {
  if (!content) return null;
  switch (content.kind) {
    case 'csv': {
      if (content.truncated) return 'too-large';
      const table = tableForEditing(content.text, name, csvDelimiterHint(name));
      return table ? { kind: 'table', ...table, lineEnding: content.lineEnding, bom: content.bom } : 'too-large';
    }
    case 'markdown':
    case 'code':
    case 'text':
      if (content.truncated) return 'too-large';
      return { kind: 'text', text: content.text, flavor: content.kind, lineEnding: content.lineEnding, bom: content.bom };
    case 'json':
      if (content.truncated) return 'too-large';
      return { kind: 'text', text: content.raw, flavor: 'json', lineEnding: content.lineEnding, bom: content.bom };
    default:
      return null;
  }
}

export function FilePreview({ attachment, onClose, onSendEdited }: {
  attachment: MessageAttachment;
  onClose: () => void;
  /** Send an edited copy into the chat this file came from. Absent where you can't send. */
  onSendEdited?: (file: File) => void;
}) {
  const store = useStore();
  const toast = useToast();
  const name = displayFileName(attachment.name);
  const kind = previewKind(attachment.name, attachment.mime);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [content, setContent] = useState<Content | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [view, setView] = useState<'rendered' | 'source'>('rendered');
  const [busy, setBusy] = useState<'save' | 'open' | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const data = await store.readAttachment(attachment);
        if (cancelled) return;
        if (!data) { setState('missing'); return; }
        const built = buildContent(kind, data, attachment.name);
        if ('url' in built) objectUrl = built.url;
        if (cancelled) { if (objectUrl) URL.revokeObjectURL(objectUrl); return; }
        setContent(built);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Keyed by the encrypted blob id — live store updates must not re-decrypt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.fileId]);

  const save = async () => {
    setBusy('save');
    try {
      const ok = await store.downloadAttachment(attachment);
      toast(ok ? 'Saved' : 'Couldn’t save the file', ok ? <Check size={18} /> : <Alert size={18} />);
    } finally { setBusy(null); }
  };

  const openWith = async () => {
    setBusy('open');
    try {
      const result = await store.openAttachment(attachment);
      if (result === 'no-app') toast('No app on this device can open this file', <Alert size={18} />);
      else if (result === 'missing') toast('This file isn’t on this device yet', <Alert size={18} />);
      else if (result === 'unavailable') toast('Opening in other apps isn’t available here', <Alert size={18} />);
    } catch {
      toast('Couldn’t open the file', <Alert size={18} />);
    } finally { setBusy(null); }
  };

  const editable = state === 'ready' ? editorSourceFor(content, attachment.name) : null;
  const startEdit = () => {
    if (editable === 'too-large') { toast('This file is too large to edit here', <Alert size={18} />); return; }
    if (editable) setEditor(editable);
  };

  const hasRendered = content?.kind === 'markdown' ? !!content.blocks : content?.kind === 'csv';
  const truncated = content && 'truncated' in content && content.truncated;
  const external = state === 'ready' && (content?.kind === 'external' || content?.kind === 'binary' || mediaFailed);

  const meta = [fileSize(attachment.size), kindLabel(attachment.name, kind)];
  if (truncated) meta.push('showing the first 1 MB');
  else if (content?.kind === 'csv' && (content.table.truncatedRows || content.table.truncatedCols)) {
    meta.push(`showing ${content.table.rows.length.toLocaleString()} rows${content.table.truncatedCols ? `, ${content.table.columns} columns` : ''}`);
  }

  return (
    <Sheet onClose={onClose} label={`Preview of ${name}`} tall>
      <SheetHead
        left={<button type="button" className="k-btn k-btn-plain is-bold" onClick={onClose}>Done</button>}
        title={<span title={name}>{name}</span>}
        right={
          <div className="k-preview-actions">
            {editable && (
              <button type="button" className="k-icon-btn" onClick={startEdit} disabled={!!busy}
                aria-label={content?.kind === 'csv' ? `Edit table ${name}` : `Edit ${name}`} title="Edit">
                <Pencil size={20} />
              </button>
            )}
            {store.canOpenAttachments && (
              <button type="button" className="k-icon-btn" onClick={openWith} disabled={!!busy || state !== 'ready'} aria-label="Open with another app">
                {busy === 'open' ? <Spinner size={18} /> : <Share size={21} />}
              </button>
            )}
            <button type="button" className="k-icon-btn" onClick={save} disabled={!!busy || state !== 'ready'} aria-label={`Save ${name}`}>
              {busy === 'save' ? <Spinner size={18} /> : <Download size={21} />}
            </button>
          </div>
        }
      />
      <div className="k-preview-meta">
        <span>{meta.join(' · ')}</span>
        {hasRendered && !external && (
          <Segmented label="View" value={view} onChange={setView}
            options={[{ value: 'rendered', label: content?.kind === 'csv' ? 'Table' : 'Preview' }, { value: 'source', label: 'Source' }]} />
        )}
      </div>

      <div className="k-preview-body">
        {state === 'loading' && (
          <div className="k-preview-state"><Spinner size={26} /><p>Decrypting…</p></div>
        )}
        {state === 'missing' && (
          <div className="k-preview-state"><Alert size={30} /><p>This file isn’t on this device yet. It appears here once it has finished arriving.</p></div>
        )}
        {state === 'error' && (
          <div className="k-preview-state"><Alert size={30} /><p>This file couldn’t be decrypted.</p></div>
        )}
        {state === 'ready' && content && (external
          ? <ExternalOnly kind={content.kind === 'external' ? content.previewKind : kind} binary={content.kind === 'binary'}
              mediaFailed={mediaFailed} canOpen={store.canOpenAttachments} busy={busy} onOpen={openWith} onSave={save} />
          : <PreviewContent content={content} view={view} onLink={setPendingLink} onMediaError={() => setMediaFailed(true)} />)}
      </div>

      {editor && (
        <FileEditor source={editor} name={name} mime={attachment.mime}
          title={editor.kind === 'table' ? 'Edit table' : 'Edit file'}
          onSend={onSendEdited ? (file) => { onSendEdited(file); onClose(); } : undefined}
          onClose={() => setEditor(null)} />
      )}

      {pendingLink && (
        <Confirm title="Open this link?" confirmLabel="Open link" onClose={() => setPendingLink(null)}
          message={<>
            <span className="k-preview-url">{pendingLink}</span>
            It opens outside Kant. The site will see your IP address.
          </>}
          onConfirm={() => {
            void openExternalUrl(pendingLink).then((ok) => { if (!ok) toast('This link can’t be opened', <Alert size={18} />); })
              .catch(() => toast('This link can’t be opened', <Alert size={18} />));
          }} />
      )}
    </Sheet>
  );
}

function PreviewContent({ content, view, onLink, onMediaError }: {
  content: Content; view: 'rendered' | 'source'; onLink: (href: string) => void; onMediaError: () => void;
}) {
  switch (content.kind) {
    case 'markdown':
      if (view === 'rendered' && content.blocks) {
        return content.blocks.length ? <div className="k-preview-doc"><Markdown blocks={content.blocks} onLink={onLink} /></div> : <Empty />;
      }
      return <Source text={content.text} />;
    case 'csv':
      if (view === 'rendered') return content.table.rows.length ? <CsvView table={content.table} /> : <Empty />;
      return <Source text={content.text} />;
    case 'json':
      return <>
        {!content.valid && <p className="k-preview-note"><Alert size={15} /> Not valid JSON — showing it as written.</p>}
        <Source text={content.text} />
      </>;
    case 'code':
    case 'text':
      return <Source text={content.text} />;
    case 'image':
      return <div className="k-preview-media"><img src={content.url} alt="" onError={onMediaError} /></div>;
    case 'audio':
      return <div className="k-preview-media is-audio"><audio src={content.url} controls preload="metadata" onError={onMediaError} /></div>;
    case 'video':
      return <div className="k-preview-media"><video src={content.url} controls playsInline preload="metadata" onError={onMediaError} /></div>;
    default:
      return null;
  }
}

function Source({ text }: { text: string }) {
  return text ? <pre className="k-preview-source">{text}</pre> : <Empty />;
}

function Empty() {
  return <div className="k-preview-state"><Doc size={30} /><p>This file is empty.</p></div>;
}

function CsvView({ table }: { table: CsvTable }) {
  const [head, ...rows] = table.rows;
  const width = table.columns;
  const cells = (row: string[]) => Array.from({ length: width }, (_, k) => row[k] ?? '');
  return (
    <div className="k-preview-table">
      <table>
        <thead><tr>{cells(head).map((c, k) => <th key={k}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, r) => <tr key={r}>{cells(row).map((c, k) => <td key={k}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function ExternalOnly({ kind, binary, mediaFailed, canOpen, busy, onOpen, onSave }: {
  kind: PreviewKind; binary: boolean; mediaFailed: boolean; canOpen: boolean; busy: 'save' | 'open' | null;
  onOpen: () => void; onSave: () => void;
}) {
  const why = mediaFailed ? (kind === 'image' ? 'This image format can’t be shown here.' : 'This format can’t be played here.')
    : binary ? 'This file isn’t text, so it can’t be shown here.'
    : kind === 'pdf' ? 'PDFs open in another app.'
    : 'Kant can’t preview this kind of file.';
  return (
    <div className="k-preview-state">
      <span className="k-preview-icon"><Doc size={34} /></span>
      <p>{why}{canOpen ? '' : ' You can save it to your device instead.'}</p>
      <div className="k-preview-cta">
        {canOpen && (
          <button type="button" className="k-btn k-btn-primary k-btn-block" onClick={onOpen} disabled={!!busy}>
            {busy === 'open' ? <Spinner size={18} /> : 'Open with…'}
          </button>
        )}
        <button type="button" className={`k-btn k-btn-block ${canOpen ? 'k-btn-secondary' : 'k-btn-primary'}`} onClick={onSave} disabled={!!busy}>
          {busy === 'save' ? <Spinner size={18} /> : 'Save to device'}
        </button>
      </div>
    </div>
  );
}
