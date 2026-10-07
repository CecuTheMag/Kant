#!/usr/bin/env bash
# Host a Kant relay from any computer, without port forwarding.
#
#   scripts/relay-tunnel.sh tailscale     private: devices on your tailnet only
#   scripts/relay-tunnel.sh funnel        public, through Tailscale Funnel
#   scripts/relay-tunnel.sh url <URL>     any other tunnel (Cloudflare Tunnel, ngrok, …)
#   scripts/relay-tunnel.sh status
#   scripts/relay-tunnel.sh stop
#
# The relay listens on 127.0.0.1:3001 only; the tunnel is the one way in.
# Walkthrough and alternatives: RELAY_TUNNELS.md.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
COMPOSE=(docker compose -f "$ROOT/docker-compose.tunnel.yml")
STATE="$ROOT/.kant-tunnel"
LOCAL=http://127.0.0.1:3001

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[0;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[0;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Host a Kant relay without port forwarding.

Usage: scripts/relay-tunnel.sh <command> [options]

Commands:
  tailscale         Private relay: only devices on your tailnet can use it
  funnel            Public relay through Tailscale Funnel (contacts need nothing installed)
  url <URL>         Use another tunnel that forwards <URL> to $LOCAL
                    (Cloudflare Tunnel, ngrok, …; see RELAY_TUNNELS.md)
  status            Show the relay, the tunnel and the address to share
  stop              Stop the relay and remove the Tailscale handler this script added

Options:
  --https-port N    Tailscale HTTPS port (default 443; Funnel allows 443, 8443, 10000)
  --no-docker       Run the relay with Node in this terminal instead of Docker
  --force           Replace an existing Tailscale Serve handler on that port
  -h, --help        Show this help
EOF
}

# ── Arguments ────────────────────────────────────────────────────────────────
CMD=${1:-}; [[ $# -gt 0 ]] && shift
URL=""
HTTPS_PORT=443
DOCKER=1
FORCE=0
if [[ "$CMD" == url ]]; then
  [[ $# -gt 0 && "$1" != -* ]] || die "usage: scripts/relay-tunnel.sh url https://your-tunnel.example"
  URL=$1; shift
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --https-port) [[ $# -ge 2 ]] || die "--https-port needs a value"; HTTPS_PORT=$2; shift 2 ;;
    --no-docker)  DOCKER=0; shift ;;
    --force)      FORCE=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "unknown option: $1 (see --help)" ;;
  esac
done
[[ "$HTTPS_PORT" =~ ^[0-9]+$ ]] || die "--https-port must be a number"

# ── Tailscale ────────────────────────────────────────────────────────────────
TS=""
find_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then TS=tailscale
  elif [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
  else die "Tailscale isn't installed. Get it from https://tailscale.com/download, sign in, then run this again."
  fi
}

# This machine's MagicDNS name, e.g. kant.tail1234.ts.net. "Self" precedes
# "Peer" in the status JSON, so the first DNSName is ours.
tailscale_name() {
  local json state name
  json=$("$TS" status --json 2>/dev/null) || die "Tailscale isn't running. Start it and sign in (tailscale up), then run this again."
  state=$(sed -n 's/.*"BackendState": *"\([^"]*\)".*/\1/p' <<<"$json" | head -1)
  [[ "$state" == Running ]] || die "Tailscale is $state, not connected. Run 'tailscale up' and sign in first."
  name=$(sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' <<<"$json" | head -1)
  name=${name%.}
  [[ -n "$name" ]] || die "This machine has no MagicDNS name. Turn on MagicDNS at https://login.tailscale.com/admin/dns"
  if ! grep -q '"CertDomains": *\[' <<<"$json"; then
    warn "HTTPS certificates aren't enabled on your tailnet yet. Tailscale will show a link to enable them;"
    warn "or turn on 'HTTPS Certificates' at https://login.tailscale.com/admin/dns"
  fi
  printf '%s' "$name"
}

# On Linux, tailscaled lets only root or its "operator" change Serve/Funnel.
# Check before starting anything, not after the user has approved Funnel.
check_tailscale_permission() {
  [[ "$(uname -s)" == Linux && $EUID -ne 0 ]] || return 0
  "$TS" debug prefs 2>/dev/null | grep -q "\"OperatorUser\": *\"$(id -un)\"" && return 0
  die "Tailscale only lets root or its operator set up Serve/Funnel on Linux. Run this once, then run this script again:
    sudo tailscale set --operator=\$USER"
}

# Refuse to replace someone else's handler on the port unless --force.
check_serve_port_free() {
  local cfg
  cfg=$("$TS" serve status --json 2>/dev/null || echo '{}')
  if grep -q ":$HTTPS_PORT\"" <<<"$cfg" && ! grep -q '127.0.0.1:3001' <<<"$cfg"; then
    [[ $FORCE == 1 ]] || die "Tailscale already serves something else on port $HTTPS_PORT (see 'tailscale serve status'). Use --https-port 8443, or --force to replace it."
  fi
}

tailscale_up() { # $1 = serve | funnel
  # Attached to the terminal on purpose: the first time, Tailscale prints a
  # link to enable Serve/Funnel for the tailnet and waits until it's approved,
  # and it only prints that link to a terminal.
  local yes=()
  [[ $FORCE == 1 ]] && yes=(--yes)
  info "Asking Tailscale to $1 https port $HTTPS_PORT → $LOCAL"
  info "If Tailscale shows a link, open it, approve, and this continues by itself."
  if ! "$TS" "$1" --bg ${yes[@]+"${yes[@]}"} --https="$HTTPS_PORT" "$LOCAL"; then
    die "tailscale $1 failed (see above). If it says access denied, run once: sudo tailscale set --operator=\$USER"
  fi
}

tailscale_down() { # remove only the handler we added
  local port=$1
  "$TS" funnel --https="$port" off >/dev/null 2>&1 || true
  "$TS" serve --https="$port" off >/dev/null 2>&1 || true
}

# ── Relay ────────────────────────────────────────────────────────────────────
public_url() { # host port → https URL, port omitted when 443
  if [[ "$2" == 443 ]]; then printf 'https://%s' "$1"; else printf 'https://%s:%s' "$1" "$2"; fi
}

check_url() {
  local name='^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$' ip6='^https?://\[[0-9A-Fa-f:]+\](:[0-9]+)?/?$'
  [[ "$1" =~ $name || "$1" =~ $ip6 ]] \
    || die "'$1' isn't a bare http(s) origin like https://relay.example.ts.net (no path)."
}

url_host() { # https://[::1]:3001 → ::1, https://a.example:8443 → a.example
  local h=${1#*://}
  h=${h%%/*}
  if [[ "$h" == \[* ]]; then h=${h#[}; h=${h%%]*}; else h=${h%%:*}; fi
  printf '%s' "$h"
}

start_relay() { # $1 = public URL
  if [[ $DOCKER == 1 ]]; then
    command -v docker >/dev/null 2>&1 || die "Docker isn't installed. Install it (https://docs.docker.com/get-docker/) or use --no-docker."
    docker info >/dev/null 2>&1 || die "Can't talk to Docker. Start Docker, or add yourself to the docker group (or use --no-docker)."
    info "Starting the relay in Docker (the first build takes a few minutes)"
    RELAY_PUBLIC_URL="$1" "${COMPOSE[@]}" up -d --build
    wait_local
  fi
}

wait_local() {
  info "Waiting for the relay on $LOCAL"
  for _ in $(seq 120); do
    curl -fsS "$LOCAL/healthz" >/dev/null 2>&1 && return 0
    sleep 1
  done
  [[ $DOCKER == 1 ]] && "${COMPOSE[@]}" logs --tail 40 relay >&2
  die "The relay didn't come up on $LOCAL."
}

# The tunnel works when /relay-info answers through it and names the same URL.
verify_public() { # $1 = public URL; returns 1 if it never answered
  local url=$1 host body
  host=$(url_host "$url")
  info "Checking $url/relay-info from outside (a brand-new HTTPS certificate can take a minute)"
  for _ in $(seq 90); do
    if body=$(curl -fsS --max-time 10 "$url/relay-info" 2>/dev/null); then
      if grep -q "/$host/" <<<"$body"; then
        return 0
      fi
      warn "The relay at $url announces a different address: $body"
      warn "RELAY_PUBLIC_URL must be exactly the tunnel URL."
      return 1
    fi
    sleep 2
  done
  return 1
}

save_state() { # mode url port
  printf 'MODE=%q\nRELAY_PUBLIC_URL=%q\nHTTPS_PORT=%q\nDOCKER=%q\n' "$1" "$2" "$3" "$DOCKER" > "$STATE"
}

share_box() { # $1 = url, $2 = who can use it
  local addr=${1#https://}
  echo
  bold "Your Kant relay is running."
  echo "  Relay address:  $addr"
  echo "  Who can use it: $2"
  echo "  In Kant:        Settings → Relay address → $addr"
  echo
  echo "  Your computer has to stay on for the relay to work."
  echo "  Status: scripts/relay-tunnel.sh status    Stop: scripts/relay-tunnel.sh stop"
  echo
}

run_foreground() { # $1 = public URL (--no-docker)
  command -v node >/dev/null 2>&1 || die "Node.js 20+ is required for --no-docker."
  if [[ ! -f "$ROOT/packages/relay/dist/index.js" ]]; then
    info "Building the relay"
    (cd "$ROOT" && npx --yes pnpm@10 install --frozen-lockfile && npx --yes pnpm@10 --dir packages/relay build)
  fi
  mkdir -p "$ROOT/relay-data"
  info "Starting the relay here; press Ctrl-C to stop it"
  RELAY_PUBLIC_URL="$1" RELAY_HTTP_BIND=127.0.0.1 RELAY_WS_BIND=127.0.0.1 RELAY_DATA_DIR="$ROOT/relay-data" \
    exec node "$ROOT/packages/relay/dist/index.js"
}

# ── Commands ─────────────────────────────────────────────────────────────────
case "$CMD" in
  tailscale|funnel)
    find_tailscale
    if [[ "$CMD" == funnel && ! "$HTTPS_PORT" =~ ^(443|8443|10000)$ ]]; then
      die "Funnel only serves ports 443, 8443 and 10000."
    fi
    name=$(tailscale_name)
    url=$(public_url "$name" "$HTTPS_PORT")
    check_tailscale_permission
    check_serve_port_free
    save_state "$CMD" "$url" "$HTTPS_PORT"
    if [[ $DOCKER == 0 ]]; then
      tailscale_up "$( [[ $CMD == funnel ]] && echo funnel || echo serve )"
      share_box "$url" "$( [[ $CMD == funnel ]] && echo anyone with the address || echo devices on your tailnet )"
      run_foreground "$url"
    fi
    start_relay "$url"
    tailscale_up "$( [[ $CMD == funnel ]] && echo funnel || echo serve )"
    if verify_public "$url"; then
      share_box "$url" "$( [[ $CMD == funnel ]] && echo 'anyone with the address' || echo 'devices signed in to your tailnet' )"
    else
      die "The relay runs, but $url doesn't answer yet. Check 'tailscale $( [[ $CMD == funnel ]] && echo funnel || echo serve ) status', then 'scripts/relay-tunnel.sh status'."
    fi
    ;;

  url)
    check_url "$URL"
    url=${URL%/}
    save_state url "$url" ""
    if [[ $DOCKER == 0 ]]; then
      share_box "$url" "anyone who can reach $url"
      echo "  Point your tunnel at $LOCAL"
      run_foreground "$url"
    fi
    start_relay "$url"
    if verify_public "$url"; then
      share_box "$url" "anyone who can reach $url"
    else
      echo
      bold "The relay runs on $LOCAL, but $url doesn't reach it yet."
      echo "  Point your tunnel at $LOCAL, for example:"
      echo "    cloudflared tunnel run <name>      (ingress service: $LOCAL)"
      echo "    ngrok http $LOCAL --url=${url#https://}"
      echo "  Then check: scripts/relay-tunnel.sh status"
      exit 1
    fi
    ;;

  status)
    [[ -f "$STATE" ]] || { echo "No relay was started with this script (no $STATE)."; exit 1; }
    # shellcheck disable=SC1090
    source "$STATE"
    echo "Mode:          $MODE"
    echo "Relay address: ${RELAY_PUBLIC_URL#https://}"
    if curl -fsS --max-time 5 "$LOCAL/healthz" >/dev/null 2>&1; then echo "Local relay:   running ($LOCAL)"; else echo "Local relay:   NOT running"; fi
    if body=$(curl -fsS --max-time 10 "$RELAY_PUBLIC_URL/relay-info" 2>/dev/null); then
      echo "From outside:  reachable"
      echo "Announces:     $(sed -n 's/.*"multiaddr":"\([^"]*\)".*/\1/p' <<<"$body")"
    else
      echo "From outside:  NOT reachable ($RELAY_PUBLIC_URL/relay-info)"
    fi
    if [[ "$MODE" == tailscale || "$MODE" == funnel ]]; then find_tailscale; "$TS" "$( [[ $MODE == funnel ]] && echo funnel || echo serve )" status || true; fi
    ;;

  stop)
    if [[ -f "$STATE" ]]; then
      # shellcheck disable=SC1090
      source "$STATE"
      if [[ "$MODE" == tailscale || "$MODE" == funnel ]]; then
        find_tailscale
        info "Removing the Tailscale handler on https port $HTTPS_PORT"
        tailscale_down "$HTTPS_PORT"
      fi
    fi
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      info "Stopping the relay (its identity is kept for next time)"
      RELAY_PUBLIC_URL=unused "${COMPOSE[@]}" down
    fi
    rm -f "$STATE"
    info "Stopped."
    ;;

  ""|-h|--help|help) usage ;;
  *) die "unknown command: $CMD (see --help)" ;;
esac
