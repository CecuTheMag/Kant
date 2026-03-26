/**
 * Kant Core — Crypto & P2P primitives (Phase 0)
 */

import sodium from 'libsodium-wrappers';
import { createLibp2p, type Libp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';

export { hasIdentity, createIdentity, unlockIdentity, wipeIdentity } from './identity.js';
export type { StoredKeypair } from './identity.js';
export {
  generateX25519Keypair, ed25519ToX25519,
  x3dhSend, x3dhReceive,
  initSenderRatchet, initReceiverRatchet,
  ratchetEncrypt, ratchetDecrypt
} from './ratchet.js';
export type { X25519Keypair, X3DHPublicBundle, X3DHPrivateBundle, RatchetState, EncryptedMessage } from './ratchet.js';
export { fetchPreKeyBundle, buildPrivateBundle, buildPublicBundle, getOrCreateSPK, PREKEY_PROTOCOL } from './prekey.js';

export const PING_PROTOCOL = '/kant/ping/1.0.0';

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyHex: string;
}

export async function generateKeypair(_password: string): Promise<Keypair> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicKeyHex: sodium.to_hex(kp.publicKey)
  };
}

export type PingHandler = (fromPeerId: string, message: string) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll(stream: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
  }
  const total = new Uint8Array(chunks.reduce((n: number, c: Uint8Array) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { total.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(total);
}

import type { StoredKeypair } from './identity.js';
import { registerPrekeyHandler } from './prekey.js';

export async function createNode(onPing?: PingHandler, relayAddr?: string, identity?: StoredKeypair): Promise<Libp2p> {
  const node = await createLibp2p({
    addresses: {
      listen: relayAddr ? [`${relayAddr}/p2p-circuit`] : []
    },
    transports: [
      webSockets(),
      circuitRelayTransport()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await node.handle(PING_PROTOCOL, async (stream: any, connection: any) => {
    const message = await readAll(stream);
    onPing?.(connection.remotePeer.toString(), message);
    stream.send(new TextEncoder().encode(`pong: ${message}`));
    await stream.close();
  }, { runOnLimitedConnection: true });

  await node.start();
  if (identity) await registerPrekeyHandler(node, identity);
  return node;
}

export async function connectToRelay(node: Libp2p, relayMultiaddr: string): Promise<void> {
  await node.dial(multiaddr(relayMultiaddr));
}

export async function sendPing(node: Libp2p, peerMultiaddr: string, message: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream: any = await node.dialProtocol(multiaddr(peerMultiaddr), PING_PROTOCOL, { runOnLimitedConnection: true });
  stream.send(new TextEncoder().encode(message));
  await stream.close();
  return readAll(stream);
}

export function ping(): string {
  return 'Kant Phase 0: P2P crypto foundation ready';
}
