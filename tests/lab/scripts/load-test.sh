#!/usr/bin/env bash
# Kant relay load-test runner.
#
# Spins up N small headless Node processes that exercise the signed relay
# registry concurrently,
# then measures:
#   * Time for all N clients to register and resolve all N-1 peers
#   * NO_RESERVATION error rate (sampled from the relay's /metrics)
#   * Relay memory / CPU usage (sampled from the relay container's stats)
#
# Usage:
#   tests/lab/scripts/load-test.sh [N] [RELAY_CONTAINER]
#
# Args:
#   N                Number of clients (default 100)
#   RELAY_CONTAINER  Docker container name of the relay (default: kant-test-lab-relay-1)
#
# Requirements:
#   * The lab must be up: tests/lab/scripts/run.sh lan
#   * node and curl must be on PATH; Docker is optional for resource stats
#
# This script does NOT recreate the lab — it talks to whatever relay is
# already running. The expected workflow is:
#   1. tests/lab/scripts/run.sh lan          # bring up the lab
#   2. tests/lab/scripts/load-test.sh 200    # hammer it

set -euo pipefail

N=${1:-100}
RELAY_CONTAINER=${2:-}
RELAY_INFO_URL=${RELAY_INFO_URL:-http://127.0.0.1:3001}
RELAY_METRICS_URL=${RELAY_METRICS_URL:-http://127.0.0.1:3001/metrics}

if [[ ! "$N" =~ ^[1-9][0-9]*$ ]]; then
  echo "N must be a positive integer" >&2
  exit 2
fi

# Resolve relay container name automatically from the compose project.
# Falls back to the hardcoded default if docker is not available.
_resolve_relay_container() {
  local name
  if name=$(docker compose -f tests/lab/docker-compose.yml ps --quiet relay 2>/dev/null) && [[ -n "$name" ]]; then
    echo "$name"
  elif [[ -n "$RELAY_CONTAINER" ]]; then
    echo "$RELAY_CONTAINER"
  else
    echo "kant-test-lab-relay-1"
  fi
}

if [[ -z "$RELAY_CONTAINER" ]]; then
  RELAY_CONTAINER=$(_resolve_relay_container)
fi

# Per-client time budget scales linearly; cap at 6 minutes for very large N.
KEY_BUDGET_S=$(( 30 + N / 2 ))
if (( KEY_BUDGET_S > 360 )); then KEY_BUDGET_S=360; fi
OVERALL_BUDGET_S=$(( KEY_BUDGET_S + 120 ))

# Hard pass/fail gate: all N clients must complete registry routing within 60 s.
# This is independent of KEY_BUDGET_S which scales with N.
KEY_HARD_LIMIT_S=60

WORK_DIR=${LOAD_ARTIFACT_DIR:-$(mktemp -d -t kant-load-XXXXXX)}
mkdir -p "$WORK_DIR"
PIDS=()

cleanup() {
  local ret=$?
  # Kill any stray background node processes spawned by this script.
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  # Never retain generated signing keys in load artifacts.
  rm -f "$WORK_DIR/client.mjs" "$WORK_DIR/peers.json" "$WORK_DIR/go"
  log "Artifacts retained at $WORK_DIR"
  exit $ret
}
trap cleanup EXIT

log()  { echo "[$(date -u +%H:%M:%S)] $*"; }
fail() { echo "[$(date -u +%H:%M:%S)] FAIL: $*" >&2; exit 1; }

# Sanity: relay reachable.
if ! curl -fsS --max-time 5 "$RELAY_INFO_URL/relay-info" >/dev/null; then
  fail "relay not reachable at $RELAY_INFO_URL/relay-info — is the lab up?"
fi

command -v node  >/dev/null || fail "node not on PATH"
log "Running load test with N=$N clients against $RELAY_CONTAINER"
log "Time budgets: key=${KEY_BUDGET_S}s, total=${OVERALL_BUDGET_S}s"

# ── Sample relay metrics before the test ─────────────────────────────────────
metrics_sample() {
  local out_file=$1
  if curl -fsS --max-time 3 "$RELAY_METRICS_URL" >"$out_file" 2>/dev/null; then
    :
  else
    : >"$out_file"
  fi
}

container_stats() {
  local out_file=$1
  if docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}} {{.MemPerc}}' "$RELAY_CONTAINER" >"$out_file" 2>/dev/null; then
    :
  else
    echo "$RELAY_CONTAINER NA NA NA" >"$out_file"
  fi
}

