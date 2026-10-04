import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserPair, sendText, incoming } from './e2e-browser-helpers.mjs';

test('two real libp2p browser nodes establish X3DH and exchange ten ordered messages each way', { timeout: 180_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    const outgoing = Array.from({ length: 10 }, (_, i) => `a-to-b-${i}-${Date.now()}`);
    for (const text of outgoing) await sendText(pair.alice.page, text);
    await incoming(pair.bob.page, outgoing.at(-1)).waitFor({ timeout: 90_000 });
    const replies = Array.from({ length: 10 }, (_, i) => `b-to-a-${i}-${Date.now()}`);
    for (const text of replies) await sendText(pair.bob.page, text);
    await incoming(pair.alice.page, replies.at(-1)).waitFor({ timeout: 90_000 });
    // Someone you're actively talking to shows as online in the chat header.
    for (const page of [pair.alice.page, pair.bob.page]) {
      await page.locator('.k-conv-sub', { hasText: /^Online$/ }).waitFor({ timeout: 10_000 });
    }
    for (const [page, expected] of [[pair.bob.page, outgoing], [pair.alice.page, replies]]) {
      const rendered = await page.locator('.k-msg.in').allTextContents();
      const positions = expected.map(text => rendered.findIndex(value => value.includes(text)));
      assert.ok(positions.every(position => position >= 0), 'all messages decrypted');
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'messages rendered in order');
    }
  } finally {
    await pair.close();
  }
});
