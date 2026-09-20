#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Validating HTTPS compose configuration..."
docker compose -f docker-compose.https.yml config >/tmp/kant-https-compose-config.txt

echo "Building custom Caddy runtime with rate-limit support..."
docker build -f Dockerfile.caddy -t kant-caddy-ratelimit . >/tmp/kant-caddy-build.log

echo "Validating the Caddyfile against the custom runtime..."
RELAY_DOMAIN="${RELAY_DOMAIN:-example.com}" \
  docker run --rm \
    -e RELAY_DOMAIN="${RELAY_DOMAIN}" \
    -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
    kant-caddy-ratelimit \
    caddy validate --config /etc/caddy/Caddyfile

echo "HTTPS deployment validation passed."
