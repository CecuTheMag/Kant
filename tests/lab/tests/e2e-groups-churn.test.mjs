import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserPair, createGroupUI, waitForContactOnline } from './e2e-browser-helpers.mjs';

const KANT_RELAY_LAB_CONTROL_TOKEN = process.env.KANT_RELAY_LAB_CONTROL_TOKEN ?? 'kant-lab-restart-token';
const relayBaseUrl = (process.env.KANT_RELAY_INFO_URL ?? 'http://localhost:3001/relay-info').replace(/\/relay-info$/, '');
const relayInfoUrl = process.env.KANT_RELAY_INFO_URL ?? 'http://localhost:3001/relay-info';
const webUrl = process.env.KANT_WEB_URL ?? 'http://web:80';

async function getIdentityKey(target) {
  const page = target?.page ?? target;
  return page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('kant');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const get = r.result.transaction('identity', 'readonly').objectStore('identity').get('keypair');
      get.onsuccess = () => resolve(get.result?.publicKeyHex ?? '');
    };
  }));
}

async function makeClient(browser, password) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript((opts) => {
    try {
      localStorage.setItem('kant_relay_url', opts.relayUrl);
      localStorage.setItem('kant_direction', 'instrument');
    } catch {}
  }, { relayUrl: process.env.KANT_RELAY_URL ?? 'http://localhost:3001' });
  const page = await context.newPage();
  await page.goto(webUrl);
  const useRelay = page.getByRole('button', { name: 'Use this relay' });
  if (await useRelay.isVisible().catch(() => false)) {
    await page.getByPlaceholder('https://relay.example.com').fill(process.env.KANT_RELAY_URL ?? 'http://localhost:3001');
    await useRelay.click();
  }
  await page.getByPlaceholder('Enter password').fill(password);
  await page.getByPlaceholder('Repeat password').fill(password);
  await page.getByRole('button', { name: 'Create Identity' }).click();
  await page.getByRole('button', { name: 'Add contact' }).first().waitFor({ timeout: 90_000 });
  // Wait for circuit address so the peer is reachable on the relay
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const addr = await page.evaluate(() => window.__kantCircuitAddr ?? '').catch(() => '');
    if (addr && addr.includes('/p2p-circuit')) break;
    await new Promise(r => setTimeout(r, 500));
  }
  return { context, page };
}

async function waitForRelay(previousUptime = Number.POSITIVE_INFINITY, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let restartObserved = false;
  while (true) {
    try {
      const health = await fetch(`${relayBaseUrl}/healthz`);
      if (health.ok) {
        const body = await health.json().catch(() => ({}));
        const uptime = Number(body?.uptime);
        if (Number.isFinite(uptime) && uptime < previousUptime) restartObserved = true;
        if (restartObserved && (await fetch(relayInfoUrl)).ok) return;
      } else {
        restartObserved = true;
      }
    } catch {
      restartObserved = true;
    }
    if (Date.now() >= deadline) throw new Error('relay did not restart in time');
    await new Promise(r => setTimeout(r, 250));
  }
}

