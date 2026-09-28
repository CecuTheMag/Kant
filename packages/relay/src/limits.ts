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
