import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from './csv';
import {
  MAX_EDIT_CELLS, blankGrid, columnLabel, deleteColumn, deleteRow, delimiterForName, detectLineEnding, insertColumn,
  insertRow, moveRow, normalizeGrid, serializeCsv, setCell, tableForEditing, trimAdded, trimGrid, withExtension,
} from './tableEdit';

const parse = (text: string, delimiter?: string) => parseCsv(text, { delimiter, maxRows: 1e6, maxCols: 1e4, maxCellChars: 1e6 }).rows;

test('serialisation round-trips awkward cells through the parser', () => {
  const grid = [
    ['name', 'note', 'amount'],
    ['Ана', 'says "hi", then leaves', '1,5'],
    ['multi\nline', ' padded ', ''],
    ['=SUM(A1)', 'tab\there', '"'],
  ];
  for (const delimiter of [',', ';', '\t']) {
    for (const eol of ['\n', '\r\n'] as const) {
      assert.deepEqual(parse(serializeCsv(grid, delimiter, eol), delimiter), grid, `${JSON.stringify(delimiter)} ${JSON.stringify(eol)}`);
    }
  }
});

test('plain cells are written without quotes', () => {
  assert.equal(serializeCsv([['a', 'b'], ['1', '2']], ',', '\n'), 'a,b\n1,2\n');
  assert.equal(serializeCsv([['a;b', 'c']], ';', '\n'), '"a;b";c\n');
});

test('grids are normalised to a rectangle, never empty', () => {
  assert.deepEqual(normalizeGrid([['a'], ['b', 'c']]), [['a', ''], ['b', 'c']]);
  assert.deepEqual(normalizeGrid([]), [['']]);
  assert.deepEqual(blankGrid(2, 3), [['', '', ''], ['', '', '']]);
  assert.deepEqual(blankGrid(0, 0), [['']]);
});

test('cell edits are immutable and ignore out-of-range targets', () => {
  const g = [['a', 'b'], ['c', 'd']];
  const next = setCell(g, 1, 0, 'x');
  assert.deepEqual(next, [['a', 'b'], ['x', 'd']]);
  assert.deepEqual(g, [['a', 'b'], ['c', 'd']]);
  assert.equal(setCell(g, 9, 0, 'x'), g);
  assert.equal(setCell(g, 0, 0, 'a'), g);
});

test('rows and columns can be inserted, deleted and moved', () => {
  const g = [['a', 'b'], ['c', 'd']];
  assert.deepEqual(insertRow(g, 1), [['a', 'b'], ['', ''], ['c', 'd']]);
  assert.deepEqual(insertRow(g, 99), [['a', 'b'], ['c', 'd'], ['', '']]);
  assert.deepEqual(deleteRow(g, 0), [['c', 'd']]);
  assert.deepEqual(deleteRow([['x', 'y']], 0), [['', '']]);
  assert.deepEqual(insertColumn(g, 0), [['', 'a', 'b'], ['', 'c', 'd']]);
  assert.deepEqual(deleteColumn(g, 1), [['a'], ['c']]);
  assert.deepEqual(deleteColumn([['a'], ['b']], 0), [[''], ['']]);
  assert.deepEqual(moveRow(g, 0, 1), [['c', 'd'], ['a', 'b']]);
  assert.equal(moveRow(g, 0, 5), g);
});

test('trailing empty rows and columns are trimmed, down to 1×1', () => {
  assert.deepEqual(trimGrid([['a', '', ''], ['', 'b', ''], ['', '', '']]), [['a', ''], ['', 'b']]);
  assert.deepEqual(trimGrid(blankGrid(3, 3)), [['']]);
});

test('only empty rows and columns added past the original size are dropped', () => {
  const original = [['a', ''], ['', '']];
  const edited = [...insertColumn(insertRow(insertRow(original, 2), 3), 2)];
  assert.equal(edited.length, 4);
  assert.deepEqual(trimAdded(edited, 2, 2), original);
  assert.deepEqual(trimAdded([['a', 'b', 'x'], ['c', 'd', ''], ['', '', '']], 2, 2), [['a', 'b', 'x'], ['c', 'd', '']]);
  assert.deepEqual(trimAdded([['']], 1, 1), [['']]);
});

test('files too big to edit safely are refused rather than truncated', () => {
  const ok = tableForEditing('a,b\r\n1,2\r\n', 'x.csv');
  assert.deepEqual(ok, { grid: [['a', 'b'], ['1', '2']], delimiter: ',', lineEnding: '\r\n' });
  const tooMany = Array.from({ length: 6000 }, (_, i) => `${i}`).join('\n');
  assert.equal(tableForEditing(tooMany, 'x.csv'), null);
  const wide = Array.from({ length: 150 }, () => Array.from({ length: 150 }, () => 'v').join(',')).join('\n');
  assert.ok(150 * 150 > MAX_EDIT_CELLS);
  assert.equal(tableForEditing(wide, 'x.csv'), null);
  assert.equal(tableForEditing('a\tb\n', 'x.tsv', '\t')!.delimiter, '\t');
});

test('helpers: line endings, delimiters, labels, names', () => {
  assert.equal(detectLineEnding('a\r\nb'), '\r\n');
  assert.equal(detectLineEnding('a\nb'), '\n');
  assert.equal(detectLineEnding('single line'), '\n');
  assert.equal(delimiterForName('data.TSV'), '\t');
  assert.equal(delimiterForName('data.csv'), ',');
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnLabel), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  assert.equal(withExtension('Budget', 'csv'), 'Budget.csv');
  assert.equal(withExtension('Budget.tsv', 'csv'), 'Budget.tsv');
  assert.equal(withExtension('  ', 'md'), 'Untitled.md');
  assert.equal(withExtension('a/b:c', 'csv'), 'abc.csv');
});
