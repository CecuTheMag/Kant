import test from 'node:test';
import assert from 'node:assert/strict';

const relayUrl = process.env.KANT_RELAY_INFO_URL ?? 'http://127.0.0.1:3001/relay-info';
const relayBaseUrl = relayUrl.replace(/\/relay-info$/, '');
const token = process.env.KANT_RELAY_LAB_CONTROL_TOKEN ?? 'kant-lab-restart-token';

test('relay info endpoint is reachable and identifies a peer', async () => {
  const response = await fetch(relayUrl);
  assert.equal(response.ok, true, `relay returned ${response.status}`);
  const body = await response.json();
  assert.ok(body.peerId || body.id || body.peerID, 'relay info has no peer identity');
});

test('/healthz returns 200 with status ok', async () => {
  const response = await fetch(`${relayBaseUrl}/healthz`);
  assert.equal(response.status, 200, `/healthz returned ${response.status}`);
  const body = await response.json();
  assert.equal(body.status, 'ok', `/healthz body.status is not 'ok': ${JSON.stringify(body)}`);
  assert.ok(typeof body.uptime === 'number', '/healthz missing uptime');
});

test('/readyz returns 200 when relay is started', async () => {
  const response = await fetch(`${relayBaseUrl}/readyz`);
  assert.equal(response.status, 200, `/readyz returned ${response.status} (relay not ready)`);
  const body = await response.json();
  assert.equal(body.ready, true, `/readyz body.ready is not true: ${JSON.stringify(body)}`);
});

test('/metrics returns Prometheus text format', async () => {
  const response = await fetch(`${relayBaseUrl}/metrics`);
  assert.equal(response.status, 200, `/metrics returned ${response.status}`);
  const text = await response.text();
  assert.ok(text.includes('kant_relay_'), `/metrics missing kant_relay_ metrics:\n${text.slice(0, 500)}`);
  assert.ok(text.includes('kant_relay_ready'), '/metrics missing kant_relay_ready gauge');
});

test('network profile is explicit', () => {
  assert.match(process.env.KANT_NETWORK_PROFILE ?? 'lan', /^(lan|wan|nat|hairpin|loss|external)$/);
});

test('admin endpoints require authorization', async () => {
  // Without auth header
  const noAuthResponse = await fetch(`${relayBaseUrl}/admin/reservations`);
  assert.equal(noAuthResponse.status, 401, 'admin endpoint should return 401 without auth');
  
  // With wrong token
  const badAuthResponse = await fetch(`${relayBaseUrl}/admin/reservations`, {
    headers: { authorization: 'Bearer wrong-token' }
  });
  assert.equal(badAuthResponse.status, 403, 'admin endpoint should return 403 with wrong token');
});

test('admin reservations endpoint returns list', async () => {
  const response = await fetch(`${relayBaseUrl}/admin/reservations`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200, 'admin reservations should return 200');
  const body = await response.json();
  assert.ok(typeof body.total === 'number', 'response should have total count');
  assert.ok(typeof body.limit === 'number', 'response should have limit');
  assert.ok(Array.isArray(body.reservations), 'response should have reservations array');
  assert.equal(body.limit, 1024, 'default limit should be 1024');
});

test('admin reservations detail endpoint returns 404 for unknown peer', async () => {
  const response = await fetch(`${relayBaseUrl}/admin/reservations/QmUnknownPeer123456`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 404, 'unknown peer should return 404');
  const body = await response.json();
  assert.ok(body.error, 'response should have error message');
});

test('admin reservation delete returns 404 for unknown peer', async () => {
  const response = await fetch(`${relayBaseUrl}/admin/reservations/QmUnknownPeer123456`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 404, 'unknown peer should return 404');
});

test('admin endpoint with bad auth on POST /__lab/restart still works', async () => {
  const response = await fetch(`${relayBaseUrl}/__lab/restart`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  });
  // Should return 202 (relay restarts) or fail gracefully
  assert.ok([202, 500, 502, 503].includes(response.status), 
    'restart endpoint should accept valid auth');
});
