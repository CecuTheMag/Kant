# Backup & Recovery Runbook

What to back up, what *not* to back up, how to recover, and how to rotate keys for a Kant relay.

## Table of Contents

1. [What Is Persistent](#what-is-persistent)
2. [What Is NOT Persistent](#what-is-not-persistent)
3. [Where Client Data Lives](#where-client-data-lives)
4. [What to Back Up](#what-to-back-up)
5. [Backup Procedure](#backup-procedure)
6. [Restoring from Backup](#restoring-from-backup)
7. [Stateless Restarts](#stateless-restarts)
8. [Disaster Recovery](#disaster-recovery)
9. [Key Rotation](#key-rotation)
10. [Post-Recovery Verification](#post-recovery-verification)

---

## What Is Persistent

Exactly **one** thing on the relay itself:

- **`relay-seed-3000.bin`** — the libp2p long-term identity seed for the relay. Stored in the `RELAY_DATA_DIR` (default `./relay-data`).

That's it. This file is what makes the relay's PeerID stable across restarts. Lose it and the relay will boot with a *new* PeerID, which means:
- Existing clients that pinned the old multiaddr will need to re-discover.
- The old multiaddr is no longer routable.
- Any DNS / app config that referenced the old PeerID is invalidated.

Optionally persisted depending on deployment:

- **Caddy data volume (`caddy-data`)** — TLS certificate and ACME account. You almost certainly want to keep this. If lost, Caddy will re-issue a new cert automatically, but clients may see a brief validation window.
- **Caddy config volume (`caddy-config`)** — Caddy's runtime config cache. Re-creatable.

---

## What Is NOT Persistent

Everything else is **ephemeral** and intentionally so:

| Data | Lives in | Persisted? |
|---|---|---|
| Circuit reservations | libp2p in-memory map | ❌ Lost on restart. Clients re-create within seconds. |
| Circuit connections | Active WebSocket sessions | ❌ Dropped. Clients reconnect. |
| Registry entries (ephemeral) | In-memory map with TTL | ❌ Expired or re-published. |
| Registry entries (identity) | In-memory map with TTL | ❌ Re-published by owners. |
| HTTP server state | Process | ❌ Stateless. |
| Metrics counters | Process | ❌ Reset to zero on restart. |
| Logs | `journald` / Docker / log shipper | Depends on log shipper — see below. |

This is by design. The relay is a **stateless packet forwarder** with a small, ephemeral, signed-publication registry on the side. The architectural guarantee is that no relay state is required for messages to flow — only the long-term identity.

---

## Where Client Data Lives

The relay **never** sees client data. For completeness:

| Data | Where it lives | Backed up by |
|---|---|---|
| User identity (keypair) | `packages/core` store — IndexedDB in browsers, file in Node/Electron/Capacitor. | The user. |
| Contacts | Same local store. | The user. |
| Message history | Same local store (encrypted at rest with the user's key). | The user. |
| Prekeys | Same local store. | The user. |
| Outbox queue | Same local store, sent items drained on connection. | The user. |

The relay's role is:
- Forward encrypted circuit traffic between peers.
- Store signed address hints in the ephemeral registry, with TTL.

> ⚠️ **Seizing a relay yields nothing of value to an attacker.** No message content, no identities, no keys, no historical contact graph — only the relay's own PeerID seed (which is published anyway) and whatever connection metadata is observable in transit (which onion routing hides).

---

## What to Back Up

| Asset | Required? | Frequency | Retention |
|---|---|---|---|
| `relay-seed-3000.bin` | **Yes** | After every rotation; otherwise continuous (it never changes) | Forever, encrypted at rest. |
| Caddy `caddy-data` volume | Recommended | Continuous (a Docker volume is durable) | Forever. |
| Compose files & `.env` | Yes | On every change | Git. |
| `Caddyfile` | Yes | On every change | Git. |
| Log archives | Recommended for forensics | Daily | Per data-retention policy. |
| Prometheus TSDB | Recommended | Daily snapshot | Per data-retention policy. |
| Grafana dashboards | Optional (exportable JSON) | On every change | Git. |

---

## Backup Procedure

### 1. The PeerID seed

Find the file:

```bash
# In the container
$ docker compose -f docker-compose.https.yml exec relay ls -la /data
-rw-------  1 node node   32 Aug 31 11:00 relay-seed-3000.bin

# On the host (if bind-mounted)
$ ls -la /opt/kant/relay-data
```

Back it up:

```bash
# Copy the seed out through the running container. This works for either a
# named Docker volume or a bind mount.
$ docker compose -f docker-compose.https.yml exec -T relay \
    sh -c 'test -s /data/relay-seed-3000.bin && cat /data/relay-seed-3000.bin' \
    > /tmp/relay-seed-3000.bin
$ test "$(wc -c < /tmp/relay-seed-3000.bin)" -eq 32
$ chmod 0600 /tmp/relay-seed-3000.bin
$ sha256sum /tmp/relay-seed-3000.bin

# Encrypt before moving it off-host, then remove the plaintext copy.
$ gpg --symmetric --cipher-algo AES256 --output /tmp/relay-seed-3000.bin.gpg /tmp/relay-seed-3000.bin
$ shred -u /tmp/relay-seed-3000.bin
```

Move the backup off-host (one of):

- **S3 / object storage** (recommended): `aws s3 cp relay-seed-3000.bin.gpg s3://kant-backups/relay/<host>/$(date -u +%Y/%m/%d)/`
- **Password manager** (small ops team): 1Password / Bitwarden / KeePassXC, entry per host.
- **Encrypted USB in a safe** (paranoid mode): for very small deployments.

> 🔒 **Treat this file like a private key.** Anyone with `relay-seed-3000.bin` can impersonate the relay. The TLS cert in Caddy's data volume provides the same property transitively, but defense-in-depth is correct here.

### 2. Caddy data (optional but recommended)

```bash
$ docker run --rm \
    -v kant_caddy-data:/data:ro \
    -v $(pwd):/backup \
    alpine tar czf /backup/caddy-data-$(date -u +%Y%m%d).tgz -C /data .
```

Store alongside the relay backup.

### 3. Logs

If you're using a log shipper (Vector, Fluent Bit, Promtail, etc.), ensure it's running on the host. The compose setup does *not* persist container logs beyond Docker's default; `json-file` driver with a rotation cap is the minimum:

```yaml
# In docker-compose.https.yml
services:
  relay:
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "10"
```

For long-term retention, ship to Loki/Elasticsearch/CloudWatch.

### 4. Configuration

Everything in `/opt/kant` *except* the `relay-data/` and `caddy-data/` volumes should be in git. The `relay-data/` directory is in `.gitignore` — backups for that path are described above.

Verify:

```bash
$ git status
$ cat .gitignore | grep -E '(relay-data|caddy-data)'
```

---

## Restoring from Backup

Use this when the host is lost, the disk is wiped, or you need to stand up the relay on a new VPS.

### 1. Provision the new host

Follow [`relay-deployment.md`](./relay-deployment.md) up to but not including the `docker compose up` step.

### 2. Restore the PeerID seed

```bash
# Stop the relay if it is running, then decrypt on the host (the runtime image
# intentionally does not contain GnuPG).
$ docker compose -f docker-compose.https.yml down
$ gpg --decrypt /backup/relay-seed-3000.bin.gpg > ./relay-seed-3000.bin.restore
$ test "$(wc -c < ./relay-seed-3000.bin.restore)" -eq 32
$ chmod 0600 ./relay-seed-3000.bin.restore

# Copy into the service volume and restore ownership for the non-root relay user.
$ docker compose -f docker-compose.https.yml run --rm --no-deps --user root \
    -v "$(pwd)/relay-seed-3000.bin.restore:/restore/relay-seed-3000.bin:ro" \
    relay sh -c 'cp /restore/relay-seed-3000.bin /data/relay-seed-3000.bin && chown relay:relay /data/relay-seed-3000.bin && chmod 0600 /data/relay-seed-3000.bin'
$ shred -u ./relay-seed-3000.bin.restore

# Verify through the relay image so the actual runtime user must be able to read it.
$ docker compose -f docker-compose.https.yml run --rm --no-deps relay \
    sh -c 'test "$(wc -c < /data/relay-seed-3000.bin)" -eq 32 && ls -l /data/relay-seed-3000.bin'
```

### 3. Verify the PeerID matches

Before bringing the relay up publicly, confirm the seed produces the expected PeerID:

```bash
# Start the relay temporarily
$ RELAY_DOMAIN=relay.example.com docker compose -f docker-compose.https.yml up -d relay

# Get the multiaddr it announces
$ curl -fsS https://relay.example.com/relay-info | jq -r .multiaddrs[]
# /dns4/relay.example.com/tcp/443/wss/p2p/<PEER_ID>

# Compare PEER_ID to the one clients have cached
# (in the app, the relay selection screen shows the PeerID)
```

If the PeerID does not match, you restored the wrong file. Stop and investigate.

### 4. Restore Caddy data (if backed up)

```bash
$ docker run --rm \
    -v kant_caddy-data:/data \
    -v $(pwd):/backup \
    alpine tar xzf /backup/caddy-data-YYYYMMDD.tgz -C /data
```

### 5. Bring everything up and verify

```bash
$ RELAY_DOMAIN=relay.example.com docker compose -f docker-compose.https.yml up -d
$ docker compose -f docker-compose.https.yml ps
$ ./scripts/verify-relay.sh   # if you have one; otherwise see Post-Recovery Verification below
```

---

## Stateless Restarts

Because almost nothing is persistent, **a routine restart is safe and should be the first thing you try** for any non-security incident.

```bash
# Graceful (drains connections cleanly)
$ docker compose -f docker-compose.https.yml restart

# Hard (drops connections, but no data loss)
$ docker compose -f docker-compose.https.yml down
$ docker compose -f docker-compose.https.yml up -d
```

Expected client impact:
- Existing circuits drop. Clients reconnect within seconds; some messages may be delayed by one retry.
- Registry entries are gone. Owners re-publish within their TTL.
- `/metrics` resets to zero. Alerts on `rate(...)` will flatten until the relay has been up for `5m+`.

There is **no scenario** in which a restart destroys data, because the relay holds no data to destroy.

---

## Disaster Recovery

Worst case: the host is gone, no backups reachable, the relay's PeerID is lost.

The blast radius is small:

- **Clients** configured to use a specific multiaddr will fail to connect.
- **Clients** that auto-discover via the registry will pick up the new PeerID as soon as the new relay registers itself.
- **No message history is lost** — that lives on client devices, not the relay.
- **No identities are lost** — those are client-side.

### Recovery steps

1. Stand up a fresh host following [`relay-deployment.md`](./relay-deployment.md).
2. A new PeerID is generated. Note the new PeerID from `/relay-info`.
3. Update any pinned multiaddrs (DNS, app config, public documentation) to the new relay.
4. Notify users via the in-app "relay changed" mechanism, or by publishing a status note.
5. Archive the old host's logs for forensics (if you can still reach its block storage via the cloud provider).

The relay's design deliberately accepts this as a non-catastrophic event.

---

## Key Rotation

Rotate the relay's identity in either of two scenarios:

- **Routine** (e.g. annually, or on personnel change in a small ops team).
- **Compromise** (someone got the `relay-seed-3000.bin`).

### Routine rotation

```bash
# 1. Pick a maintenance window
# 2. Generate the new key
$ docker compose -f docker-compose.https.yml down
$ sudo mv /opt/kant/relay-data/relay-seed-3000.bin /opt/kant/relay-data/relay-seed-3000.bin.old
# New key is created on next start.

$ RELAY_DOMAIN=relay.example.com docker compose -f docker-compose.https.yml up -d
$ NEW_PEER_ID=$(curl -fsS https://relay.example.com/relay-info | jq -r .peer_id)
echo "$NEW_PEER_ID"

# 3. Update pinned references:
#    - DNS records
#    - app config / VITE_RELAY_URL multiaddrs
#    - docs and runbook links

# 4. Keep relay-seed-3000.bin.old for at least 30 days, then destroy
$ shred -u /opt/kant/relay-data/relay-seed-3000.bin.old
```

### Emergency rotation (suspected compromise)

```bash
# 1. Treat the old key as public. The relay's identity must be considered
#    burned. Anyone holding the old relay-seed-3000.bin can impersonate the relay
#    in private channels.

# 2. Rotate immediately (same steps as above, but skip the "keep old" step)
$ docker compose -f docker-compose.https.yml down
$ sudo shred -u /opt/kant/relay-data/relay-seed-3000.bin
$ RELAY_DOMAIN=relay.example.com docker compose -f docker-compose.https.yml up -d

# 3. Engage Security (see incident-response.md Escalation Path)
# 4. Begin an incident; this is at minimum a P2.
# 5. Notify users that the relay identity has changed.
```

### Client-side keys

The above is for the **relay's** identity only. Client identity keys live on client devices and are never on the relay. If a *client's* key is compromised, the recovery procedure is out of scope for this runbook; see the user guide.

---

## Post-Recovery Verification

After any restore or rotation, run this checklist:

- [ ] `docker compose ps` shows both containers `Up (healthy)`.
- [ ] `curl -fsS https://relay.example.com/healthz` returns `ok`.
- [ ] `curl -fsS https://relay.example.com/readyz | jq -e '.ready == true'`.
- [ ] `curl -fsS https://relay.example.com/relay-info` returns the expected PeerID.
- [ ] `curl -fsS https://relay.example.com/metrics` returns Prometheus output.
- [ ] `kant_relay_reservations_active` is increasing as clients reconnect.
- [ ] No `bad_signature` or `unauthorized` errors in the first 10 minutes (would suggest a corrupted or mismatched key).
- [ ] At least one external client successfully connects over `wss://`.
- [ ] TLS certificate is valid (`openssl s_client -connect relay.example.com:443` shows a Let's Encrypt cert).
- [ ] If you rotated: all references to the old PeerID have been updated and the old key destroyed.

---

## Image Signing & Rollback

### Docker Image Signing

If you're using Docker and pushing images to a registry, sign them to prevent tampering:

```bash
# Sign with Cosign (recommended)
cosign sign --yes ghcr.io/kant-project/relay:v1.2.3

# Verify before deployment
cosign verify ghcr.io/kant-project/relay:v1.2.3

# Sign with Docker Content Trust (legacy)
export DOCKER_CONTENT_TRUST=1
docker push ghcr.io/kant-project/relay:v1.2.3

# Verify trust
docker trust inspect --pretty ghcr.io/kant-project/relay:v1.2.3
```

### Version Tagging Strategy (Semver)

| Tag | Example | Usage |
|-----|---------|-------|
| `latest` | `v1.2.3` | Most recent stable release |
| `major` | `v1` | Any v1.x.x (upgrade path) |
| `minor` | `v1.2` | Any v1.2.x (feature branch) |
| `sha` | `v1.2.3-abc1234` | Specific commit (immutable) |

```bash
# Tagging workflow
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
docker build -t ghcr.io/kant-project/relay:v1.2.3 .
docker push ghcr.io/kant-project/relay:v1.2.3
docker tag ghcr.io/kant-project/relay:v1.2.3 ghcr.io/kant-project/relay:latest
docker push ghcr.io/kant-project/relay:latest
```

### Quick Rollback Command Examples

#### Rollback to Previous Version (Docker)

```bash
# 1. Identify the previous version tag
docker images ghcr.io/kant-project/relay

# 2. Stop current container
docker compose -f docker-compose.https.yml down

# 3. Pull and deploy previous version
docker pull ghcr.io/kant-project/relay:v1.2.2

# 4. Update docker-compose.yml to use previous tag
sed -i 's/image: ghcr.io\/kant-project\/relay:v[0-9.]*/image: ghcr.io\/kant-project\/relay:v1.2.2/' docker-compose.https.yml

# 5. Start with previous version
docker compose -f docker-compose.https.yml up -d

# 6. Verify
curl -fsS https://relay.example.com/healthz
```

#### Rollback Using Peer-ID Restore

If the rollback is due to identity issues, execute **Restoring from Backup → Restore the PeerID seed** above, then start and verify:

```bash
$ docker compose -f docker-compose.https.yml up -d relay
$ curl -fsS https://relay.example.com/relay-info | jq -r '.peerId'
```

Do not compress identity restoration into a one-liner: decryption, the exact
32-byte length check, ownership restoration, and PeerID comparison are separate
rollback gates.

#### Rollback Without Docker (Direct Binary)

```bash
# 1. Download previous release
curl -fsSL https://github.com/kant-project/relay/releases/download/v1.2.2/kant-relay -o /usr/local/bin/kant-relay

# 2. Set permissions
chmod +x /usr/local/bin/kant-relay

# 3. Stop current
systemctl stop kant-relay

# 4. Restart with old binary
systemctl start kant-relay

# 5. Verify
curl -fsS http://localhost:3001/healthz
```

### Pre-Rollback Checklist

Before initiating a rollback, verify:

- [ ] You have a valid `relay-seed-3000.bin` backup
- [ ] The target version is compatible with your Caddy/TLS configuration
- [ ] You have tested the rollback procedure in staging
- [ ] You have notified users if there will be downtime
- [ ] You have captured current metrics/logs for post-incident analysis

### Post-Rollback Verification

After any rollback, run the full verification:

- [ ] `curl -fsS https://relay.example.com/healthz` returns `ok`
- [ ] `curl -fsS https://relay.example.com/metrics | grep kant_relay` returns metrics
- [ ] `kant_relay_reservations_active` is increasing as clients reconnect
- [ ] No increase in `kant_relay_reservation_errors_total` or `bad_signature` errors
- [ ] Peer count stabilizes within expected range
- [ ] Archive logs and metrics from the failed version for analysis

---

*See also: [`relay-deployment.md`](./relay-deployment.md) for the standard deploy, [`incident-response.md`](./incident-response.md) for handling the events that might lead to a recovery, [`RELAY_DEPLOY.md`](../../RELAY_DEPLOY.md) for the threat model context.*
