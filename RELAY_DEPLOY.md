# Deploying the Kant relay

The relay does not store message plaintext or message history. It carries encrypted transport traffic and keeps an in-memory signed address registry, so it can observe connection and registry metadata while running.
A $4–6/mo VPS (Hetzner CAX11, Fly.io, DigitalOcean) is all you need.

---

## 1. VPS setup

```bash
# On the VPS (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
npm install -g pnpm
```

## 2. Deploy

### Option A: Automated Deployment (Recommended)
Use the provided deployment script to automate Docker installation, configuration, and startup.

```bash
# If you are running this on a server where the repo is already cloned:
cd /path/to/Kant

# For production (HTTPS):
sudo ./scripts/deploy-relay.sh --local --domain relay.yourdomain.com --mode https

# For internal/lab (HTTP):
sudo ./scripts/deploy-relay.sh --local --mode http
```

*Note: Use the `--local` flag if the repository is private or already present on the disk to avoid Git authentication issues.*

### Option B: Remote Clone Deployment
If you want the script to clone the repository for you:
```bash
# Run from any directory
sudo ./scripts/deploy-relay.sh --domain relay.yourdomain.com --mode https
```

### Option B: Manual Deployment
If you prefer to manage the process manually:
```bash
git clone https://github.com/your-org/kant.git
cd kant
pnpm install --frozen-lockfile
cd packages/relay && pnpm build
```

## 3. Run (with systemd — recommended)

Create `/etc/systemd/system/kant-relay.service`:

```ini
[Unit]
Description=Kant relay node
After=network.target

[Service]
WorkingDirectory=/opt/kant
ExecStart=/usr/bin/node packages/relay/dist/index.js
Restart=always
RestartSec=5
Environment=RELAY_PORT=3000
Environment=RELAY_INFO_PORT=3001
Environment=RELAY_PUBLIC_HOST=YOUR_SERVER_IP_OR_DOMAIN
Environment=RELAY_HTTP_BIND=0.0.0.0
Environment=RELAY_DATA_DIR=/opt/kant/relay-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now kant-relay
```

## 4. Firewall

Open two ports:
- **3000** — libp2p WebSocket (peers connect here)
- **3001** — HTTP registry (register / lookup / relay-info)

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 3001/tcp
```

## 5. TLS (strongly recommended)

Put Nginx or Caddy in front so the WebSocket runs on `wss://` and the HTTP API on `https://`. Browsers require TLS for production.

Caddy example (`/etc/caddy/Caddyfile`):

```
relay.yourdomain.com {
    reverse_proxy /relay-info localhost:3001
    reverse_proxy /register   localhost:3001
    reverse_proxy /lookup*    localhost:3001
    reverse_proxy /*          localhost:3000
}
```

With Caddy the WebSocket and HTTP registry both live behind the same domain on port 443.
Update `RELAY_PUBLIC_HOST` to your domain and set `RELAY_PORT=443` if you want the multiaddr to reflect the TLS address — or just let clients connect via the multiaddr returned by `/relay-info`.

## 6. Point the app at the relay

In `packages/app/.env` (copy from `.env.example`):

```
VITE_RELAY_URL=https://relay.yourdomain.com
```

Build and ship the app. Every client worldwide now connects to the same public relay.

---

## What the relay can and cannot see

| | Relay |
|---|---|
| Message content | ✗ Never — Double Ratchet + Noise |
| Who is talking to whom | ✗ Onion routing, 3 hops |
| That a peer is online | ✓ Sees circuit reservations |
| Peer public keys (in registry) | ✓ Required for lookup |

The relay is architecturally incapable of reading messages. Seizing the relay yields nothing of value.
