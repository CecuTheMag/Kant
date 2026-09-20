#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="$ROOT_DIR/.env.kant-deploy"
SECRETS_DIR="$ROOT_DIR/.kant-secrets"
SERVICE_ACCOUNT_FILE="$SECRETS_DIR/firebase-service-account.json"

die() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
info() { printf '\n==> %s\n' "$1"; }

[[ -f "$ROOT_DIR/docker-compose.push-proxy.yml" ]] || die "Run this script from the Kant repository."
command -v docker >/dev/null 2>&1 || die "Docker is required. Install Docker and Docker Compose, then run this script again."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose)."

printf '%s\n' 'Kant self-hosted deployment'
printf '%s\n' 'This creates local files with mode 600. Secrets are not printed.'

reuse_existing=false
if [[ -f "$ENV_FILE" && -f "$SERVICE_ACCOUNT_FILE" ]]; then
  read -r -p 'Existing deployment configuration found. Reuse it? [Y/n]: ' reuse_answer
  if [[ ! "$reuse_answer" =~ ^[Nn]$ ]]; then
    reuse_existing=true
    set -a
    source "$ENV_FILE"
    set +a
    firebase_project_id=${FIREBASE_PROJECT_ID:-}
    if [[ -z "$firebase_project_id" ]]; then
      firebase_project_id=$(node -e "const x=require(process.argv[1]); if (!x.project_id) process.exit(2); process.stdout.write(x.project_id)" "$SERVICE_ACCOUNT_FILE" 2>/dev/null) || die "Existing Firebase service-account file has no project ID."
      printf 'Recovered Firebase project ID from the saved service-account file.\n'
    fi
    proxy_secret=${PUSH_PROXY_SECRET:-}
    if [[ -z "$proxy_secret" ]]; then
      command -v openssl >/dev/null 2>&1 || die "openssl is required to generate the proxy secret."
      proxy_secret=$(openssl rand -hex 32)
      printf 'Generated a missing proxy secret for the existing deployment.\n'
    fi
    caddy_email=${CADDY_EMAIL:-admin@example.com}
    vapid_public_key=${VAPID_PUBLIC_KEY:-}
    vapid_private_key=${VAPID_PRIVATE_KEY:-}
    vapid_subject=${VAPID_SUBJECT:-mailto:admin@kant.local}
    firebase_json="$SERVICE_ACCOUNT_FILE"
    relay_mode=$([[ "${RELAY_SECURE:-true}" == true ]] && printf https || printf http)
    if [[ "$relay_mode" == https ]]; then
      relay_domain=${RELAY_DOMAIN:-}
      [[ -n "$relay_domain" ]] || die "Missing RELAY_DOMAIN in existing configuration."
      relay_public_host=${RELAY_PUBLIC_HOST:-$relay_domain}
      relay_public_port=${RELAY_PUBLIC_PORT:-443}
      relay_url="https://${relay_domain}"
    else
      relay_domain=''
      relay_public_host=${RELAY_PUBLIC_HOST:?Missing RELAY_PUBLIC_HOST in existing configuration}
      relay_public_port=${RELAY_PUBLIC_PORT:-3000}
      relay_url="http://${relay_public_host}:3001"
    fi
    push_proxy_port=${PUSH_PROXY_PORT:-3002}
    push_proxy_url=${PUSH_PROXY_URL:-}
    if [[ -z "$push_proxy_url" && "$relay_mode" == https ]]; then
      push_proxy_url="http://push-proxy:4001"
    fi
    [[ -n "$push_proxy_url" ]] || die "Missing PUSH_PROXY_URL in existing configuration."
    printf 'Reusing existing deployment configuration.\n'
  fi
fi

