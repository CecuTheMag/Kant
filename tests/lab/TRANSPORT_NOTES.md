# Relay transport investigation notes

This is a living record for the isolated PVE lab.  It documents observed
behavior, commands, and open hypotheses; it is not a production runbook.

## Reproduction

On PVE node 2, LXC 100:

```sh
cd /opt/kant
docker compose -f tests/lab/docker-compose.yml build relay web runner
docker compose -f tests/lab/docker-compose.yml up -d --force-recreate relay web
docker compose -f tests/lab/docker-compose.yml run --rm runner \
  pnpm --dir tests/lab exec playwright test ui/transport-e2e.spec.mjs --workers=1
```

The test creates two independent Chromium browser contexts, creates real
identities, adds each other as contacts, establishes a circuit-relay session,
then sends a message in the direction selected by the test.

## Findings (2026-08-22)

1. The signed HTTP relay registry works: both browser identities register and
   lookup returns current circuit addresses.
2. The original first-message path had an X3DH/Double-Ratchet deadlock.  The
   deterministic tiebreak makes one peer the sender; the receiver cannot send
   until it processes one sender-chain frame.  `a7c7dcd` adds an encrypted,
   non-visible session-ready frame and holds user messages during setup.
3. Repeated real-client runs still reproduce circuit dial failures during
   startup/reconnect: `CONNECTION_FAILED`, `index out of range`, and previously
   `invalid wire type` from yamux.  A local stream write is therefore not proof
   of delivery.
4. Ping streams were incorrectly request/response: the receiver wrote a pong
   after the sender had already closed and never read the response.  The active
   fix changes these to one-way frames and uses explicit encrypted delivery
   receipts for delivery confirmation.
5. Presence was being sent to every contact on each 10-second directory cycle,
   competing with handshake/message streams.  It is now rate-limited to once
   per minute; signed directory refresh continues independently.
6. The client heartbeat was restarting nodes that had never obtained a circuit
   after 60 seconds.  This recreated the same deterministic PeerID and aborted
   the reservation attempt, visible in browser logs as a second `createNode`
   for each client.  Restart-on-loss now applies only after a circuit has been
   observed.
7. Core sends now reuse an already-open peer/circuit connection before dialing
   another one.  This applies to prekey, ping, receipt, and onion forwarding.
8. **Root reservation fix:** the client was listening on bare `/p2p-circuit`,
   which requires ambient relay discovery.  The relay is already explicitly
   configured, so the listen address now uses `<relay-multiaddr>/p2p-circuit`
   as documented by js-libp2p's pre-configured-reservation example.

## Latest result

Before the explicit-reservation fix, the clean PVE run after the one-way
ping/presence throttling completed its handshake but did **not** deliver the
test marker within 90 seconds.  The failure is retained in the previous
Playwright artifact.  After the explicit reservation change, a fresh run passed
the full two-browser delivery assertion in **19.6 seconds** with no dial or
yamux errors.

## Root cause of the remaining flakiness (2026-08-22)

Repeated runs still failed intermittently with **zero** peer-to-peer traffic
after both clients dialled the relay.  Relay registry logs showed the failing
run never registered at all — the clients were connected to the relay but never
obtained a circuit.  Cause, in `@libp2p/circuit-relay-v2`:

1. `listener.listen()` runs exactly **once** per node start.  It makes a single
   RESERVE attempt; on failure (the known intermittent decode error, or a
   DialError) the attempt is never retried — `hangUp` + re-dial of the relay
   does NOT re-run `listen()`.
2. A `DialError` additionally blocklists the relay for the life of the node
   (cuckoo filter), so even a later connection cannot reserve.
3. `FaultTolerance.NO_FATAL` keeps the node running anyway, and the heartbeat's
   "initial reservation" branch deliberately never restarts a circuit-less
   node.  Result: the client sits "connected" but permanently circuit-less —
   no registration, no presence, no delivery.  This was Cecu's "sometimes
   sends, sometimes not" in its worst form.

### Fixes shipped

- `useKant.ts` heartbeat: if we hold a live relay connection but have never
  seen a circuit for ~40s (4 heartbeats), do a **controlled restart** — full
  `disconnectNode(false)` (awaits stop, so the deterministic PeerID never
  exists twice) then fresh `startNode`.  This re-runs `listen()` with a clean
  reservation store and clears the relay blocklist.  Safe where the old 60s
  restart was not: it only fires while connected, and stops the old node first.
- Second bug found while verifying: a held first message could be encrypted
  under a sender ratchet that a concurrent tiebreak re-handshake then replaced,
  making the ciphertext undecryptable (x3dh-reset loop, message lost).  Fix:
  pending plaintext is now retained until a **delivery ACK** (receipt), a
  `flushed` id-set guards against re-sending under the same ratchet, and every
  ratchet replacement (init accept, resync, reset, winner rebuild) clears the
  set so the next flush re-encrypts under the live session.

### Verification (2026-08-22, PVE lab)

`ui/transport-e2e.spec.mjs` 6× consecutive after the fixes: **6/6 passed**.
Two runs took ~46s — reservation failed once, the controlled restart recovered
it, and the held marker was delivered anyway.  Full suite (core + health +
smoke + transport) also green.

## Next investigations

1. Replace the separate ping/receipt streams with a single per-peer framed
   transport queue, or prove libp2p supports this circuit-stream pattern under
   concurrent bidirectional traffic.
2. Add relay-side event logging for reservation creation/removal and relayed
   connection open/close, keyed only by PeerID and reason (no payloads).
3. Test reservation readiness before advertising/registering a circuit address.
4. Add a stress matrix: simultaneous first send in both directions, reconnect,
   relay restart, delay/loss, and repeated client creation/destruction.
5. Keep browser-console logs and Playwright trace artifacts for every failed
   run; redact identity material before sharing outside the lab.
6. The runner's Playwright output dir is recreated per run (`run --rm`), so
   artifacts from failed runs are lost once the next run starts — dump the
   in-app DebugLog (`.debug-log-mobile-hidden` panel) on failure instead of
   relying on console-filtered stderr.
