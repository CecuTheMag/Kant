#!/usr/bin/env bash
set -e

ROOT=$(cd "$(dirname "$0")" && pwd)

echo "==> Installing dependencies..."
cd "$ROOT"
npx pnpm install --frozen-lockfile 2>/dev/null || npx pnpm install

find_port() {
  for p in {3000..3010}; do
    if ! lsof -ti:$p | grep -q .; then
      echo $p
      return
    fi
  done
  echo "No free port 3000-3010" >&2
  exit 1
}

RELAY_PORT=$(find_port)
RELAY_INFO_PORT=$((RELAY_PORT + 1))

echo "==> Using ports: relay=$RELAY_PORT http=$RELAY_INFO_PORT"

echo "==> Building relay..."
cd "$ROOT/packages/relay"
npx tsc

echo "==> Killing old relay/http on $RELAY_PORT, $RELAY_INFO_PORT..."
lsof -ti:$RELAY_PORT,$RELAY_INFO_PORT | xargs -r kill -9

echo "==> Starting relay (logs -> $ROOT/relay.log)..."
cd "$ROOT"
node packages/relay/dist/index.js > relay.log 2>&1 &
RELAY_PID=$!

sleep 3
echo ""
echo "--- Relay output ---"
cat relay.log
echo "--------------------"
echo "Relay PID: $RELAY_PID | http://127.0.0.1:$RELAY_INFO_PORT/relay-info"

trap "echo 'Stopping relay (PID $RELAY_PID)...'; kill $RELAY_PID 2>/dev/null" EXIT INT TERM

echo "==> Starting app at http://localhost:5173 (auto-ports)"
echo "    Open two tabs for multi-instance test."
echo ""
cd "$ROOT/packages/app"
npx vite
