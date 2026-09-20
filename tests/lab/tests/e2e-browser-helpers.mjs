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

/**
 * Create a browser pair for 2-member E2E tests (Alice and Bob).
 * @deprecated Use createBrowserGroup(n) for scalable N-member tests.
 */
export async function createBrowserPair() {
  const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTS);
  const makeClient = async label => {
    const context = await browser.newContext({ acceptDownloads: true });
    // Force legacy UI so tests target the production component tree
    await context.addInitScript((opts) => {
      try {
        localStorage.setItem('kant_relay_url', opts.relayUrl);
        localStorage.setItem('kant_direction', 'instrument');
      } catch {}
    }, { relayUrl });
    const page = await context.newPage();
    page.on('console', message => {
      const value = message.text();
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
    await page.goto(webUrl);
    // Local/manual labs commonly use the app's loopback default, which the UI
    // deliberately asks the user to confirm. CI uses a non-loopback service
    // URL and skips this screen, so handle both startup paths explicitly.
    const useRelay = page.getByRole('button', { name: 'Use this relay' });
    if (await useRelay.isVisible().catch(() => false)) {
      await page.getByPlaceholder('https://relay.example.com').fill(relayUrl);
      await useRelay.click();
    }
    const password = `KantE2E-${label}-2026!`;
    await page.getByPlaceholder('Enter password').fill(password);
    await page.getByPlaceholder('Repeat password').fill(password);
    await page.getByRole('button', { name: 'Create Identity' }).click();
    await page.getByRole('button', { name: 'Add contact' }).first().waitFor({ timeout: 90_000 });
    return { context, page };
  };
  const alice = await makeClient('Alice');
  const bob = await makeClient('Bob');
  const [aliceKey, bobKey] = await Promise.all([identityKey(alice.page), identityKey(bob.page)]);
  assert.match(aliceKey, /^[0-9a-f]{64}$/);
  assert.match(bobKey, /^[0-9a-f]{64}$/);
  const add = async (page, peerKey, name) => {
    // Target the icon button in the header by aria-label to avoid strict-mode
    // violations — the page has multiple 'Add contact' buttons (header icon,
    // GetStarted step, modal submit, footer).
    await page.getByRole('button', { name: 'Add contact' }).and(page.locator('[aria-label="Add contact"]')).click();
    await page.getByPlaceholder('64 hex characters…').fill(peerKey);
    const nickInput = page.getByPlaceholder('e.g. Mara').or(page.getByPlaceholder('e.g. Alice')).first();
    await nickInput.fill(name);
    // Modal submit — scoped inside the open modal to avoid matching other buttons.
    await page.locator('.modal, [role="dialog"]').getByRole('button', { name: /^Add [Cc]ontact$/ }).click();
    const entry = page.getByText(name, { exact: false }).first();
    await entry.waitFor();
    await entry.click();
  };
  await Promise.all([add(alice.page, bobKey, 'Bob E2E'), add(bob.page, aliceKey, 'Alice E2E')]);
  // Connect both nodes to the relay so circuit addresses are populated
  const connect = async (page) => {
    const connectBtn = page.getByRole('button', { name: 'Connect to Network' });
    if (await connectBtn.isVisible().catch(() => false)) await connectBtn.click();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const addr = await page.evaluate(() => window.__kantCircuitAddr ?? '').catch(() => '');
      if (addr && addr.includes('/p2p-circuit')) return;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Node did not get a circuit address within 180s');
  };
  try {
    await Promise.all([connect(alice.page), connect(bob.page)]);
  } catch (error) {
    // A rejected Promise.all used to leak both Chromium contexts and leave
    // reconnect timers running for minutes, contaminating the next churn run.
    await Promise.allSettled([alice.context.close(), bob.context.close()]);
    await browser.close().catch(() => {});
    throw error;
  }
  // Read each peer's circuit address from window.__kantCircuitAddr (set by useKant)
  // and inject it into the other peer's contacts IDB so the group modal doesn't
  // show the "Enter circuit address" fallback input.
  const getCircuitAddr = async (page) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const addr = await page.evaluate(() => window.__kantCircuitAddr ?? '');
      if (addr && addr.includes('/p2p-circuit')) return addr;
      await new Promise(r => setTimeout(r, 300));
    }
    return '';
  };
  const [aliceCircuit, bobCircuit] = await Promise.all([
    getCircuitAddr(alice.page),
    getCircuitAddr(bob.page),
  ]);
  const injectAddr = async (page, hex, addr) => {
    if (!addr) return;
    await page.evaluate(async ({ hex, addr }) => {
      await new Promise((resolve) => {
        const r = indexedDB.open('kant');
        r.onsuccess = () => {
          const tx = r.result.transaction('contacts', 'readwrite');
          const store = tx.objectStore('contacts');
          const get = store.get(hex);
          get.onsuccess = () => {
            const rec = get.result ?? { publicKeyHex: hex };
            store.put({ ...rec, lastCircuitAddr: addr });
            tx.oncomplete = resolve;
          };
        };
      });
    }, { hex, addr });
  };
  await Promise.all([
    injectAddr(alice.page, bobKey, bobCircuit),
    injectAddr(bob.page, aliceKey, aliceCircuit),
  ]);

  // Wait for presence exchange so React state has live lastCircuitAddr before
  // any group creation. createGroup reads c.lastCircuitAddr from React state
  // (not IDB directly), which is only updated when a presence ping arrives.
  await Promise.all([
    waitForContactOnline(alice.page, 'Bob E2E'),
    waitForContactOnline(bob.page, 'Alice E2E'),
  ]);

  return {
    browser, alice, bob,
    async close() {
      await Promise.allSettled([alice.context.close(), bob.context.close()]);
      await browser.close();
    },
  };
}

