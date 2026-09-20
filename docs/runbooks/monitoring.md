# Monitoring Runbook

How to observe a Kant relay in production: the metrics it exposes, what to watch, alert thresholds, and Grafana dashboard suggestions.

Deployable assets:

- Prometheus rules: [`ops/monitoring/prometheus-alerts.yml`](../../ops/monitoring/prometheus-alerts.yml)
- Grafana dashboard: [`ops/monitoring/grafana-kant-relay.json`](../../ops/monitoring/grafana-kant-relay.json)

## Table of Contents

1. [Metrics Endpoint](#metrics-endpoint)
2. [Key Metrics](#key-metrics)
3. [Alert Thresholds](#alert-thresholds)
4. [Prometheus Scrape Config](#prometheus-scrape-config)
5. [Grafana Dashboard](#grafana-dashboard)
6. [Log-Based Signals](#log-based-signals)

---

## Metrics Endpoint

The relay exposes Prometheus-format metrics at:

```
GET /metrics    on RELAY_INFO_PORT (default 3001)
```

When fronted by Caddy, this is also reachable at:

```
https://relay.example.com/metrics
```

Sample:

```
$ curl -fsS https://relay.example.com/metrics | head -20
# HELP kant_relay_reservations_active Current number of active circuit reservations
# TYPE kant_relay_reservations_active gauge
kant_relay_reservations_active 47
# HELP kant_relay_peers_active Current number of connected peers
# TYPE kant_relay_peers_active gauge
kant_relay_peers_active 31
...
```

Default `prom-client` runtime metrics (CPU, memory, GC, event-loop lag) are also included. See [`packages/relay/src/metrics.ts`](../../packages/relay/src/metrics.ts) for the canonical list.

---

## Key Metrics

The metrics below are the ones to watch in dashboards and alerting. Anything not listed here is secondary — useful for forensics, not for paging.

### `kant_relay_reservations_active` (gauge)

**Current number of active circuit reservations.**

This is the single most important health signal. A healthy relay serving a steady population of peers will hold reservations roughly equal to the number of online peers (each peer holds 1–2 reservations). The number should drift up during peak hours and down during off-peak; it should *not* yo-yo.

| Pattern | Likely meaning |
|---|---|
| Stable at expected level | Healthy. |
| Slowly growing over hours | Population growing, or clients not refreshing reservations. |
| Sudden spike | Possible load event, attack, or a client bug creating excess reservations. |
| Sudden drop to zero | Network or libp2p failure — relay is unable to keep reservations open. |
| Oscillating rapidly | libp2p is rejecting/recreating reservations — check `reservation_errors_total`. |

### `kant_relay_reservation_errors_total{code="NO_RESERVATION"}` (counter)

**Total reservation attempts that failed with `NO_RESERVATION`.**

`NO_RESERVATION` is returned by libp2p when a peer tries to *use* a relay reservation that doesn't exist (e.g. it expired, was never created, or the relay lost it). A small steady-state rate is normal — clients occasionally race. A spike means clients are trying to relay through us faster than we can hand out reservations, or reservations are expiring before clients renew them.

| Pattern | Likely meaning |
|---|---|
| < 5/min steady | Normal background noise. |
| 10–50/min | Capacity pressure or expiry-too-aggressive. Investigate. |
| > 50/min | Real problem — clients are failing to relay. Page. |

Also watch the other `code` labels (`RESOURCE_LIMIT`, `PERMISSION_DENIED`, etc.) — sustained non-zero values on any of them are bad.

### `kant_relay_peers_active` (gauge)

**Current number of connected libp2p peers.**

A peer here means an open WebSocket connection to the relay, regardless of whether they hold a reservation. Should track closely with `reservations_active` but is sometimes slightly higher (peers connected but reservation not yet granted) or lower (peers in the middle of reconnecting).

### `kant_relay_registry_entries{kind="ephemeral"|"identity"}` (gauge)

**Current number of registry entries by kind.**

- `kind="ephemeral"` — short-lived entries (typically network/address hints).
- `kind="identity"` — long-lived entries tied to a PeerID.

The relay caps total entries; if either number is stuck at the cap, evictions are happening too aggressively. Check `kant_relay_registry_evictions_total`.

A healthy ratio is typically `ephemeral >> identity`. A sudden flip (e.g. identity >> ephemeral) can indicate a client bug or a coordinated publish.

### `kant_relay_register_requests_total{result="bad_signature"}` (counter)

**Register requests rejected because the signature did not verify.**

This is the single most important security signal. A steady `0` is normal. Anything consistently non-zero is **a strong signal of an attack** — someone is sending forged registrations, either probing the registry or trying to spoof someone else's address.

| Pattern | Likely meaning |
|---|---|
| 0 | Healthy. |
| Occasional 1–2/min | Likely a buggy client. Watch, don't page. |
| > 5/min sustained | **Probable attack. Page and investigate.** |
| Bursts of 100+/min | **Active attack or scanning. Page immediately.** |

The same `result` label series has other values — `ok`, `invalid_payload`, `rate_limited`, `not_found`, `forbidden`, `internal_error`. Watch the rates of all of them.

### `kant_relay_opk_burn_failures_total` (counter)

**OPK burn failures reported by clients (OPK already consumed or missing).**

Clients POST to `/report/opk-burn-failure` when `burnOPK()` returns `null`. The relay is stateless wrt OPKs, so this counter aggregates client-side observations. A non-zero rate means one of two things:

1. **Replay attack** — an attacker is re-sending an `opkId` whose corresponding private key has already been consumed by a legitimate first-use handshake. This is the X3DH replay defence working as designed; the counter exists to detect the attack, not to act on the failure.
2. **OPK pool exhaustion** — the receiving client ran out of OPKs and is rejecting new handshakes because the pool wasn't replenished in time (see `replenishOPKPool()` in `packages/core/src/prekey.ts`).

| Pattern | Likely meaning |
|---|---|
| 0 | Healthy. |
| 0 < rate ≤ 0.1/s (5m) | Normal background. |
| > 0.1/s sustained | Replay attack or OPK pool exhaustion. Page. |

Reported reasons (`reason` is logged, not labeled, to keep cardinality bounded): `already_burned`, `not_found`, `unknown`.

### Other metrics worth graphing (not paging)

| Metric | Use |
|---|---|
| `kant_relay_circuits_opened_total{direction=...}` | Circuit churn rate; high churn + slow refresh hints at instability. |
| `kant_relay_circuit_duration_seconds` (histogram) | p50/p95/p99 of circuit lifetimes. |
| `kant_relay_register_request_duration_seconds` (histogram) | HTTP registry latency. |
| `kant_relay_lookup_request_duration_seconds` (histogram) | HTTP registry latency. |
| `kant_relay_lookup_hits_total` / `_misses_total` | Registry hit ratio — sustained low hits can indicate caching or churn issues. |
| `kant_relay_reservations_removed_total{reason=...}` | Why reservations are going away. `expire` is normal; `error` is not. |
| `kant_relay_ready{gate=...}` | Per-gate readiness state, useful for debugging startup. |
| `process_cpu_seconds_total`, `process_resident_memory_bytes` | Standard `prom-client` runtime. |
| `nodejs_eventloop_lag_seconds` | If p99 > 1s the relay is overloaded. |

---

## Alert Thresholds

All thresholds assume a relay sized for ~500 peers with `RELAY_MAX_RESERVATIONS=1024`. Adjust linearly for larger or smaller instances.

### Page on-call (P2)

| Alert | Condition | For |
|---|---|---|
| `RelayHighNoReservationRate` | `rate(kant_relay_reservation_errors_total{code="NO_RESERVATION"}[5m]) > 50/min` | 5m |
| `RelayAuthFailureBurst` | `rate(kant_relay_register_requests_total{result="bad_signature"}[5m]) > 5/min` | 5m |
| `RelayDown` | `up{job="kant-relay"} == 0` | 2m |
| `RelayNotReady` | `kant_relay_ready{relay="main"} == 0` | 5m |
| `RelayReservationNearLimit` | `kant_relay_reservations_active > 900` (90% of 1024) | 5m |

### Warning (P3 / P4)

| Alert | Condition | For |
|---|---|---|
| `RelayNoReservationElevated` | `rate(kant_relay_reservation_errors_total{code="NO_RESERVATION"}[5m]) > 10/min` | 10m |
| `RelayPeerCountHigh` | `kant_relay_peers_active > 500` | 10m |
| `RelayRegistryEvictionsHigh` | `rate(kant_relay_registry_evictions_total[15m]) > 50/min` | 15m |
| `RelayEventLoopLag` | `nodejs_eventloop_lag_seconds{quantile="0.99"} > 0.5` | 10m |
| `RelayLookupLatency` | `histogram_quantile(0.99, rate(kant_relay_lookup_request_duration_seconds_bucket[5m])) > 0.1` | 10m |
| `RelayRegisterLatency` | `histogram_quantile(0.99, rate(kant_relay_register_request_duration_seconds_bucket[5m])) > 0.1` | 10m |

### PromQL examples

```promql
# NO_RESERVATION rate (per minute)
rate(kant_relay_reservation_errors_total{code="NO_RESERVATION"}[5m]) * 60

# bad_signature rate
rate(kant_relay_register_requests_total{result="bad_signature"}[5m]) * 60

# Reservation saturation
kant_relay_reservations_active / on() group_left vector(1024)

# Auth failure alert
sum(rate(kant_relay_register_requests_total{result="bad_signature"}[5m])) * 60 > 5
```

---

## Prometheus Scrape Config

### External Prometheus (recommended for production)

Add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'kant-relay'
    metrics_path: '/metrics'
    scheme: https
    static_configs:
      - targets: ['relay.example.com']
    scrape_interval: 15s
    scrape_timeout: 10s
    # Optional: basic auth if metrics are protected
    # basic_auth:
    #   username: 'prometheus'
    #   password_file: '/etc/prometheus/relay-metrics-password'
```

### Internal/Docker Prometheus scrape config

If Prometheus is running inside the same Docker network:

```yaml
scrape_configs:
  - job_name: 'kant-relay'
    static_configs:
      - targets: ['relay:3001']
    metrics_path: '/metrics'
    scrape_interval: 15s
    scrape_timeout: 10s
    # Remove scheme for internal Docker networking
    # (connects via Docker DNS, not HTTPS)
```

### Alert Threshold Reminders

The following thresholds should be configured in your alerting rules:

#### Critical (P2) — Page immediately

| Metric | Condition | Meaning |
|--------|-----------|---------|
| `kant_relay_reservation_errors_total{code="NO_RESERVATION"}` | > 50/min | Clients failing to relay — capacity issue or attack |
| `kant_relay_reservations_active` | > 900 (90% of 1024) | Reservation limit near capacity |
| `kant_relay_register_requests_total{result="bad_signature"}` | > 5/min | Possible authentication attack |
| `up{job="kant-relay"}` | == 0 | Relay is down |

#### Warning (P3/P4) — Investigate within the hour

| Metric | Condition | Meaning |
|--------|-----------|---------|
| `kant_relay_reservation_errors_total{code="NO_RESERVATION"}` | > 10/min | Elevated reservation failures |
| `kant_relay_peers_active` | > 500 | High peer count — verify capacity |
| `kant_relay_registry_evictions_total` | > 50/15min | Evictions happening too fast |
| `nodejs_eventloop_lag_seconds{quantile="0.99"}` | > 0.5s | Relay is overloaded |

### Complete Alert Rule Example

```yaml
# kant-relay-alerts.yml
groups:
  - name: kant-relay
    rules:
      # Critical
      - alert: RelayHighNoReservationRate
        expr: rate(kant_relay_reservation_errors_total{code="NO_RESERVATION"}[5m]) * 60 > 50
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High NO_RESERVATION error rate"
          description: "Relay {{ $labels.instance }} has {{ $value }} NO_RESERVATION errors/min"

      - alert: RelayReservationNearLimit
        expr: kant_relay_reservations_active > 900
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Reservation limit approaching"
          description: "{{ $value }} active reservations (limit: 1024)"

      - alert: RelayAuthFailureBurst
        expr: rate(kant_relay_register_requests_total{result="bad_signature"}[5m]) * 60 > 5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Authentication failures detected"
          description: "{{ $value }} bad_signature errors/min — possible attack"

      # Warning
      - alert: RelayNoReservationElevated
        expr: rate(kant_relay_reservation_errors_total{code="NO_RESERVATION"}[5m]) * 60 > 10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Elevated NO_RESERVATION rate"
          description: "{{ $value }} errors/min — investigate capacity or client bugs"

      - alert: RelayPeerCountHigh
        expr: kant_relay_peers_active > 500
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High peer count"
          description: "{{ $value }} active peers"

      - alert: KantOPKBurnFailures
        expr: rate(kant_relay_opk_burn_failures_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "OPK burn race condition detected"
          description: "OPK burn returned null for {{ $value }} requests/sec. Possible replay attack or OPK pool exhaustion."
```

If the `/metrics` endpoint is behind Caddy with a path-specific route, no extra path is required. If you've put it on a different port internally, point the target at that port and adjust `scheme` accordingly.

---

## Grafana Dashboard

A starter panel list. All panels should source the `kant-relay` Prometheus job.

### Row 1: Overview

- **Stat — Active reservations.** `kant_relay_reservations_active`.
- **Stat — Active peers.** `kant_relay_peers_active`.
- **Stat — NO_RESERVATION rate (5m).** `rate(kant_relay_reservation_errors_total{code="NO_RESERVATION"}[5m]) * 60`.
- **Stat — Ready.** `kant_relay_ready{relay="main"}` rendered as Up/Down.

### Row 2: Capacity

- **Time series — Active reservations vs. limit.** `kant_relay_reservations_active` with a threshold annotation at 900.
- **Time series — Active peers.**
- **Gauge — Reservation saturation.** `kant_relay_reservations_active / 1024` shown 0–100%.

### Row 3: Errors

- **Time series — Reservation errors by code.** `sum by (code) (rate(kant_relay_reservation_errors_total[5m]))`.
- **Time series — Register results.** `sum by (result) (rate(kant_relay_register_requests_total[5m]))`.
- **Time series — Bad signature (security).** `rate(kant_relay_register_requests_total{result="bad_signature"}[5m]) * 60` with alert annotation at 5/min.

### Row 4: Latency

- **Time series — Lookup p50/p95/p99.** `histogram_quantile(0.5/0.95/0.99, ..._lookup_request_duration_seconds_bucket)`.
- **Time series — Register p50/p95/p99.**
- **Time series — Circuit duration p50/p95/p99.**

### Row 5: Registry

- **Time series — Registry entries by kind.** `kant_relay_registry_entries`.
- **Time series — Lookup hit ratio.** `rate(kant_relay_lookup_hits_total[5m]) / (rate(kant_relay_lookup_hits_total[5m]) + rate(kant_relay_lookup_misses_total[5m]))`.
- **Time series — Evictions by reason.** `sum by (reason) (rate(kant_relay_registry_evictions_total[5m]))`.

### Row 6: Runtime

- **Time series — CPU.**
- **Time series — RSS memory.**
- **Time series — Event loop lag p99.**

Suggested refresh: **15s**. Suggested time range: **last 6 hours** for ops, **last 24h** for incident review.

---

## Log-Based Signals

Logs are JSON when `LOG_FORMAT=json` is set. Useful patterns (assumes `jq`):

```bash
# All errors
$ docker compose logs relay 2>&1 | jq -c 'select(.level == "error" or .level == "fatal")'

# Reservation events
$ docker compose logs relay 2>&1 | jq -c 'select(.msg | test("reservation"; "i"))'

# Auth failures
$ docker compose logs relay 2>&1 | jq -c 'select(.msg | test("bad_signature|unauthorized"; "i"))'

# Last 20 registry events
$ docker compose logs relay 2>&1 | jq -c 'select(.component == "registry")' | tail -20
```

See [`incident-response.md`](./incident-response.md) for the log-grep playbook for each common incident scenario.

---

*See also: [`relay-deployment.md`](./relay-deployment.md) for scraping setup, [`incident-response.md`](./incident-response.md) for what to do when these alerts fire.*
