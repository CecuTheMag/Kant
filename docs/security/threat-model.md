# Threat Model

## Scope

This document describes the security assumptions for the Kant relay and client architecture as implemented in this repository. It is intentionally scoped to the active product surface: relay bootstrap, registry publishing, client identity and session handling, and the TLS termination layer in front of the public relay.

This is an engineering threat model for deployment and review. It does not replace a formal red-team or external audit.

---

## System components

### 1. Client application
The client app runs in the browser or desktop environment. It stores local identity material, contact data, encrypted message state, and encrypted file metadata.

Primary risks:
- local compromise of the device
- malware or browser extension compromise
- loss or theft of user device
- unauthorized local access to browser storage or desktop app state

Security assumptions:
- the client protects local state with OS-level storage controls
- the app is expected to be run on a trusted endpoint
- the relay does not hold plaintext message content

Client invariants:
- **All message content travels inside the end-to-end encryption.** That includes structured content such as a quoted reply (`packages/core/src/envelope.ts`). The outer wire JSON (`id`, `fromPubKeyHex`, ratchet header) is visible to the last onion hop and is not authenticated, so no content may be placed there, and receivers ignore any legacy content field found there.
- **Edits are requests, not proof.** An edit is an `edit` reference inside the encrypted envelope. A receiver applies it only to a message the same sender authored according to its own record (DMs: the stored message in that sender's conversation must not be ours; groups: the target's sender must match), never to our own messages, and never shows it as a new message. Group authorship is as strong as group-message authorship already is: any holder of the group key can claim any member's `fromPubKeyHex`. Peers that don't advertise `message-edit-1` receive the correction as a normal message prefixed with ✎.
- **Voice-note and group-file descriptors ride in FILE_META**, on the Noise-encrypted file stream between the two peers, next to the file name and thumbnail it already carried — never on the message wire. They are validated and bounded on receipt (`sanitizeVoiceMeta`, `sanitizeGroupRef`). A file claiming a group is filed there only if the sender is a member of that group; group attachment references are written locally when a transfer completes and are never taken from a `group-msg`, so a member cannot point a message at another stored blob.
- **The microphone is live only while recording.** Every exit path (send, cancel, leaving the chat, a failed start) stops the capture tracks; audio goes from memory straight into the encrypted file transfer.
- **Received files are untrusted.** Previews decrypt to memory and render only through inert elements (text nodes, `<img>`, `<audio>`, `<video>`): no HTML is rendered, remote images inside documents are never fetched, and links leave the app only for `http(s)`/`mailto` after the user confirms. Plaintext touches disk only for "Open with…", under `cache/kant-open/`, which is swept at cold start, on resume and on erase.
- **"Erase this device" clears every IndexedDB store** (enumerated from the database, not a hard-coded list), identifying local settings and temporary files, with networking stopped first.
- **Relay federation carries only ciphertext.** A user on relay 1 reaches a user on relay 2 through relay 1's `/fed/<relay2>` tunnel, which splices the WebSocket byte for byte onto relay 2; Noise runs from the client to relay 2 and again end to end to the contact, so neither relay can read or alter content, and relay 2 sees relay 1's IP, not the user's. Tunnels only go to pinned, configured peer relays, only for clients currently connected to relay 1 (short-lived single-use token signed with the client's key), and are capped per client and globally. Federated lookups are non-recursive and an answer is accepted only if it points at the relay that gave it. While federation is on, clients refuse direct dials to federated relays.
- **No OS backup on Android.** `allowBackup` is off and the data-extraction rules exclude everything: a restored copy would put the encrypted identity in a cloud account and fork every double-ratchet session.

### 2. Relay service
The relay operates as a public bootstrapping and route registry service. It exposes HTTP registry endpoints and a libp2p WebSocket listener for peer transport.

Primary risks:
- denial of service or service exhaustion
- malicious registration floods
- stale reservation abuse
- invalid or malformed requests
- relay identity impersonation

