# Incident Response Runbook

Procedures for responding to issues with a Kant relay in production: severity levels, common scenarios, escalation, and post-mortem data collection.

## Table of Contents

1. [Severity Levels](#severity-levels)
2. [Incident Lifecycle](#incident-lifecycle)
3. [Common Scenarios](#common-scenarios)
   - [Scenario 1: Relay Unreachable](#scenario-1-relay-unreachable)
   - [Scenario 2: NO_RESERVATION Errors Spiking](#scenario-2-no_reservation-errors-spiking)
   - [Scenario 3: High Latency](#scenario-3-high-latency)
   - [Scenario 4: Peer Connection Issues](#scenario-4-peer-connection-issues)
   - [Scenario 5: Authentication Failures / Possible Attack](#scenario-5-authentication-failures--possible-attack)
4. [Escalation Path](#escalation-path)
5. [Data Collection for Post-Mortems](#data-collection-for-post-mortems)
6. [Communication Templates](#communication-templates)

---

## Severity Levels

| Severity | Definition | Response time | Examples |
|---|---|---|---|
| **P1** | Relay is fully down or actively compromised. Clients cannot connect at all. | Immediate, 24/7. | `RelayDown` for > 5 min, successful auth bypass, ongoing DoS impacting service. |
| **P2** | Major degradation. Some clients affected, or capacity/correctness alarms firing. | Within 30 min, business hours. Within 2h off-hours. | `RelayHighNoReservationRate`, `RelayAuthFailureBurst`, `RelayNotReady`. |
| **P3** | Minor degradation. Workaround exists. | Within 1 business day. | Elevated `NO_RESERVATION` rate, lookup latency degraded, single bad client. |
| **P4** | Informational. No user impact. | Best-effort. | Single transient metric excursion, post-mortem follow-up. |

> When in doubt, classify up. You can always downgrade.

---

## Incident Lifecycle

1. **Detect** — Page fires, user report, or anomaly discovered in dashboard.
2. **Triage** — Confirm the alert is real (not a Prometheus scrape issue). Assign a severity and an Incident Commander (IC).
3. **Mitigate** — Stop the bleeding. Restore service. *Don't root-cause during mitigation.*
4. **Communicate** — Status updates to stakeholders at least every 30 min for P1/P2.
5. **Resolve** — Service restored. Close the alert.
6. **Post-mortem** — Within 5 business days for P1/P2, 10 days for P3. See [Data Collection](#data-collection-for-post-mortems).

### Roles

For P1/P2 incidents:

- **Incident Commander (IC):** Owns the response. Decides severity, calls the shots, manages comms. Does *not* debug.
- **Operations Lead:** Executes the runbook, runs commands, reads logs.
- **Comms Lead:** Posts status updates. (For P1 only.)
- **Scribe:** Notes everything done in the incident channel.

For P3/P4, the on-call engineer plays all roles.

---

## Common Scenarios

### Scenario 1: Relay Unreachable

**Symptoms:** `RelayDown` alert; `/healthz` and `/readyz` return connection refused or time out; users report they cannot connect at all.

**Likely causes:** Container crashed, host down, network/firewall change, Caddy certificate failure.

#### Triage checklist

```bash
# T+0: confirm scope
$ curl -fsS --max-time 5 https://relay.example.com/healthz
# If this fails, is the host reachable at all?
$ ping -c 3 relay.example.com
$ ssh user@relay.example.com 'echo ok'

# T+1m: are containers running?
$ docker ps -a
$ docker compose -f docker-compose.https.yml ps

# T+2m: recent container logs
$ docker compose -f docker-compose.https.yml logs --tail=200 --no-color relay
$ docker compose -f docker-compose.https.yml logs --tail=50  --no-color caddy

# T+3m: host resources
$ ssh user@relay.example.com 'uptime; free -h; df -h; docker system df'
```

#### Common fixes

| Symptom in logs | Fix |
|---|---|
| `relay   Exited (1)` | Check `docker logs <id> --tail=200`. Likely config error or OOM. |
| `caddy   Exited (1)` | `Caddyfile` syntax error. `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`. |
| Caddy logs `acme: error: ...` | DNS or rate-limit issue. Check `dig +short relay.example.com`. |
| Host unreachable | Network/VPS issue. Open ticket with provider. |
| OOMKilled in `dmesg` | Increase host RAM or reduce `RELAY_MAX_RESERVATIONS`. |

#### Recovery

```bash
# If containers are unhealthy but host is fine:
$ docker compose -f docker-compose.https.yml restart

# If that doesn't help, full rebuild:
$ docker compose -f docker-compose.https.yml down
$ RELAY_DOMAIN=relay.example.com docker compose -f docker-compose.https.yml up -d

# Verify
$ curl -fsS https://relay.example.com/readyz
$ curl -fsS https://relay.example.com/metrics | grep kant_relay_ready
```

#### Log grep patterns

```bash
# Container state transitions
$ docker compose logs --no-color | grep -E '(OOMKilled|exited|restarting|killed)'

# Caddy errors
$ docker compose logs --no-color caddy | grep -iE '(error|acme|permission)'

# Relay startup errors
$ docker compose logs --no-color relay | grep -E ' (ERROR|FATAL) '
```

---

### Scenario 2: NO_RESERVATION Errors Spiking

**Symptoms:** `RelayHighNoReservationRate` or `RelayNoReservationElevated` alert; users report "I can connect but cannot send messages" or peers go offline intermittently.

**Likely causes:**
- Relay is at or near `RELAY_MAX_RESERVATIONS` (1024 default).
- Reservation TTL is too short, or clients are not refreshing in time.
- libp2p upgrade or client regression causing reservation churn.
- Network instability between clients and relay forcing rapid reconnect.

#### Triage

```bash
# 1. Confirm the spike
$ curl -fsS https://relay.example.com/metrics | grep no_reservation

# 2. Check saturation
$ curl -fsS https://relay.example.com/metrics | grep '^kant_relay_reservations_active'

# 3. Check how reservations are being removed
$ curl -fsS https://relay.example.com/metrics | grep reservations_removed
# Look at the 'reason' label — 'expire' is normal; 'error' is not.

# 4. Recent log entries
$ docker compose logs --since='15m' --no-color relay | grep -i reservation | tail -100
```

#### Decision tree

```
NO_RESERVATION rate high
  ├─ reservations_active > 900?
  │    └─ YES → relay is at capacity. See "Capacity relief" below.
  └─ reservations_active < 500?
       └─ Likely TTL/refresh issue. See "Reservation churn" below.
```

#### Capacity relief

```bash
# Quick: increase the cap (requires restart)
$ docker compose -f docker-compose.https.yml down
# Edit .env or compose file: RELAY_MAX_RESERVATIONS=2048
$ RELAY_DOMAIN=relay.example.com docker compose -f docker-compose.https.yml up -d

# Better long-term: scale horizontally. Add a second relay and
# point half the clients at it via DNS round-robin or app config.
```

#### Reservation churn

```bash
# Are reservations expiring faster than they should?
$ curl -fsS https://relay.example.com/metrics | grep reservations_removed_total
# Count by reason:
# kant_relay_reservations_removed_total{reason="expire"}  <-- normal
# kant_relay_reservations_removed_total{reason="error"}   <-- investigate

# If 'error' is climbing, the relay is closing reservations unusually.
# Check for client version skew — coordinate with the app team.
```

#### Log grep patterns

```bash
# All reservation activity in the alert window
$ docker compose logs --since='30m' --no-color relay | grep -iE 'reservation'

# Reservation rejections specifically
$ docker compose logs --since='30m' --no-color relay | grep -iE 'rejected|denied|no_reservation'

# Resource limits
$ docker compose logs --since='30m' --no-color relay | grep -iE 'resource.?limit'
```

---

### Scenario 3: High Latency

**Symptoms:** `RelayLookupLatency` or `RelayRegisterLatency` alert; slow `/relay-info`, slow message delivery observed client-side.

**Likely causes:** Host CPU saturation, event-loop lag, slow upstream DNS (Caddy ACME), noisy neighbor on shared VPS, or a client making pathological registry calls.

#### Triage

```bash
# From an external host, time the endpoints
$ for i in 1 2 3 4 5; do
    curl -o /dev/null -s -w "%{time_total}\n" https://relay.example.com/relay-info
  done

# On the relay host
$ ssh user@relay.example.com 'uptime; top -bn1 | head -20; free -h'
$ ssh user@relay.example.com 'docker stats --no-stream'

# Check event loop lag
$ curl -fsS https://relay.example.com/metrics | grep nodejs_eventloop_lag
```

#### Mitigations

| Symptom | Mitigation |
|---|---|
| `nodejs_eventloop_lag_seconds{quantile="0.99"} > 1` | Node is single-threaded; check for sync work in logs. Restart may be the only immediate fix. |
| CPU at 100% on host | Scale vertically (larger VPS) or add a second relay. |
| High `register_request_duration_seconds` for one IP | Add rate-limiting at Caddy. See [`Caddyfile`](../../Caddyfile). |
| DNS resolution slow in logs | Check upstream resolvers. |
| Disk I/O wait high | Unusual — relay is in-memory. Likely a noisy neighbor. |

#### Log grep patterns

```bash
# Slow requests (if structured logs include duration)
$ docker compose logs --no-color relay | jq -c 'select(.duration_ms > 100)'

# Registry errors
$ docker compose logs --no-color relay | grep -iE 'timeout|slow|backpressure'

# GC pauses
$ docker compose logs --no-color relay | grep -iE 'gc|pause'
```

---

### Scenario 4: Peer Connection Issues

**Symptoms:** `kant_relay_peers_active` lower than expected; clients report frequent disconnects; reconnect loops in app logs.

**Likely causes:** Caddy WebSocket timeout (most common), transient network blips, libp2p version skew, host firewall dropping idle connections.

#### Triage

```bash
# 1. Check WebSocket-specific Caddy settings
$ docker compose -f docker-compose.https.yml exec caddy caddy adapt --config /etc/caddy/Caddyfile --pretty

# 2. Look for connection-reset patterns in Caddy logs
$ docker compose logs --no-color caddy | grep -iE '(reset|close|timeout)'

# 3. Relay-side peer metrics
$ curl -fsS https://relay.example.com/metrics | grep -E 'kant_relay_peers_(active|connected|disconnected)_total'
```

#### Common fixes

- **Caddy idle timeout:** Ensure the Caddyfile uses `keepalive off` and the libp2p transport is configured for long-lived WebSockets. See [`Caddyfile`](../../Caddyfile).
- **Reverse proxy in front of Caddy:** If you have Cloudflare or another proxy, increase its idle timeout to > 100s and enable WebSockets.
- **Host firewall:** `ufw` should not be killing idle established connections. If a stateful firewall is misbehaving, set `nf_conntrack_tcp_timeout_established=7200` or similar.
- **Client skew:** A small percentage of disconnects is normal. If > 5% of connections are dropping within 60s, suspect a client release.

#### Log grep patterns

```bash
# Disconnect events
$ docker compose logs --no-color relay | grep -iE 'disconnect|close|reset'

# Connection rate changes
$ curl -fsS https://relay.example.com/metrics | grep -E 'kant_relay_peers_'
```

---

### Scenario 5: Authentication Failures / Possible Attack

**Symptoms:** `RelayAuthFailureBurst` alert; `kant_relay_register_requests_total{result="bad_signature"}` rising; `lookup` returning unusual patterns.

**Likely causes:** Misbehaving/malicious client, scanning/probing of the registry endpoint, replay attempts, or a legitimate client with a bad clock.

#### Triage

```bash
# 1. Confirm the burst
$ curl -fsS https://relay.example.com/metrics | grep 'bad_signature'

# 2. Identify source IPs (if logs include remote_addr)
$ docker compose logs --since='15m' --no-color relay \
  | jq -r 'select(.msg | test("bad_signature"; "i")) | .remote_addr' \
  | sort | uniq -c | sort -rn | head -20

# 3. Are the requests targeting specific peer IDs?
$ docker compose logs --since='15m' --no-color relay \
  | jq -r 'select(.result == "bad_signature") | .peer_id' \
  | sort | uniq -c | sort -rn | head -20
```

#### Mitigations

| Severity | Action |
|---|---|
| < 10/min, single source | Likely a buggy client. Block at Caddy for 1h. Notify app team. |
| 10–100/min, single source | Probable attack. Block at Caddy for 24h, capture logs. |
| > 100/min or distributed | Active DoS. Engage upstream provider / Cloudflare. Consider enabling Caddy rate-limit module. |

#### Caddy rate-limit (if not already enabled)

Add to the registry routes in [`Caddyfile`](../../Caddyfile):

```
reverse_proxy /register relay:3001 {
    rate_limit 60r/m
}
```

> Note: this is a per-Caddy-instance limit, not a global one. For real attack mitigation, use an upstream WAF.

#### Log grep patterns

```bash
# All auth failures
$ docker compose logs --no-color relay | grep -E 'bad_signature|unauthorized|forbidden'

# Per-IP tally
$ docker compose logs --since='1h' --no-color relay \
  | grep 'bad_signature' \
  | grep -oE 'remote_addr=[^ ]+' \
  | sort | uniq -c | sort -rn | head

# Targeted peer IDs
$ docker compose logs --since='1h' --no-color relay \
  | grep 'bad_signature' \
  | grep -oE 'peer_id=[^ ]+' \
  | sort | uniq -c | sort -rn | head
```

#### Forensic preservation

Before any mitigation that drops logs (e.g. container restart), preserve evidence:

```bash
$ docker compose logs --since='24h' --no-color relay > /tmp/relay-incident-$(date -u +%Y%m%dT%H%M%SZ).log
$ sha256sum /tmp/relay-incident-*.log > /tmp/relay-incident-*.log.sha256
$ gzip -k /tmp/relay-incident-*.log
# Move to your evidence bucket before clearing.
```

---

## Escalation Path

1. **On-call engineer** — first responder for all alerts.
2. **Platform team lead** — if on-call cannot resolve within SLA, or incident is P1.
3. **Security team** — for any Scenario 5 (auth/attack) or suspected compromise.
4. **VP Engineering** — for P1 lasting > 1h, or any customer-visible incident lasting > 4h.
5. **Legal / Comms** — coordinated by VP Engineering.

### Contact registry (example — replace with real values)

| Role | Primary | Secondary | Channel |
|---|---|---|---|
| On-call | rotation-pager | — | PagerDuty / Opsgenie |
| Platform lead | TBD | TBD | Slack `#kant-platform` |
| Security | security@kant.example | — | Slack `#sec-incidents` |
| VP Eng | TBD | TBD | Phone (in PagerDuty) |
| Status page | — | — | https://status.kant.example |

> Always pin the incident channel and the IC at the top of the channel topic.

---

## Data Collection for Post-Mortems

Within **1 hour of resolution** for P1/P2, snapshot the following into the incident folder (`/incidents/YYYY-MM-DD-shortname/`):

### 1. Timeline

- T+0 (alert fired) → T+resolve. List every action with a timestamp and author.
- Pull from PagerDuty, Slack, and shell history.

### 2. Logs

```bash
# Full relay logs for the incident window
$ docker compose logs --since='2026-08-31T11:00:00Z' --until='2026-08-31T13:00:00Z' \
  --no-color relay > relay.log

# Full Caddy logs for the same window
$ docker compose logs --since='2026-08-31T11:00:00Z' --until='2026-08-31T13:00:00Z' \
  --no-color caddy > caddy.log

$ sha256sum *.log > SHA256SUMS
$ tar czf incident-$(date -u +%Y%m%d).tgz relay.log caddy.log SHA256SUMS
```

### 3. Metrics

Export from Prometheus:

```promql
# Run in Prometheus UI or `promtool query instant`
kant_relay_reservations_active
kant_relay_peers_active
rate(kant_relay_reservation_errors_total[1m])
rate(kant_relay_register_requests_total[1m])
node_cpu_seconds_total
nodejs_eventloop_lag_seconds
```

Or use the [Grafana dashboard export](../monitoring.md#grafana-dashboard) as PNG/PDF.

### 4. Config snapshots

```bash
$ docker compose -f docker-compose.https.yml config > docker-compose.config.yml
$ docker compose -f docker-compose.https.yml exec caddy cat /etc/caddy/Caddyfile > Caddyfile.active
$ docker compose -f docker-compose.https.yml exec relay env | sort > relay.env
```

### 5. State

```bash
# Container state at time of incident
$ docker ps -a > containers.txt
$ docker inspect $(docker ps -aq) > containers.json

# Relay's reported multiaddr at time of incident
$ curl -fsS https://relay.example.com/relay-info > relay-info.json
$ curl -fsS https://relay.example.com/metrics > metrics.txt
```

### 6. Client-side evidence (if available)

- Sample of client error reports with timestamps.
- A peer ID seen failing on multiple clients.

### 7. Post-mortem template

Use this skeleton:

```markdown
# Post-Mortem: <short title>

**Date:** YYYY-MM-DD
**Severity:** P1/P2/P3/P4
**IC:** name
**Duration:** HH:MM (alert → resolved)

## Summary
One paragraph. What broke, who was affected, how long.

## Impact
- Users affected: ~N
- Peers dropped: ~N
- Duration of degraded service: HH:MM

## Timeline (UTC)
- 11:00 — first alert
- 11:05 — on-call paged
- ...

## Root cause
What actually went wrong, technically.

## Contributing factors
What else made it worse or hid the issue.

## What went well
- ...

## What went poorly
- ...

## Action items
- [ ] <owner> — <action> — <due date>
- [ ] ...
```

---

## Communication Templates

### Initial (P1/P2)

> **Incident — Kant relay degraded** (P2, started 2026-08-31 11:55 UTC)
> Some clients may experience failed connections. Engineering is investigating. Next update by 12:30 UTC.

### Resolution

> **Resolved — Kant relay** (P2, 2026-08-31 11:55–12:40 UTC)
> Root cause was <one sentence>. Service restored. Full post-mortem within 5 business days.

### Internal-only (P3/P4)

A short note in `#kant-platform` with the alert, the fix, and a link to the runbook section used. No external comms.

---

*See also: [`monitoring.md`](./monitoring.md) for the metrics these scenarios reference, [`backup-recovery.md`](./backup-recovery.md) for the post-incident state-recovery procedure if a key was rotated.*
