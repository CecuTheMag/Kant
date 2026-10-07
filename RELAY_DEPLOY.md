# Deploying the Kant relay

The relay does not store message plaintext or message history. It carries encrypted transport traffic and keeps an in-memory signed address registry, so it can observe connection and registry metadata while running.
A $4–6/mo VPS (Hetzner CAX11, Fly.io, DigitalOcean) is all you need.

## What you need (and what you don't)

| | |
|---|---|
| **Needed** | A machine that stays on, with Docker. For HTTPS: a domain pointing at it and ports 80 + 443 open. |
| **No domain / can't open ports?** | Use a tunnel instead: `scripts/relay-tunnel.sh funnel` ([RELAY_TUNNELS.md](RELAY_TUNNELS.md)). |
| **Not needed** | Firebase, a `google-services.json` or service-account file, a push proxy, VAPID tools, Node.js. |
| **Made for you** | The TLS certificate (Caddy, Let's Encrypt), the Web Push keys for desktop notifications, an operator token for `/metrics`. |

Notifications, per platform:

| Platform | What wakes it | Needs anything from you? |
|---|---|---|
| Desktop / browser (PWA) | Web Push | No; the scripts generate the keys. |
| Android | The app's foreground service keeps it connected while Kant runs | No. Waking a *closed* app needs Firebase push, which only an app built with your own Firebase project can use (then set `PUSH_PROXY_URL`/`PUSH_PROXY_SECRET`, see `packages/push-proxy`). The released Kant app is built without it. |
| iOS | Local notifications while the app runs | No (remote push would need an Apple developer account). |

---

## 1. Deploy (recommended: the script)

On the server, with the repository cloned:

```bash
cd /path/to/Kant
./scripts/deploy-relay.sh --local
```

It asks how people will reach the relay:

1. **HTTPS with a domain**: asks for the domain and an email (Let's Encrypt
   sends certificate notices there; `@example.*` addresses are refused), checks
   the domain's DNS points at this server, and gets the certificate.
2. **HTTP on a LAN or VPN**: uses this machine's LAN IP (or one you give).
3. **No domain or no open ports**: sends you to `scripts/relay-tunnel.sh`.

It then builds and starts the relay, generates the Web Push keys, checks the
relay answers at its address and prints the address to share. Everything it
chose is in `.env` (owner-only) and reused when you run it again, e.g. to
update. Non-interactive:

```bash
./scripts/deploy-relay.sh --local --mode https --domain relay.example.org --email you@example.org --yes
./scripts/deploy-relay.sh --local --mode http --yes
```

Without `--local` it clones the repository into `/opt/kant` (`--path` to change
that). It uses `sudo` only where it has to (installing Docker, writing to
`/opt`).

## 2. Manual deployment (without Docker)

```bash
# Node.js 20+ and pnpm
git clone https://github.com/CecuTheMag/Kant.git
cd Kant
pnpm install --frozen-lockfile
cd packages/relay && pnpm build
node dist/vapid.js        # Web Push keys for the environment below (optional)
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

Port 3001 alone is enough if you set `RELAY_PUBLIC_URL=http://<host>:3001`:
the relay then announces its libp2p WebSocket on the API port and serves both
there. That's what tunnels use ([RELAY_TUNNELS.md](RELAY_TUNNELS.md)).

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

People using the released apps enter the address in **Settings → Relay
address** (or during onboarding), e.g. `relay.yourdomain.com`. Nothing needs
rebuilding.

If you build the app yourself, you can make your relay the default in
`packages/app/.env` (copy from `.env.example`):

```
VITE_RELAY_URL=https://relay.yourdomain.com
```

---

## 7. Federate with other relays (optional)

Federation lets a user on your relay talk to a user on another relay. Traffic
goes **user1 → your relay → their relay → user2**: the client opens a WebSocket
to *its own* relay at `/fed/<peer-relay-id>`, which splices it byte for byte onto
the peer relay. The client then runs Noise with the peer relay, and a normal
circuit (with its own end-to-end Noise) to user2. Both relays only ever carry
ciphertext; the peer relay sees your relay's IP, never the user's.

1. Get each relay's PeerID: `curl https://<relay>/relay-info` → `peerId`.
2. On **each** relay, list the others (comma-separated `<url>#<peerId>`):

   ```bash
   # relay A (.env next to docker-compose.https.yml)
   RELAY_FEDERATION=https://relay-b.example.org#12D3KooW…B
   # relay B
   RELAY_FEDERATION=https://relay-a.example.org#12D3KooW…A
   ```

   The PeerID is a pin: if the URL ever answers with a different identity,
   federation with it stops. Use `https://` URLs in production.
3. `docker compose -f docker-compose.https.yml up -d --build`. The shipped
   Caddyfile already routes `/fed/*` to the relay; custom proxies need the same
   (WebSocket upgrade passthrough, no buffering, HTTP/1.1).
4. Check: `curl https://<relay>/relay-info` shows
   `"federation": {"tunnel": …, "peers": ["12D3KooW…"]}` once the peer answers;
   `GET /admin/federation` (bearer `RELAY_LAB_CONTROL_TOKEN`) shows per-peer
   health and the last error; Prometheus has `kant_federation_*` metrics.

Safeguards: only pinned peers are tunnel targets (never an open proxy); only
clients currently connected to the relay may tunnel, with a single-use token
signed by their key and valid for 60 s; tunnel caps
(`RELAY_FEDERATION_MAX_TUNNELS`, default 1024; `…_PER_CLIENT`, default 8);
federated lookups are answered from the local registry only (no recursion), and
an answer is accepted only if it points at the relay that gave it. While
federation is on, clients refuse to dial a federated relay directly.

## 8. Capacity

One relay carries **4096 online users** by default (`RELAY_MAX_CONNECTIONS`;
reservations follow it unless `RELAY_MAX_RESERVATIONS` is set). Measured: 1000
clients use ~510 MB RSS and under half a CPU core; 1000 clients reconnecting at
once are all back within 5 s. Raise the cap only with the RAM for it (~0.5 MB
per user).

`RELAY_MAX_CIRCUITS_PER_PEER` (default 1024) is how many people one user can
be connected to through the relay at the same time. libp2p's built-in default
was 32, which before 0.5.0 meant nobody could reach a 33rd contact or group
member; don't set it below a few hundred.

`RELAY_INBOUND_CONNECTIONS_PER_SECOND` (default 500) is libp2p's per-IP connect
rate limit. Behind Caddy every client arrives from Caddy's IP, so this is the
relay's **total** connect rate — keep it well above your reconnect wave after a
restart. `RELAY_MAX_PENDING_CONNECTIONS` (default 256) bounds handshakes in
flight.

Only a device holding a live connection to the relay can `/register`, only
under its own key (its PeerID is derived from its identity key), and it keeps at
most 4 keys; the registry is sized so connected devices can never fill it.

Verify a deployment under real traffic with the transport load test and the
federation smoke test (both use real libp2p clients):

```sh
cd packages/core && pnpm run build
node --loader ./sodium-loader.mjs --import ./sodium-loader.mjs scripts/relay-load.mjs \
  --relay https://<relay> --clients 50 --rate 5 --fanout 3 --msgs 2
node --loader ./sodium-loader.mjs --import ./sodium-loader.mjs scripts/federation-smoke.mjs \
  https://<relay-a> https://<relay-b> 10
```

## What the relay can and cannot see

| | Relay |
|---|---|
| Message content | ✗ Never — Double Ratchet + Noise |
| Who is talking to whom | ✗ Onion routing, 3 hops |
| That a peer is online | ✓ Sees circuit reservations |
| Peer public keys (in registry) | ✓ Required for lookup |

The relay is architecturally incapable of reading messages. Seizing the relay yields nothing of value.
