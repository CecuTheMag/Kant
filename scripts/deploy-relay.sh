#!/usr/bin/env bash
# Deploy a Kant relay on a server with Docker Compose.
#
#   https  a domain pointing at this server; Caddy gets the certificate
#          (ports 80 and 443 must be reachable from the internet)
#   http   a LAN or VPN only (plain HTTP on ports 3000/3001)
#
# Run it without options and it asks for what it needs. Nothing about Firebase
# or push proxies is required: those belong to whoever builds the app.
# No domain, or can't open ports? Use scripts/relay-tunnel.sh (RELAY_TUNNELS.md).

set -euo pipefail

INSTALL_DIR="/opt/kant"
REPO_URL="https://github.com/CecuTheMag/Kant.git"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${BLUE}==>${NC} $1"; }
warn()    { echo -e "${YELLOW}warning:${NC} $1" >&2; }
error()   { echo -e "${RED}error:${NC} $1" >&2; exit 1; }

show_help() {
    cat <<EOF
Usage: $0 [options]

Without options it asks how people will reach the relay.

Options:
  -m, --mode MODE      'https' (a domain, ports 80/443 open) or 'http' (LAN/VPN only)
  -d, --domain NAME    HTTPS: the domain pointing at this server.
                       HTTP: the IP or name clients use (default: this machine's LAN IP)
  -e, --email EMAIL    HTTPS: your email for Let's Encrypt certificate notices
  -p, --path PATH      Installation directory (default: $INSTALL_DIR)
  -r, --repo URL       Git repository to clone (default: $REPO_URL)
  -l, --local          Use this checkout instead of cloning
  -y, --yes            Don't ask; fail if something required is missing
  -h, --help           Show this help

Examples:
  $0                                            # asks
  $0 --local --mode https --domain relay.example.org --email you@example.org
  $0 --local --mode http

No domain, or can't open ports? scripts/relay-tunnel.sh funnel  (see RELAY_TUNNELS.md)
EOF
}

MODE=""; DOMAIN=""; EMAIL=""; INSTALL_PATH="$INSTALL_DIR"; REPO="$REPO_URL"; USE_LOCAL=false; ASK=true
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)   MODE="${2:-}"; shift ;;
        -d|--domain) DOMAIN="${2:-}"; shift ;;
        -e|--email)  EMAIL="${2:-}"; shift ;;
        -p|--path)   INSTALL_PATH="${2:-}"; shift ;;
        -r|--repo)   REPO="${2:-}"; shift ;;
        -l|--local)  USE_LOCAL=true ;;
        -y|--yes)    ASK=false ;;
        -h|--help)   show_help; exit 0 ;;
        *) error "Unknown option: $1 (see --help)" ;;
    esac
    shift
done
[[ -t 0 ]] || ASK=false

ask() { # ask VAR "question" [default]
    local __var=$1 __q=$2 __def=${3:-} __ans
    [[ $ASK == true ]] || return 0
    if [[ -n "$__def" ]]; then read -r -p "$__q [$__def]: " __ans; else read -r -p "$__q: " __ans; fi
    printf -v "$__var" '%s' "${__ans:-$__def}"
}

lan_ip() {
    local ip
    ip=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
    [[ -n "$ip" ]] || ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    printf '%s' "$ip"
}

# ── What kind of relay ───────────────────────────────────────────────────────
if [[ -z "$MODE" ]]; then
    if [[ $ASK == true ]]; then
        echo -e "${BOLD}How will people reach this relay?${NC}"
        echo "  1) Over the internet, with a domain that points at this server (HTTPS; ports 80 and 443 open)"
        echo "  2) Only on this network or a VPN (HTTP)"
        echo "  3) Over the internet, but I have no domain or can't open ports"
        read -r -p "Choose 1, 2 or 3 [1]: " choice
        case "${choice:-1}" in
            1) MODE=https ;;
            2) MODE=http ;;
            3) echo; echo "Use the tunnel script instead; it needs no domain and no open ports:"
               echo "  scripts/relay-tunnel.sh funnel        (Tailscale Funnel; see RELAY_TUNNELS.md)"
               exit 0 ;;
            *) error "Please answer 1, 2 or 3." ;;
        esac
    else
        MODE=https
    fi