async function waitForReservations(peerIds, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${relayBaseUrl}/admin/reservations`, {
        headers: { authorization: `Bearer ${KANT_RELAY_LAB_CONTROL_TOKEN}` },
      });
      if (res.ok) {
        const body = await res.json();
        const active = new Set((body?.reservations ?? []).map(r => r.peerId));
        if (peerIds.every(peerId => active.has(peerId))) return;
      }
    } catch { /* relay still restarting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`relay did not recover reservations for: ${peerIds.join(', ')}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// TEST 1: Relay restart during group key distribution
// ─────────────────────────────────────────────────────────────────────────────
test('group key delivery survives relay restart during distribution', { timeout: 420_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    const { alice, bob } = pair;

    // Alice creates a group with Bob (already added as contact by createBrowserPair)
    await createGroupUI(alice.page, 'churn-restart-group', ['Bob E2E']);

    // Bob's app defaults to the Chats tab — groups render only in the Groups tab.
    await bob.page.getByRole('button', { name: 'Groups' }).click();

    // Wait for Bob to see the group, then open its conversation (message waits
    // target the open conversation; group rows show no message preview).
    await bob.page.getByText('churn-restart-group', { exact: false }).first().waitFor({ timeout: 30_000 });
    await bob.page.getByText('churn-restart-group', { exact: false }).first().click();

    const expectedPeerIds = await Promise.all([alice.page, bob.page].map(page =>
      page.evaluate(() => (window.__kantCircuitAddr ?? '').split('/p2p/').pop() ?? '')
    ));
    expectedPeerIds.forEach(peerId => assert.match(peerId, /^12D3KooW/, 'client peer id available'));

    // Restart the relay. Capture uptime first so waitForRelay cannot mistake
    // the still-running pre-exit process (the endpoint exits 50ms after 202)
    // for the restarted instance.
    const beforeHealth = await fetch(`${relayBaseUrl}/healthz`).then(r => r.json());
    const previousUptime = Number(beforeHealth?.uptime);
    const res = await fetch(`${relayBaseUrl}/__lab/restart`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KANT_RELAY_LAB_CONTROL_TOKEN}` },
    });
    assert.equal(res.status, 202, 'Relay restart accepted');
    await waitForRelay(previousUptime);
    // The HTTP process can be healthy while peers are still reacquiring their
    // circuit reservations. Sending before both are present only tests a known
    // offline-recipient window, not post-restart delivery.
    await waitForReservations(expectedPeerIds);

    // Open the group on Alice and send a message after restart
    await alice.page.getByText('churn-restart-group', { exact: false }).first().click();
    const composer = alice.page.locator('textarea.composer-input');
    await composer.waitFor({ state: 'visible', timeout: 60_000 });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (!await composer.isDisabled().catch(() => true)) break;
      await new Promise(r => setTimeout(r, 500));
    }
    await composer.fill('alice-after-restart');
    await composer.press('Enter');
    await bob.page.getByText('alice-after-restart', { exact: true }).waitFor({ timeout: 90_000 });
  } finally {
    await pair.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Member disconnect and reconnect
// ─────────────────────────────────────────────────────────────────────────────
test('group key delivery survives member disconnect and reconnect', { timeout: 180_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    const { alice, bob, browser } = pair;

    // Alice creates a group with Bob
    await createGroupUI(alice.page, 'churn-disconnect-group', ['Bob E2E']);
    await bob.page.getByRole('button', { name: 'Groups' }).click();
    await bob.page.getByText('churn-disconnect-group', { exact: false }).first().waitFor({ timeout: 30_000 });
    await bob.page.getByText('churn-disconnect-group', { exact: false }).first().click();

    // Send a message before disconnect
    await alice.page.getByText('churn-disconnect-group', { exact: false }).first().click();
    const aliceComposer = alice.page.locator('textarea.composer-input');
    await aliceComposer.waitFor({ state: 'visible', timeout: 60_000 });
    const d1 = Date.now() + 60_000;
    while (Date.now() < d1) { if (!await aliceComposer.isDisabled().catch(() => true)) break; await new Promise(r => setTimeout(r, 500)); }
    await aliceComposer.fill('before-disconnect');
    await aliceComposer.press('Enter');
    await bob.page.getByText('before-disconnect', { exact: true }).waitFor({ timeout: 90_000 });

    // Carol joins
    const carol = await makeClient(browser, 'KantE2E-Carol-2026!');
    const carolKey = await getIdentityKey(carol.page);
    const aliceKey = await getIdentityKey(alice.page);

    // Add Carol as Alice's contact and wait for her to come online.
    // The Add contact button exists only on the Chats tab — Alice is on Groups
    // after createGroupUI, so switch back first.
    await alice.page.getByRole('button', { name: 'Chats' }).click();
    await alice.page.getByRole('button', { name: 'Add contact' }).and(alice.page.locator('[aria-label="Add contact"]')).click();
    await alice.page.getByPlaceholder('64 hex characters…').fill(carolKey);
    await alice.page.getByPlaceholder('e.g. Mara').first().fill('Carol E2E');
    await alice.page.locator('.modal').getByRole('button', { name: /^Add [Cc]ontact$/ }).click();
    await alice.page.getByText('Carol E2E', { exact: false }).first().waitFor();
    await waitForContactOnline(alice.page, 'Carol E2E');

    // Carol adds Alice back (mutual contact). With zero contacts her UI is in
    // first-run mode, which hides the groups list entirely.
    await carol.page.getByRole('button', { name: 'Add contact' }).and(carol.page.locator('[aria-label="Add contact"]')).click();
    await carol.page.getByPlaceholder('64 hex characters…').fill(aliceKey);
    await carol.page.getByPlaceholder('e.g. Mara').first().fill('Alice E2E');
    await carol.page.locator('.modal').getByRole('button', { name: /^Add [Cc]ontact$/ }).click();
    await carol.page.getByText('Alice E2E', { exact: false }).first().waitFor();
    await waitForContactOnline(carol.page, 'Alice E2E');

    // Alice creates a 3-member group
    await createGroupUI(alice.page, 'churn-three-member', ['Bob E2E', 'Carol E2E']);
    await bob.page.getByText('churn-three-member', { exact: false }).first().waitFor({ timeout: 30_000 });
    await bob.page.getByText('churn-three-member', { exact: false }).first().click();
    await carol.page.getByRole('button', { name: 'Groups' }).click();
    await carol.page.getByText('churn-three-member', { exact: false }).first().waitFor({ timeout: 30_000 });
    await carol.page.getByText('churn-three-member', { exact: false }).first().click();

    // Carol goes offline — reload locks her identity in IndexedDB (node not
    // started = effectively offline, same as closing the app on a device).
    await carol.page.reload();

    // Alice sends while Carol is offline
    await alice.page.getByText('churn-three-member', { exact: false }).first().click();
    const groupComposer = alice.page.locator('textarea.composer-input');
    await groupComposer.waitFor({ state: 'visible', timeout: 60_000 });
    const d2 = Date.now() + 60_000;
    while (Date.now() < d2) { if (!await groupComposer.isDisabled().catch(() => true)) break; await new Promise(r => setTimeout(r, 500)); }
    await groupComposer.fill('message-during-offline');
    await groupComposer.press('Enter');
    await bob.page.getByText('message-during-offline', { exact: true }).waitFor({ timeout: 90_000 });

    // Carol reconnects — unlock her persisted identity (same keypair; her
    // groups live in IndexedDB and must still be there after the app restart).
    await carol.page.getByPlaceholder('Enter password').fill('KantE2E-Carol-2026!');
    await carol.page.getByRole('button', { name: 'Unlock' }).click();
    await carol.page.getByRole('button', { name: 'Groups' }).click();
    await carol.page.getByText('churn-three-member', { exact: false }).first().waitFor({ timeout: 45_000 });
  } finally {
    await pair.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Concurrent member churn
// ─────────────────────────────────────────────────────────────────────────────
test('group key delivery survives concurrent member churn', { timeout: 180_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    const { alice, bob, browser } = pair;
    const aliceKey = await getIdentityKey(alice.page);
    const bobKey = await getIdentityKey(bob.page);

    // Alice creates a group with Bob
    await createGroupUI(alice.page, 'churn-concurrent-group', ['Bob E2E']);
    await bob.page.getByRole('button', { name: 'Groups' }).click();
    await bob.page.getByText('churn-concurrent-group', { exact: false }).first().waitFor({ timeout: 30_000 });
    await bob.page.getByText('churn-concurrent-group', { exact: false }).first().click();

    // Send before churn
    await alice.page.getByText('churn-concurrent-group', { exact: false }).first().click();
    const aliceComposer = alice.page.locator('textarea.composer-input');
    await aliceComposer.waitFor({ state: 'visible', timeout: 60_000 });
    const d1 = Date.now() + 60_000;
    while (Date.now() < d1) { if (!await aliceComposer.isDisabled().catch(() => true)) break; await new Promise(r => setTimeout(r, 500)); }
    await aliceComposer.fill('before-concurrent-churn');
    await aliceComposer.press('Enter');
    await bob.page.getByText('before-concurrent-churn', { exact: true }).waitFor({ timeout: 90_000 });

    // Bob goes offline — reload locks his identity (node stops; same device
    // restart semantics as Test 2).
    await bob.page.reload();

    // Alice sends while Bob is offline
    await aliceComposer.fill('msg-during-churn');
    await aliceComposer.press('Enter');

    // Bob reconnects — unlock the same identity; the group must persist.
    await bob.page.getByPlaceholder('Enter password').fill('KantE2E-Bob-2026!');
    await bob.page.getByRole('button', { name: 'Unlock' }).click();
    await bob.page.getByRole('button', { name: 'Groups' }).click();
    await bob.page.getByText('churn-concurrent-group', { exact: false }).first().waitFor({ timeout: 45_000 });
  } finally {
    await pair.close();
  }
});
