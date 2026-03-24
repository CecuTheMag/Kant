#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing dependencies..."
cd "$ROOT"
npx pnpm install --frozen-lockfile 2>/dev/null || npx pnpm install

echo "==> Building relay..."
cd "$ROOT/packages/relay"
npx tsc

echo "==> Starting relay (logs -> $ROOT/relay.log)..."
cd "$ROOT"
node packages/relay/dist/index.js > relay.log 2>&1 &
RELAY_PID=$!

sleep 2
echo ""
echo "--- Relay output ---"
cat relay.log
echo "--------------------"
echo ""

trap "echo 'Stopping relay (PID $RELAY_PID)...'; kill $RELAY_PID 2>/dev/null" EXIT INT TERM

echo "==> Starting app at http://localhost:5173"
echo "    Open two tabs, follow the 3-step UI to connect and ping."
echo ""
cd "$ROOT/packages/app"
npx vite