fi
[[ "$MODE" == https || "$MODE" == http ]] || error "Invalid mode: $MODE (use https or http)."

if [[ "$MODE" == https ]]; then
    [[ -n "$DOMAIN" ]] || ask DOMAIN "Domain that points at this server (e.g. relay.example.org)"
    [[ -n "$DOMAIN" ]] || error "HTTPS needs a domain: --domain relay.example.org"
    [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]] || error "'$DOMAIN' doesn't look like a domain name."
    [[ -n "$EMAIL" ]] || ask EMAIL "Your email, for certificate expiry notices from Let's Encrypt"
    [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || error "HTTPS needs a valid email for the certificate: --email you@example.org"
    # Let's Encrypt refuses example.com/.net/.org addresses, and with them the certificate.
    [[ ! "$EMAIL" =~ @example\.(com|net|org)$ ]] || error "Let's Encrypt rejects @example.* addresses; use a real email."
else
    [[ -n "$DOMAIN" ]] || ask DOMAIN "IP or name clients use to reach this machine" "$(lan_ip)"
    [[ -n "$DOMAIN" ]] || DOMAIN=$(lan_ip)
    [[ -n "$DOMAIN" ]] || error "Couldn't detect this machine's IP. Pass it with --domain <ip-or-name>."
    [[ "$DOMAIN" != 0.0.0.0 ]] || error "0.0.0.0 is a bind address; clients need this machine's real IP or name."
fi

log "Mode: $MODE   Address: $DOMAIN   Path: $INSTALL_PATH"

# ── Docker ───────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    warn "Docker not found. Installing it (get.docker.com)..."
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sudo sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
fi
DOCKER=(docker)
docker info &>/dev/null || DOCKER=(sudo docker)
"${DOCKER[@]}" compose version &>/dev/null || error "Docker Compose v2 is required (docker compose)."

# ── Source ───────────────────────────────────────────────────────────────────
SUDO=()
mkdir -p "$INSTALL_PATH" 2>/dev/null || true
[[ -w "$INSTALL_PATH" ]] || SUDO=(sudo)
"${SUDO[@]}" mkdir -p "$INSTALL_PATH"
if [[ "$USE_LOCAL" == true ]]; then
    SRC=$(cd "$(dirname "$0")/.." && pwd)
    if [[ "$(cd "$INSTALL_PATH" && pwd)" != "$SRC" ]]; then
        log "Copying $SRC to $INSTALL_PATH"
        "${SUDO[@]}" cp -R "$SRC"/. "$INSTALL_PATH/"
    fi
elif [[ -d "$INSTALL_PATH/.git" ]]; then
    log "Updating $INSTALL_PATH"
    "${SUDO[@]}" git -C "$INSTALL_PATH" pull --ff-only
elif [[ -z "$(ls -A "$INSTALL_PATH")" ]]; then
    log "Cloning $REPO into $INSTALL_PATH"
    "${SUDO[@]}" git clone "$REPO" "$INSTALL_PATH"
else
    warn "$INSTALL_PATH is not empty and not a git checkout; using the files there."
fi
cd "$INSTALL_PATH"

COMPOSE_FILE="docker-compose.$MODE.yml"
compose() { "${DOCKER[@]}" compose -f "$COMPOSE_FILE" "$@"; }

# ── Configuration (.env, kept across reruns) ─────────────────────────────────
env_get() { [[ -f .env ]] && sed -n "s/^$1=//p" .env | tail -1 || true; }
VAPID_PUBLIC_KEY=$(env_get VAPID_PUBLIC_KEY); VAPID_PRIVATE_KEY=$(env_get VAPID_PRIVATE_KEY)
PUSH_PROXY_URL=$(env_get PUSH_PROXY_URL); PUSH_PROXY_SECRET=$(env_get PUSH_PROXY_SECRET)
RELAY_LAB_CONTROL_TOKEN=$(env_get RELAY_LAB_CONTROL_TOKEN)

log "Building the relay (the first build takes a few minutes)"
RELAY_DOMAIN="$DOMAIN" RELAY_PUBLIC_HOST="$DOMAIN" compose build

# Desktop notifications (Web Push) need a key pair per relay; make one once.
if [[ -z "$VAPID_PUBLIC_KEY" || -z "$VAPID_PRIVATE_KEY" ]]; then
    log "Generating Web Push keys for desktop notifications"
    keys=$(RELAY_DOMAIN="$DOMAIN" RELAY_PUBLIC_HOST="$DOMAIN" compose run --rm --no-deps -T --entrypoint node relay packages/relay/dist/vapid.js)
    VAPID_PUBLIC_KEY=$(sed -n 's/^VAPID_PUBLIC_KEY=//p' <<<"$keys")
    VAPID_PRIVATE_KEY=$(sed -n 's/^VAPID_PRIVATE_KEY=//p' <<<"$keys")
    [[ -n "$VAPID_PUBLIC_KEY" && -n "$VAPID_PRIVATE_KEY" ]] || error "Couldn't generate Web Push keys."
fi
# Operator token for /metrics and /admin (keep it private).
[[ -n "$RELAY_LAB_CONTROL_TOKEN" ]] || RELAY_LAB_CONTROL_TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')

log "Writing $INSTALL_PATH/.env"
tmp=$(mktemp)
{
    if [[ "$MODE" == https ]]; then
        echo "RELAY_DOMAIN=$DOMAIN"
        echo "CADDY_EMAIL=$EMAIL"
    else
        echo "RELAY_PUBLIC_HOST=$DOMAIN"
    fi
    echo "VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY"
    echo "VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY"
    echo "VAPID_SUBJECT=mailto:${EMAIL:-admin@kant.local}"
    echo "RELAY_LAB_CONTROL_TOKEN=$RELAY_LAB_CONTROL_TOKEN"
    # Android wake-ups: only for apps built with your own Firebase project.
    echo "PUSH_PROXY_URL=$PUSH_PROXY_URL"
    echo "PUSH_PROXY_SECRET=$PUSH_PROXY_SECRET"
} > "$tmp"
chmod 600 "$tmp"
"${SUDO[@]}" mv "$tmp" .env

# ── Start and check ──────────────────────────────────────────────────────────
log "Starting the relay"
compose up -d

if [[ "$MODE" == https ]]; then
    URL="https://$DOMAIN"
    public_ip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
    dns_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
    if [[ -z "$dns_ip" ]]; then
        target=${public_ip:-"this server's public IP"}
        warn "$DOMAIN doesn't resolve yet. Point an A record at $target; the certificate follows."
    elif [[ -n "$public_ip" && "$dns_ip" != "$public_ip" ]]; then
        warn "$DOMAIN points at $dns_ip, but this server's public IP is $public_ip. Fix the DNS record."
    fi
else
    URL="http://$DOMAIN:3001"
fi

log "Waiting for $URL (a new certificate can take a minute)"
ok=false
for _ in $(seq 60); do
    if body=$(curl -fsS --max-time 5 "$URL/relay-info" 2>/dev/null) && grep -q "/$DOMAIN/" <<<"$body"; then ok=true; break; fi
    sleep 3
done

echo
if [[ $ok == true ]]; then
    echo -e "${GREEN}${BOLD}Your Kant relay is running.${NC}"
else
    echo -e "${YELLOW}${BOLD}The relay started, but $URL doesn't answer from here yet.${NC}"
    if [[ "$MODE" == https ]]; then
        echo "  Check that $DOMAIN points at this server and ports 80 and 443 are open,"
        echo "  then: ${DOCKER[*]} compose -f $COMPOSE_FILE logs caddy"
    else
        echo "  Check the firewall allows ports 3000 and 3001: ${DOCKER[*]} compose -f $COMPOSE_FILE logs relay"
    fi
fi
echo "  Relay address:  ${URL#https://}"
echo "  In Kant:        Settings → Relay address → ${URL#https://}"
echo "  Desktop notifications: on (Web Push keys in $INSTALL_PATH/.env)"
echo "  Logs:           cd $INSTALL_PATH && ${DOCKER[*]} compose -f $COMPOSE_FILE logs -f"
echo "  Back up the relay-data volume: it holds the relay's identity."
[[ $ok == true ]]
