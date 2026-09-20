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
