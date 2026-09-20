# Release-readiness validation — 2026-09-02

Environment: Hermes local process lab, system Google Chrome 151, Node.js test runner. Node 2 is under acknowledged maintenance and was intentionally deferred for the Docker rerun.

## Passed

- Core unit suite: 7/7 (group delivery queue and file receiver limits), plus X3DH/OPK script including 20-way atomic reservation and parallel burn.
- Core coverage gates: group aggregate 45.66% lines / 73.98% branches / 47.96% functions; file module 48.95% / 54.10% / 53.57%.
- Protocol lab: 7/7 (X3DH, ratchet tamper rejection, file chunk authentication, QR validation, OPK behavior, group rotation/removal).
- Relay smoke/admin: 10/10 (`/healthz`, `/readyz`, `/metrics`, relay info, auth and reservation admin routes).
- Browser file E2E: 1 MiB source/download SHA-256 `631b84027d6b9e52b539c4e8373622d23032dfadc64d60af87339c9037e4f769`; third-party sealed-key open rejected.
- Browser group churn: 3/3 — relay restart during distribution, member disconnect/reconnect, and concurrent member churn. The final focused restart rerun passed in 82.7 seconds.
- Signed registry load N=100: 100 registrations, 100 lookups, 9,900/9,900 routes, zero errors, 1 second routing wall clock. See `load-n100.json`.
- Production dependency audit: no high or critical advisories; two moderate advisories remain.

## Observations

- Relay-restart churn runs logged recoverable client-side mux/protobuf decode errors (`index out of range: 13 + 8 > 17` and `invalid wire type 7 at offset 14`) on group presence immediately after restart. In both cases the subsequent presence/message path recovered and delivered the group message. Raw relay process logs are retained; payload content is not logged.
- One final-suite attempt returned 404 from the restart endpoint because the local launcher used the Docker-facing token variable instead of the relay process variable. This was a harness error, recorded in `failure-harness-404.txt` with its relay log in `relay-final-churn.log`; the corrected focused rerun is preserved in `relay-final-restart.log` and passed.
- Relay resource stats are `NA` in this run because Hermes has no Docker CLI. Node 2 Docker metrics are deferred until maintenance ends.
- The N=100 test exercises signed registry concurrency and route completeness, not 100 live libp2p reservations. This limitation is now explicit in the runbook and internal review.

## Deferred / external gates

- `pnpm --dir tests/lab exec playwright install --with-deps chromium` on Node 2 after maintenance.
- Full segmented Docker E2E rerun and Docker CPU/memory samples on Node 2 after maintenance.
- Independent security audit / penetration test (external release gate).
