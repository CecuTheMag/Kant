import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertByTime } from './messageOrder';

const ids = (list: { id: string }[]) => list.map(m => m.id);

test('a message in time order goes at the end', () => {
  const list = [{ id: 'a', ts: 1 }, { id: 'b', ts: 2 }];
  assert.deepEqual(ids(insertByTime(list, { id: 'c', ts: 3 })), ['a', 'b', 'c']);
  assert.deepEqual(ids(insertByTime([], { id: 'a', ts: 1 })), ['a']);
});

test('a late arrival goes before the first later message', () => {
  const list = [{ id: 'a', ts: 1 }, { id: 'c', ts: 5 }, { id: 'd', ts: 6 }];
  assert.deepEqual(ids(insertByTime(list, { id: 'b', ts: 4 })), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(insertByTime(list, { id: 'z', ts: 0 })), ['z', 'a', 'c', 'd']);
});

test('equal times keep arrival order, and the input is not changed', () => {
  const list = [{ id: 'a', ts: 2 }];
  assert.deepEqual(ids(insertByTime(list, { id: 'b', ts: 2 })), ['a', 'b']);
  assert.deepEqual(ids(list), ['a']);
});