/**
 * Create N browser contexts with identities, suitable for scale testing.
 * Each member gets its stable public identity key. Contacts are injected
 * directly into IndexedDB so the owner can create the group without O(n)
 * modal setup.
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

  // Launch all contexts in parallel for faster setup
  console.log(`[createBrowserGroup] Creating ${n} contexts...`);
  const contexts = await Promise.all(
    Array.from({ length: n }, (_, i) => browser.newContext({ acceptDownloads: true }))
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

  // Set up each member's page and identity — in parallel batches so the
  // N-member fixture finishes inside the scale tests' budgets. The old
  // sequential goto+identity flow cost ~15s per member, which alone blew the
  // 120s budget at N=10 on a 4-vCPU runner.
  const setupMember = async (i) => {
    const label = `Member${i}`;
    const context = contexts[i];
    // Use an options object to reliably serialize and guard storage access
    await context.addInitScript((opts) => {
      try {
        localStorage.setItem('kant_relay_url', opts.relayUrl);
        localStorage.setItem('kant_direction', 'instrument');
      } catch {}
    }, { relayUrl: relayUrlOverride });
    const page = await context.newPage();
    const sessionReadyContacts = new Set();
    page.on('console', message => {
      const value = message.text();
      const ready = value.match(/Session ready:\s*(Member\d+)/);
      if (ready) sessionReadyContacts.add(ready[1]);
      if (/createNode|reservation|reconnect|queue|NO_RESERVATION|PING|session|x3dh|group/i.test(value)) {
        process.stderr.write(`[${label}] ${value}\n`);
      }
    });
    page.on('pageerror', error => process.stderr.write(`[${label}] page error: ${error.message}\n`));

    await page.goto(webUrlOverride);
    const useRelay = page.getByRole('button', { name: 'Use this relay' });
    if (await useRelay.isVisible().catch(() => false)) {
      await page.getByPlaceholder('https://relay.example.com').fill(relayUrlOverride);
      await useRelay.click();
    }

    // Stored identity has one keypair record; the scale fixture needs only
    // publicKeyHex because group distribution fetches current prekey bundles
    // over the live circuit.
    const existing = await getIdentityRecord(page);
    let publicKeyHex = existing?.publicKeyHex;

    if (typeof publicKeyHex === 'string' && publicKeyHex.length > 0) {
      console.log(`[${label}] Reusing existing identity: ${publicKeyHex.slice(0, 16)}...`);
    } else {
      const password = `KantE2E-${label}-2026!`;
      await page.getByPlaceholder('Enter password').fill(password);
      await page.getByPlaceholder('Repeat password').fill(password);
      await page.getByRole('button', { name: 'Create Identity' }).click();
      publicKeyHex = await eventually(async () => {
        const record = await getIdentityRecord(page);
        assert.ok(record?.publicKeyHex, `${label}: identity creation has not committed yet`);
        return record.publicKeyHex;
      }, 90_000);
      console.log(`[${label}] Created new identity: ${publicKeyHex.slice(0, 16)}...`);
    }

    assert.match(publicKeyHex, /^[0-9a-f]{64}$/, `${label}: publicKeyHex is required`);
    return { page, context, publicKeyHex, sessionReadyContacts };
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
  } catch (error) {
    // A failed fixture used to leak every context and keep node alive until
    // an external timeout killed it — close everything so the runner exits.
    await closeFixture();
    throw error;
  }

  console.log(`[createBrowserGroup] Injecting owner-centered contacts for ${n} members...`);
  // These tests exercise one owner's group fan-out. A complete contact mesh is
  // unrelated to that flow and starts n*(n-1) background DM/X3DH handshakes.
  // Besides overwhelming small runners, those handshakes contend for the same
  // advertised OPKs as group-key delivery. Only the owner needs contacts for
  // the creation modal; recipients learn the full membership from the signed
  // group-key payload.
  const ownerContacts = members.slice(1).map((member, index) => ({
    publicKeyHex: member.publicKeyHex,
    nickname: `Member${index + 1}`,
    trusted: true,
  }));
  await injectContacts(members[0].page, ownerContacts);
  console.log(`[createBrowserGroup] All contacts injected.`);

  // Direct IDB writes deliberately avoid O(n²) UI work, but React already
  // captured the owner's contacts state. Reload only the owner so the real app
  // executes getContacts(); reloading recipients needlessly replaces nine
  // healthy relay reservations even though they have no contact state to load.
  const owner = members[0];
  owner.sessionReadyContacts.clear();
  await owner.page.reload();
  await owner.page.getByPlaceholder('Enter password').fill('KantE2E-Member0-2026!');
  await owner.page.getByRole('button', { name: 'Unlock' }).click();
  await owner.page.getByRole('button', { name: 'Groups' }).waitFor({ timeout: 90_000 });
  console.log(`[createBrowserGroup] Owner contacts hydrated in app state.`);

  // Do not let group creation race circuit reservations. A relay can accept a
  // WebSocket connection while dropping its first reservation request; recover
  // only those members with one full reload, as the smaller lab fixture does.
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
    await member.page.getByPlaceholder('Enter password').fill(`KantE2E-Member${index}-2026!`);
    await member.page.getByRole('button', { name: 'Unlock' }).click();
    await member.page.getByRole('button', { name: 'Groups' }).waitFor({ timeout: 90_000 });
    await waitForCircuit(member, index, 90_000);
  }
  await Promise.all(members.slice(1).map((_, index) =>
    waitForContactOnline(members[0].page, `Member${index + 1}`, 90_000)
  ));
  await eventually(() => {
    const missing = members.slice(1)
      .map((_, index) => `Member${index + 1}`)
      .filter(name => !owner.sessionReadyContacts.has(name));
    assert.equal(missing.length, 0, `Owner sessions not ready: ${missing.join(', ')}`);
    return true;
  }, 90_000);
  console.log(`[createBrowserGroup] All circuits and owner sessions ready for ${n - 1} live members.`);

  const endMem = process.memoryUsage().heapUsed;
  console.log(`[createBrowserGroup] Final heap: ${Math.round(endMem / 1024 / 1024)} MB (+${Math.round((endMem - startMem) / 1024 / 1024)} MB)`);

  return {
    browser,
    members,
    async close() {
      console.log('[createBrowserGroup] Closing browser...');
      const closeStart = process.memoryUsage().heapUsed;
      await closeFixture();
      const closeEnd = process.memoryUsage().heapUsed;
      console.log(`[createBrowserGroup] Cleanup heap: ${Math.round(closeEnd / 1024 / 1024)} MB (freed ~${Math.round((closeEnd - closeStart) / 1024 / 1024)} MB)`);
    }
  };
}

/**
 * Click a contact by name and wait for "Online" to appear in the conversation header.
 * This confirms a presence ping has been received and React state has the live circuit address.
 */
