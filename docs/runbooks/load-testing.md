# Load Testing Guide

This runbook covers the Kant relay load test: how to run it, what it measures, pass criteria, and how to interpret and debug failures.

---

## Overview

The load test spawns **N headless Node.js client processes** that speak the same signed registry protocol as real Kant clients. It exercises the relay's:

- **Address registry** — concurrent `/register` and `/lookup` requests
- **Route completeness** — every client must resolve every other registered key
- **Relay error surface** — `NO_RESERVATION` error rates are sampled during the run
- **Resource consumption** — relay memory and CPU under load

The test is **registry-level only** — it does not create libp2p reservations, send group keys, or run a browser. Real group/file/churn transport behavior is covered by the Playwright E2E suite; do not present this test as evidence of 100 simultaneous relay reservations.

---

## Running the Test

### Prerequisites

The Docker lab must be up and the relay must be reachable:

```sh
# From the repo root:
tests/lab/scripts/run.sh lan
```

Or bring up just the relay:

```sh
docker compose -f tests/lab/docker-compose.yml up -d relay
```

### Execute

```sh
tests/lab/scripts/load-test.sh [N] [RELAY_CONTAINER]
```

| Argument | Default | Description |
|---|---|---|
| `N` | `100` | Number of concurrent client processes |
| `RELAY_CONTAINER` | auto-detected | Docker container name of the relay (e.g. `kant-test-lab-relay-1`) |

**Examples:**

```sh
# 100 clients (default)
tests/lab/scripts/load-test.sh

# 200 clients
tests/lab/scripts/load-test.sh 200

# 100 clients against a specific relay container
tests/lab/scripts/load-test.sh 100 my-relay-container
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RELAY_INFO_URL` | `http://127.0.0.1:3001` | Relay `/relay-info` endpoint |
| `RELAY_METRICS_URL` | `http://127.0.0.1:3001/metrics` | Prometheus metrics endpoint |

```sh
# Example with custom URLs (e.g. testing against a remote relay)
RELAY_INFO_URL=http://relay.example.com:3001 \
RELAY_METRICS_URL=http://relay.example.com:3001/metrics \
  tests/lab/scripts/load-test.sh 200
```

---

## What It Measures

Each client process performs a full lifecycle:

1. **Register** — signs an Ed25519 keypair and registers a circuit address with the relay
2. **Lookup** — requests circuit addresses for all other peers (simulates group key distribution)

The script aggregates and reports:

| Metric | Description |
|---|---|
| **Registry routing wall-clock time** | Seconds from "go" signal to all N clients completing |
| **Register latency percentiles** | p50, p95, p99 in milliseconds |
| **Lookup latency percentiles** | p50, p95, p99 in milliseconds |
| **Register success rate** | `registerOk / N` |
| **Lookup success rate** | `lookupOk / N` |
| **Route completeness** | `routingOk / N`; each client resolved all N-1 peer keys |
| **NO_RESERVATION error delta** | Increase in `kant_relay_reservation_errors_total{code="NO_RESERVATION"}` during the test |
| **Relay CPU %** | Sampled from `docker stats` before/during/after |
| **Relay memory %** | Sampled from `docker stats` before/during/after |

---

## Pass Criteria

| Criterion | Threshold | Notes |
|---|---|---|
| Registry routing time | **≤ 60 s** | Hard gate — test fails if exceeded |
| Register success rate | **100%** (`registerOk == N`) | All clients must register successfully |
| Lookup success rate | **100%** (`lookupOk == N`) | All clients must complete lookup |
| Route completeness | **100%** (`routingOk == N`) | An HTTP 200 with missing routes fails |

The hard 60-second gate is independent of N. The script scales the internal wait budget with N (30 s + N/2, capped at 360 s), but always enforces the 60 s ceiling as the minimum contractual SLA.

Partial results (e.g. `registerOk=98/100` or missing routes) exit non-zero. The JSON report carries the exact counts for debugging and trending.

---

## Output Format

On success:

```
[14:32:01] Running load test with N=100 clients against kant-test-lab-relay-1
[14:32:01] Time budgets: key=80s, total=200s
[14:32:07] Go signal sent. Timing registry routing...
[14:32:41] All clients finished (or timed out) in 40s
[14:32:41] PASS: all 100 clients registered and resolved every peer
```

On failure:

```
[14:32:41] FAIL: Key distribution took 65s (limit: 60s)
```

