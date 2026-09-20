import { test, expect } from '@playwright/test';

const PASSWORD = 'KantTransport-2026!';

async function publicKey(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('kant');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction('identity', 'readonly');
      const get = tx.objectStore('identity').get('keypair');
      get.onsuccess = () => resolve(get.result?.publicKeyHex ?? '');
      get.onerror = () => reject(get.error);
    };
  }));
}

async function bootstrap(context, baseURL, relayURL) {
  await context.addInitScript(({ url, onionEnabled }) => {
    localStorage.setItem('kant_relay_url', url);
    localStorage.setItem('kant_onion_enabled', onionEnabled ? 'true' : 'false');
  }, { url: relayURL, onionEnabled: process.env.KANT_ONION === 'true' });
  const page = await context.newPage();
  page.on('console', message => {
    const text = message.text();
    if (/\[createNode\]|\[queue\]|PING |Session|Relay|NO_RESERVATION|FAIL|retry/i.test(text)) {
      process.stderr.write(`[browser] ${text}\n`);
    }
  });
  await page.goto(baseURL);
  await page.getByPlaceholder('Enter password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Identity' }).click();
  await expect(page.locator('body')).not.toContainText('Cannot reach relay', { timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Add contact' }).first()).toBeVisible({ timeout: 90_000 });
  return page;
}

async function addContact(page, hex, nickname) {
  await page.getByRole('button', { name: 'Add contact' }).first().click();
  await page.locator('#ac-hex').fill(hex);
  await page.locator('#ac-nick').fill(nickname);
  await page.getByRole('button', { name: 'Add contact', exact: true }).last().click();
  await expect(page.getByText(nickname, { exact: false }).first()).toBeVisible();
}

test('two real clients establish a session and deliver a message through the relay', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const relayURL = process.env.KANT_RELAY_URL ?? 'http://relay:3001';
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const [alice, bob] = await Promise.all([
      bootstrap(aliceContext, baseURL, relayURL),
      bootstrap(bobContext, baseURL, relayURL),
    ]);
    const [aliceKey, bobKey] = await Promise.all([publicKey(alice), publicKey(bob)]);
    expect(aliceKey).toMatch(/^[0-9a-f]{64}$/);
    expect(bobKey).toMatch(/^[0-9a-f]{64}$/);
    await Promise.all([addContact(alice, bobKey, 'Bob transport'), addContact(bob, aliceKey, 'Alice transport')]);
    await alice.getByText('Bob transport', { exact: false }).first().click();
    await bob.getByText('Alice transport', { exact: false }).first().click();
    // Registry heartbeats/session handshakes are intentionally asynchronous.
    await alice.waitForTimeout(12_000);
    const marker = `delivery-${Date.now()}`;
    await alice.locator('textarea.composer-input').fill(marker);
    await alice.locator('textarea.composer-input').press('Enter');
    await expect(bob.getByText(marker, { exact: true })).toBeVisible({ timeout: 90_000 });
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
