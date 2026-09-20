# Interactive Kant deployment

The repository includes `scripts/deploy-kant.sh`, which interactively configures and starts both:

- the Firebase push proxy
- either the HTTP relay or HTTPS relay with Caddy

Run it from the repository root:

```bash
./scripts/deploy-kant.sh
```

The script asks for:

- Firebase project ID
- path to the Firebase service-account JSON
- proxy shared secret, or permission to generate one
- HTTP or HTTPS relay mode
- relay host/IP for HTTP, or DNS domain for HTTPS
- push proxy host port, defaulting to `3002`
- Caddy certificate email for HTTPS
- push proxy URL
- optional VAPID public/private keys for desktop Web Push

It creates two local files with owner-only permissions:

- `.env.kant-deploy`
- `.kant-secrets/firebase-service-account.json`

Both paths are ignored by Git. The Firebase JSON is mounted read-only into the proxy container and is not copied into an environment variable.

## Rebuilding without re-entering values

After the first setup completes, rerunning the script detects the saved files and asks:

```text
Existing deployment configuration found. Reuse it? [Y/n]:
```

Press Enter to reuse the saved Firebase path, proxy secret, relay mode, domain, VAPID keys, and proxy URL. The script then rebuilds and restarts the services without asking for those values again. Choose `n` only when intentionally changing the deployment configuration.

## HTTPS prerequisites

Before selecting HTTPS:

- point the DNS record at the server
- allow ports 80 and 443 through the firewall
- ensure the selected domain is reachable from the public internet

Caddy obtains and renews the TLS certificate automatically.

In HTTPS mode, the script automatically hosts the proxy beside the relay at
`https://your-domain/proxy`. No second domain or exposed proxy port is needed.
In HTTP mode, the proxy is exposed directly on the selected host port, which
defaults to `3002` for LAN testing.

## Proxy network security

The proxy exposes port 4001 for relay-to-proxy calls. Use HTTPS for the proxy URL or place the proxy and relay on a private network/VPN. The bearer secret protects the API, but it does not replace TLS because HTTP exposes the secret to network observers.