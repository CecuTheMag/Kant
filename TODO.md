# Kant — TODO / Completion Status

## Phase 0: P2P Crypto Foundation ✅
- [x] `packages/core/src/ratchet.ts`: X3DH + Double Ratchet implemented
- [x] `packages/core/src/identity.ts`: Argon2id + Ed25519 identity, IndexedDB storage
- [x] `packages/core/src/prekey.ts`: X3DH pre-key bundle serve/fetch over libp2p
- [x] `packages/relay/src/index.ts`: libp2p circuit relay v2 bootstrap node
- [x] Delivery receipts protocol (`/kant/receipt/1.0.0`)
- [x] Contact management with QR codes
- [x] Message persistence in IndexedDB with at-rest encryption

## Phase 1: Core Messenger — Bugs Fixed ✅

### Bug Fixes
- [x] **Message decryption placeholder** — `App.tsx` now calls `getConversation()` and displays
      actual decrypted text (via `messages.ts` `decryptText`). No more `[decrypted] xxxx`.
- [x] **DB version conflict** — All `openDB()` functions (`identity.ts`, `prekey.ts`, `queue.ts`)
      now create all 5 stores (`identity`, `contacts`, `messages`, `prekeys`, `queue`) in a
      single `onupgradeneeded` handler at version 2. No more store-not-found errors.
- [x] **contacts.ts double-hexing** — `addContact()` validates input is already a 64-char hex
      string and stores it directly. Removed `sodium.to_hex(publicKeyHex)` re-encoding.
- [x] **ratchet.ts nonce bug** — `ratchetDecrypt` now uses the nonce from the incoming message
      instead of generating a random one. `ratchetEncrypt` returns `nonce` in the result.
- [x] **ratchet.ts x3dhSend signature** — Now returns `{ sharedSecret, ephemeralPublic }` and
      generates the ephemeral keypair internally (matches App.tsx destructuring).
- [x] **prekey.ts fetchPreKeyBundle** — Fixed: reads stream before closing it.

### New Features
- [x] **Peer discovery** (`packages/core/src/discovery.ts`) — `startDiscovery()` listens for
      `peer:connect` events and surfaces peers with circuit-relay multiaddrs to the UI.
      `getKnownPeers()` queries the peerStore for already-known circuit peers.
- [x] **Offline message queue** (`packages/core/src/queue.ts`) — `enqueue()`/`dequeue()` persist
      unsent messages in IndexedDB. `startQueueRetry()` flushes queued messages when a peer
      reconnects (`peer:connect` event). Status transitions: `sending` → queue → `sent`.
- [x] **DHT UI in App.tsx** — "Discovered peers" panel shows spinner while discovering, lists
      peers with a "Chat" button to initiate session directly from a discovered peer's circuit addr.
- [x] **Exports** — `packages/core/src/index.ts` exports `discovery` and `queue` modules.

## Phase 2: Group Chat — Pending
- [ ] Group key agreement (Sender Keys / MLS lite)
- [ ] Group membership management
- [ ] Group message routing over relay
- [ ] Group UI

## Phase 3: Hardening — Pending
- [ ] Key rotation / pre-key replenishment
- [ ] Message ordering guarantees
- [ ] Skipped message keys cache
- [ ] Forward secrecy audit
