import { test } from 'node:test';
import assert from 'node:assert/strict';
import { popBack, pushBack } from './backStack';

test('nothing open: back is not handled', () => {
  assert.equal(popBack(), false);
});

test('the newest overlay closes first', () => {
  const closed: string[] = [];
  const offA = pushBack(() => { closed.push('a'); offA(); });
  const offB = pushBack(() => { closed.push('b'); offB(); });
  assert.equal(popBack(), true);
  assert.equal(popBack(), true);
  assert.equal(popBack(), false);
  assert.deepEqual(closed, ['b', 'a']);
});

test('unregistering removes only that overlay', () => {
  const closed: string[] = [];
  const offA = pushBack(() => closed.push('a'));
  const offB = pushBack(() => closed.push('b'));
  const offC = pushBack(() => closed.push('c'));
  offB();
  popBack();
  offC();
  popBack();
  offA();
  assert.deepEqual(closed, ['c', 'a']);
  assert.equal(popBack(), false);
});
