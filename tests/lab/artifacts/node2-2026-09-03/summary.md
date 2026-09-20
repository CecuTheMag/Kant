# Node 2 release-readiness evidence — 2026-09-03

## Outcome

- Engineering checklist completion: **95% (20/21 requested items)**.
- Final source snapshot: `a1f8213`; deployed app: `be372b7`; deployed relay: `cb09dbb`.
- All critical application blockers are closed by the recorded functional, churn, file-integrity, and UI runs.
- The remaining requested item is the independent external security audit / penetration test, which requires external scheduling.

## Passing evidence

- Serialized functional E2E: 9/9 pass in 628.8 s. Covers the 1 MiB file hash/integrity path, group distribution/rotation/churn, ordered messaging, durable offline delivery, and automatic relay-restart recovery.
- Final relay churn regression: 4/4 pass in 383.5 s. Covers group distribution during relay restart, member disconnect/reconnect, concurrent churn, and direct messaging after relay restart.
- Final Playwright UI/transport: 4/4 pass in 49.3 s. Includes two real browser clients establishing a secure session and delivering through circuit relay.
- Post-deploy smoke: 16/16 pass for crypto basics, relay identity/info, `/healthz`, `/readyz`, `/metrics`, and authenticated admin routes.
- Browser group scale: N=10 pass.
- Signed registry load: N=100 pass; 100/100 register, 100/100 lookup, 9,900/9,900 routes, zero errors, zero `NO_RESERVATION` delta. Register p50/p95/p99: 112/287/388 ms. Lookup p50/p95/p99: 119/222/225 ms.
- Production dependency audit: 271 dependencies, zero findings at info/low/moderate/high/critical.
- Reservation cleanup: after final UI clients exited, active/tracked reservations and active peers all returned to zero; four disconnect removals were recorded and the admin reservation list was empty.

## Capacity result

The opt-in N=50 browser test is **not a pass**. It was stopped at 32 contexts after CT100 reached 7,904/8,192 MiB RAM and 2,047/2,048 MiB swap. The disposable runner was removed and relay/web remained healthy. Run this case on a dedicated 16 GiB worker or shard it before making it a CI gate.

## Node 2 runtime at handoff

- Proxmox node: `stormnode2`; CT100 `kant-test` running and enabled at boot.
- CT100: 4 cores, 8 GiB RAM, 2 GiB swap; root disk 24 GiB with 9.5 GiB free.
- Containers: `kant-test-lab-relay-1` on 3000/3001 and `kant-test-lab-web-1` on 8080; no test runner remains.
- Relay: `/healthz` OK, `/readyz` ready, readiness gauge 1, web HTTP 200.
- Relay PeerID remained stable across rebuilds/restarts. Seed is 32 bytes, mode 0600, owned by UID 100; the Node relay process runs as UID 100.
- Backup: Proxmox `/root/backups/kant/kant-staging-before-7360068-20260903.tar.gz` (0600). Earlier pre-change seed/source backup remains documented in the operator handoff.

## Remaining external release gates

- Run and retain the hosted main-branch CI artifacts.
- Schedule the independent security audit / penetration test.
- Configure production TLS/tokens and exercise key/token rotation.
- Complete privacy-policy and data-residency review.
