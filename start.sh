#!/usr/bin/env bash
set -e

# ── Kant dev launcher ──────────────────────────────────────────────────────────
# Starts the Vite dev server only. The relay runs separately via Docker.
#
# Usage:
#   ./start.sh                                    # app on :5173, relay at default
#   ./start.sh --relay http://192.168.1.5:3001    # point at a specific relay
#   ./start.sh --port 5174                        # custom app port
#   ./start.sh --help
#
# Run the relay:
#   HTTP (LAN):   RELAY_PUBLIC_HOST=192.168.1.5 docker compose -f docker-compose.http.yml up -d
#   HTTPS (web):  RELAY_DOMAIN=relay.yourdomain.com docker compose -f docker-compose.https.yml up -d
# ──────────────────────────────────────────────────────────────────────────────

RELAY_URL=""
APP_PORT=5173

while [[ $# -gt 0 ]]; do
  case "$1" in
    --relay)   RELAY_URL="$2"; shift 2 ;;
    --port)    APP_PORT="$2";  shift 2 ;;
    --help|-h)
      echo "Usage: ./start.sh [--relay URL] [--port PORT]"
      echo ""
      echo "  --relay URL   Relay to connect to (default: VITE_RELAY_URL in .env)"
      echo "  --port PORT   App port (default: 5173)"
      echo ""
      echo "Relay (run separately):"
      echo "  HTTP:   RELAY_PUBLIC_HOST=<ip> docker compose -f docker-compose.http.yml up -d"
      echo "  HTTPS:  RELAY_DOMAIN=<domain>  docker compose -f docker-compose.https.yml up -d"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1 (use --help)"
      exit 1
      ;;
  esac
done

ROOT=$(cd "$(dirname "$0")" && pwd)

echo "==> Installing dependencies..."
cd "$ROOT"
npx pnpm install --frozen-lockfile 2>/dev/null || npx pnpm install

echo "==> Starting app on http://localhost:$APP_PORT"
if [[ -n "$RELAY_URL" ]]; then
  echo "    Relay: $RELAY_URL"
fi
echo ""

cd "$ROOT/packages/app"
if [[ -n "$RELAY_URL" ]]; then
  VITE_RELAY_URL="$RELAY_URL" pnpm exec vite --host 0.0.0.0 --port "$APP_PORT"
else
  pnpm exec vite --host 0.0.0.0 --port "$APP_PORT"
fi