# Count NO_RESERVATION errors in a /metrics dump.
no_reservation_count() {
  local dump=$1
  awk '
    /^kant_relay_reservation_errors_total\{[^}]*code="NO_RESERVATION"[^}]*\} / { print $2 }
  ' "$dump" | head -n1 | awk '{ print int($1) }'
}

metrics_sample "$WORK_DIR/metrics_before.txt"
container_stats "$WORK_DIR/stats_before.txt"
NO_RES_BEFORE=$(no_reservation_count "$WORK_DIR/metrics_before.txt")
NO_RES_BEFORE=${NO_RES_BEFORE:-0}

log "Pre-test: relay NO_RESERVATION errors = $NO_RES_BEFORE"
log "Pre-test relay stats: $(cat "$WORK_DIR/stats_before.txt")"

# ── Spawn N clients ──────────────────────────────────────────────────────────
# Each client is a short Node script that:
#   1) loads its pre-generated Ed25519 keypair
#   2) registers with the relay
#   3) waits for the "go" signal (presence of $WORK_DIR/go)
#   4) resolves every other client's registered route
#   5) reports per-client latency + errors to $WORK_DIR/results/<id>.json
#
# Doing this in plain Node keeps the test framework-agnostic and side-steps
# the headless-browser stack (we only need registry + group-handler, not
# WebRTC/UI). The protocol is the same one the browser clients speak.

CLIENT_SCRIPT="$WORK_DIR/client.mjs"
cat >"$CLIENT_SCRIPT" <<'NODE_EOF'
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const id = parseInt(process.argv[2], 10);
const peersFile = process.argv[3];
const goFile = process.argv[4];
const outFile = process.argv[5];
const relayBase = process.env.RELAY_BASE ?? 'http://127.0.0.1:3001';
const MAX_BODY = 65536;

function postJson(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, relayBase);
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      headers: { 'content-type': 'application/json', 'content-length': data.length, ...headers }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; if (buf.length > MAX_BODY) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function ed25519Keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyHex:  publicKey.export({ format: 'der', type: 'spki' }).toString('hex').slice(-64),
    privateKeyDer: privateKey.export({ format: 'der', type: 'pkcs8' }),
  };
}

function sign(privDer, msg) {
  const key = crypto.createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
  return crypto.sign(null, Buffer.from(msg, 'utf8'), key).toString('hex');
}

async function main() {
  const result = { id, ok: false, register: {}, keySend: [], errors: [] };
  try {
    const allPeers = JSON.parse(await fs.readFile(peersFile, 'utf8'));
    const self = allPeers.find((peer) => peer.id === id);
    if (!self?.privateKeyDer) throw new Error(`missing credentials for client ${id}`);
    const kp = {
      publicKeyHex: self.publicKeyHex,
      privateKeyDer: Buffer.from(self.privateKeyDer, 'base64'),
    };
    const circuitAddr = `/ip4/127.0.0.1/tcp/40000/p2p/12D3KooWLoad${id.toString().padStart(8, '0')}`;
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    const signedMsg = `${timestamp}|${nonce}|${circuitAddr}`;
    const sig = sign(kp.privateKeyDer, signedMsg);

    // 1) register
    const t0 = Date.now();
    const reg = await postJson('/register', {
      publicKeyHex: kp.publicKeyHex,
      identityKeyHex: kp.publicKeyHex,
      circuitAddr,
      sig,
      timestamp,
      nonce,
    });
    result.register = { status: reg.status, ms: Date.now() - t0 };
    if (reg.status !== 200) {
      result.errors.push(`register status=${reg.status}`);
      await fs.writeFile(outFile, JSON.stringify(result));
      return;
    }

    // 2) wait for the go signal
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      try { await fs.access(goFile); break; } catch { /* not yet */ }
      await sleep(100);
    }
    try { await fs.access(goFile); }
    catch { result.errors.push('go signal never arrived'); await fs.writeFile(outFile, JSON.stringify(result)); return; }

    // 3) read peer list
    const peers = allPeers.filter((p) => p.id !== id);

    // 4) look up each peer's circuit addr
    const keys = peers.map((p) => p.publicKeyHex);
    const lts = Date.now();
    const lnonce = crypto.randomBytes(16).toString('hex');
    const lsigned = `${lts}|${lnonce}|${keys.join(',')}`;
    const lsig = sign(kp.privateKeyDer, lsigned);
    const lookup = await postJson('/lookup', {
      publicKeyHex: kp.publicKeyHex,
      keys,
      sig: lsig,
      timestamp: lts,
      nonce: lnonce,
    });
    result.lookup = { status: lookup.status, ms: Date.now() - lts };
    if (lookup.status !== 200) {
      result.errors.push(`lookup status=${lookup.status}`);
      await fs.writeFile(outFile, JSON.stringify(result));
      return;
    }
    const lookups = JSON.parse(lookup.body);

    // 5) Confirm every registered peer was returned. This is a registry load
    //    test; browser E2E separately validates real libp2p/group streams.
    const keyMsgs = [];
    for (const p of peers) {
      const ts = Date.now();
      const routed = !!lookups[p.publicKeyHex];
      keyMsgs.push({ peer: p.id, routed, ms: Date.now() - ts });
    }
    result.keySend = keyMsgs;
    result.routed = keyMsgs.filter((entry) => entry.routed).length;
    result.expectedRoutes = peers.length;
    result.ok = result.routed === result.expectedRoutes;
    if (!result.ok) result.errors.push(`routes ${result.routed}/${result.expectedRoutes}`);
  } catch (e) {
    result.errors.push(String(e?.message ?? e));
  } finally {
    await fs.writeFile(outFile, JSON.stringify(result));
  }
}

