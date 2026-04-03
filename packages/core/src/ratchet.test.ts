import { createIdentity, unlockIdentity, x3dhSend, x3dhReceive, initSenderRatchet, initReceiverRatchet, ratchetEncrypt, ratchetDecrypt, buildPublicBundle, buildPrivateBundle } from './index.js';

async function testRatchet() {
  // Alice creates identity
  const alicePass = 'alicepass';
  await createIdentity(alicePass);
  const aliceKp = await unlockIdentity(alicePass);
  if (!aliceKp) throw new Error('Alice unlock failed');

  // Bob creates identity
  const bobPass = 'bobpass';
  await createIdentity(bobPass);
  const bobKp = await unlockIdentity(bobPass);
  if (!bobKp) throw new Error('Bob unlock failed');

  // Bob builds public bundle
  const bobPublicBundle = await buildPublicBundle(bobKp);

  // Alice performs X3DH send with her identity Kp
  const x3dhResult = await x3dhSend(aliceKp, bobPublicBundle);
  const aliceShared = x3dhResult.sharedSecret;

  // Bob performs X3DH receive
  const bobPrivateBundle = await buildPrivateBundle(bobKp);
  const bobShared = await x3dhReceive(bobPrivateBundle, x3dhResult.ephemeralPublic);

  console.assert(aliceShared.length === 32 && bobShared.length === 32, 'X3DH shared secrets mismatch length');
  console.log('X3DH ✅');

  // Init ratchets
  const aliceRatchet = await initSenderRatchet(aliceShared, bobPublicBundle.signedPreKey);
  const bobRatchet = await initReceiverRatchet(bobShared, bobPrivateBundle.signedPreKeypair);

  // Alice encrypts, Bob decrypts
  const msg1 = 'Hello secure ratchet world!';
  const enc1 = await ratchetEncrypt(aliceRatchet, msg1);
  const dec1 = await ratchetDecrypt(bobRatchet, enc1);
  console.assert(dec1 === msg1, `Decrypt mismatch: ${dec1} != ${msg1}`);

  // Bob replies
  const msg2 = 'Hi back, ratcheted!';
  const enc2 = await ratchetEncrypt(bobRatchet, msg2);
  const dec2 = await ratchetDecrypt(aliceRatchet, enc2);
  console.assert(dec2 === msg2, `Reply mismatch: ${dec2} != ${msg2}`);

  console.log('Full ratchet roundtrip ✅');
}

testRatchet().catch(console.error);

