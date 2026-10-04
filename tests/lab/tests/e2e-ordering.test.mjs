import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserPair, sendMessage, sendText, incoming, composer } from './e2e-browser-helpers.mjs';

test('rapid messages preserve ratchet order and duplicate message IDs are not processed twice', { timeout: 180_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    await sendMessage(pair.alice.page, pair.bob.page, `ordering-ready-${Date.now()}`);
    const stamp = Date.now();
    const values = Array.from({ length: 50 }, (_, i) => `ordered-${String(i).padStart(2, '0')}-${stamp}`);
    for (const text of values) await sendText(pair.alice.page, text);
    await incoming(pair.bob.page, values.at(-1)).waitFor({ timeout: 120_000 });
    const rendered = await pair.bob.page.locator('.k-msg.in').allTextContents();
    const positions = values.map(text => rendered.findIndex(value => value.includes(text)));
    assert.ok(positions.every(position => position >= 0), 'all 50 messages arrived and decrypted');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'rapid messages rendered in order');

    // Force the same transport ID twice. The receiver must ACK the retry while
    // refusing to render or persist its second payload.
    await pair.alice.page.evaluate(() => Object.defineProperty(crypto, 'randomUUID', {
      configurable: true, value: () => '00000000-0000-4000-8000-000000000001',
    }));
    await sendMessage(pair.alice.page, pair.bob.page, 'dedupe-first');
    // Not sendText: with a reused ID the sender's own bubble may not render either.
    await composer(pair.alice.page).fill('dedupe-second');
    await pair.alice.page.getByRole('button', { name: 'Send', exact: true }).click();
    await new Promise(resolve => setTimeout(resolve, 2_000));
    assert.equal(await pair.bob.page.locator('.k-msg.in', { hasText: 'dedupe-first' }).count(), 1);
    assert.equal(await pair.bob.page.locator('.k-msg.in', { hasText: 'dedupe-second' }).count(), 0);
  } finally { await pair.close(); }
});
