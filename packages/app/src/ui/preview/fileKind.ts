/**
 * Decide how an attachment can be previewed. Pure — no DOM.
 *
 * The extension wins over the MIME type: Android's picker often reports
 * `application/octet-stream` for perfectly ordinary text files. Neither is
 * trusted for anything dangerous — every kind below renders through inert
 * elements (text nodes, <img>, <audio>, <video>), so a lying sender can at
 * worst get the wrong viewer, never script execution. HTML and SVG source in
 * particular are shown as text / an <img>, never as a live document.
 */
import { fileExtension, sanitizeMime } from './sanitize';

export type PreviewKind =
  | 'image' | 'audio' | 'video'
  | 'markdown' | 'csv' | 'json' | 'code' | 'text'
  | 'pdf' | 'none';

const BY_EXT: Record<string, PreviewKind> = {};
const add = (kind: PreviewKind, exts: string) => { for (const e of exts.split(' ')) BY_EXT[e] = kind; };

add('image', 'png jpg jpeg jfif gif webp bmp avif svg ico');
add('audio', 'mp3 m4a aac wav ogg oga opus flac weba');
add('video', 'mp4 m4v webm mov 3gp ogv');
add('markdown', 'md markdown mdown mkd mkdn');
add('csv', 'csv tsv');
add('json', 'json geojson webmanifest');
add('text', 'txt text log nfo srt vtt me');
add('code', [
  'js mjs cjs ts mts cts jsx tsx py pyw rb go rs java kt kts scala groovy gradle',
  'c h cc cpp cxx hpp hh cs swift m mm php pl pm r dart lua zig nim ex exs erl hs clj',
  'sh bash zsh fish ps1 psm1 bat cmd',
  'html htm xhtml css scss sass less vue svelte astro xml xsd xsl plist',
  'yaml yml toml ini cfg conf env properties editorconfig gitignore gitattributes dockerignore',
  'sql graphql gql proto tf hcl nix cmake mk diff patch jsonl ndjson csr pem crt',
].join(' '));
add('pdf', 'pdf');

/** Conventional extension-less file names that are plain text or source. */
const BY_NAME: Record<string, PreviewKind> = {
  readme: 'text', license: 'text', licence: 'text', copying: 'text', authors: 'text', changelog: 'text', notice: 'text',
  dockerfile: 'code', makefile: 'code', gemfile: 'code', procfile: 'code', vagrantfile: 'code', jenkinsfile: 'code',
};

function byMime(mime: string): PreviewKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return 'markdown';
  if (mime === 'text/csv' || mime === 'text/tab-separated-values') return 'csv';
  if (mime === 'application/json' || mime.endsWith('+json')) return 'json';
  // Before the +xml rule: SVG shown through <img> is inert (no script, no fetches).
  if (mime === 'image/svg+xml') return 'image';
  if (mime === 'text/html' || mime === 'application/xml' || mime.endsWith('+xml')
    || mime === 'application/javascript' || mime === 'application/x-sh') return 'code';
  const [type] = mime.split('/');
  if (type === 'image' || type === 'audio' || type === 'video') return type;
  if (type === 'text') return 'text';
  return 'none';
}

export function previewKind(name: string | undefined, mime: string | undefined): PreviewKind {
  const ext = fileExtension(name);
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  if (!ext) {
    const base = (name ?? '').trim().toLowerCase();
    if (BY_NAME[base]) return BY_NAME[base];
  }
  return byMime(sanitizeMime(mime));
}

/** Kinds whose preview is decoded text (and so can be copied). */
export function isTextKind(kind: PreviewKind): boolean {
  return kind === 'markdown' || kind === 'csv' || kind === 'json' || kind === 'code' || kind === 'text';
}

/** The CSV delimiter implied by the file name, when there is one. */
export function csvDelimiterHint(name: string | undefined): string | undefined {
  return fileExtension(name) === 'tsv' ? '\t' : undefined;
}

const LABEL: Partial<Record<PreviewKind, string>> = {
  markdown: 'Markdown', csv: 'Spreadsheet', json: 'JSON', text: 'Text', pdf: 'PDF',
  image: 'Image', audio: 'Audio', video: 'Video',
};

/** Short human label for the metadata line, e.g. "Markdown", "PY file". */
export function kindLabel(name: string | undefined, kind: PreviewKind): string {
  const ext = fileExtension(name);
  if (kind === 'csv' && ext === 'tsv') return 'Spreadsheet (TSV)';
  if (LABEL[kind]) return LABEL[kind]!;
  return ext ? `${ext.toUpperCase()} file` : 'File';
}

/**
 * Preview size ceilings. Text beyond the first MiB is truncated (the file is
 * still saved or opened whole); rich rendering is capped lower because a
 * Markdown/CSV layout of megabytes is unusable on a phone anyway.
 */
export const PREVIEW_LIMITS = {
  textBytes: 1024 * 1024,
  markdownChars: 256 * 1024,
  jsonPrettyChars: 512 * 1024,
  csvRows: 2000,
  csvCols: 64,
  csvCellChars: 1000,
} as const;