A JSON report and raw metric/stat samples are retained in the working directory (`/tmp/kant-load-XXXXXX/`) and printed as part of the human-readable report. Generated signing keys are deleted during cleanup.

---

## Failure Modes and Debugging Checklist

### "relay not reachable" — connection refused

```
curl: (7) Failed to connect to 127.0.0.1 port 3001
```

**Check:**
- [ ] `docker compose -f tests/lab/docker-compose.yml ps` — is the `relay` container running?
- [ ] `docker logs kant-test-lab-relay-1` — any startup errors?
- [ ] Is port 3001 exposed on the host? (Some CI environments map it differently.)
- [ ] Try with explicit `RELAY_INFO_URL=http://relay:3001` if running inside the compose network.

### Registry routing timeout (exceeded 60 s limit)

**Check:**
- [ ] Relay CPU/memory at the time of the test — see `Relay stats (post)` in the report. High CPU means the relay is saturated; consider scaling horizontally or reducing N.
- [ ] `kant_relay_reservation_errors_total{code="NO_RESERVATION"}` delta — if non-zero, clients are racing to use expired reservations. Check reservation TTL and renewal logic.
- [ ] Lookup latency p95/p99 — if these are high (> 500 ms), the registry is under pressure. See [`monitoring.md`](./monitoring.md#registry-metrics) for registry tunables.
- [ ] Network latency between clients and relay — in a LAN lab this should be < 1 ms; if testing across hosts or VPNs, the base RTT adds directly to all latencies.

### High NO_RESERVATION error delta

**Check:**
- [ ] `kant_relay_reservations_active` gauge — is the relay near its 1024 reservation limit (`> 900`)?
- [ ] Reservation TTL vs. client reconnect frequency. See [`incident-response.md`](./incident-response.md#scenario-2-no_reservation-errors-spiking).
- [ ] Any client bugs causing premature reservation expiry or bad renewal tokens.

### Partial registration success (`registerOk < N`)

**Check:**
- [ ] The JSON report's `errors` array per client — look for specific HTTP status codes or error messages.
- [ ] `kant_relay_register_requests_total{result="bad_signature"}` — a spike means a client is sending malformed signatures, possibly a keypair generation bug.
- [ ] `kant_relay_registry_entries` gauge — if `entries > 8000`, the registry may be evicting entries aggressively. Check `MAX_ENTRIES` and eviction policy.

### Partial lookup success (`lookupOk < N`)

**Check:**
- [ ] Same JSON report `errors` array — `lookup status=NON_200` indicates the relay returned an error.
- [ ] `kant_relay_lookup_misses_total` — if lookup is returning 404s, the registered circuit addresses may have expired between registration and lookup.
- [ ] `kant_relay_lookup_request_duration_seconds` histogram — if p99 is high (> 1 s), the lookup path is slow under this concurrency level.

### docker/docker-compose not available

**Check:**
- [ ] The script auto-resolves the relay container name via `docker compose ps`, but requires `docker` on PATH.
- [ ] In containerized CI environments, mount the Docker socket or use a Docker-in-Docker setup.

---

## CI Integration

The load test runs nightly (via GitHub Actions cron) and can be triggered manually. It is **non-blocking** — a failed load test does not block merges, but results are reported as artifacts and trends are tracked via the CI history.

See [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) for the `load-test` job configuration.

### Artifact Retention

| Artifact | Retention | Contents |
|---|---|---|
| `load-test-report` | 30 days | Human-readable and JSON load test report |
| `load-test-metrics` | 30 days | Raw `/metrics` samples (before/mid/after) |

---

## Historical Trending

To compare results across runs, check the CI "Load Test" job history:

1. Go to the **Actions** tab → **Load Test** workflow.
2. Click any past run to see attached artifacts.
3. Key trend indicators:
   - Registry routing time — should be stable; increases indicate regression
   - `NO_RESERVATION` delta — should be zero or very low; increases indicate capacity issues
   - Register/lookup p99 latency — increases indicate performance regression

---

## Related Documentation

- [Monitoring & metrics](./monitoring.md) — Prometheus metric reference, alert thresholds
- [Incident response](./incident-response.md) — Escalation path, common failure scenarios
- [Relay deployment](./relay-deployment.md) — Relay setup, resource sizing
- [`tests/lab/scripts/load-test.sh`](../../tests/lab/scripts/load-test.sh) — The load test script source

---

*Last updated: 2026-08-31. Maintained by the Kant platform team.*
