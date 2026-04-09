#!/usr/bin/env bash
set -e

INSTANCE=${1:-1}
BASE_PORT=$((3000 + (INSTANCE - 1) * 2))
RELAY_PORT=$BASE_PORT
RELAY_INFO_PORT=$((BASE_PORT + 1))
APP_PORT=$((5172 + INSTANCE))

ROOT=$(cd "$(dirname "$0")" && pwd)
echo "==> Instance $INSTANCE | relay=$RELAY_PORT http=$RELAY_INFO_PORT app=$APP_PORT"

echo "==> Installing dependencies..."
cd "$ROOT"
npx pnpm install --frozen-lockfile 2>/dev/null || npx pnpm install

echo "==> Building relay..."
cd "$ROOT/packages/relay"
RELAY_PORT=$RELAY_PORT RELAY_INFO_PORT=$RELAY_INFO_PORT npx tsc

echo "==> Killing old processes on $RELAY_PORT, $RELAY_INFO_PORT..."
lsof -ti:$RELAY_PORT,$RELAY_INFO_PORT | xargs -r kill -9 2>/dev/null || true

echo "==> Starting relay..."
cd "$ROOT"
RELAY_PORT=$RELAY_PORT RELAY_INFO_PORT=$RELAY_INFO_PORT \
  node packages/relay/dist/index.js > "relay-$INSTANCE.log" 2>&1 &
RELAY_PID=$!

sleep 2
echo ""
echo "--- Relay output (instance $INSTANCE) ---"
cat "relay-$INSTANCE.log" 2>/dev/null || echo "Starting..."
echo "--------------------"
echo "Relay PID: $RELAY_PID | http://127.0.0.1:$RELAY_INFO_PORT/relay-info"

trap "echo 'Stopping relay (PID $RELAY_PID)...'; kill $RELAY_PID 2>/dev/null" EXIT INT TERM

echo ""
echo "==> Starting app at http://localhost:$APP_PORT"
echo "    Instance $INSTANCE — connects to relay on port $RELAY_INFO_PORT"
echo ""
cd "$ROOT/packages/app"
VITE_RELAY_HTTP_PORT=$RELAY_INFO_PORT npx vite --port $APP_PORT
