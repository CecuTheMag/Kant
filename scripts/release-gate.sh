#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export CI=true
export KANT_NETWORK_PROFILE="lan"
export KANT_RELAY_LAB_CONTROL_TOKEN="${KANT_RELAY_LAB_CONTROL_TOKEN:-kant-lab-restart-token}"

echo "==> install"
pnpm install --frozen-lockfile

echo "==> typecheck"
pnpm run typecheck

echo "==> core build"
pnpm --filter=@kant/core run build

echo "==> relay build"
pnpm --filter=@kant/relay run build

echo "==> app build"
pnpm --filter=@kant/app run build

echo "==> validate HTTPS deployment"
RELAY_DOMAIN="${RELAY_DOMAIN:-majesticrelay.duckdns.org}" ./scripts/validate-https-deploy.sh

echo "==> bring up lab stack"
docker compose -f tests/lab/docker-compose.yml up -d --build relay web
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3001/healthz >/dev/null 2>&1 && curl -sf http://127.0.0.1:8080/ >/dev/null 2>&1; then
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "lab stack failed to become ready" >&2
    exit 1
  fi
  sleep 1
done

echo "==> smoke health checks"
curl -sf http://127.0.0.1:3001/healthz | grep -q '"status":"ok"'
curl -sf http://127.0.0.1:3001/readyz | grep -q '"ready":true'
curl -sf http://127.0.0.1:8080/ >/dev/null

echo "==> lab smoke tests"
KANT_WEB_URL=http://127.0.0.1:8080 \
KANT_RELAY_URL=http://127.0.0.1:3001 \
KANT_RELAY_INFO_URL=http://127.0.0.1:3001/relay-info \
node --experimental-global-webcrypto --test --test-concurrency=1 \
  tests/lab/tests/health.test.mjs

echo "Release gate passed."
