import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const webUrl = process.env.KANT_WEB_URL ?? 'http://web:80';
const relayUrl = process.env.KANT_RELAY_URL ?? 'http://relay:3001';

// Allow overriding the Chromium binary via env var so Arch Linux (and any
// other distro where Playwright's --with-deps fails) can use the system
// Chromium instead of downloading a separate binary.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium in your shell
// or .env to activate this. CI leaves it unset and uses Playwright's own build.
const CHROMIUM_LAUNCH_OPTS = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : { headless: true };

/** Helper to open IndexedDB with promise-based API */
function idbOpen(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Retry `fn` every 500ms until it succeeds or `maxMs` (default 30s) elapses.
 * Returns the resolved value of `fn` on success, or rethrows on timeout.
 */
export async function eventually(fn, optsOrMs = 30_000) {
  const maxMs = typeof optsOrMs === 'number' ? optsOrMs : (optsOrMs?.timeout ?? 30_000);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try { return await fn(); }
    catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return await fn(); // final throw on timeout
}

export async function identityKey(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('kant');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const get = request.result.transaction('identity', 'readonly').objectStore('identity').get('keypair');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result?.publicKeyHex ?? '');
    };
  }));
}

/**
 * Inject contacts directly into IndexedDB to avoid O(n²) UI clicks for scale tests.
 * Each contact includes the full prekey bundle needed for X3DH key exchange.
 * @param {import('@playwright/test').Page} page
 * @param {Array<{publicKeyHex: string, preKeyBundle?: object, trusted?: boolean}>} contacts
 */
export async function injectContacts(page, contacts) {
  await page.evaluate(async (contacts) => {
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('kant');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction('contacts', 'readwrite');
        const store = tx.objectStore('contacts');
        for (const c of contacts) store.put(c);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
    });
  }, contacts);
}

/**
 * Read Kant's actual identity record. The store uses an explicit `keypair`
 * key, and production persists the stable public key as `publicKeyHex`.
 * Scale tests used to read getAll()[0] and expect a retired identity bundle
 * shape, so a healthy newly-created identity looked like a null fixture.
 */
async function getIdentityRecord(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('kant');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      try {
        const get = request.result.transaction('identity', 'readonly')
          .objectStore('identity').get('keypair');
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolve(get.result ?? null);
      } catch (error) { reject(error); }
    };
  }));
}

/** Wait for `promise`, but give up after `ms` so a wedged Chromium can't block teardown. */
function settleWithin(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, ms).unref?.()),
  ]);
}

/* ── UI driver ────────────────────────────────────────────────────────────────
 * Every interaction with the app's screens goes through these functions, so a
 * UI change means updating one place rather than every test. They follow the
 * same flows a person does (terms → network → name and password, invite
 * links, the composer), and match the selectors tests/lab/local/harness.mjs
 * uses for the reconnect suite.
 */

export const passwordFor = label => `KantE2E-${label}-2026!`;

const chatsReady = page => page.getByRole('button', { name: 'New message' });

/** Text that is exactly `name` — "Member1" must not match "Member15". */
const exactly = name => new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

/** On a phone-width layout an open chat covers the list; go back to it. */
export async function toChatList(page) {
  if (!isPhoneLayout(page)) return;
  const back = page.getByRole('button', { name: 'Back to chats' });
  if (await back.isVisible().catch(() => false)) await back.click();
  await chatsReady(page).waitFor({ timeout: 10_000 });
}

