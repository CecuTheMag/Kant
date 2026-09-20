# Kant repository setup guide

This guide reflects the current repository implementation and intentionally excludes product claims that are not backed by the code.

---

## 1. Repository layout

```text
Kant/
├── package.json
├── pnpm-workspace.yaml
├── start.sh
├── docker-compose.http.yml
├── docker-compose.https.yml
├── packages/
│   ├── app/
│   ├── cli/
│   ├── core/
│   ├── desktop/
│   ├── relay/
│   └── admin/
├── docs/
├── tests/
├── ops/
├── RELAY_DEPLOY.md
├── REPO_SETUP.md
├── README.md
└── LICENSE
```

### Package roles

- [packages/core](packages/core): shared crypto, identities, messaging primitives, discovery, group logic, file handling
- [packages/relay](packages/relay): circuit relay bootstrap node, registry, metrics, health checks
- [packages/app](packages/app): React client for interactive messaging
- [packages/desktop](packages/desktop): desktop packaging and host integration
- [packages/cli](packages/cli): command-line interface surface
- [packages/admin](packages/admin): placeholder status; not a current operational admin product

---

## 2. Local development flow

The app is started separately from the relay. The repository launcher is intentionally minimal and only starts the web app process.

```bash
cd Kant
npx pnpm install
./start.sh --port 5173
```

If you want to point the app at a specific relay:

```bash
./start.sh --relay http://127.0.0.1:3001 --port 5173
```

The actual relay service is expected to be running elsewhere, either through Docker or a standalone Node process.

---

## 3. Relay runtime

The relay is started from the Node project under [packages/relay](packages/relay), usually via Docker or a systemd service.

The relay binds an internal WebSocket port and exposes an HTTP registry port. The exact defaults are defined in [packages/relay/src/index.ts](packages/relay/src/index.ts):

- RELAY_PORT = 3000
- RELAY_INFO_PORT = 3001
- RELAY_PUBLIC_HOST defaults to a local non-internal IP if not set
- RELAY_HTTP_BIND defaults to 0.0.0.0

### HTTP endpoints

The relay implements these endpoints directly:

- /relay-info
- /healthz
- /readyz
- /metrics
- /register
- /lookup
- /report/opk-burn-failure
- /admin/reservations when a control token is configured

These are not abstract future goals; they are implemented in the current server.

---

## 4. Deployment options

### Local or LAN deployment

```bash
RELAY_PUBLIC_HOST=127.0.0.1 docker compose -f docker-compose.http.yml up -d --build
```

### Public relay behind TLS

Use a TLS terminator in front of the relay, such as Caddy or Nginx. The relay advertises a public host and port, while the actual listening socket stays local. This pattern is the one the code expects for internet-facing use.

See [RELAY_DEPLOY.md](RELAY_DEPLOY.md) for the deployment guidance used by the repo.

---

## 5. App configuration

The app reads the relay URL from the environment or from the CLI override. The sample file is [packages/app/.env.example](packages/app/.env.example).

Example:

```env
VITE_RELAY_URL=https://relay.example.com
```

The code also supports a legacy fallback based on the HTTP port value when a full URL is not supplied.

---

## 6. Operational reality

The repo currently supports:

- encrypted messaging primitives
- relay-backed address registry
- circuit relay bootstrap flow
- health and readiness monitoring
- metrics export
- admin debugging endpoints behind bearer auth

The repository does not currently contain a full admin plane, policy engine, or enterprise management console. The admin package is still a placeholder, and the operational admin endpoints are intentionally limited to reservation visibility and eviction under auth.

---

## 7. Recommended next step

For a production-ready deployment, keep the relay behind TLS and configure a public host, then run the web app against that relay URL. If you are doing launch prep without the admin plane, this repo is already aligned to that scope: relay + app + core + operational monitoring, without the missing admin layer.
