# Running a relay without port forwarding

You don't need a router login, a static IP or an open port to run a Kant relay.
A tunnel (Tailscale, Cloudflare Tunnel, ngrok and similar) gives your machine
one HTTPS address and carries the traffic to it from outside. This also works
behind carrier-grade NAT (most mobile and many fibre connections), where port
forwarding is impossible anyway.

The relay serves everything on **one port, 3001**: the HTTP API (`/relay-info`,
`/lookup`, …), the libp2p WebSocket clients connect over, and federation
tunnels. Point the tunnel at `http://127.0.0.1:3001` and tell the relay the
public URL with `RELAY_PUBLIC_URL`. That URL is the relay address people paste
into the app.

## The easy way

On the machine that will host the relay (Linux or macOS, with
[Docker](https://docs.docker.com/get-docker/) and, for the first two,
[Tailscale](https://tailscale.com/download) signed in):

```bash
scripts/relay-tunnel.sh funnel                       # public: anyone can use it
scripts/relay-tunnel.sh tailscale                    # private: your tailnet only
scripts/relay-tunnel.sh url https://relay.example.org   # Cloudflare Tunnel, ngrok, …
```

The script starts the relay, sets up the tunnel, checks it from the outside
and prints the relay address to share. The first time, Tailscale shows a link
to enable Serve/Funnel for your tailnet; open it, approve, and the script
carries on. `scripts/relay-tunnel.sh status` shows what's running and
`scripts/relay-tunnel.sh stop` stops it (the relay keeps its identity for next
time). No Docker? Add `--no-docker` to run it with Node in the terminal.

The rest of this page explains each option and how to set it up by hand.

| Option | Who can connect | Your own domain? | Cost | Best for |
|---|---|---|---|---|
| [Tailscale Serve](#1-tailscale-serve-private) | Only devices in your tailnet | No | Free | Family or a team that all install Tailscale |
| [Tailscale Funnel](#2-tailscale-funnel-public) | Anyone | No | Free | Small groups, quickest public setup |
| [Cloudflare Tunnel](#3-cloudflare-tunnel) | Anyone | Yes (on Cloudflare) | Free | An always-on public relay |
| [ngrok](#4-ngrok) | Anyone | No (one free static domain) | Free tier | Quick tests |

Whichever you use, message content stays end-to-end encrypted (Double
Ratchet and Noise). The tunnel provider sees the same metadata as the relay
itself: who connects, when, and how much they send.

---

## 0. Start the relay by hand

Docker (recommended). The relay is published on `127.0.0.1` only, so nothing
is reachable except through the tunnel:

```bash
RELAY_PUBLIC_URL=https://kant.tail1234.ts.net \
  docker compose -f docker-compose.tunnel.yml up -d --build
```

Without Docker:

```bash
pnpm install --frozen-lockfile && pnpm --dir packages/relay build
RELAY_PUBLIC_URL=https://kant.tail1234.ts.net RELAY_HTTP_BIND=127.0.0.1 RELAY_WS_BIND=127.0.0.1 \
  node packages/relay/dist/index.js
```

(For systemd, add `Environment=RELAY_PUBLIC_URL=…`,
`Environment=RELAY_HTTP_BIND=127.0.0.1` and `Environment=RELAY_WS_BIND=127.0.0.1` to the unit in
[RELAY_DEPLOY.md](RELAY_DEPLOY.md#3-run-with-systemd--recommended).)

`RELAY_PUBLIC_URL` must be exactly the address clients use: scheme, host and
port if it isn't 443, with no path. You usually learn it from the tunnel in the
next step. If so, start the tunnel first, then (re)start the relay with the
URL.

Keep the URL stable. Clients store addresses that include it, so changing it
later means everyone has to update their relay address.

---

## 1. Tailscale Serve (private)

Only devices logged in to your tailnet can reach the relay. Nothing is on the
public internet.

1. Install Tailscale on the relay machine and on every phone and computer that
   will use Kant: <https://tailscale.com/download>. To include people outside
   your tailnet, [share the machine](https://tailscale.com/kb/1084/sharing) with
   them.
2. In the admin console, under **DNS**, turn on **MagicDNS** and **HTTPS
   Certificates**.
3. On the relay machine:

   ```bash
   tailscale serve --bg 3001
   ```

   It prints the address, e.g. `https://kant.tail1234.ts.net`.
4. Start the relay (step 0) with `RELAY_PUBLIC_URL=https://kant.tail1234.ts.net`.
5. In Kant, go to **Settings → Relay address** and enter `kant.tail1234.ts.net`.

Use the `https://….ts.net` name, not the `100.x.y.z` IP. The phone apps
require HTTPS, and the web app can't open `ws://` from an HTTPS page.

To turn it off: `tailscale serve reset`.

## 2. Tailscale Funnel (public)

Same as Serve, but anyone on the internet can reach the relay. Your contacts
don't need Tailscale.

1. Do steps 1–2 above (Tailscale only on the relay machine).
2. Run:

   ```bash
   tailscale funnel --bg 3001
   ```

   The first time, the CLI prints a link to enable Funnel for your tailnet.
   Open it and approve. Then you get the public URL, e.g.
   `https://kant.tail1234.ts.net`.
3. Start the relay with `RELAY_PUBLIC_URL=https://kant.tail1234.ts.net`.
4. Share `kant.tail1234.ts.net` as your relay address.

Notes:
- Funnel only serves ports 443, 8443 and 10000. If you use
  `tailscale funnel --bg --https=8443 3001`, set
  `RELAY_PUBLIC_URL=https://kant.tail1234.ts.net:8443`.
- TLS ends on your machine. Tailscale's servers forward encrypted bytes.
- Funnel traffic goes through Tailscale's relay servers and is
  bandwidth-limited. That's fine for messaging and small groups; large file
  transfers will be slower than over a VPS.
- Check it: `tailscale funnel status`. Turn it off: `tailscale funnel reset`.

## 3. Cloudflare Tunnel

Needs a free Cloudflare account and a domain whose DNS is on Cloudflare.

```bash
cloudflared tunnel login
cloudflared tunnel create kant
cloudflared tunnel route dns kant relay.yourdomain.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: kant
credentials-file: /home/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: relay.yourdomain.com
    service: http://127.0.0.1:3001
  - service: http_status:404
```

```bash
cloudflared tunnel run kant      # or: sudo cloudflared service install
```

Start the relay with `RELAY_PUBLIC_URL=https://relay.yourdomain.com`.
WebSockets pass through Cloudflare by default; don't enable features that
rewrite responses (Rocket Loader, the "Under Attack" challenge) on that
hostname. Unlike Funnel, Cloudflare terminates TLS at its edge. It can't read
messages (they're Noise-encrypted inside), but it sees the same metadata the
relay does.

**Quick tunnel, for testing only:** `cloudflared tunnel --url http://127.0.0.1:3001`
prints a random `https://….trycloudflare.com` URL. It changes on every run, so
don't hand it out.

## 4. ngrok

```bash
ngrok config add-authtoken <token>
ngrok http 3001 --url=your-name.ngrok-free.app
```

Start the relay with `RELAY_PUBLIC_URL=https://your-name.ngrok-free.app`. The
free tier gives you one static domain. ngrok may show browser clients a
warning page on free domains. If the app can't connect, check
`curl https://your-name.ngrok-free.app/relay-info` from a browser, or use one
of the options above.

## Other tunnels

Any service that forwards HTTPS **with WebSocket upgrades** to one local port
works the same way: zrok, Pinggy, localhost.run, playit.gg (HTTP tunnel), or
your own `frp`/`rathole`/WireGuard tunnel to a small VPS. Point it at
`http://127.0.0.1:3001` and set `RELAY_PUBLIC_URL` to the address it gives you.
Raw TCP tunnels such as `bore` also work if they forward to 3001. Then use
`http://host:port` (no TLS), which only desktop clients accept.

---

## Check that it works

```bash
curl https://kant.tail1234.ts.net/relay-info
```

The `multiaddr` must point at the tunnel, not your LAN IP:

```json
{"peerId":"12D3KooW…","multiaddr":"/dns4/kant.tail1234.ts.net/tcp/443/tls/ws/p2p/12D3KooW…"}
```

For an end-to-end check with real clients through the tunnel:

```bash
cd packages/core && pnpm run build
node --loader ./sodium-loader.mjs --import ./sodium-loader.mjs scripts/relay-load.mjs \
  --relay https://kant.tail1234.ts.net --clients 10 --rate 2 --fanout 2 --msgs 2
```

## Good to know

- **Metrics.** With `RELAY_PUBLIC_URL` set, `/metrics` answers 404 unless the
  request carries `Authorization: Bearer $RELAY_LAB_CONTROL_TOKEN`. Every
  tunnelled request comes from localhost, so the relay can't hide it by IP the
  way Caddy does.
- **Rate limiting.** All connections reach the relay from `127.0.0.1`, as they
  do behind Caddy, so `RELAY_INBOUND_CONNECTIONS_PER_SECOND` is the relay's
  total connect rate (see [Capacity](RELAY_DEPLOY.md#8-capacity)).
- **Federation.** Use the tunnel URL in other relays' `RELAY_FEDERATION`
  (`https://kant.tail1234.ts.net#12D3KooW…`). `/fed/*` is served on the same
  port. A Tailscale **Serve** relay is only reachable from inside the tailnet,
  so a public relay can't federate with it.
- **Your machine has to stay on.** The relay is as available as the computer
  running it. For an always-on relay, see [RELAY_DEPLOY.md](RELAY_DEPLOY.md).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `/relay-info` works but the app never connects | `RELAY_PUBLIC_URL` doesn't match the tunnel URL. The `multiaddr` has the wrong host or port. |
| `multiaddr` shows `/ip4/192.168…/tcp/3000/ws` | `RELAY_PUBLIC_URL` isn't set, so the relay fell back to the LAN address. |
| Connects, then drops after a minute or two | The tunnel closes long-lived WebSockets. Check its idle/keep-alive settings. |
| Phone can't connect to `http://100.x.y.z:3001` | Phones require HTTPS. Use `tailscale serve` and the `….ts.net` name. |
| Contacts can't reach you after the tunnel restarted | The tunnel URL changed (e.g. a quick tunnel). Use a stable one. |
