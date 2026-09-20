# Relay Deployment Runbook

Step-by-step procedure for deploying a new Kant relay, or redeploying/upgrading an existing one.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Docker Compose Deployment (HTTPS)](#docker-compose-deployment-https)
4. [Docker Compose Deployment (HTTP / internal)](#docker-compose-deployment-http--internal)
5. [Health Checks](#health-checks)
6. [Caddy Reverse Proxy](#caddy-reverse-proxy)
7. [Initial Verification](#initial-verification)
8. [Viewing Logs](#viewing-logs)
9. [Post-Deployment Checklist](#post-deployment-checklist)

---

## Prerequisites

### Host Requirements

- **OS:** Linux (Ubuntu 22.04+ or Debian 12+ recommended). macOS works for local dev.
- **CPU/RAM:** 1 vCPU / 1 GB RAM is sufficient for ~500 peers. A $4–6/mo VPS (Hetzner CAX11, Fly.io, DigitalOcean) is the reference target.
- **Disk:** 5 GB minimum. The relay keeps only its PeerID seed on disk; everything else is in-memory.
- **Network:**
  - Inbound **TCP 3000** — libp2p WebSocket (peers connect here).
  - Inbound **TCP 3001** — HTTP registry (register / lookup / relay-info / metrics).
  - Inbound **TCP 80** and **TCP 443** — Caddy (HTTPS deployment only).

### Software

- **Docker** 24+ and **Docker Compose v2**.
  ```bash
  $ docker --version
  Docker version 24.x, build ...
  $ docker compose version
  Docker Compose version v2.x.x
  ```
- A registered domain name pointing at the host (HTTPS only).
- For non-Docker deployments: Node.js 20+ and pnpm 9+.

### Firewall (ufw example)

```bash
$ sudo ufw allow OpenSSH
$ sudo ufw allow 80/tcp     # Caddy (HTTPS only)
$ sudo ufw allow 443/tcp    # Caddy (HTTPS only)
$ sudo ufw allow 3000/tcp   # libp2p WebSocket (skip if fronted by Caddy)
$ sudo ufw allow 3001/tcp   # HTTP registry (skip if fronted by Caddy)
$ sudo ufw enable
```

> ⚠️ **Do not expose 3000/3001 directly to the public internet in production.** Always front the relay with Caddy (or another TLS terminator) so peers connect over `wss://` and `https://`.

---

## Environment Variables

All variables are read at startup. The relay will refuse to start if a required variable is missing or invalid.

| Variable | Required | Default | Description |
|---|---|---|---|
| `RELAY_PORT` | no | `3000` | libp2p WebSocket listener port. |
| `RELAY_INFO_PORT` | no | `3001` | HTTP registry + metrics listener port. |
| `RELAY_HTTP_BIND` | no | `0.0.0.0` | Bind address for the HTTP registry. |
| `RELAY_PUBLIC_HOST` | **yes** | — | Public hostname or IP, advertised in `/relay-info`. |
| `RELAY_PUBLIC_PORT` | no | `3000` | Public port advertised in `/relay-info` (use `443` behind Caddy). |
| `RELAY_SECURE` | no | `false` | Set to `true` when fronted by TLS; advertised as `wss://` / `https://`. |
| `RELAY_DATA_DIR` | no | `./relay-data` | Directory holding the PeerID seed (`peer-id.key`). |
| `RELAY_MAX_RESERVATIONS` | no | `1024` | Max concurrent circuit reservations. |
| `RELAY_MAX_CIRCUITS_PER_PEER` | no | `16` | Max open circuits per peer. |
| `RELAY_REGISTRY_TTL_SECONDS` | no | `3600` | TTL for registry entries. |
| `RELAY_LOG_LEVEL` | no | `info` | `trace` / `debug` / `info` / `warn` / `error`. |
| `LOG_FORMAT` | no | `pretty` | `pretty` for humans, `json` for log aggregators. |

### Example `.env` (HTTPS)

```ini
# /opt/kant/.env
RELAY_DOMAIN=relay.example.com
RELAY_PUBLIC_HOST=relay.example.com
RELAY_PUBLIC_PORT=443
RELAY_SECURE=true
RELAY_LOG_LEVEL=info
LOG_FORMAT=json
```

---

## Docker Compose Deployment (HTTPS)

This is the recommended deployment for any internet-facing relay.

### 1. Clone and configure

```bash
$ git clone https://github.com/your-org/kant.git /opt/kant
$ cd /opt/kant
$ echo "RELAY_DOMAIN=relay.example.com" > .env
```

### 2. Build and start

```bash
$ RELAY_DOMAIN=relay.example.com docker compose -f docker-compose.https.yml up -d --build
```

What this does:
- Builds the relay image from [`packages/relay/Dockerfile`](../../packages/relay/Dockerfile).
- Starts `relay` (private, internal-only on port 3000) and `caddy` (public, ports 80/443).
- Caddy terminates TLS, obtains a Let's Encrypt cert automatically, and reverse-proxies to the relay.

### 3. Confirm both containers are up

```bash
$ docker compose -f docker-compose.https.yml ps
NAME      SERVICE   STATUS          PORTS
caddy     caddy     Up (healthy)    0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
relay     relay     Up (healthy)    3001/tcp
```

### 4. Wait for the PeerID to be generated

The first start creates a new PeerID seed at `relay-data/peer-id.key`. Subsequent restarts reuse it.

---

## Docker Compose Deployment (HTTP / internal)

Use this for trusted-network deployments (LAN, lab, CI). No TLS, no Caddy.

```bash
$ docker compose -f docker-compose.http.yml up -d --build
```

The relay listens directly on **3000** (libp2p) and **3001** (HTTP). Open those ports in the firewall.

> 🚫 Do not use the HTTP variant for any deployment reachable from the public internet. Browsers will refuse to use the WebSocket without TLS, and the registry HTTP API would be unauthenticated on the wire.

---

## Health Checks

The relay exposes three HTTP endpoints on `RELAY_INFO_PORT` (default **3001**):

| Endpoint | Method | Purpose | Expected |
|---|---|---|---|
| `/healthz` | GET | Liveness — process is up. | `200 OK` always, once the HTTP server is listening. |
| `/readyz` | GET | Readiness — can accept peer connections. | `200 OK` only after libp2p has a reachable multiaddr; `503` otherwise. |
| `/metrics` | GET | Prometheus metrics. | `200 OK` with text/plain payload. |

### From the host

```bash
$ curl -fsS http://127.0.0.1:3001/healthz
ok
$ curl -fsS http://127.0.0.1:3001/readyz
{"ready":true,"multiaddrs":["/ip4/.../tcp/443/wss"]}
```

### From behind Caddy (production)

```bash
$ curl -fsS https://relay.example.com/healthz
ok
$ curl -fsS https://relay.example.com/readyz | jq
{
  "ready": true,
  "multiaddrs": [
    "/dns4/relay.example.com/tcp/443/wss"
  ]
}
```

### Docker-level healthchecks

Both compose files include a `healthcheck` block. Inspect status with:

```bash
$ docker inspect --format '{{.Name}} {{.State.Health.Status}}' $(docker ps -q)
```

---

## Caddy Reverse Proxy

The provided [`Caddyfile`](../../Caddyfile) terminates TLS and routes traffic. The critical points:

```
relay.example.com {
    # WebSocket (libp2p) — long-lived connections
    reverse_proxy /* relay:3000 {
        header_up Host {host}
        transport http {
            keepalive off
        }
    }

    # HTTP registry & metrics
    reverse_proxy /relay-info relay:3001
    reverse_proxy /register   relay:3001
    reverse_proxy /lookup*    relay:3001
    reverse_proxy /healthz    relay:3001
    reverse_proxy /readyz     relay:3001
    reverse_proxy /metrics    relay:3001
}
```

### Caddy log location

```bash
$ docker compose -f docker-compose.https.yml logs caddy
```

Caddy stores its ACME data in the `caddy-data` volume. **Do not delete it** unless you intend to re-issue the certificate.

### Forcing a certificate renewal

```bash
$ docker compose -f docker-compose.https.yml exec caddy caddy reload --config /etc/caddy/Caddyfile --address
```

---

## Initial Verification

Run this checklist within 5 minutes of bringing the relay up. All items must pass before announcing the relay to clients.

```bash
# 1. Liveness
$ curl -fsS https://relay.example.com/healthz
ok

# 2. Readiness
$ curl -fsS https://relay.example.com/readyz | jq -e '.ready == true'

# 3. Multiaddr is correct (should match your public host:port)
$ curl -fsS https://relay.example.com/relay-info | jq -r .multiaddrs[]

# 4. Metrics endpoint is reachable
$ curl -fsS https://relay.example.com/metrics | grep '^kant_relay_ready'

# 5. Open firewall ports from an external host
$ nc -zv relay.example.com 443
Connection to relay.example.com 443 (tcp) succeeded!

# 6. WebSocket upgrade works (use any WS client; wscat is convenient)
$ npx -y wscat -c wss://relay.example.com
Connected
```

Expected timeline after `docker compose up`:

- **T+0s:** Containers starting.
- **T+2–5s:** `relay` healthy, `caddy` requesting cert.
- **T+10–30s:** Caddy has cert, all routes 200.
- **T+30s+:** Peers can begin connecting.

---

## Viewing Logs

### Live tail (Docker Compose)

```bash
# Both services, interleaved
$ docker compose -f docker-compose.https.yml logs -f --tail=200

# Just the relay
$ docker compose -f docker-compose.https.yml logs -f relay

# Just Caddy
$ docker compose -f docker-compose.https.yml logs -f caddy
```

### JSON logs

Set `LOG_FORMAT=json` for structured logs (recommended in production):

```bash
$ docker compose -f docker-compose.https.yml logs relay | jq -r '"\(.time) \(.level) \(.msg)"'
```

Sample log lines:

```
2026-08-31T11:49:00Z INFO  relay listening multiaddrs=["/dns4/relay.example.com/tcp/443/wss"]
2026-08-31T11:49:01Z INFO  registry started ttl=3600
2026-08-31T11:49:01Z INFO  http listening bind=0.0.0.0:3001
```

### Useful grep patterns

```bash
# Errors only
$ docker compose logs relay 2>&1 | grep -E ' (ERROR|FATAL) '

# Reservation events
$ docker compose logs relay 2>&1 | grep -i 'reservation'

# Auth failures (potential attack)
$ docker compose logs relay 2>&1 | grep -E 'bad_signature|unauthorized'
```

See [`monitoring.md`](./monitoring.md) and [`incident-response.md`](./incident-response.md) for log patterns tied to specific scenarios.

---

## Post-Deployment Checklist

- [ ] Both containers report `Up (healthy)`.
- [ ] `/healthz` and `/readyz` return 200 from an external host.
- [ ] `/metrics` returns Prometheus output.
- [ ] `/relay-info` returns the correct public multiaddr.
- [ ] Caddy has a valid Let's Encrypt certificate (`https://` works in a browser).
- [ ] At least one external peer can connect over `wss://`.
- [ ] `relay-data/peer-id.key` is created and backed up (see [`backup-recovery.md`](./backup-recovery.md)).
- [ ] Firewall is restricted to 80/443 (or 3000/3001 for HTTP variant).
- [ ] `LOG_FORMAT=json` is set for production.
- [ ] Prometheus scrape job configured against `/metrics` (see [`monitoring.md`](./monitoring.md)).
- [ ] On-call alerting wired up (see [`monitoring.md`](./monitoring.md#alert-thresholds)).

---

*See also: [`RELAY_DEPLOY.md`](../../RELAY_DEPLOY.md) for the prose deployment guide, [`monitoring.md`](./monitoring.md) for what to watch after deploy, [`backup-recovery.md`](./backup-recovery.md) for the `peer-id.key` backup procedure.*
