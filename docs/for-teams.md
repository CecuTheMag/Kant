# Kant for teams and organisations

The [README](../README.md) describes Kant for people who want a private messenger. This page is for organisations weighing Kant as a messaging layer they run themselves: the licensing model, how Kant compares with the alternatives, and what is and isn't built yet.

---

## Commercial model and corporate bundle

Kant is open core:

- the messenger, `@kant/core`, the relay, the desktop and CLI clients and the push proxy are open source under the AGPL-3.0 — anyone, including companies, can use, modify and self-host them for free
- organisations that can't meet the AGPL's obligations (for example, shipping a modified Kant without publishing the changes) can buy a commercial licence instead
- the paid corporate bundle is designed for organisational deployments and includes the admin-focused features and governance controls that are not part of the free community build

This means the admin features are not a general consumer feature. They are part of the corporate bundle and are meant for enterprise deployment, internal control, auditability, and managed operational governance.

At a product level, the repo reflects that split:

- core messaging, relay connectivity, and app functionality are the product base
- admin, policy, audit, and operational control features are positioned as a paid corporate layer
- the free build remains the community baseline without the corporate governance toolkit

---

## Product focus

Kant is designed for real-world peer connectivity in environments where direct peer-to-peer reachability is limited by NAT, firewalls, and mobile network churn.

The current implementation includes:

- encrypted peer identity and session primitives in the core package
- a browser client for relay-connected messaging
- a dedicated relay service that exposes registry and health endpoints
- deterministic relay identities and stable public multiaddrs across restarts
- support for group messaging, file transfer, and relay-based discovery
- operational endpoints for health, readiness, metrics, and reservation visibility

The relay is intentionally stateless with respect to message plaintext and relies on signed registry records and replay-resistant nonce verification for integrity.

---

## Why teams choose Kant

Kant is positioned for teams that want messaging infrastructure with less dependence on a centralized provider, better control over routing and relay topology, and a product architecture that is designed to work across NAT-heavy environments.

### The value proposition

- Control: run your own relay, connect clients to a network you operate
- Privacy posture: the relay is intentionally not the message store and does not process plaintext content
- Reachability: libp2p + circuit relay v2 is designed for peers behind NAT and firewall constraints
- Operational transparency: health, readiness, metrics, and registry endpoints are built into the runtime
- Platform independence: the client and relay are decoupled enough to support self-hosted or customized network designs

### Best fit

Kant is a strong fit for organizations evaluating a secure messaging layer that: 

- want self-hosted network control
- need peer connectivity in challenging network conditions
- prefer a relay-first architecture over pure centralized cloud messaging
- want a product surface that can evolve toward larger enterprise governance later

This is a product that starts from infrastructure control and secure transport, rather than a prebuilt admin SaaS layer.

---

## Competitive comparison

The comparison below is intentionally framed around product strategy and architecture, not inflated claims about unimplemented admin tooling.

| Category | Kant | Signal | Telegram | WhatsApp | Matrix |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Core model | Relay-assisted P2P messaging with libp2p and peer registry | Centralized messaging service | Centralized messaging service with optional secret chats | Centralized messaging service | Federated, server-based messaging network |
| Infrastructure ownership | Self-hosted relay possible; app connects to operator-controlled relay | Provider-controlled infrastructure | Provider-controlled infrastructure; self-hosting is possible but not the default product model | Provider-controlled infrastructure | Strong self-hosting support via homeservers |
| NAT / connectivity strategy | Built for NAT traversal via circuit relay v2 and relay-assisted peer discovery | Depends on provider infrastructure | Depends on provider infrastructure | Depends on provider infrastructure | Depends on server federation and homeserver connectivity |
| Privacy posture | Relay does not hold plaintext; registry and routing metadata remain operational concerns | End-to-end encryption by default, with provider-managed infrastructure | E2EE exists in secret chats; cloud metadata still matters | E2EE exists, but provider ecosystem remains centralized | End-to-end encryption is available, but federation and server policies matter |
| Operational visibility | Health, readiness, metrics, registry endpoints included in the codebase | Mostly provider-side control plane | Provider-side control plane | Provider-side control plane | Org-controlled server operations, but app experience is more federation-centric |
| Admin model | Current repo includes reservation/admin debug endpoints, but not a full enterprise admin plane | Provider-managed admin tools | Provider-managed admin tools | Provider-managed admin tools | Homeserver admin tooling exists, but not a comparable end-user messaging product story |
| Ideal customer | Teams that value infrastructure ownership, secure routing, and relay control | Users wanting simple secure messaging immediately | Users prioritizing scale and messaging convenience | Users already embedded in the Meta ecosystem | Organizations with a strong self-hosted federation strategy |
| Current maturity | Core product stack exists; admin layer is intentionally not the main scope yet | Mature consumer platform | Mature consumer platform | Mature consumer platform | Mature open ecosystem |

### Decision summary

A buyer choosing Kant is choosing a different value equation than a mainstream consumer app:

- the product is strongest where infrastructure control matters more than polished consumer convenience
- the relay-first design is better aligned with teams operating behind NAT, inside internal networks, or across geographically distributed edge deployments
- the product is not positioned as a full SaaS admin suite yet; it is positioned as a secure, self-hostable messaging substrate with a clear path to enterprise extension

### Positioning against the strongest alternatives

| Alternative | Why buyers pick it | Why Kant is the better fit |
| :--- | :--- | :--- |
| Signal | Simple, familiar, strong privacy reputation | Better for teams that need relay infrastructure control and self-hosted routing choices instead of provider dependence |
| Telegram | Scale, convenience, broad user adoption | Better for organizations that want a privacy-first architecture with lower reliance on a centralized provider model |
| WhatsApp | Ubiquity and mainstream adoption | Better for teams that need self-hosting options, peer connectivity behind NAT, and infrastructure ownership |
| Matrix | Open federation and self-hosting strengths | Better when an organization wants a more relay-aware, encrypted peer-to-peer architecture with direct control over connectivity and public relay placement |

### Who should choose Kant

- security-conscious teams that want more control over network topology
- organizations operating across mobile, remote, or NAT-heavy environments
- teams that want a messaging stack with a self-hostable relay and measurable operational surfaces
- buyers evaluating a secure communication layer instead of a generic consumer app

### Who should not choose Kant yet

- teams that need a polished consumer messaging feature set immediately and do not care about infrastructure ownership
- organizations looking for a full enterprise admin SaaS bundle before the product matures further
- buyers expecting a completed admin console, policy engine, or managed compliance suite as part of the current repo


---

## Current scope and constraints

This repository currently represents the working product core for encrypted P2P communication, not the full enterprise admin control plane.

The live code explicitly includes:

- a relay and registry layer
- encrypted communication and group workflows
- operational health and metrics
- admin debug endpoints behind bearer auth

The code does not include a complete admin console, policy engine, or enterprise management plane. The admin package remains intentionally placeholder status, and the active product scope is the relay + app + core stack.


---

Interested in a commercial licence or the corporate bundle? Write to [licensing@kant.network](mailto:licensing@kant.network).
