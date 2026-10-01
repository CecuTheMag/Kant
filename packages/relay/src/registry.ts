/**
 * Whether a /register request may write the registry entry for `key`.
 *
 * The signature proves only the signing (identity) key, so a request owns
 * `key` when it is that key. Any other key it lists (an ephemeral key) is
 * unproven: it may take a free slot or refresh an entry the same device holds,
 * never another device's. Otherwise a connected client could re-point someone
 * else's registration to itself, or delete it by disconnecting. Ephemeral keys
 * are random and a device's PeerID follows from its identity, so honest
 * clients never collide with another device here.
 */
export function mayWriteRegistryKey(
  existing: { peerId: string } | undefined,
  key: string,
  signingKeyHex: string,
  peerId: string,
): boolean {
  if (key.toLowerCase() === signingKeyHex.toLowerCase()) return true;
  return !existing || existing.peerId === peerId;
}