/** Below 768 px the app shows the list or one chat, never both (kant.css). */
function isPhoneLayout(page) {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

/** The chat-list row for a person or group, by exact name. */
export function chatRow(page, name) {
  return page.locator('.k-row-name').filter({ hasText: exactly(name) }).first();
}

function watchConsole(page, label, onLine) {
  page.on('console', message => {
    const value = message.text();
    onLine?.(value);
    // Full passthrough in debug mode (KANT_DEBUG_CONSOLE=1) so the app's
    // addLog console.debug trail and every warning reach the test log.
    if (process.env.KANT_DEBUG_CONSOLE === '1') {
      process.stderr.write(`[${label}] ${value}\n`);
      return;
    }
    if (/createNode|reservation|reconnect|queue|NO_RESERVATION|PING|session|x3dh|group|key|distribut|bundle|fetch/i.test(value)) {
      process.stderr.write(`[${label}] ${value}\n`);
    }
  });
  page.on('pageerror', error => process.stderr.write(`[${label}] page error: ${error.message}\n`));
}

/** First run: terms, then the network step (skipped by builds with a default relay), then name and password. */
export async function onboard(page, label, relay = relayUrl) {
  await page.getByRole('button', { name: 'Agree and continue' }).click({ timeout: 60_000 });
  const relayField = page.locator('#relay');
  const nameField = page.getByPlaceholder('How friends will see you');
  await relayField.or(nameField).first().waitFor({ timeout: 60_000 });
  if (await relayField.isVisible()) {
    await relayField.fill(relay);
    await relayField.press('Enter');
  }
  await nameField.fill(label, { timeout: 60_000 });
  await page.getByPlaceholder('At least 8 characters').fill(passwordFor(label));
  await page.getByPlaceholder('Type it again').fill(passwordFor(label));
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await chatsReady(page).waitFor({ timeout: 90_000 });
}

/** A reload or restart of an existing profile lands on the unlock screen. */
export async function unlock(page, label) {
  await page.getByLabel('Password', { exact: true }).fill(passwordFor(label), { timeout: 60_000 });
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await chatsReady(page).waitFor({ timeout: 90_000 });
}

/** The link "Copy link" in My code produces (ui/lib.ts buildInvite). Same relay, so no `r`. */
export function inviteLink(hex, name) {
  return `https://kant.network/add#${new URLSearchParams({ k: hex, n: name })}`;
}

/** Add a contact the way a person does: paste their invite link. */
export async function addContact(page, hex, name) {
  await toChatList(page);
  const emptyState = page.getByRole('button', { name: 'Add a contact' });
  if (await emptyState.isVisible().catch(() => false)) {
    await emptyState.click();
  } else {
    await chatsReady(page).click();
    await page.getByRole('dialog', { name: 'New message' }).getByRole('button', { name: 'Add contact', exact: true }).click();
  }
  const sheet = page.getByRole('dialog', { name: 'Add contact' });
  const invite = sheet.locator('#invite');
  if (!await invite.isVisible().catch(() => false)) await sheet.getByRole('button', { name: 'Paste link' }).click();
  await invite.fill(inviteLink(hex, name));
  await sheet.getByRole('button', { name: 'Add contact', exact: true }).last().click();
  await sheet.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  // On a phone, adding opens the new chat over the list.
  if (isPhoneLayout(page)) await page.getByRole('button', { name: 'Back to chats' }).waitFor({ timeout: 10_000 });
  await toChatList(page);
  await chatRow(page, name).waitFor({ timeout: 15_000 });
}

/** Open a person's or group's chat from the chat list. */
export async function openChat(page, name) {
  await toChatList(page);
  await chatRow(page, name).click();
  await composer(page).waitFor({ timeout: 30_000 });
}

export function composer(page) {
  return page.getByLabel('Message', { exact: true });
}

/** Type and send in the open chat. The Send button enables once the app is connected to its relay. */
export async function sendText(page, text) {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click({ timeout: 120_000 });
  await page.locator('.k-msg.out', { hasText: text }).first().waitFor({ timeout: 10_000 });
}

export function incoming(page, text) {
  return page.locator('.k-msg.in', { hasText: text }).first();
}

export async function sendMessage(sender, receiver, text) {
  await sendText(sender, text);
  await incoming(receiver, text).waitFor({ timeout: 90_000 });
}

/**
 * Send a message from sender to all receivers in parallel.
 * @param {import('@playwright/test').Page} sender
 * @param {Array<import('@playwright/test').Page>} receivers
 * @param {string} text
 * @param {number} [timeoutMs=90000]
 */
export async function sendMessageToAll(sender, receivers, text, timeoutMs = 90_000) {
  await sendText(sender, text);
  await Promise.all(receivers.map(receiver => incoming(receiver, text).waitFor({ timeout: timeoutMs })));
}

/** Attach a file in the open chat through the composer's Attach → File menu. */
export async function attachFile(page, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach' }).click({ timeout: 120_000 });
  await page.getByRole('menuitem', { name: 'File' }).click();
  await (await chooser).setFiles(file);
}

/** Press a received file's Save button and return the Playwright download. */
export async function saveFile(page, name) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: `Save ${name}` }).last().click();
  return download;
}

/** New message → New group: name it, pick members by contact name, Create. */
export async function createGroupUI(page, groupName, memberNames) {
  await toChatList(page);
  await chatsReady(page).click();
  await page.getByRole('dialog', { name: 'New message' }).getByRole('button', { name: 'New group' }).click();
  const sheet = page.getByRole('dialog', { name: 'New group' });
  await sheet.getByLabel('Group name').fill(groupName);
  for (const name of memberNames) {
    await sheet.locator('button.k-cell').filter({ has: page.locator('.k-cell-label', { hasText: exactly(name) }) }).click();
  }
  // The header counts the selection; a mis-click would otherwise go unnoticed.
  await sheet.getByText(`Members · ${memberNames.length} selected`, { exact: true }).waitFor({ timeout: 5_000 });
  await sheet.getByRole('button', { name: 'Create', exact: true }).click();
  await toChatList(page);
  await chatRow(page, groupName).waitFor({ timeout: 15_000 });
}

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

