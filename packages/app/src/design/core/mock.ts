/**
 * Mock data + a fake network state machine.
 *
 * This stands in for `hooks/useKant` + `@kant/core` so the UI can be driven through every
 * state — including the ones you'd otherwise have to manufacture with two browser profiles
 * and a live relay (key rotation, relay failure, onion path established).
 *
 * Nothing here is real crypto. Porting means replacing this module and nothing else.
 */

import type { Contact, Group, Identity, PlainMessage, NodeStatus, RouteHop } from './types';

export const ME: Identity = {
  publicKeyHex: '7c1e4a09b83d5f26ae90c47db215f8036ea9c5d1470b8e3f92a6c05d1e7b34af',
  nickname: 'you',
  circuitAddr:
    '/dns4/relay.stormlabs.cloud/tcp/8443/tls/ws/p2p/12D3KooWFj4VsJSPrGaHfSHEqR22NLG7Jz7Dhzg1heLne4n7MWmV/p2p-circuit/p2p/12D3KooWBXgHpxRyaVaQwvkASTFFE2CZe5F3A1PgPWtHzET5BqBW',
};

const H = 3600_000;
const M = 60_000;
const now = Date.now();

export const CONTACTS: Contact[] = [
  {
    publicKeyHex: '1970fda84cef6eeed40df23d0cc16acbb0425f96ebdc5d56f4293f0a79315ef1',
    nickname: 'Mara',
    circuitAddr: '/p2p-circuit/p2p/12D3KooWBXgHpxRyaVaQwvkASTFFE2CZe5F3A1PgPWtHzET5BqBW',
    trust: 'verified',
    online: true,
    lastMessage: 'the relay in Sofia is back up, try again',
    lastMessageTs: now - 4 * M,
    unread: 2,
    pinned: true,
  },
  {
    publicKeyHex: 'da41afc089b6e27f3105cd9a8e4b7362f0d81ca594736ebd2f8071ac36e5d9b4',
    nickname: 'Tobias',
    circuitAddr: '/p2p-circuit/p2p/12D3KooWQx8mRt4KpLdA2VnZcE9FhJb7SgWy1TuXrN6oPmKe3ZaD',
    // The interesting one: we had verified them, and the key changed underneath.
    trust: 'changed',
    previousKeyHex: 'da41afc089b6e27f3105cd9a8e4b7362f0d81ca594736ebd2f8071ac36e5d9b4',
    online: true,
    lastMessage: 'new phone — resending my key',
    lastMessageTs: now - 26 * M,
    unread: 1,
  },
  {
    publicKeyHex: 'b3e70c8a45f19d2e6a0b84c37f5d1e92834ac6b0df51782e9c34a6d0b85f172c',
    nickname: 'Ines',
    circuitAddr: '/p2p-circuit/p2p/12D3KooWLp2vNq7XsBmT4YdKcF8RgHj5WnAe1QuZoP9tMxVb6CeR',
    trust: 'verified',
    online: false,
    lastSeen: now - 3 * H,
    lastMessage: 'you: sent the build',
    lastMessageTs: now - 3 * H,
  },
  {
    publicKeyHex: '5f8a2c60e94b7d13a85fc026b71e4d38920ac57f6be013d84a2f9c6b05e73d1a',
    nickname: 'Jonas',
    circuitAddr: '/p2p-circuit/p2p/12D3KooWTv6yHc3RmQ8bXnJkD5FgLp7WsAe2NuZoR4tYxMb9CqPd',
    trust: 'unverified',
    online: true,
    lastMessage: 'who else is on this relay?',
    lastMessageTs: now - 19 * H,
  },
  {
    publicKeyHex: 'c62d19f7a0b48e35d17c9f2604ba8e713d5f0c26a94b8ef317206dc5b40f9a8e',
    nickname: 'Halvard',
    // No circuit address — we know the key but have no way to reach them yet.
    trust: 'unverified',
    online: false,
    lastSeen: now - 6 * 86400_000,
    lastMessage: 'no address on file',
    lastMessageTs: now - 6 * 86400_000,
  },
];

export const GROUPS: Group[] = [
  {
    id: 'g1',
    name: 'Relay ops',
    memberKeys: [CONTACTS[0].publicKeyHex, CONTACTS[2].publicKeyHex, CONTACTS[3].publicKeyHex],
    lastMessage: 'Mara: rotating the cert tonight, expect a blip',
    lastMessageTs: now - 51 * M,
    unread: 5,
  },
  {
    id: 'g2',
    name: 'Cabin trip',
    memberKeys: [CONTACTS[1].publicKeyHex, CONTACTS[2].publicKeyHex],
    lastMessage: 'Ines: I can drive, 4 seats',
    lastMessageTs: now - 2 * 86400_000,
  },
];