if [[ "$reuse_existing" != true ]]; then
  read -r -p 'Firebase project ID [kant-messenger]: ' firebase_project_id
  firebase_project_id=${firebase_project_id:-kant-messenger}

  while true; do
    read -r -p 'Path to Firebase service-account JSON: ' firebase_json
    [[ -f "$firebase_json" ]] && break
    printf 'File not found. Please enter an existing JSON file.\n'
  done

  service_account_project_id=$(
    node -e "const x=require(process.argv[1]); if (!x.project_id || !x.private_key || !x.client_email) process.exit(2); process.stdout.write(x.project_id)" "$firebase_json" 2>/dev/null
  ) || die "The Firebase file is not valid or is missing required fields."
  [[ "$service_account_project_id" == "$firebase_project_id" ]] || die "Firebase project mismatch: JSON is for '$service_account_project_id', but you entered '$firebase_project_id'."

  read -r -s -p 'Proxy shared secret (Enter to generate one): ' proxy_secret
  printf '\n'
  if [[ -z "$proxy_secret" ]]; then
    command -v openssl >/dev/null 2>&1 || die "openssl is required to generate the proxy secret."
    proxy_secret=$(openssl rand -hex 32)
  fi
  [[ ${#proxy_secret} -ge 32 ]] || die 'Proxy shared secret must be at least 32 characters.'

  while true; do
    read -r -p 'Relay mode (http/https) [https]: ' relay_mode
    relay_mode=${relay_mode:-https}
    [[ "$relay_mode" == http || "$relay_mode" == https ]] && break
    printf 'Choose http or https.\n'
  done

if [[ "$relay_mode" == https ]]; then
  read -r -p 'Relay domain (for example relay.example.com): ' relay_domain
  [[ "$relay_domain" =~ ^[A-Za-z0-9.-]+$ && "$relay_domain" == *.* ]] || die 'HTTPS requires a valid DNS domain.'
  relay_public_host="$relay_domain"
  relay_public_port=443
  relay_url="https://$relay_domain"
  read -r -p "Caddy/Let's Encrypt email [admin@example.com]: " caddy_email
  caddy_email=${caddy_email:-admin@example.com}
else
  relay_domain=''
  read -r -p 'Relay public host or IP: ' relay_public_host
  [[ -n "$relay_public_host" ]] || die 'HTTP requires a public host or IP.'
  read -r -p 'Relay public port [3000]: ' relay_public_port
  relay_public_port=${relay_public_port:-3000}
  [[ "$relay_public_port" =~ ^[0-9]+$ && "$relay_public_port" -ge 1 && "$relay_public_port" -le 65535 ]] || die 'Relay port must be between 1 and 65535.'
  relay_url="http://${relay_public_host}:3001"
  caddy_email=''
fi

if [[ "$relay_mode" == https ]]; then
  push_proxy_port=4001
  default_proxy_url="http://push-proxy:4001"
else
  read -r -p 'Push proxy host port [3002]: ' push_proxy_port
  push_proxy_port=${push_proxy_port:-3002}
  [[ "$push_proxy_port" =~ ^[0-9]+$ && "$push_proxy_port" -ge 1 && "$push_proxy_port" -le 65535 ]] || die 'Push proxy port must be between 1 and 65535.'
  default_proxy_url="http://${relay_public_host}:${push_proxy_port}"
fi
read -r -p "Push proxy URL [$default_proxy_url]: " push_proxy_url
push_proxy_url=${push_proxy_url:-$default_proxy_url}
[[ "$push_proxy_url" =~ ^https?:// ]] || die 'Push proxy URL must start with http:// or https://.'

read -r -p 'VAPID public key (Enter to disable desktop Web Push): ' vapid_public_key
read -r -s -p 'VAPID private key (Enter to disable desktop Web Push): ' vapid_private_key
printf '\n'
if [[ -n "$vapid_public_key" && -z "$vapid_private_key" ]] || [[ -z "$vapid_public_key" && -n "$vapid_private_key" ]]; then
  die 'Provide both VAPID keys or leave both empty.'
fi
read -r -p 'VAPID subject email [admin@kant.local]: ' vapid_subject
vapid_subject=${vapid_subject:-mailto:admin@kant.local}
fi

info 'Preparing private deployment files'
umask 077
mkdir -p "$SECRETS_DIR"
if [[ "$(readlink -f -- "$firebase_json")" != "$(readlink -f -- "$SERVICE_ACCOUNT_FILE")" ]]; then
  cp -- "$firebase_json" "$SERVICE_ACCOUNT_FILE"
fi
chmod 600 "$SERVICE_ACCOUNT_FILE"

cat > "$ENV_FILE" <<EOF
FIREBASE_PROJECT_ID=$firebase_project_id
PUSH_PROXY_SECRET=$proxy_secret
PUSH_PROXY_URL=$push_proxy_url
RELAY_PUBLIC_HOST=$relay_public_host
RELAY_DOMAIN=$relay_domain
RELAY_PUBLIC_PORT=$relay_public_port
RELAY_SECURE=$([[ "$relay_mode" == https ]] && printf true || printf false)
CADDY_EMAIL=$caddy_email
PUSH_PROXY_PORT=$push_proxy_port
VAPID_PUBLIC_KEY=$vapid_public_key
VAPID_PRIVATE_KEY=$vapid_private_key
VAPID_SUBJECT=$vapid_subject
EOF
chmod 600 "$ENV_FILE"

proxy_compose=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.push-proxy.yml")
relay_compose=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.$relay_mode.yml")

info 'Validating Docker Compose configuration'
"${proxy_compose[@]}" config --quiet
"${relay_compose[@]}" config --quiet

info 'Starting push proxy'
if [[ "$relay_mode" == https ]]; then
  printf 'Proxy will start alongside the HTTPS relay through the shared domain stack.\n'
else
  "${proxy_compose[@]}" up -d --build
fi

info "Starting $relay_mode relay"
"${relay_compose[@]}" up -d --build

printf '\nDeployment started.\n'
printf 'Relay URL: %s\n' "$relay_url"
if [[ "$relay_mode" == https ]]; then
  printf 'Proxy URL (relay internal): %s\n' "$push_proxy_url"
  printf 'Proxy health: curl -fsS https://%s/proxy/healthz\n' "$relay_domain"
  printf 'Relay health: curl -fsS https://%s/healthz\n' "$relay_domain"
else
  printf 'Proxy URL: %s\n' "$push_proxy_url"
  printf 'Proxy health: curl -fsS %s/healthz\n' "$push_proxy_url"
  printf 'Relay health: curl -fsS http://%s:3001/healthz\n' "$relay_public_host"
fi
printf 'Private env: %s\n' "$ENV_FILE"
printf 'Private Firebase file: %s\n' "$SERVICE_ACCOUNT_FILE"
