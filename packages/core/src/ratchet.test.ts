import {
  createIdentity,
  x3dhSend, x3dhReceive, ed25519ToX25519,
  initSenderRatchet, initReceiverRatchet,
  ratchetEncrypt, ratchetDecrypt,
  buildPublicBundle, buildPrivateBundle,
} from './index.js';

async function testRatchet() {
  // Alice creates identity
  const aliceKp = await createIdentity('alicepass');

  // Bob creates identity
  const bobKp = await createIdentity('bobpass');

  // Bob builds public bundle
  const bobPublicBundle = await buildPublicBundle(bobKp);

  // Alice converts her Ed25519 identity to X25519 for X3DH
  const aliceX25519 = await ed25519ToX25519(aliceKp.publicKey, aliceKp.privateKey);

  // Alice performs X3DH send
  const x3dhResult = await x3dhSend(aliceX25519, bobPublicBundle);
  const aliceShared = x3dhResult.sharedSecret;

  // Bob performs X3DH receive — must pass aliceIdentityPub (X25519) and ephemeralPub
  const bobPrivateBundle = await buildPrivateBundle(bobKp);
  const bobShared = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, x3dhResult.ephemeralPublic);

  if (aliceShared.length !== 32 || bobShared.length !== 32) throw new Error('X3DH shared secret wrong length');
  if (!aliceShared.every((b, i) => b === bobShared[i])) throw new Error('X3DH shared secrets do not match');
  console.log('X3DH ✅');

  // Init ratchets
  const aliceRatchet = await initSenderRatchet(aliceShared, bobPublicBundle.signedPreKey);
  const bobRatchet   = await initReceiverRatchet(bobShared, bobPrivateBundle.signedPreKeypair);

  // Alice encrypts, Bob decrypts
  const msg1 = 'Hello secure ratchet world!';
  const enc1 = await ratchetEncrypt(aliceRatchet, msg1);
  const dec1 = await ratchetDecrypt(bobRatchet, enc1);
  if (dec1 !== msg1) throw new Error(`Decrypt mismatch: ${dec1} != ${msg1}`);

  // Bob replies (DH ratchet step fires here)
  const msg2 = 'Hi back, ratcheted!';
  const enc2 = await ratchetEncrypt(bobRatchet, msg2);
  const dec2 = await ratchetDecrypt(aliceRatchet, enc2);
  if (dec2 !== msg2) throw new Error(`Reply mismatch: ${dec2} != ${msg2}`);

  console.log('Full ratchet roundtrip ✅');
}

testRatchet().catch(console.error);