/**
 * Two fresh clients, Alice and Bob, who have added each other by invite link
 * and are both online with each other's live address. Each has the other's
 * chat open when this resolves.
 */
export async function createBrowserPair() {
  const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTS);
  try {
    return await setupBrowserPair(browser);
  } catch (error) {
    // Any setup failure (not just connect) used to leave Chromium running,
    // which kept the runner process alive for hours after the test failed.
    await settleWithin(browser.close(), 15_000);
    throw error;
  }
}

/** A fresh, onboarded client in its own browser context. */
export async function createClient(browser, label) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  watchConsole(page, label);
  await page.goto(webUrl);
  await onboard(page, label);
  return { context, page };
}

async function setupBrowserPair(browser) {
  const [alice, bob] = await Promise.all([createClient(browser, 'Alice'), createClient(browser, 'Bob')]);
  const [aliceKey, bobKey] = await Promise.all([identityKey(alice.page), identityKey(bob.page)]);
  assert.match(aliceKey, /^[0-9a-f]{64}$/);
  assert.match(bobKey, /^[0-9a-f]{64}$/);
  await Promise.all([addContact(alice.page, bobKey, 'Bob E2E'), addContact(bob.page, aliceKey, 'Alice E2E')]);
  // Group delivery needs a live circuit address for each member, which only a
  // presence exchange provides — wait for it rather than for UI "online" text.
  await Promise.all([
    waitForContactOnline(alice.page, 'Bob E2E', 180_000),
    waitForContactOnline(bob.page, 'Alice E2E', 180_000),
  ]);
  return {
    browser, alice, bob,
    async close() {
      await settleWithin(Promise.allSettled([alice.context.close(), bob.context.close()]), 15_000);
      await settleWithin(browser.close(), 15_000);
    },
  };
}

/**
 * Create N browser contexts with identities, suitable for scale testing.
 * Member0 is the owner; only the owner has contacts (injected straight into
 * IndexedDB so setup stays O(n)).
 *
 * @param {number} n - Number of browser members to create
 * @param {string} [relayUrlOverride] - Optional relay URL override
 * @param {string} [webUrlOverride] - Optional web URL override
 * @returns {Promise<{
 *   browser: import('@playwright/test').Browser,
 *   members: Array<{page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext, publicKeyHex: string, sessionReadyContacts: Set<string>}>,
 *   close: () => Promise<void>
 * }>}
 */
