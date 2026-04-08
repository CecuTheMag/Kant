#!/usr/bin/env bash
set -e

ROOT=$(cd "$(dirname "$0")" && pwd)

echo "==> Installing dependencies..."
cd "$ROOT"
npx pnpm install --frozen-lockfile 2>/dev/null || npx pnpm install

echo "==> Building relay..."
cd "$ROOT/packages/relay"
npx tsc

# Kill any existing relay on port 3000
lsof -ti:3000 | xargs -r kill -9

echo "==> Starting relay (logs -> $ROOT/relay.log)..."
cd "$ROOT"
node packages/relay/dist/index.js > relay.log 2>&1 &
RELAY_PID=$!

sleep 3
echo ""
echo "--- Relay output ---"
cat relay.log
echo "--------------------"
echo "Relay PID: $RELAY_PID"

trap "echo 'Stopping relay (PID $RELAY_PID)...'; kill $RELAY_PID 2>/dev/null" EXIT INT TERM

echo "==> Starting app at http://localhost:5173"
echo "    Open two tabs for auto-connect test."
echo ""
cd "$ROOT/packages/app"
npx vite
