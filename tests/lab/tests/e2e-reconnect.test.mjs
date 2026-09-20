import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserPair, sendMessage } from './e2e-browser-helpers.mjs';

test('clients recover from a relay restart and resume messaging without manual intervention', { timeout: 180_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    await sendMessage(pair.alice.page, pair.bob.page, `before-restart-${Date.now()}`);
    const token = process.env.KANT_RELAY_LAB_CONTROL_TOKEN;
    assert.ok(token, 'KANT_RELAY_LAB_CONTROL_TOKEN is required for the reconnect lab');
    const infoUrl = process.env.KANT_RELAY_INFO_URL ?? 'http://relay:3001/relay-info';
    const relayBaseUrl = infoUrl.replace(/\/relay-info$/, '');
    const response = await fetch(`${relayBaseUrl}/__lab/restart`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 202);
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const deadline = Date.now() + 60_000;
    while (true) {
      try { if ((await fetch(infoUrl)).ok) break; } catch {}
      if (Date.now() >= deadline) throw new Error('relay did not restart');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await sendMessage(pair.alice.page, pair.bob.page, `alice-after-restart-${Date.now()}`);
    await sendMessage(pair.bob.page, pair.alice.page, `bob-after-restart-${Date.now()}`);
  } finally { await pair.close(); }
});
