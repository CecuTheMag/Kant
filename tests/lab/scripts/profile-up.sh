#!/usr/bin/env bash
set -euo pipefail

profile=${1:-lan}
compose=(docker compose -f tests/lab/docker-compose.yml)

case "$profile" in
  lan) "${compose[@]}" up -d relay web; ;;
  wan|nat|hairpin|loss)
    "${compose[@]}" --profile "$profile" up -d relay web router_a router_b client_a client_b client_c
    for router in router_a router_b; do
      id=$("${compose[@]}" ps -q "$router")
      docker exec "$id" sh -c 'sysctl -w net.ipv4.ip_forward=1 >/dev/null; wan=$(ip route show default | awk "{print \$5; exit}"); iptables -t nat -C POSTROUTING -o "$wan" -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o "$wan" -j MASQUERADE'
    done
    ;;
  *) echo "usage: $0 lan|wan|nat|hairpin|loss" >&2; exit 2 ;;
esac

echo "Kant lab profile active: $profile"