export async function waitForContactOnline(page, contactName, timeoutMs = 60_000) {
  // Keep the conversation selected, but verify the actual prerequisite for
  // group delivery: the presence handler persisted a live circuit address.
  // UI "Online" text is presentation state and can lag a successful presence
  // update by a render; waiting on it made the lab randomly reject healthy
  // ratchets/circuits.
  await page.locator('.inst-rows button.row', { hasText: contactName }).first().click();
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

/**
 * Create a group via InstrumentApp's NewGroupModal.
 * Navigates to the Groups tab, opens the modal, fills the name,
 * selects members by nickname, and submits.
 */
export async function createGroupUI(page, groupName, memberNicknames) {
  await page.getByRole('button', { name: 'Groups' }).click();
  await page.getByRole('button', { name: 'New group' }).first().click();
  await page.getByPlaceholder('e.g. Roadtrip').fill(groupName);
  for (const nick of memberNicknames) {
    await page.locator('.modal button.row', { hasText: nick }).first().click();
  }
  await page.locator('.modal').getByRole('button', { name: 'Create group' }).click();
  await page.getByText(groupName, { exact: false }).first().waitFor({ timeout: 15_000 });
}

export async function sendMessage(sender, receiver, text) {
  const composer = sender.locator('textarea.composer-input');
  // Wait for the composer to exist and become enabled.
  // It is disabled until nodeStatus reaches 'chatting' (session established).
  await composer.waitFor({ state: 'visible', timeout: 60_000 });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const disabled = await composer.isDisabled().catch(() => true);
    if (!disabled) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (await composer.isDisabled().catch(() => true)) {
    throw new Error('composer-input never became enabled (session not established within 60s)');
  }
  await composer.fill(text);
  await composer.press('Enter');
  await receiver.getByText(text, { exact: true }).waitFor({ timeout: 90_000 });
}

/**
 * Send a message from sender to all receivers in parallel.
 * @param {import('@playwright/test').Page} sender
 * @param {Array<import('@playwright/test').Page>} receivers
 * @param {string} text
 * @param {number} [timeoutMs=90000]
 */
export async function sendMessageToAll(sender, receivers, text, timeoutMs = 90_000) {
  const composer = sender.locator('textarea.composer-input');
  await composer.fill(text);
  await composer.press('Enter');
  // Wait for all receivers in parallel
  await Promise.all(
    receivers.map(receiver =>
      receiver.getByText(text, { exact: true }).waitFor({ timeout: timeoutMs })
    )
  );
}
