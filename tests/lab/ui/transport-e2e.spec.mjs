import { test, expect } from '@playwright/test';
import { onboard, addContact, openChat, sendText, incoming, identityKey, waitForContactOnline } from '../tests/e2e-browser-helpers.mjs';

async function bootstrap(context, baseURL, relayURL, label) {
  await context.addInitScript(({ onionEnabled }) => {
    localStorage.setItem('kant_onion_enabled', onionEnabled ? 'true' : 'false');
  }, { onionEnabled: process.env.KANT_ONION === 'true' });
  const page = await context.newPage();
  page.on('console', message => {
    const text = message.text();
    if (/\[createNode\]|\[queue\]|PING |Session|Relay|NO_RESERVATION|FAIL|retry/i.test(text)) {
      process.stderr.write(`[${label}] ${text}\n`);
    }
  });
  await page.goto(baseURL);
  await onboard(page, label, relayURL);
  return page;
}

test('two real clients establish a session and deliver a message through the relay', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const relayURL = process.env.KANT_RELAY_URL ?? 'http://relay:3001';
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const [alice, bob] = await Promise.all([
      bootstrap(aliceContext, baseURL, relayURL, 'Alice'),
      bootstrap(bobContext, baseURL, relayURL, 'Bob'),
    ]);
    const [aliceKey, bobKey] = await Promise.all([identityKey(alice), identityKey(bob)]);
    expect(aliceKey).toMatch(/^[0-9a-f]{64}$/);
    expect(bobKey).toMatch(/^[0-9a-f]{64}$/);
    await Promise.all([addContact(alice, bobKey, 'Bob transport'), addContact(bob, aliceKey, 'Alice transport')]);
    // Registry heartbeats and session handshakes are asynchronous: wait for
    // each side to hold the other's live address rather than a fixed sleep.
    await Promise.all([
      waitForContactOnline(alice, 'Bob transport', 120_000),
      waitForContactOnline(bob, 'Alice transport', 120_000),
    ]);
    const marker = `delivery-${Date.now()}`;
    await sendText(alice, marker);
    await expect(incoming(bob, marker)).toBeVisible({ timeout: 90_000 });
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