main().catch((e) => {
  console.error(`client ${id} crashed:`, e);
  process.exit(1);
});
NODE_EOF

mkdir -p "$WORK_DIR/results"
log "Generating $N keypairs in-process and spawning $N client processes..."

# 1) Generate all keypairs up front so each process registers the same public
# key that the other processes will look up.
PEERS_FILE="$WORK_DIR/peers.json"
node - "$PEERS_FILE" "$N" <<'KEYGEN_EOF'
const crypto = require('node:crypto');
const [peersFile, countValue] = process.argv.slice(2);
const count = Number.parseInt(countValue, 10);
const out = [];
for (let i = 0; i < count; i++) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const hex = publicKey.export({ format: 'der', type: 'spki' }).toString('hex').slice(-64);
  const privateKeyDer = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  out.push({ id: i, publicKeyHex: hex, privateKeyDer });
}
require('node:fs').writeFileSync(peersFile, JSON.stringify(out));
KEYGEN_EOF

# 2) Launch N client processes in batches to avoid fd exhaustion.
BATCH=20
for ((i=0; i<N; i+=BATCH)); do
  for ((j=i; j<i+BATCH && j<N; j++)); do
    out="$WORK_DIR/results/$j.json"
    : >"$out"
    node "$CLIENT_SCRIPT" "$j" "$PEERS_FILE" "$WORK_DIR/go" "$out" &
    PIDS+=($!)
  done
  # small breather between batches
  sleep 0.05
done

log "All $N clients launched. Waiting for registrations to complete..."

# Give clients a moment to register before we signal "go".
sleep 5

# 3) Snapshot relay metrics (mid-test) for NO_RESERVATION delta.
metrics_sample "$WORK_DIR/metrics_mid.txt"
container_stats "$WORK_DIR/stats_mid.txt"

# 4) Drop the go signal — clients will now resolve every registered peer.
: >"$WORK_DIR/go"
T_KEY_START=$(date +%s)
log "Go signal sent. Timing registry routing..."

# 5) Wait for all clients to finish (or hit the budget).
BUDGET_END=$(( $(date +%s) + KEY_BUDGET_S ))
while (( $(date +%s) < BUDGET_END )); do
  remaining=0
  for ((i=0; i<N; i++)); do
    f="$WORK_DIR/results/$i.json"
    if ! grep -q '"ok":true' "$f" 2>/dev/null && ! grep -q '"ok":false' "$f" 2>/dev/null; then
      remaining=$((remaining+1))
    fi
  done
  if (( remaining == 0 )); then break; fi
  sleep 1
done

T_KEY_END=$(date +%s)
ROUTING_S=$(( T_KEY_END - T_KEY_START ))
log "All clients finished (or timed out) in ${ROUTING_S}s"

