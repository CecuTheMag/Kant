import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { displayFileName, fileExtension, isSafeExternalUrl, safeFileName, sanitizeMime } from './sanitize';
import { csvDelimiterHint, isTextKind, kindLabel, previewKind } from './fileKind';

describe('file names', () => {
  test('bidi overrides cannot disguise the real extension', () => {
    const spoof = 'invoice\u202Efdp.exe';
    assert.equal(displayFileName(spoof), 'invoicefdp.exe');
    assert.equal(fileExtension(spoof), 'exe');
  });

  test('disk names are one safe segment', () => {
    assert.equal(safeFileName('../../etc/passwd'), '_.._etc_passwd');
    assert.equal(safeFileName('..\\..\\x.txt'), '_.._x.txt');
    assert.equal(safeFileName('.hidden'), 'hidden');
    assert.equal(safeFileName('a:b*c?"<>|.md'), 'a_b_c_____.md');
    assert.equal(safeFileName('tab\tand\nnewline.txt'), 'tabandnewline.txt');
    assert.equal(safeFileName(''), 'file');
    assert.equal(safeFileName('...'), 'file');
    assert.equal(safeFileName(undefined), 'file');
  });

  test('long names are cut but keep their extension', () => {
    const name = safeFileName(`${'x'.repeat(300)}.markdown`);
    assert.equal(name.length, 120);
    assert.ok(name.endsWith('.markdown'));
  });

  test('extensions', () => {
    assert.equal(fileExtension('A1_GET_team.MD'), 'md');
    assert.equal(fileExtension('archive.tar.gz'), 'gz');
    assert.equal(fileExtension('noext'), '');
    assert.equal(fileExtension('.bashrc'), '');
    assert.equal(fileExtension('trailing.'), '');
    assert.equal(fileExtension('weird.ex t'), '');
  });
});

describe('mime', () => {
  test('parameters are stripped and garbage becomes octet-stream', () => {
    assert.equal(sanitizeMime('text/plain; charset=utf-8'), 'text/plain');
    assert.equal(sanitizeMime('TEXT/Markdown'), 'text/markdown');
    for (const bad of [undefined, '', 'text', '/x', 'a/b/c', 'text/ht ml', 'x'.repeat(300) + '/y']) {
      assert.equal(sanitizeMime(bad), 'application/octet-stream', String(bad));
    }
  });
});

describe('external links', () => {
  test('only web and mail links may leave the app', () => {
    for (const ok of ['https://kant.network', 'http://example.com/a?b#c', 'mailto:a@b.c', 'HTTPS://X.COM']) {
      assert.equal(isSafeExternalUrl(ok), true, ok);
    }
    for (const bad of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd',
      'intent://x#Intent;end', 'content://x', 'kant://add', 'vbscript:x', '//evil.com', '/relative', 'https://', 'https://user:pw@bank.com',
      'https://bank.com@evil.io', `https://x.com/${'a'.repeat(3000)}`,
    ]) {
      assert.equal(isSafeExternalUrl(bad), false, bad);
    }
  });
});

describe('preview kind', () => {
  test('extension wins over a generic MIME type', () => {
    assert.equal(previewKind('A1_GET_team.md', 'application/octet-stream'), 'markdown');
    assert.equal(previewKind('notes.txt', ''), 'text');
    assert.equal(previewKind('data.csv', 'application/vnd.ms-excel'), 'csv');
    assert.equal(previewKind('data.tsv', ''), 'csv');
    assert.equal(previewKind('main.py', ''), 'code');
    assert.equal(previewKind('voice.opus', ''), 'audio');
    assert.equal(previewKind('clip.mp4', ''), 'video');
    assert.equal(previewKind('doc.pdf', ''), 'pdf');
    assert.equal(previewKind('conf.json', ''), 'json');
  });

  test('active documents are never rendered live', () => {
    assert.equal(previewKind('page.html', 'text/html'), 'code');
    assert.equal(previewKind('page', 'text/html'), 'code');
    assert.equal(previewKind('x.svg', 'text/html'), 'image');
    assert.equal(previewKind('x', 'image/svg+xml'), 'image');
  });

  test('falls back to MIME, then to conventional names', () => {
    assert.equal(previewKind('blob', 'text/markdown'), 'markdown');
    assert.equal(previewKind('blob', 'application/ld+json'), 'json');
    assert.equal(previewKind('blob', 'text/x-anything'), 'text');
    assert.equal(previewKind('README', ''), 'text');
    assert.equal(previewKind('Dockerfile', ''), 'code');
    assert.equal(previewKind('app.apk', 'application/vnd.android.package-archive'), 'none');
    assert.equal(previewKind(undefined, undefined), 'none');
  });

  test('labels and helpers', () => {
    assert.equal(kindLabel('a.md', 'markdown'), 'Markdown');
    assert.equal(kindLabel('a.py', 'code'), 'PY file');
    assert.equal(kindLabel('a.tsv', 'csv'), 'Spreadsheet (TSV)');
    assert.equal(kindLabel('noext', 'none'), 'File');
    assert.equal(csvDelimiterHint('a.tsv'), '\t');
    assert.equal(csvDelimiterHint('a.csv'), undefined);
    assert.equal(isTextKind('json'), true);
    assert.equal(isTextKind('pdf'), false);
  });
});
