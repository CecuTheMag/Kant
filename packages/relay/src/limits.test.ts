import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RELAY_DATA_LIMIT, isWireSafeUint64 } from './limits.js';

test('relay data limit avoids the uint64 range circuit-relay-v2 mis-encodes', () => {
  assert.equal(isWireSafeUint64(RELAY_DATA_LIMIT), true);
  assert.ok(RELAY_DATA_LIMIT >= 2n ** 32n, 'large enough for 100 MB files many times over');
  for (const broken of [2n ** 31n, 2n * 1024n ** 3n, 3n * 2n ** 30n, 2n ** 32n - 1n]) assert.equal(isWireSafeUint64(broken), false, String(broken));
  for (const fine of [0n, 131072n, 2n ** 31n - 1n, 2n ** 32n, 2n ** 40n]) assert.equal(isWireSafeUint64(fine), true, String(fine));
});

test('connection limits: defaults carry thousands of clients, env overrides, bad values fail loudly', async () => {
  const { connectionLimits } = await import('./limits.js');
  const d = connectionLimits({});
  assert.ok(d.maxConnections >= 4096, 'libp2p default of 300 refused the 301st online user');
  assert.equal(d.maxReservations, d.maxConnections);
  assert.ok(d.inboundConnectionThreshold >= 100, 'behind Caddy this is the whole relay\'s connect rate, not one IP\'s');
  assert.ok(d.maxIncomingPendingConnections >= 100);
  const o = connectionLimits({ RELAY_MAX_CONNECTIONS: '10000', RELAY_INBOUND_CONNECTIONS_PER_SECOND: '50', RELAY_MAX_PENDING_CONNECTIONS: ' ' });
  assert.equal(o.maxConnections, 10000);
  assert.equal(o.maxReservations, 10000, 'reservations follow the connection cap unless set');
  assert.equal(o.inboundConnectionThreshold, 50);
  assert.equal(o.maxIncomingPendingConnections, d.maxIncomingPendingConnections, 'blank means default');
  assert.equal(connectionLimits({ RELAY_MAX_CONNECTIONS: '5000', RELAY_MAX_RESERVATIONS: '4000' }).maxReservations, 4000);
  for (const bad of ['0', '-1', '12abc', '1.5']) assert.throws(() => connectionLimits({ RELAY_MAX_CONNECTIONS: bad }), /RELAY_MAX_CONNECTIONS/);
});
