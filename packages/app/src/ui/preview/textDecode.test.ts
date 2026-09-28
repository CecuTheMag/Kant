import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decodeTextPreview } from './textDecode';
import { detectDelimiter, parseCsv } from './csv';

const enc = (s: string) => new TextEncoder().encode(s);
const LIMITS = { maxRows: 2000, maxCols: 64, maxCellChars: 1000 };

describe('decodeTextPreview', () => {
  test('plain UTF-8, Cyrillic included', () => {
    const r = decodeTextPreview(enc('Здравей, свят\nhello'), 1024);
    assert.deepEqual(r, { text: 'Здравей, свят\nhello', truncated: false, binary: false, encoding: 'utf-8', lineEnding: '\n', bom: false });
  });

  test('line endings are normalised', () => {
    assert.equal(decodeTextPreview(enc('a\r\nb\rc\n'), 1024).text, 'a\nb\nc\n');
  });

  test('the file\'s own line break is reported so an edited copy can keep it', () => {
    assert.equal(decodeTextPreview(enc('a\r\nb\r\n'), 1024).lineEnding, '\r\n');
    assert.equal(decodeTextPreview(enc('a\nb\n'), 1024).lineEnding, '\n');
    assert.equal(decodeTextPreview(enc('one line'), 1024).lineEnding, '\n');
    assert.equal(decodeTextPreview(enc('\nstarts with a break'), 1024).lineEnding, '\n');
  });

  test('UTF-8 BOM is dropped', () => {
    const withBom = decodeTextPreview(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]), 1024);
    assert.equal(withBom.text, 'hi');
    assert.equal(withBom.bom, true);
    assert.equal(decodeTextPreview(enc('hi'), 1024).bom, false);
  });

  test('UTF-16 LE and BE with BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
    assert.deepEqual(decodeTextPreview(le, 1024), { text: 'hi', truncated: false, binary: false, encoding: 'utf-16le', lineEnding: '\n', bom: true });
    assert.deepEqual(decodeTextPreview(be, 1024), { text: 'hi', truncated: false, binary: false, encoding: 'utf-16be', lineEnding: '\n', bom: true });
  });

  test('truncation never splits a multi-byte character', () => {
    // "аб" is 4 bytes; cutting at 3 must yield just "а", not "а\uFFFD".
    const r = decodeTextPreview(enc('абв'), 3);
    assert.equal(r.text, 'а');
    assert.equal(r.truncated, true);
    const emoji = decodeTextPreview(enc('x😀'), 4);
    assert.equal(emoji.text, 'x');
  });

  test('truncation never splits a UTF-16 surrogate pair', () => {
    // BOM + "x" + U+1F600 (d83d de00), little-endian.
    const le = new Uint8Array([0xff, 0xfe, 0x78, 0x00, 0x3d, 0xd8, 0x00, 0xde]);
    assert.equal(decodeTextPreview(le, 4).text, 'x');
  });

  test('binary data is detected instead of shown as garbage', () => {
    assert.equal(decodeTextPreview(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]), 1024).binary, true);
    const controls = new Uint8Array(200).fill(0x01);
    assert.equal(decodeTextPreview(controls, 1024).binary, true);
    // ANSI colour escapes in a log are fine.
    assert.equal(decodeTextPreview(enc('\u001b[31mred\u001b[0m\tok'), 1024).binary, false);
  });

  test('empty input', () => {
    assert.deepEqual(decodeTextPreview(new Uint8Array(), 10), { text: '', truncated: false, binary: false, encoding: 'utf-8', lineEnding: '\n', bom: false });
  });
});

describe('csv', () => {
  test('quotes, doubled quotes, embedded delimiters and newlines', () => {
    const t = parseCsv('name,note\n"Doe, J","said ""hi""\nthen left"\nx,y\n', LIMITS);
    assert.deepEqual(t.rows, [['name', 'note'], ['Doe, J', 'said "hi"\nthen left'], ['x', 'y']]);
    assert.equal(t.columns, 2);
    assert.equal(t.truncatedRows, false);
  });

  test('CRLF, BOM, ragged rows, no trailing newline', () => {
    const t = parseCsv('\uFEFFa,b,c\r\n1\r\n2,3', LIMITS);
    assert.deepEqual(t.rows, [['a', 'b', 'c'], ['1'], ['2', '3']]);
    assert.equal(t.columns, 3);
  });

  test('delimiter detection: comma, semicolon (EU Excel), tab, pipe', () => {
    assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
    assert.equal(detectDelimiter('Име;Сума;Дата\nИван;12,50;01.02\nМария;3,00;02.02'), ';');
    assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
    assert.equal(detectDelimiter('a|b|c\n1|2|3'), '|');
    assert.equal(detectDelimiter('"x,y";z\n"p,q";r'), ';');
    assert.equal(detectDelimiter('single column'), ',');
  });

  test('an unterminated quote swallows the rest instead of throwing', () => {
    const t = parseCsv('a,"open\nstill open', LIMITS);
    assert.deepEqual(t.rows, [['a', 'open\nstill open']]);
  });

  test('output is bounded', () => {
    const big = Array.from({ length: 50 }, (_, r) => Array.from({ length: 100 }, (_, c) => `${r}.${c}`).join(',')).join('\n');
    const t = parseCsv(big, { maxRows: 10, maxCols: 5, maxCellChars: 1000 });
    assert.equal(t.rows.length, 10);
    assert.equal(t.columns, 5);
    assert.equal(t.truncatedRows, true);
    assert.equal(t.truncatedCols, true);
    const long = parseCsv(`${'z'.repeat(50)},b`, { maxRows: 10, maxCols: 5, maxCellChars: 10 });
    assert.equal(long.rows[0][0], `${'z'.repeat(10)}…`);
  });

  test('explicit delimiter overrides detection', () => {
    assert.deepEqual(parseCsv('a,b\tc', { ...LIMITS, delimiter: '\t' }).rows, [['a,b', 'c']]);
  });
});
