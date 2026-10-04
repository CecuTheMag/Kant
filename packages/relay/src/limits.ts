/**
 * Circuit limits the relay grants with each reservation.
 *
 * They are sent to the client inside the reservation response as protobuf
 * uint64/uint32 fields. The protons-runtime used by @libp2p/circuit-relay-v2
 * 4.x mis-encodes uint64 values in [2^31, 2^32): they decode as 0, or shift
 * every following byte so the whole response fails to decode ("index out of
 * range"). A 2 GiB limit (exactly 2^31) did the latter: every client's first
 * reservation failed and only its 45 s self-heal restart got it online.
 */
const BROKEN_UINT64_MIN = 2n ** 31n;
const BROKEN_UINT64_MAX = 2n ** 32n - 1n;

/** True if the value survives circuit-relay-v2's protobuf encoding. */
export function isWireSafeUint64(value: bigint): boolean {
  return value >= 0n && (value < BROKEN_UINT64_MIN || value > BROKEN_UINT64_MAX);
}

/** Bytes per relayed connection before the relay closes it (large files and long chats). */
export const RELAY_DATA_LIMIT = 8n * 1024n * 1024n * 1024n; // 8 GiB
/** Lifetime of a relayed connection, ms. */
export const RELAY_DURATION_LIMIT_MS = 12 * 60 * 60 * 1000; // 12 hours

if (!isWireSafeUint64(RELAY_DATA_LIMIT)) {
  throw new Error(`RELAY_DATA_LIMIT ${RELAY_DATA_LIMIT} falls in the uint64 range circuit-relay-v2 cannot encode`);
}

/**
 * libp2p's connection-manager defaults are sized for an ordinary peer, not a
 * relay every client holds a connection to. Left at the defaults the relay
 * refused the 301st online user (maxConnections 300), and accepted only 5 new
 * connections per second per source IP (inboundConnectionThreshold). Behind
 * Caddy every client arrives from Caddy's one IP, so that 5/s was the whole
 * relay's budget: a refused client stayed offline until its app restarted
 * networking, and reconnect waves after a restart or network blip were mostly
 * refused.
 */
export interface ConnectionLimits {
  /** Concurrent connections (≈ online users + peer-relay links). */
  maxConnections: number;
  /** Concurrent circuit reservations (one per online client). */
  maxReservations: number;
  /** New inbound connections accepted per second from one IP (behind a proxy: in total). */
  inboundConnectionThreshold: number;
  /** Connections allowed to be mid-handshake at once. */
  maxIncomingPendingConnections: number;
  /**
   * Relayed connections one client may have open at once, in each direction.
   * Every relayed connection holds a circuit-relay HOP stream open on the
   * client's connection to the relay (and a STOP stream on the other end's)
   * for as long as it lives, and libp2p caps streams per protocol per
   * connection at 32 inbound by default. Left there, nobody could talk to more
   * than 32 people at once: a group owner's 33rd member, or the 33rd contact
   * online, got "The stream has been reset" on every attempt. Clients raise
   * their own side to match (CLIENT_MAX_RELAYED_CONNECTIONS in @kant/core).
   */
  maxCircuitsPerPeer: number;
}

function positiveInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

export function connectionLimits(env: Record<string, string | undefined> = process.env): ConnectionLimits {
  const maxConnections = positiveInt(env, 'RELAY_MAX_CONNECTIONS', 4096);
  return {
    maxConnections,
    maxReservations: positiveInt(env, 'RELAY_MAX_RESERVATIONS', maxConnections),
    inboundConnectionThreshold: positiveInt(env, 'RELAY_INBOUND_CONNECTIONS_PER_SECOND', 500),
    maxIncomingPendingConnections: positiveInt(env, 'RELAY_MAX_PENDING_CONNECTIONS', 256),
    maxCircuitsPerPeer: positiveInt(env, 'RELAY_MAX_CIRCUITS_PER_PEER', 1024),
  };
}
