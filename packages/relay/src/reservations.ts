// Kant Relay — Reservation Tracking
// Tracks circuit-relay-v2 reservations by listening to relay events.
// Note: libp2p's internal reservation map is not directly exposed,
// so we maintain our own tracking map synchronized via events.

import { EventEmitter } from 'events';
import { log } from './logger.js';
import { adminEvictions, reservationsActive, reservationsTracked, reservationsCreated } from './metrics.js';

/** Maximum reservation duration in milliseconds (12 hours) */
const MAX_RESERVATION_DURATION_MS = 12 * 60 * 60 * 1000;

/** Interval for reconciling the tracked map against libp2p's reservation store */
const SYNC_INTERVAL_MS = 10 * 1000;

/** Sweep interval for expired reservations (60 seconds) */
const SWEEP_INTERVAL_MS = 60 * 1000;

/** Maximum number of reservations (matches circuit-relay-v2 config) */
export const MAX_RESERVATIONS = 1024;

/** Reservation status enum */
export type ReservationStatus = 'active' | 'evicted' | 'expired';

/** A tracked reservation entry */
export interface ReservationEntry {
  peerId: string;
  address: string;
  expires: number;         // Unix timestamp (ms) when reservation expires
  createdAt: number;       // Unix timestamp (ms) when we first saw it
  dataUsed: bigint;        // Bytes used on this reservation
  duration: number;        // Duration in ms (estimated from max or actual)
  status: ReservationStatus;
}

/** Simplified reservation info returned by admin endpoints */
export interface ReservationInfo {
  peerId: string;
  address: string;
  expires: number;
  createdAt: number;
  status: ReservationStatus;
  dataUsed?: bigint;
  duration?: number;
}

/** Internal map of peerId -> ReservationEntry */
const reservations = new Map<string, ReservationEntry>();

/** Event emitter for reservation changes (for potential future use) */
const reservationEvents = new EventEmitter();

/**
 * Track a new reservation created by a peer.
 * Called when the relay:reservation-created event fires.
 */
export function trackReservation(peerId: string, address: string, _dataLimit?: bigint, durationLimit?: number): void {
  const now = Date.now();
  const duration = durationLimit ?? MAX_RESERVATION_DURATION_MS;
  const existing = reservations.get(peerId);
  if (existing) {
    existing.address = address;
    existing.expires = now + duration;
    existing.duration = duration;
    existing.status = 'active';
    reservationsTracked.set(reservations.size);
    reservationsActive.set(reservations.size);
    log.info({ event: 'reservation.refreshed', peerId: peerId.slice(0, 12), expires: new Date(existing.expires).toISOString() }, 'reservation refreshed');
    reservationEvents.emit('refreshed', existing);
    return;
  }
  
  const entry: ReservationEntry = {
    peerId,
    address,
    expires: now + duration,
    createdAt: now,
    dataUsed: 0n,
    duration,
    status: 'active',
  };
  
  reservations.set(peerId, entry);
  reservationsTracked.set(reservations.size);
  reservationsActive.set(reservations.size);
  
  log.info({ 
    event: 'reservation.tracked', 
    peerId: peerId.slice(0, 12),
    expires: new Date(entry.expires).toISOString(),
    duration
  }, 'reservation tracked');
  
  reservationEvents.emit('tracked', entry);
}

/**
 * Update data usage for a reservation.
 * Called when relay reports data usage changes.
 */
export function updateReservationData(peerId: string, dataUsed: bigint): void {
  const entry = reservations.get(peerId);
  if (entry) {
    entry.dataUsed = dataUsed;
  }
}

/**
 * Mark a reservation as removed (cleaned up by libp2p).
 * Called when the relay:reservation-removed event fires.
 */
export function untrackReservation(peerId: string): void {
  const entry = reservations.get(peerId);
  if (entry) {
    reservations.delete(peerId);
    reservationsTracked.set(reservations.size);
    reservationsActive.set(reservations.size);
    
    log.info({ 
      event: 'reservation.untracked', 
      peerId: peerId.slice(0, 12),
      reason: 'removed'
    }, 'reservation untracked');
    
    reservationEvents.emit('untracked', entry);
  }
}

/**
 * Soft-evict a reservation.
 * Note: libp2p doesn't expose a direct eviction API. This marks the entry
 * as evicted and returns info, but true eviction requires the peer to
 * reconnect and not request a reservation.
 * 
 * @param peerId The peer to evict
 * @returns The evicted entry or undefined if not found
 */
export function evictReservation(peerId: string): ReservationEntry | undefined {
  const entry = reservations.get(peerId);
  if (!entry) {
    return undefined;
  }
  
  entry.status = 'evicted';
  reservations.delete(peerId);
  reservationsTracked.set(reservations.size);
  reservationsActive.set(reservations.size);
  adminEvictions.inc();
  
  log.info({ 
    event: 'admin.reservation.evicted', 
    peerId: peerId.slice(0, 12)
  }, 'reservation soft-evicted via admin');
  
  reservationEvents.emit('evicted', entry);
  return entry;
}

/**
 * Get all active (non-evicted, non-expired) reservations.
 */
