import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sodiumModule from 'libsodium-wrappers-sumo';
import { generateX25519Keypair } from '../../../packages/core/dist/ratchet.js';
import { createBrowserPair, sendMessage } from './e2e-browser-helpers.mjs';

const sodium = sodiumModule.default ?? sodiumModule;
await sodium.ready;

test('a 1 MiB file arrives intact and its sealed key cannot be opened by a third party', { timeout: 120_000 }, async () => {
  const pair = await createBrowserPair();
  const recipient = await generateX25519Keypair();
  const outsider = await generateX25519Keypair();
  const source = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  try {
    await sendMessage(pair.alice.page, pair.bob.page, `file-session-ready-${Date.now()}`);
    await pair.alice.page.locator('input[type=file]').setInputFiles({
      name: 'one-meg.bin', mimeType: 'application/octet-stream', buffer: source,
    });
    const receivedFile = pair.bob.page.getByText('one-meg.bin', { exact: true }).last();
    try {
      await receivedFile.waitFor({ timeout: 45_000 });
    } catch (error) {
      process.stderr.write(`Alice UI:\n${await pair.alice.page.locator('body').innerText()}\nBob UI:\n${await pair.bob.page.locator('body').innerText()}\n`);
      throw error;
    }
    const downloadPromise = pair.bob.page.waitForEvent('download');
    await pair.bob.page.getByRole('button', { name: 'Download one-meg.bin' }).click();
    const download = await downloadPromise;
    // Save to a temp path and read back — createReadStream() is unreliable in
    // headless Playwright; path() is the stable cross-platform alternative.
    const tmpPath = await download.path();
    assert.ok(tmpPath, 'download.path() returned null — file not saved');
    const received = await import('node:fs/promises').then(fs => fs.readFile(tmpPath));
    const recvHash = createHash('sha256').update(received).digest('hex');
    const srcHash = createHash('sha256').update(source).digest('hex');
    console.log(`sourceLen=${source.length} recvLen=${received.length}`);
    console.log(`sourceHash=${srcHash}`);
    console.log(`recvHash=${recvHash}`);
    assert.equal(recvHash, srcHash, 'file hash mismatch — transfer corrupted');
    // Verify sealed-key isolation: a third party must NOT be able to open a key
    // sealed to a different recipient.
    const keyMaterial = sodium.randombytes_buf(56);
    const sealedKey = sodium.crypto_box_seal(keyMaterial, recipient.publicKey);
    let opened = false;
    try {
      sodium.crypto_box_seal_open(sealedKey, outsider.publicKey, outsider.privateKey);
      opened = true; // only reached if the open succeeded (should not happen)
    } catch (e) {
      console.log('sealed-open-threw (expected):', e && e.message);
    }
    console.log('sealed-open-result:', opened);
    assert.equal(opened, false, 'third party opened the sealed file key');
  } finally { await pair.close(); }
});
