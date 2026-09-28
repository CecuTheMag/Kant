import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RELAY_DATA_LIMIT, isWireSafeUint64 } from './limits.js';

test('relay data limit avoids the uint64 range circuit-relay-v2 mis-encodes', () => {
  assert.equal(isWireSafeUint64(RELAY_DATA_LIMIT), true);
  assert.ok(RELAY_DATA_LIMIT >= 2n ** 32n, 'large enough for 100 MB files many times over');
  for (const broken of [2n ** 31n, 2n * 1024n ** 3n, 3n * 2n ** 30n, 2n ** 32n - 1n]) assert.equal(isWireSafeUint64(broken), false, String(broken));
  for (const fine of [0n, 131072n, 2n ** 31n - 1n, 2n ** 32n, 2n ** 40n]) assert.equal(isWireSafeUint64(fine), true, String(fine));
});
