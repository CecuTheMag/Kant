import test from 'node:test';
import { createBrowserPair, sendMessage } from './e2e-browser-helpers.mjs';

test('Alice queues a message while Bob is offline and delivers it when he returns', { timeout: 180_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    await sendMessage(pair.alice.page, pair.bob.page, `offline-ready-${Date.now()}`);
    await pair.bob.context.setOffline(true);
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const message = `queued-while-bob-offline-${Date.now()}`;
    const composer = pair.alice.page.locator('textarea.composer-input');
    await composer.fill(message);
    await composer.press('Enter');
    await pair.alice.page.getByText(message, { exact: true }).waitFor();
    await pair.bob.context.setOffline(false);
    await pair.bob.page.getByText(message, { exact: true }).waitFor({ timeout: 120_000 });
  } finally { await pair.close(); }
});
