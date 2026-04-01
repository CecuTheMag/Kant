/**
 * Kant Core — Crypto & P2P primitives (Phase 0)
 */
import sodium from 'libsodium-wrappers';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
export { hasIdentity, createIdentity, unlockIdentity, wipeIdentity } from './identity.js';
export { generateX25519Keypair, ed25519ToX25519, x3dhSend, x3dhReceive, initSenderRatchet, initReceiverRatchet, ratchetEncrypt, ratchetDecrypt } from './ratchet.js';
export { fetchPreKeyBundle, buildPrivateBundle, buildPublicBundle, getOrCreateSPK, PREKEY_PROTOCOL } from './prekey.js';
export { addContact, getContacts, getContact, deleteContact, generateQR, parseQR } from './contacts.js';
export { saveMessage, getConversation, getAllConversations, deleteConversation } from './messages.js';
export const RECEIPT_PROTOCOL = '/kant/receipt/1.0.0';
export const PING_PROTOCOL = '/kant/ping/1.0.0';
export async function generateKeypair(_password) {
    await sodium.ready;
    const kp = sodium.crypto_sign_keypair();
    return {
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
        publicKeyHex: sodium.to_hex(kp.publicKey)
    };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
    }
    const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
        total.set(c, offset);
        offset += c.length;
    }
    return new TextDecoder().decode(total);
}
import { registerPrekeyHandler } from './prekey.js';
export async function createNode(onPing, onReceipt, relayAddr, identity) {
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
    await node.handle(PING_PROTOCOL, async (stream, connection) => {
        const message = await readAll(stream);
        onPing?.(connection.remotePeer.toString(), message);
        stream.send(new TextEncoder().encode(`pong: ${message}`));
        await stream.close();
    }, { runOnLimitedConnection: true });
    // Receipt protocol handler
    await node.handle(RECEIPT_PROTOCOL, async (stream, connection) => {
        const receiptJson = await readAll(stream);
        try {
            const receipt = JSON.parse(receiptJson);
            onReceipt?.(connection.remotePeer.toString(), receipt);
        }
        catch { }
        await stream.close();
    }, { runOnLimitedConnection: true });
    await node.start();
    if (identity)
        await registerPrekeyHandler(node, identity);
    return node;
}
export async function connectToRelay(node, relayMultiaddr) {
    await node.dial(multiaddr(relayMultiaddr));
}
export async function sendReceipt(node, peerMultiaddr, receipt) {
    const receiptJson = JSON.stringify(receipt);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = await node.dialProtocol(multiaddr(peerMultiaddr), RECEIPT_PROTOCOL, { runOnLimitedConnection: true });
    stream.send(new TextEncoder().encode(receiptJson));
    await stream.close();
}
export async function sendPing(node, peerMultiaddr, message) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = await node.dialProtocol(multiaddr(peerMultiaddr), PING_PROTOCOL, { runOnLimitedConnection: true });
    stream.send(new TextEncoder().encode(message));
    await stream.close();
    return readAll(stream);
}
export function ping() {
    return 'Kant Phase 0: P2P crypto foundation ready';
}
