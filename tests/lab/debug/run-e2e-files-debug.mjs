import { createHash } from 'node:crypto';
import sodiumModule from 'libsodium-wrappers-sumo';
import { generateX25519Keypair } from '../../../packages/core/dist/ratchet.js';
import { createBrowserPair, sendMessage } from '../tests/e2e-browser-helpers.mjs';

const sodium = sodiumModule.default ?? sodiumModule;
await sodium.ready;

async function main(){
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
    await receivedFile.waitFor({ timeout: 45_000 });
    const downloadPromise = pair.bob.page.waitForEvent('download');
    await pair.bob.page.getByRole('button', { name: 'Download one-meg.bin' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const received = Buffer.concat(chunks);
    const recvHash = createHash('sha256').update(received).digest('hex');
    const srcHash = createHash('sha256').update(source).digest('hex');
    console.log(`sourceLen=${source.length} recvLen=${received.length}`);
    console.log(`sourceHash=${srcHash}`);
    console.log(`recvHash=${recvHash}`);
    if (recvHash !== srcHash) {
      console.error('HASH MISMATCH');
    } else {
      console.log('HASH OK');
    }
    const keyMaterial = sodium.randombytes_buf(56);
    const sealedKey = sodium.crypto_box_seal(keyMaterial, recipient.publicKey);
    let opened = false;
    try { opened = sodium.crypto_box_seal_open(sealedKey, outsider.publicKey, outsider.privateKey); } catch (e) { console.log('sealed-open-error', e && e.message); }
    console.log('sealed-open-result-type', typeof opened, Object.prototype.toString.call(opened));
    console.log('sealed-open-result-value', opened);
    if (opened !== false) console.error('Third party opened sealed key!');
  } catch (e) {
    console.error('ERROR in test body:', e);
  } finally {
    await pair.close();
  }
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)});