export async function createBrowserGroup(n, relayUrlOverride = relayUrl, webUrlOverride = webUrl) {
  console.log(`[createBrowserGroup] Launching browser with ${n} contexts...`);
  const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTS);
  const startMem = process.memoryUsage().heapUsed;
  console.log(`[createBrowserGroup] Initial heap: ${Math.round(startMem / 1024 / 1024)} MB`);

  /** @type {Array<{page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext, publicKeyHex: string, sessionReadyContacts: Set<string>}>} */
  const members = [];

  console.log(`[createBrowserGroup] Creating ${n} contexts...`);
  const contexts = await Promise.all(
    Array.from({ length: n }, () => browser.newContext({ acceptDownloads: true }))
  );
  const closeTimeout = (ms) => new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  const closeFixture = async () => {
    await Promise.race([
      Promise.allSettled(contexts.map(context => context.close().catch(() => {}))),
      closeTimeout(15_000),
    ]);
    await Promise.race([
      browser.close().catch(() => {}),
      closeTimeout(15_000),
    ]);
  };

  const setupMember = async (i) => {
    const label = `Member${i}`;
    const page = await contexts[i].newPage();
    const sessionReadyContacts = new Set();
    watchConsole(page, label, value => {
      const ready = value.match(/Session ready:\s*(Member\d+)/);
      if (ready) sessionReadyContacts.add(ready[1]);
    });
    await page.goto(webUrlOverride);
    await onboard(page, label, relayUrlOverride);
    const record = await eventually(async () => {
      const value = await getIdentityRecord(page);
      assert.ok(value?.publicKeyHex, `${label}: identity creation has not committed yet`);
      return value;
    }, 90_000);
    assert.match(record.publicKeyHex, /^[0-9a-f]{64}$/, `${label}: publicKeyHex is required`);
    console.log(`[${label}] Created identity: ${record.publicKeyHex.slice(0, 16)}...`);
    return { page, context: contexts[i], publicKeyHex: record.publicKeyHex, sessionReadyContacts };
  };

  // Two concurrent Argon2/key-generation flows are the stable ceiling for
  // this 4-vCPU lab runner. Four can leave one renderer stuck before it
  // commits the identity record, producing a false scale failure.
  const BATCH = 2;
  try {
    for (let start = 0; start < n; start += BATCH) {
      const size = Math.min(BATCH, n - start);
      const batch = await Promise.all(
        Array.from({ length: size }, (_, k) => setupMember(start + k))
      );
      members.push(...batch);
    }

    console.log(`[createBrowserGroup] Injecting owner-centered contacts for ${n} members...`);
    // These tests exercise one owner's group fan-out. A complete contact mesh is
    // unrelated to that flow and starts n*(n-1) background DM/X3DH handshakes.
    // Only the owner needs contacts for the group sheet; recipients learn the
    // full membership from the signed group-key payload.
    const ownerContacts = members.slice(1).map((member, index) => ({
      publicKeyHex: member.publicKeyHex,
      nickname: `Member${index + 1}`,
      trusted: true,
    }));
    await injectContacts(members[0].page, ownerContacts);

    // Direct IDB writes avoid O(n²) UI work, but React already captured the
    // owner's contacts state. Reload only the owner so the app loads them.
    const owner = members[0];
    owner.sessionReadyContacts.clear();
    await owner.page.reload();
    await unlock(owner.page, 'Member0');
    console.log(`[createBrowserGroup] Owner contacts hydrated in app state.`);

    // Do not let group creation race circuit reservations. A relay can accept a
    // WebSocket connection while dropping its first reservation request; recover
    // only those members with one full reload, as the smaller fixture does.
    const waitForCircuit = (member, index, timeoutMs) => eventually(async () => {
      const addr = await member.page.evaluate(() => window.__kantCircuitAddr ?? '');
      assert.ok(addr.includes('/p2p-circuit'), `Member${index}: circuit reservation is not ready`);
      return addr;
    }, timeoutMs);
    const missingCircuits = [];
    await Promise.all(members.map(async (member, index) => {
      await waitForCircuit(member, index, 45_000).catch(() => missingCircuits.push(index));
    }));
    for (const index of missingCircuits) {
      const member = members[index];
      console.log(`[createBrowserGroup] Recovering Member${index} circuit with one reload.`);
      await member.page.reload();
      await unlock(member.page, `Member${index}`);
      await waitForCircuit(member, index, 90_000);
    }
    await Promise.all(members.slice(1).map((_, index) =>
      waitForContactOnline(owner.page, `Member${index + 1}`, 90_000, { open: false })
    ));
    await eventually(() => {
      const missing = members.slice(1)
        .map((_, index) => `Member${index + 1}`)
        .filter(name => !owner.sessionReadyContacts.has(name));
      assert.equal(missing.length, 0, `Owner sessions not ready: ${missing.join(', ')}`);
      return true;
    }, 90_000);
  } catch (error) {
    // A failed fixture used to leak every context and keep node alive until
    // an external timeout killed it — close everything so the runner exits.
    await closeFixture();
    throw error;
  }
  console.log(`[createBrowserGroup] All circuits and owner sessions ready for ${n - 1} live members.`);

  const endMem = process.memoryUsage().heapUsed;
  console.log(`[createBrowserGroup] Final heap: ${Math.round(endMem / 1024 / 1024)} MB (+${Math.round((endMem - startMem) / 1024 / 1024)} MB)`);

  return {
    browser,
    members,
    async close() {
      console.log('[createBrowserGroup] Closing browser...');
      await closeFixture();
    }
  };
}

/**
 * Wait until `page` holds a live circuit address for the contact named
 * `contactName` — the actual prerequisite for delivery, which only a presence
 * exchange provides. UI "online" text can lag it by a render. Opens the
 * contact's chat first unless `open: false`.
 */
export async function waitForContactOnline(page, contactName, timeoutMs = 60_000, { open = true } = {}) {
  if (open) await openChat(page, contactName);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const liveAddr = await page.evaluate((nickname) => new Promise((resolve) => {
      const req = indexedDB.open('kant');
      req.onerror = () => resolve('');
      req.onsuccess = () => {
        try {
          const all = req.result.transaction('contacts', 'readonly').objectStore('contacts').getAll();
          all.onerror = () => resolve('');
          all.onsuccess = () => {
            const contact = (all.result ?? []).find((c) => c.nickname === nickname);
            resolve(contact?.lastCircuitAddr ?? '');
          };
        } catch { resolve(''); }
      };
    }), contactName).catch(() => '');
    if (typeof liveAddr === 'string' && liveAddr.includes('/p2p-circuit')) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Contact ${contactName} did not receive a live circuit address within ${timeoutMs}ms`);
}
