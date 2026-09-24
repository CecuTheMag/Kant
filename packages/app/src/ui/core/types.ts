/**
 * Types mirroring the real Kant app so components port cleanly.
 *
 * `Contact`, `PlainMessage`, `MessageStatus` and `NodeStatus` keep the field names used by
 * `@kant/core` and `hooks/useKant` (see the design-pass patch: `msg.from === 'me'`, `msg.ts`,
 * `c.publicKeyHex`, `c.nickname`, `c.circuitAddr`). Fields this prototype ADDS are marked —
 * those are the ones that need real backing state when porting.
 */

/** Sent → delivered → read, plus the two failure/limbo states. Same shape as core. */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * ADDED. The real app has a boolean-ish connected state; this models the full ladder so the
 * UI can say something honest at every point instead of just "Offline".
 */
export type NodeStatus =
  | 'offline'
  | 'connecting'
  | 'relay'   // reachable, traffic goes through the relay
  | 'direct'  // direct peer connection, no relay in path
  | 'onion'   // routed through intermediate peers, relay can't see endpoints
  | 'error';

/** ADDED. Persistent per-contact verification state — the core of this design pass. */
export type TrustState = 'unverified' | 'verified' | 'changed';

export interface RouteHop {
  /** Short label shown in the route ribbon: 'you', 'relay', a peer short-id, or the contact. */
  label: string;
  kind: 'self' | 'relay' | 'hop' | 'peer';
  /** Round-trip contribution in ms, when known. */
  ms?: number;
}

export interface MessageAttachment {
  /** Stable blob id used by the encrypted file store. Mock attachments omit it. */
  fileId?: string;
  name: string;
  mime: string;
  size: number;
  sha256?: string;
  thumbnail?: string;
  display?: 'inline' | 'attachment';
}

export interface Contact {
  /**
   * ADDED, and this is the load-bearing change. A contact is an entity whose key can change;
   * the shipping app uses `publicKeyHex` itself as the identifier, which makes "same person,
   * new key" unrepresentable — you get a stranger instead of a warning. Stable id, mutable key.
   */
  id?: string;
  publicKeyHex: string;
  nickname?: string;
  circuitAddr?: string;
  /** ADDED — needs persisting alongside the contact record. */
  trust: TrustState;
  /** ADDED — when trust === 'changed', the key we knew before. */
  previousKeyHex?: string;
  /** ADDED — when the ceremony was completed, so the warning can say "you verified this on…". */
  verifiedAt?: number;
  online: boolean;
  lastSeen?: number;
  /** ADDED — denormalised for the list row. Handoff §9.6 flagged this as needing real state. */
  lastMessage?: string;
  lastMessageTs?: number;
  unread?: number;
  pinned?: boolean;
  muted?: boolean;
  /** Someone who messaged us before we added them — shown as a message request. */
  request?: boolean;
  /** Messages from this contact are dropped on arrival. */
  blocked?: boolean;
}

export interface PlainMessage {
  id: string;
  /** 'me' for outbound, otherwise the sender's public key hex. */
  from: 'me' | string;
  ts: number;
  text: string;
  status: MessageStatus;
  attachments?: MessageAttachment[];
  /** ADDED — provenance. Which path this message actually took. */
  route?: RouteHop[];
  /** Expiring message deadline, if set. */
  expiresAt?: number;
  /** ADDED — a system/protocol event rendered inline (key change, session reset…). */
  system?: 'key-changed' | 'session-reset' | 'verified' | 'joined' | 'left';
  /** Quoted-message reference, when this message was sent as a reply. */
  replyTo?: { id: string; from: string; text: string };
}

export interface Group {
  id: string;
  name: string;
  memberKeys: string[];
  createdAt?: number;
  lastMessage?: string;
  lastMessageTs?: number;
  unread?: number;
}

/** A peer discovered on the network — a libp2p peer ID, NOT a Kant identity. */
export interface PeerInfo {
  peerId: string;
  multiaddrs?: string[];
}

export interface Identity {
  publicKeyHex: string;
  nickname: string;
  circuitAddr: string;
}
