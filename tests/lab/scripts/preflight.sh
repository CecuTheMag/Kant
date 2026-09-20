#!/usr/bin/env bash
set -euo pipefail

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need docker
need curl
need ip
need tc

docker info >/dev/null
docker compose version
network="kant-preflight-$$"
docker network create "$network" >/dev/null
trap 'docker network rm "$network" >/dev/null 2>&1 || true' EXIT
docker run --rm --network "$network" alpine:3.20 sh -c 'ip link; ping -c 1 8.8.8.8 >/dev/null'

ns="kant-preflight-ns-$$"
ip netns add "$ns"
ip netns exec "$ns" ip link >/dev/null
ip netns del "$ns"

tc qdisc add dev "${KANT_TEST_IFACE:-eth0}" root netem delay 5ms loss 1%
tc qdisc show dev "${KANT_TEST_IFACE:-eth0}" | grep -q netem
tc qdisc del dev "${KANT_TEST_IFACE:-eth0}" root

df -P / | awk 'NR==2 { if ($4 < 5242880) { print "less than 5 GiB free"; exit 1 } }'
echo "Kant lab preflight: PASS"
