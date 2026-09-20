#!/usr/bin/env bash
set -euo pipefail

profile=${1:-lan}
root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$root"

tests/lab/scripts/preflight.sh
tests/lab/scripts/profile-up.sh "$profile"

docker compose -f tests/lab/docker-compose.yml run --rm core
docker compose -f tests/lab/docker-compose.yml run --rm runner pnpm --dir tests/lab test
if [[ "${KANT_SKIP_UI:-0}" != 1 ]]; then
  docker compose -f tests/lab/docker-compose.yml run --rm runner pnpm --dir tests/lab test:ui
fi

echo "Kant lab run complete: $profile"