export function getActiveReservations(): ReservationInfo[] {
  const now = Date.now();
  const active: ReservationInfo[] = [];
  
  for (const [, entry] of reservations) {
    if (entry.status === 'active' && entry.expires > now) {
      active.push({
        peerId: entry.peerId,
        address: entry.address,
        expires: entry.expires,
        createdAt: entry.createdAt,
        status: entry.status,
      });
    }
  }
  
  return active;
}

/**
 * Get all tracked reservations (including evicted/expired that haven't been cleaned up).
 */
export function getAllReservations(): ReservationInfo[] {
  const now = Date.now();
  const all: ReservationInfo[] = [];
  
  for (const [, entry] of reservations) {
    // Auto-expire entries that have passed their expiry time
    let status = entry.status;
    if (status === 'active' && entry.expires <= now) {
      status = 'expired';
    }
    
    all.push({
      peerId: entry.peerId,
      address: entry.address,
      expires: entry.expires,
      createdAt: entry.createdAt,
      status,
      dataUsed: entry.dataUsed,
      duration: entry.duration,
    });
  }
  
  return all;
}

/**
 * Get detailed info about a specific reservation.
 */
export function getReservation(peerId: string): ReservationInfo | undefined {
  const entry = reservations.get(peerId);
  if (!entry) {
    return undefined;
  }
  
  const now = Date.now();
  let status = entry.status;
  if (status === 'active' && entry.expires <= now) {
    status = 'expired';
  }
  
  return {
    peerId: entry.peerId,
    address: entry.address,
    expires: entry.expires,
    createdAt: entry.createdAt,
    status,
    dataUsed: entry.dataUsed,
    duration: entry.duration,
  };
}

/**
 * Get the count of remaining active reservations.
 */
export function getReservationCount(): number {
  return reservations.size;
}

/**
 * Reconcile our tracking map with circuit-relay-v2's real reservation store.
 *
 * circuit-relay-v2 4.x declares server-side reservation events in its type map
 * ('relay:reservation', 'relay:created-reservation', ...) but never dispatches
 * any of them — the compiled server code contains zero dispatchEvent calls.
 * Event-driven tracking therefore stays at zero forever. Polling
 * `node.services.relay.reservations` (the live PeerMap the server actually
 * gates hop-connect on) is the only reliable signal.
 *
 * @param node       The running libp2p node (services.relay = CircuitRelayServer)
 * @param intervalMs Poll cadence (default 10s)
 * @returns          A stop function that clears the interval
 */
export function startReservationSync(node: any, intervalMs: number = SYNC_INTERVAL_MS): () => void {
  const sync = () => {
    try {
      const service = node?.services?.relay;
      const peerMap = service?.reservations;
      if (!peerMap) return;

      const now = Date.now();
      const seen = new Set<string>();

      for (const [peerId, res] of peerMap.entries()) {
        const pid = String(peerId);
        seen.add(pid);
        const addr = res?.addr?.toString?.() ?? '';
        const expires = res?.expiry?.getTime?.() ?? now + MAX_RESERVATION_DURATION_MS;
        const existing = getReservation(pid);
        const isFresh = existing && existing.status === 'active'
          && existing.address === addr && existing.expires === expires;
        if (!isFresh) {
          trackReservation(pid, addr, undefined, Math.max(0, expires - now));
          if (!existing) reservationsCreated.inc();
        }
      }

      // Untrack entries libp2p no longer holds. Expired-but-tracked entries
      // are left for the sweep's grace window (in-flight reconnects).
      for (const info of getAllReservations()) {
        if (!seen.has(info.peerId) && info.status === 'active') {
          untrackReservation(info.peerId);
        }
      }
    } catch { /* non-fatal — retry next tick */ }
  };

  sync();
  const timer = setInterval(sync, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Sweep expired reservations from the tracking map.
 * Called periodically to clean up stale entries.
 */
function sweepExpiredReservations(): void {
  const now = Date.now();
  let swept = 0;
  // Collect keys to delete first to avoid mutating the map mid-iteration.
  const toDelete: string[] = [];

  for (const [, entry] of reservations) {
    if (entry.status === 'active' && entry.expires <= now) {
      entry.status = 'expired';
    }
    // Only remove entries that expired at least 60s ago (grace window for
    // in-flight reconnects) or that were explicitly evicted.
    if (entry.status === 'evicted' ||
        (entry.status === 'expired' && entry.expires <= now - 60_000)) {
      toDelete.push(entry.peerId);
    }
  }

  for (const peerId of toDelete) {
    if (reservations.delete(peerId)) {
      reservationsTracked.set(reservations.size);
      reservationsActive.set(reservations.size);
      swept++;
    }
  }

  if (swept > 0) {
    log.info({ event: 'reservation.sweep', swept }, 'expired reservations swept');
  }
}

// Start the periodic sweep
setInterval(sweepExpiredReservations, SWEEP_INTERVAL_MS);

/**
 * Get the EventEmitter for reservation events.
 * Useful for testing and external monitoring.
 */
export function getReservationEvents(): EventEmitter {
  return reservationEvents;
}