Security assumptions:
- the relay should sit behind TLS termination and a public firewall policy
- the relay is not a message store
- the relay should not expose administrative surfaces without auth
- the relay should treat all registry updates as untrusted and validate them

### 3. TLS terminator (Caddy)
Caddy receives public traffic on 80/443 and proxies to the relay's local HTTP ports.

Primary risks:
- certificate misconfiguration
- HTTP downgrade or redirect abuse
- missing TLS enforcement
- exposed admin API on public interfaces

Security assumptions:
- public internet traffic should be terminated only on TLS-enabled ports
- the relay should not be directly exposed to the internet in production
- Caddy should be configured with automatic HTTPS and safe timeouts

### 4. Registry and reservation logic
The relay keeps an ephemeral registration and reservation state used for peer lookup and route establishment.

Primary risks:
- replay attacks against registration endpoints
- stale entries persisting beyond TTL
- reservation exhaustion
- spoofed peer addresses
- invalid signature or nonce reuse

Security assumptions:
- registry entries are ephemeral and expire by TTL
- nonces and reservation checks are required to prevent replay
- stale entries are actively pruned

---

## Security goals

1. Preserve confidentiality of message content in transit and at rest on the client device.
2. Prevent the relay from acting as a message store or plaintext observer.
3. Prevent forged registration or replayed registration traffic from distorting peer reachability.
4. Ensure the relay remains available under normal operational load and abusive traffic.
5. Ensure the public-facing deployment path uses encrypted transport and safe defaults.
6. Keep the relay identity stable and recoverable through an authenticated backup flow.

---

## Trust boundaries

### Internal trust boundaries
- Client-to-relay relationships are untrusted until verified by the protocol.
- Relay-to-client traffic is treated as untrusted because the relay cannot read message plaintext.
- TLS terminator and relay are separated operationally by local-only network interfaces and trusted backend routing.

### External trust boundaries
- Any traffic arriving from the internet to the public relay is considered hostile until validated.
- The public domain and TLS certificate are trusted only when properly configured and renewed.
- The relay identity seed is privileged material and must be protected as a private key.

---

## Threats and mitigations

### A. Message interception
Threat: an attacker intercepts traffic in transit.

Mitigations:
- public endpoints use HTTPS/TLS termination
- relay traffic is not treated as plaintext message transport
- the client stack uses the protocol's authenticated and encrypted primitives
- the relay should not be directly public without TLS termination in production

### B. Relay impersonation
Threat: an attacker presents a malicious public relay to clients.

Mitigations:
- the relay's public host and certificate must be validated by users or operators
- clients should validate the relay domain or configured endpoint before trusting it
- the relay identity seed must be backed up and protected

### C. Replay attacks
Threat: an attacker replays old registration or lookup requests.

Mitigations:
- nonce validation and replay checks in the relay
- signed registry entries and TTL expiry
- expiration and stale entry cleanup

### D. Reservation abuse and resource exhaustion
Threat: an attacker creates too many reservations or floods the relay with bogus requests.

Mitigations:
- rate limiting on the public edge
- bounded reservation state and cleanup logic
- explicit failure and backoff behavior for abusive clients

### E. Seed compromise
Threat: an attacker gains access to the relay seed file.

Mitigations:
- store seed material with restrictive permissions
- back up encrypted off-host
- rotate or replace the relay identity only with operational approval
- reduce privileges by running the relay as a dedicated non-root user

### F. Host compromise
Threat: an attacker gains root access to the relay host.

Mitigations:
- isolate relay and Caddy processes to dedicated runtime users
- minimize runtime privileges
- use a dedicated data directory with strict permissions
- rotate secrets and redeploy if the host is compromised

### G. Public exposure of admin services
Threat: admin or debug surfaces are exposed without authentication.

Mitigations:
- require bearer tokens or other auth on admin endpoints
- avoid public exposure of admin surfaces in production
- keep the admin plane behind a trusted internal network or private control plane

### H. Device seizure and coerced unlock
Threat: someone takes the user's device, or forces them to unlock Kant.