const RELAY_ROUTE: RouteHop[] = [
  { label: 'you', kind: 'self' },
  { label: 'relay.stormlabs', kind: 'relay', ms: 34 },
  { label: 'Mara', kind: 'peer', ms: 22 },
];

const ONION_ROUTE: RouteHop[] = [
  { label: 'you', kind: 'self' },
  { label: 'relay.stormlabs', kind: 'relay', ms: 31 },
  { label: '12D3…7fQa', kind: 'hop', ms: 48 },
  { label: '12D3…c2Rv', kind: 'hop', ms: 41 },
  { label: 'Mara', kind: 'peer', ms: 19 },
];

const DIRECT_ROUTE: RouteHop[] = [
  { label: 'you', kind: 'self' },
  { label: 'Mara', kind: 'peer', ms: 12 },
];

export const ROUTES: Record<string, RouteHop[]> = {
  relay: RELAY_ROUTE,
  onion: ONION_ROUTE,
  direct: DIRECT_ROUTE,
};

const mara = CONTACTS[0].publicKeyHex;
const tobias = CONTACTS[1].publicKeyHex;

export const THREADS: Record<string, PlainMessage[]> = {
  [mara]: [
    { id: 'm1', from: mara, ts: now - 27 * H, text: 'did the reservation drop again overnight?', status: 'read' },
    { id: 'm2', from: 'me', ts: now - 26.9 * H, text: 'yeah. third time this week. I think the relay is evicting us when it restarts.', status: 'read', route: RELAY_ROUTE },
    { id: 'm3', from: mara, ts: now - 26.8 * H, text: 'the reservation TTL is 15 min and the container restarts on the hour. so we lose it every time.', status: 'read' },
    { id: 'm4', from: 'me', ts: now - 3 * H, text: 'ok that explains the pattern. can you pin the container?', status: 'read', route: ONION_ROUTE },
    {
      id: 'm5', from: mara, ts: now - 52 * M,
      text: 'done. also grabbed a proper cert so we can drop the self-signed one.',
      status: 'read',
      attachments: [{ name: 'relay-config.yaml', mime: 'text/yaml', size: 2841 }],
    },
    { id: 'm6', from: mara, ts: now - 6 * M, text: 'the relay in Sofia is back up, try again', status: 'delivered' },
    { id: 'm7', from: mara, ts: now - 4 * M, text: 'reservation has held for 40 min so far', status: 'delivered' },
  ],
  [tobias]: [
    { id: 't1', from: tobias, ts: now - 4 * 86400_000, text: 'sending you the venue list tonight', status: 'read' },
    { id: 't2', from: 'me', ts: now - 4 * 86400_000 + 5 * M, text: 'no rush', status: 'read', route: RELAY_ROUTE },
    { id: 't3', from: tobias, ts: now - 28 * M, text: '', status: 'read', system: 'key-changed' },
    { id: 't4', from: tobias, ts: now - 26 * M, text: 'new phone — resending my key', status: 'delivered' },
  ],
  [CONTACTS[2].publicKeyHex]: [
    { id: 'i1', from: CONTACTS[2].publicKeyHex, ts: now - 5 * H, text: 'is the android build signed yet?', status: 'read' },
    { id: 'i2', from: 'me', ts: now - 3 * H, text: 'debug only for now', status: 'read', route: RELAY_ROUTE, attachments: [{ name: 'Kant-debug.apk', mime: 'application/vnd.android.package-archive', size: 5_179_696 }] },
  ],
  [CONTACTS[3].publicKeyHex]: [
    { id: 'j1', from: CONTACTS[3].publicKeyHex, ts: now - 19 * H, text: 'who else is on this relay?', status: 'read' },
  ],
  [CONTACTS[4].publicKeyHex]: [],
};

