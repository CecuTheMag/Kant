/**
 * The other side of the iOS messaging test: a Kant web client in headless
 * Chromium, on the same machine and relay as the iOS Simulator.
 *
 *   node tests/lab/local/ios-peer.mjs <relay url> <file for the invite link>
 *
 * Onboards, writes its invite link to the file (CI passes it to the iOS UI
 * test), accepts the iPhone's message request, and answers "hello from
 * iPhone" with "hello from the web". Then stays online until it is stopped.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { serveApp } from './harness.mjs';
import { onboard, identityKey, inviteLink, sendText, incoming } from '../tests/e2e-browser-helpers.mjs';

const [relay, linkFile] = process.argv.slice(2);
if (!relay || !linkFile) {
  console.error('usage: node tests/lab/local/ios-peer.mjs <relay url> <link file>');
  process.exit(2);
}

const app = await serveApp(39790);
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
page.on('console', (m) => { if (/session|x3dh|presence|request|decrypt|FAIL/i.test(m.text())) console.log('[web]', m.text()); });
await page.goto(app.url);
await onboard(page, 'Web peer', relay);
writeFileSync(linkFile, inviteLink(await identityKey(page), 'Web peer'));
console.log('invite link written');

// The iPhone's first message arrives as a request from someone not in our
// contacts: Message requests → open it → Accept.
await page.locator('.k-requests-row').click({ timeout: 30 * 60_000 });
await page.getByRole('dialog', { name: 'Message requests' }).locator('button.k-cell').first().click();
await page.getByRole('button', { name: 'Accept', exact: true }).click({ timeout: 60_000 });
await incoming(page, 'hello from iPhone').waitFor({ timeout: 180_000 });
console.log('got the iPhone message');
await sendText(page, 'hello from the web');
console.log('replied');
await new Promise((resolve) => setTimeout(resolve, 30 * 60_000));
await browser.close();
await app.close();