# Hard gate: registry routing must complete within KEY_HARD_LIMIT_S.
if (( ROUTING_S > KEY_HARD_LIMIT_S )); then
  fail "Registry routing took ${ROUTING_S}s (limit: ${KEY_HARD_LIMIT_S}s)"
fi

# ── Aggregate results ────────────────────────────────────────────────────────
node - <<NODE_EOF >"$WORK_DIR/agg.json"
const fs = require('node:fs');
const path = require('node:path');
const dir = '$WORK_DIR/results';
const N = $N;
let ok = 0, registerOk = 0, lookupOk = 0, routingOk = 0, routedTotal = 0, expectedRoutes = 0, noReservation = 0, errors = 0;
const regMs = [], lookupMs = [];
for (let i = 0; i < N; i++) {
  const f = path.join(dir, i + '.json');
  let r;
  try { r = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { errors++; continue; }
  if (r.ok) ok++;
  if (r.register && r.register.status === 200) registerOk++;
  if (r.lookup && r.lookup.status === 200) lookupOk++;
  routedTotal += r.routed || 0;
  expectedRoutes += r.expectedRoutes || 0;
  if (r.routed === r.expectedRoutes) routingOk++;
  if (r.register) regMs.push(r.register.ms);
  if (r.lookup) lookupMs.push(r.lookup.ms);
  for (const e of (r.errors || [])) {
    if (/NO_RESERVATION/i.test(e)) noReservation++;
    else errors++;
  }
}
const pct = (a) => a.length ? Math.round(a.slice().sort((a,b)=>a-b)[Math.floor(a.length*0.5)]) : 0;
const p95 = (a) => a.length ? Math.round(a.slice().sort((a,b)=>a-b)[Math.floor(a.length*0.95)]) : 0;
const p99 = (a) => a.length ? Math.round(a.slice().sort((a,b)=>a-b)[Math.floor(a.length*0.99)]) : 0;
const sum = (a) => a.reduce((s,x)=>s+x,0);
console.log(JSON.stringify({
  N, ok, registerOk, lookupOk, routingOk, routedTotal, expectedRoutes, noReservation, errors,
  registerLatencyMs: { p50: pct(regMs), p95: p95(regMs), p99: p99(regMs), avg: regMs.length ? Math.round(sum(regMs)/regMs.length) : 0 },
  lookupLatencyMs:   { p50: pct(lookupMs), p95: p95(lookupMs), p99: p99(lookupMs), avg: lookupMs.length ? Math.round(sum(lookupMs)/lookupMs.length) : 0 },
}, null, 2));
NODE_EOF

AGG=$(cat "$WORK_DIR/agg.json")

# 6) Post-test relay stats.
metrics_sample "$WORK_DIR/metrics_after.txt"
container_stats "$WORK_DIR/stats_after.txt"
NO_RES_AFTER=$(no_reservation_count "$WORK_DIR/metrics_after.txt")
NO_RES_AFTER=${NO_RES_AFTER:-0}
NO_RES_DELTA=$(( NO_RES_AFTER - NO_RES_BEFORE ))

# 7) Clean up clients — handled by cleanup trap on EXIT.

# ── Report ────────────────────────────────────────────────────────────────────
cat <<EOF

================ Kant load test report ================
Clients (N):               $N
Relay container:           $RELAY_CONTAINER
Wall clock (routing):      ${ROUTING_S}s
EOF

echo "$AGG" | sed 's/^/  /'

cat <<EOF
NO_RESERVATION errors:     $NO_RES_DELTA (delta over test, sampled from /metrics)
Relay stats (post):        $(cat "$WORK_DIR/stats_after.txt")
=======================================================
EOF

# Pass / fail gate.
REGISTER_OK=$(echo "$AGG" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).registerOk)})")
LOOKUP_OK=$(echo   "$AGG" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).lookupOk)})")
ROUTING_OK=$(echo  "$AGG" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).routingOk)})")

if (( REGISTER_OK == N )) && (( LOOKUP_OK == N )) && (( ROUTING_OK == N )); then
  log "PASS: all $N clients registered and resolved every peer"
  exit 0
fi

log "FAIL: registerOk=$REGISTER_OK/$N, lookupOk=$LOOKUP_OK/$N, routingOk=$ROUTING_OK/$N"
exit 1
