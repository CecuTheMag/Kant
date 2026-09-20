import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserPair } from './e2e-browser-helpers.mjs';

test('two real libp2p browser nodes establish X3DH and exchange ten ordered messages each way', { timeout: 180_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    const outgoing = Array.from({ length: 10 }, (_, i) => `a-to-b-${i}-${Date.now()}`);
    const aliceComposer = pair.alice.page.locator('textarea.composer-input');
    for (const text of outgoing) { await aliceComposer.fill(text); await aliceComposer.press('Enter'); }
    await pair.bob.page.getByText(outgoing.at(-1), { exact: true }).waitFor({ timeout: 90_000 });
    const replies = Array.from({ length: 10 }, (_, i) => `b-to-a-${i}-${Date.now()}`);
    const bobComposer = pair.bob.page.locator('textarea.composer-input');
    for (const text of replies) { await bobComposer.fill(text); await bobComposer.press('Enter'); }
    await pair.alice.page.getByText(replies.at(-1), { exact: true }).waitFor({ timeout: 90_000 });
    for (const [page, expected] of [[pair.bob.page, outgoing], [pair.alice.page, replies]]) {
      const rendered = await page.locator('.conv-body .msg').allTextContents();
      const positions = expected.map(text => rendered.findIndex(value => value.includes(text)));
      assert.ok(positions.every(position => position >= 0), 'all messages decrypted');
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'messages rendered in order');
    }
  } finally {
    await pair.close();
  }
});
