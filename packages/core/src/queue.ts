/**
 * Kant Queue — Offline message queue with retry on peer:connect
 */

import type { Libp2p } from 'libp2p';
import { openDB, idbPut, idbDelete, idbGetAll } from './db.js';

export interface QueuedMessage {
  id: string;
  contactPubkeyHex: string;
  peerCircuitAddr: string;
  wirePayload: string; // JSON-serialised encrypted message
  timestamp: number;
  retries: number;
}

const STORE = 'queue';

export async function enqueue(msg: Omit<QueuedMessage, 'retries'>): Promise<void> {
  const db = await openDB();
  await idbPut(db, STORE, { ...msg, retries: 0 });
  db.close();
}

export async function dequeue(id: string): Promise<void> {
  const db = await openDB();
  await idbDelete(db, STORE, id);
  db.close();
}

export async function getPendingForContact(contactPubkeyHex: string): Promise<QueuedMessage[]> {
  const db  = await openDB();
  const all = await idbGetAll<QueuedMessage>(db, STORE);
  db.close();
  return all.filter(m => m.contactPubkeyHex === contactPubkeyHex);
}

export type SendFn = (wirePayload: string, peerCircuitAddr: string) => Promise<void>;

/**
 * Listen for peer:connect events and flush queued messages for that peer.
 * Returns cleanup function.
 */
export function startQueueRetry(
  _node: Libp2p,
  send: SendFn,
  onDelivered: (msgId: string) => void,
  getLiveAddr?: (contactPubkeyHex: string) => string | undefined
): () => void {
  // Per-contact backoff: tracks the earliest time we may retry for a contact.
  // Prevents peer:connect storms (every dial fires peer:connect, which would
  // re-trigger the queue flush, which dials again — infinite loop).
  const backoffUntil = new Map<string, number>();
  const inFlight = new Set<string>();
  const BACKOFF_MS = 15000;
  const POLL_MS = 5000;

  async function flushPending() {
    const db = await openDB();
    const all = await idbGetAll<any>(db, 'contacts');
    db.close();

    for (const contact of all) {
      if (!contact.publicKeyHex || inFlight.has(contact.publicKeyHex)) continue;
      const now = Date.now();
      if ((backoffUntil.get(contact.publicKeyHex) ?? 0) > now) continue;

      const pending = await getPendingForContact(contact.publicKeyHex);
      if (!pending.length) continue;

      // The caller refreshes this address from the signed relay directory and
      // presence frames. Never retry against the address embedded in the queued
      // record: it may refer to an expired reservation after sleep or churn.
      const liveAddr = getLiveAddr?.(contact.publicKeyHex);
      if (!liveAddr) continue;

      inFlight.add(contact.publicKeyHex);
      let anyFailed = false;
      try {
        for (const msg of pending) {
          try {
            await send(msg.wirePayload, liveAddr);
            onDelivered(msg.id);
            // A completed stream write is not proof of delivery. Keep the
            // exact ciphertext until the recipient ACK removes it so a lost
            // relay write remains recoverable across reconnects/restarts.
            backoffUntil.set(contact.publicKeyHex, Date.now() + BACKOFF_MS);
            console.log('[queue] resent queued msg', msg.id.replace(/[^\w-]/g, '').slice(0, 16));
          } catch (e: any) {
            anyFailed = true;
            console.warn('[queue] retry failed for', msg.id.replace(/[^\w-]/g, '').slice(0, 16), String(e).slice(0, 120));
            // A contact has one ordered ratchet stream. Preserve queue order and
            // stop after the first transport failure.
            break;
          }
        }
      } finally {
        inFlight.delete(contact.publicKeyHex);
      }
      if (anyFailed) backoffUntil.set(contact.publicKeyHex, now + BACKOFF_MS);
    }
  }

  // peer:connect is too early for circuit-relay delivery and may fire for the
  // relay itself. Poll durable queue state instead; failures are bounded by the
  // per-contact backoff and only one ordered drain may run at a time.
  const timer = setInterval(() => {
    void flushPending().catch(error => {
      console.warn('[queue] periodic retry failed', String(error).slice(0, 120));
    });
  }, POLL_MS);
  void flushPending().catch(() => {});

  return () => {
    clearInterval(timer);
    inFlight.clear();
  };
}
