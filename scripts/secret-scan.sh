#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for secret scanning" >&2
  exit 1
fi

docker run --rm \
  -v "$PWD:/src" \
  -w /src \
  zricethezav/gitleaks:v8.18.0 detect \
  --source=/src \
  --no-banner \
  --redact \
  --log-level warn \
  --exit-code 1
