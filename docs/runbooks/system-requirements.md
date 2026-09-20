# Kant system requirements evaluation

This document provides a practical hardware baseline for a self-hosted Kant deployment. It is based on the current runtime model in the repo: a Node-based libp2p relay, a lightweight Node-based push proxy for Android wake delivery, and client apps running in browser, mobile, or desktop environments.

## Scope

This evaluation covers the three main runtime layers in the current architecture:

- relay runtime
- push proxy runtime
- client application runtime (browser / Android / desktop)

It is intentionally conservative and intended to support a production-style self-hosted deployment without overprovisioning beyond what the codebase actually requires.

## Current runtime characteristics

### Relay

The relay is a libp2p circuit relay v2 bootstrap service. It runs in Node 18 and uses:

- libp2p WebSocket transport
- noise encryption and yamux multiplexing
- circuit relay server handshake and reservation tracking
- in-memory registry and metrics exposure
- HTTP health, readiness, metrics, and registry endpoints

The relay is not a message store. It does not persist message content in the relay process, and it primarily consumes CPU, memory, and networking for peer routing, reservation tracking, and registry churn.

### Push proxy

The push proxy is a small Node service whose main responsibilities are:

- receiving relay wake requests
- tracking identity key to FCM token mappings in memory
- minting a Google OAuth access token for Firebase
- sending an empty FCM wake payload to the registered device token

This service is intentionally lightweight, but it must have outbound connectivity to Google Firebase and a valid Firebase service account.

### Client app

The app itself is not a server. It is a client runtime that loads in the browser or on Android or desktop. The host device mainly needs enough RAM, CPU, and storage for UI responsiveness and message processing, not for serving incoming traffic.

---

## Minimum viable hardware

### 1) Relay host

This is the server-side component that peers use to bootstrap connectivity and route around NAT.

| Component | Minimum | Recommended | Notes |
| --- | --- | --- | --- |
| CPU | 1 vCPU | 2 vCPU | A single core is enough for low traffic, but relay churn and active reservation work benefit from at least two cores |
| RAM | 2 GB | 4 GB | Reserve more if there are many active peers or large file transfers |
| Storage | 20 GB SSD | 40 GB SSD | Enough for relay seed, logs, and operational persistence |
| Network | 1 Gbps egress preferred | 1 Gbps or better | Public relay connectivity should be stable and not behind a congested NAT path |
| Public exposure | 1 public IP / DNS name | 1 public IP + TLS termination | Internet-facing deployments should front the relay with TLS or a reverse proxy |

Minimum practical baseline for a small self-hosted relay:

- 1 vCPU
- 2 GB RAM
- 20 GB SSD
- stable outbound internet

This is adequate for a low-volume or private deployment with a small peer set and light relay churn.

### 2) Push proxy host

The push proxy is the narrowest component in the stack. It is lightweight but must be reachable by the relay and have a valid Firebase service account configured.

| Component | Minimum | Recommended | Notes |
| --- | --- | --- | --- |
| CPU | 1 vCPU | 2 vCPU | The service is light, but FCM token operations and wake dispatch should not compete with other workloads |
| RAM | 1 GB | 2 GB | In-memory token map is small, but allow headroom for Node and OS |
| Storage | 10 GB SSD | 20 GB SSD | Logs and service state are small |
| Network | 100 Mbps | 1 Gbps or better | Stable HTTPS outbound connectivity to Google is required |

Minimum practical baseline for a small push proxy:

- 1 vCPU
- 1 GB RAM
- 10 GB SSD
- stable outbound HTTPS access to Google Firebase

For larger deployments, memory should scale with token count because the proxy keeps registered tokens in memory. If you have tens of thousands of active identities, move to a Redis-backed or database-backed registry instead of a pure in-memory Map.

### 3) Client device requirements

The app behaves like a normal encrypted messaging client and is not a server. The hardware requirements are driven by device capability and OS compatibility.

#### Android app

| Requirement | Minimum | Recommended | Notes |
| --- | --- | --- | --- |
| OS version | Android 8+ | Android 12+ | Modern Android is strongly preferred for background push reliability |
| CPU | 64-bit ARM or x86 | modern 64-bit SoC | FCM and background network behavior are more predictable on newer devices |
| RAM | 4 GB | 6 GB+ | Adequate for UI, background networking, and message sync |
| Storage | 2 GB free | 4 GB+ free | Needed for app data, temporary cache, logs, and message state |
| Connectivity | mobile data or Wi-Fi | stable mobile/Wi‑Fi | Peer connectivity is sensitive to NAT and network transitions |

For a production user base, 4 GB RAM is the practical floor, with 6 GB or more preferred for smoother background operation.

#### Desktop browser app

| Requirement | Minimum | Recommended | Notes |
| --- | --- | --- | --- |
| CPU | 2 cores | 4 cores | Enough for the browser runtime and local message processing |
| RAM | 4 GB | 8 GB | Browser memory use increases when tabs are active and large message flows occur |
| Storage | 2 GB free | 10 GB free | Local cache, browser storage, and message state are modest but not zero |
| OS | modern desktop OS | modern desktop OS | Windows, macOS, or Linux with a recent browser |

The browser client is not resource-heavy, but a 4 GB system with a modern browser is a sensible floor.

#### General web / laptop client

The app is expected to run on a normal laptop or desktop workstation. The main requirement is a modern browser, decent CPU, and enough RAM for normal message handling.

---

## Combined deployment recommendation

If you host the relay and push proxy together on the same server, use the following as a practical baseline:

| Deployment type | CPU | RAM | Storage | Notes |
| --- | --- | --- | --- | --- |
| Small self-hosted deployment | 2 vCPU | 4 GB | 40 GB SSD | Good starting point for a small team or limited peer set |
| Medium production deployment | 4 vCPU | 8 GB | 80 GB SSD | Better for active peers, bursty traffic, and higher relay churn |
| Large deployment | 8 vCPU | 16 GB+ | 200 GB SSD | Appropriate when scaling peer count or push reliability becomes operationally relevant |

For a single relay plus one push proxy on one host, the minimum practical target is roughly:

- 2 vCPU
- 4 GB RAM
- 40 GB SSD

That is the smallest configuration that gives the relay and proxy enough headroom to run without constant contention under real operating conditions.

---

## Operational notes

### Why not go lower

The current implementation uses:

- a libp2p relay with peer registry and reservation logic
- HTTP health and metrics servers
- periodic registry and reservation cleanup
- in-memory state for push registrations

This means memory and stable network access matter more than raw CPU burst when the system is idle. The relay is not computationally intense, but it is operationally sensitive to network quality and peer churn.

### Scaling watchpoints

Increase capacity if any of these happen:

- peer count rises sharply
- relay sees repeated reservation churn
- push registrations become high-volume
- file transfer or multi-peer chat usage becomes common
- relay and proxy are colocated on an undersized VM

### Storage guidance

Storage is not the main bottleneck, but logs and relay seeds should be kept on durable SSD-backed storage. Keep:

- relay seed file
- Docker volumes or host storage for relay state
- logs and metrics retention for a reasonable operational window

---

## Bottom-line recommendation

For a production self-hosted deployment, the strongest baseline is:

- relay: 2 vCPU, 4 GB RAM, 40 GB SSD
- push proxy: 1–2 vCPU, 2 GB RAM, 20 GB SSD
- Android clients: 4 GB RAM minimum, Android 8+ preferred
- desktop/web clients: modern desktop or laptop with 4 GB RAM and a current browser

This is conservative, realistic, and aligned with the actual architecture in the current codebase.
