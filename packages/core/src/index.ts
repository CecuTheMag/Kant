/**
 * Kant Core — Crypto & P2P primitives (Phase 0)
 */

import sodium from 'libsodium-wrappers-sumo';
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

export { addContact, getContacts, getContact, deleteContact, generateQR, parseQR } from './contacts.js';
export type { Contact } from './contacts.js';

export { saveMessage, getConversation, getAllConversations, deleteConversation } from './messages.js';
export type { StoredMessage, Conversation, MessageStatus } from './messages.js';

export { startDiscovery, getKnownPeers } from './discovery.js';
export type { DiscoveredPeer, PeerDiscoveryHandler } from './discovery.js';

export { enqueue, dequeue, getPendingForContact, startQueueRetry } from './queue.js';
export type { QueuedMessage, SendFn } from './queue.js';

export const RECEIPT_PROTOCOL = '/kant/receipt/1.0.0';

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

export type ReceiptHandler = (fromPeerId: string, receipt: {msgId: string, status: 'sending' | 'sent' | 'delivered' | 'read', fromPubKeyHex: string}) => void;

export async function createNode(onPing?: PingHandler, onReceipt?: ReceiptHandler, relayAddr?: string, identity?: StoredKeypair): Promise<Libp2p> {
  console.log('[createNode] Starting, relay:', relayAddr);

  const node = await createLibp2p({
    addresses: {
      // Passing the relay addr as a listen address triggers the circuit relay
      // transport to make a reservation and announce a /p2p-circuit address.
      listen: relayAddr ? [`${relayAddr}/p2p-circuit`] : []
    },
    transports: [
      webSockets(),
      circuitRelayTransport()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
    connectionGater: { denyDialMultiaddr: () => false }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await node.handle(PING_PROTOCOL, async (stream: any, connection: any) => {
    const message = await readAll(stream);
    onPing?.(connection.remotePeer.toString(), message);
    stream.send(new TextEncoder().encode(`pong: ${message}`));
    await stream.close();
  }, { runOnLimitedConnection: true });

  await node.handle(RECEIPT_PROTOCOL, async (stream: any, connection: any) => {
    const receiptJson = await readAll(stream);
    try {
      const receipt = JSON.parse(receiptJson) as {msgId: string, status: 'sending' | 'sent' | 'delivered' | 'read', fromPubKeyHex: string};
      onReceipt?.(connection.remotePeer.toString(), receipt);
    } catch {}
    await stream.close();
  }, { runOnLimitedConnection: true });

  await node.start();
  console.log('[createNode] Started, peerId:', node.peerId.toString());

  if (identity) await registerPrekeyHandler(node, identity);
  return node;
}

export async function getRelayInfo(httpPort?: number): Promise<{ peerId: string; multiaddr: string } | null> {
  const envPort = (import.meta as any).env?.VITE_RELAY_HTTP_PORT;
  const ports = httpPort ? [httpPort] : envPort ? [parseInt(envPort)] : [3001, 3003, 3005];
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/relay-info`);
      if (!res.ok) continue;
      const data = await res.json();
      console.log(`[getRelayInfo] Found relay on port ${port}:`, data.multiaddr);
      return data;
    } catch {}
  }
  return null;
}

export async function connectToRelay(node: Libp2p, relayAddr: string): Promise<void> {
  console.log('Connecting to relay:', relayAddr);
  await node.dial(multiaddr(relayAddr));
  await new Promise(r => setTimeout(r, 1500)); // Wait for identify
}

export async function sendReceipt(node: Libp2p, peerMultiaddr: string, receipt: {msgId: string, status: 'sending' | 'sent' | 'delivered' | 'read', fromPubKeyHex?: string}): Promise<void> {
  const receiptJson = JSON.stringify(receipt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream: any = await node.dialProtocol(multiaddr(peerMultiaddr), RECEIPT_PROTOCOL, { runOnLimitedConnection: true });
  stream.send(new TextEncoder().encode(receiptJson));
  await stream.close();
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