Mitigations:
- everything at rest (identity key, messages, reactions, files, sessions) is encrypted under a key derived from the password with Argon2id; a locked or powered-off device reveals no content
- **auto-lock** (Settings → Security) drops every key from memory after a chosen time in the background by reloading into a fresh process; while locked the client is offline and senders keep messages queued
- **duress password**: entering it on the unlock screen erases the identity, contacts, messages, files, sessions and the fingerprint key, then opens a new empty account with that password. Every identity record carries a duress verifier — a real Argon2id hash or random bytes of the same shape — and every unlock runs both Argon2id checks, so neither the stored data nor the unlock result reveals whether a duress password is set. Whether it is set is recorded only encrypted under the unlocked key (`packages/core/src/identity.ts`)
- **fingerprint unlock** (Android; iOS contract in `packages/app/src/lib/biometric.ts`) wraps the Argon2id-derived key with a hardware Keystore AES-GCM key that needs a strong (Class 3) biometric for every use and is destroyed when biometrics change. The password is still required after a device restart, after a user-chosen period (1–7 days) and after 3 failed fingerprint prompts; the button never prompts on its own

Residual risks:
- a fingerprint can be taken by force: the settings screen says so, and users facing that risk should leave fingerprint unlock off (the duress password cannot help once a finger has unlocked the app)
- the duress wipe is a normal deletion: forensic recovery of freed flash pages is not ruled out, although everything deleted was encrypted at rest with a key that no longer exists on the device
- a duress wipe takes about as long as one extra Argon2id derivation longer than a wrong password, which is not observable in practice but not constant time

### I. Backups and moving to a new device
Threat: a backup file or a device-to-device move leaks the account, or lets someone plant a different identity.

Mitigations:
- both carry the same sealed stream (`packages/core/src/bundle.ts`): newline-delimited records sealed with `crypto_secretstream_xchacha20poly1305`, so truncation, reordering and tampering are detected and an incomplete restore is erased, never left half-written. The identity record inside stays encrypted with the account password
- **backup file**: keyed by Argon2id of the account password with a fresh salt; creating one requires the password. Double Ratchet sessions and outboxes are excluded, so a restored backup cannot fork sessions with a device that is still running; sessions re-establish on first contact
- **move** (`packages/core/src/transfer.ts`, protocol `/kant/transfer/1.0.0`): the new device shows a QR code with a one-time X25519 public key and its circuit address; the old device derives the stream key with its own one-time key; both show a 6-digit code derived from the key, which the user compares before the new device accepts anything. The new device's `ready` and `done` replies are MACed with the key, so the old device only sends to — and only erases itself after — the holder of the scanned key. The move includes sessions, and the old device erases itself afterwards so a session is never used on two devices. The relay forwards ciphertext only

Residual risks:
- a backup file is only as strong as the account password; users are told that the file plus the password is the account
- a six-digit comparison code gives roughly a one-in-a-million chance to a live attacker who saw the QR code and raced the real device; they would still need the user to confirm on the new device

---

## Security assumptions to document for operators

- Message content is not stored by the relay.
- Relay metadata is operationally required for peer discovery and connectivity.
- The relay is not a full trust anchor for user identity; it is a connectivity bootstrap layer.
- Client devices are the trust boundary for local state and message history protection.
- Public internet exposure requires TLS termination and safe firewall rules.
- Backup of the relay identity seed is mandatory for continuity.

---

## Residual risks and release caveats

This threat model should be read with these limitations in mind:

- The repo contains the active build, but it is not itself a substitute for an external security review.
- The relay is a connectivity service, not a full compliance platform.
- Security assumptions change when the deployment topology changes, especially if a different reverse proxy, secret manager, or network boundary is introduced.
- The threat model must be revisited whenever the relay, transport, or registry design changes.

---

## Release gate

A production release should not proceed without:

- a tested public deployment path
- a backup and restore path for the relay seed
- a secret rotation plan
- known risk documentation
- a current threat model review
- an independent security audit or penetration test
