import test from 'node:test';
import { createBrowserPair, sendMessage, sendText, incoming } from './e2e-browser-helpers.mjs';

test('Alice queues a message while Bob is offline and delivers it when he returns', { timeout: 180_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    await sendMessage(pair.alice.page, pair.bob.page, `offline-ready-${Date.now()}`);
    await pair.bob.context.setOffline(true);
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const message = `queued-while-bob-offline-${Date.now()}`;
    await sendText(pair.alice.page, message);
    await pair.bob.context.setOffline(false);
    await incoming(pair.bob.page, message).waitFor({ timeout: 120_000 });
  } finally { await pair.close(); }
});