export const GROUP_THREADS: Record<string, PlainMessage[]> = {
  g1: [
    { id: 'gm1', from: CONTACTS[2].publicKeyHex, ts: now - 3 * H, text: 'cert expires in 6 days', status: 'read' },
    { id: 'gm2', from: 'me', ts: now - 2.5 * H, text: 'I can do the renewal, just need the DNS token', status: 'read', route: RELAY_ROUTE },
    { id: 'gm3', from: CONTACTS[3].publicKeyHex, ts: now - 2 * H, text: 'sent it to you directly', status: 'read' },
    { id: 'gm4', from: mara, ts: now - 51 * M, text: 'rotating the cert tonight, expect a blip', status: 'delivered', expiresAt: now + 20 * H },
  ],
  g2: [
    { id: 'gc1', from: CONTACTS[2].publicKeyHex, ts: now - 2 * 86400_000, text: 'I can drive, 4 seats', status: 'read' },
  ],
};

/* ---------------- scenarios ---------------- */

/** Every state the States explorer can jump to. */
export type Scenario =
  | 'loading'
  | 'auth-create'
  | 'auth-unlock'
  | 'auth-error'
  | 'first-run'
  | 'connecting'
  | 'connected'
  | 'onion'
  | 'direct'
  | 'offline'
  | 'relay-error'
  | 'key-changed'
  | 'verify'
  | 'empty-thread'
  | 'send-failed';

export const SCENARIOS: { id: Scenario; label: string; group: string; note: string }[] = [
  { id: 'loading', label: 'Loading', group: 'Boot', note: 'Cold start, before storage is read' },
  { id: 'auth-create', label: 'Create identity', group: 'Boot', note: 'No keypair on this device' },
  { id: 'auth-unlock', label: 'Unlock', group: 'Boot', note: 'Keypair exists, needs the password' },
  { id: 'auth-error', label: 'Wrong password', group: 'Boot', note: 'Failed unlock' },
  { id: 'first-run', label: 'First run', group: 'Onboarding', note: 'Identity exists, no contacts, not connected' },
  { id: 'connecting', label: 'Connecting', group: 'Network', note: 'Dialing the relay' },
  { id: 'connected', label: 'Connected via relay', group: 'Network', note: 'Normal operation' },
  { id: 'onion', label: 'Onion route', group: 'Network', note: 'Two intermediate hops' },
  { id: 'direct', label: 'Direct peer', group: 'Network', note: 'No relay in path' },
  { id: 'offline', label: 'Offline', group: 'Network', note: 'No transport' },
  { id: 'relay-error', label: 'Relay unreachable', group: 'Network', note: 'Dial failed' },
  { id: 'key-changed', label: 'Key changed', group: 'Trust', note: 'A verified contact’s key rotated' },
  { id: 'verify', label: 'Verify ceremony', group: 'Trust', note: 'Comparing fingerprints' },
  { id: 'empty-thread', label: 'Empty conversation', group: 'Conversation', note: 'Contact added, nothing sent' },
  { id: 'send-failed', label: 'Send failed', group: 'Conversation', note: 'Message could not be routed' },
];

export function statusForScenario(s: Scenario): NodeStatus {
  switch (s) {
    case 'connecting': return 'connecting';
    case 'onion': return 'onion';
    case 'direct': return 'direct';
    case 'offline':
    case 'first-run':
    case 'loading': return 'offline';
    case 'relay-error': return 'error';
    default: return 'relay';
  }
}

export function routeForStatus(s: NodeStatus): RouteHop[] {
  if (s === 'onion') return ONION_ROUTE;
  if (s === 'direct') return DIRECT_ROUTE;
  if (s === 'relay') return RELAY_ROUTE;
  return [];
}

export const STATUS_COPY: Record<NodeStatus, { label: string; detail: string }> = {
  offline:    { label: 'Offline',    detail: 'No transport. Messages will queue until you connect.' },
  connecting: { label: 'Connecting', detail: 'Dialing the relay and requesting a reservation.' },
  relay:      { label: 'Relay',      detail: 'Traffic runs through your relay. It sees who talks to whom, never what.' },
  direct:     { label: 'Direct',     detail: 'Straight to the peer. No relay in the path.' },
  onion:      { label: 'Onion',      detail: 'Routed through intermediate peers. The relay cannot link sender to recipient.' },
  error:      { label: 'Unreachable', detail: 'The relay refused the connection. Check the URL in Settings.' },
};

export function contactByKey(hex: string): Contact | undefined {
  return CONTACTS.find((c) => c.publicKeyHex === hex);
}

export function displayName(c: Contact): string {
  return c.nickname || shortName(c.publicKeyHex);
}

function shortName(hex: string): string {
  return hex.slice(0, 8);
}
