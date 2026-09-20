#!/bin/bash

# Kant Relay Deployment Script
# This script automates the deployment of a Kant Relay using Docker Compose.
# It supports both HTTPS (production) and HTTP (internal/lab) modes.

set -e

# --- Defaults ---
INSTALL_DIR="/opt/kant"
REPO_URL="https://github.com/magcecu/Kant.git"
DEFAULT_DOMAIN="relay.example.com"

# --- Colors ---
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

show_help() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -d, --domain DOMAIN    Public domain for the relay (required for HTTPS)"
    echo "  -m, --mode MODE        Deployment mode: 'https' (default) or 'http'"
    echo "  -p, --path PATH        Installation directory (default: /opt/kant)"
    echo "  -r, --repo URL         Git repository URL (default: $REPO_URL)"
    echo "  -l, --local            Use local files instead of cloning from Git"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Example:"
    echo "  sudo $0 --domain relay.kant.io --mode https"
    echo "  sudo $0 --local --domain relay.kant.io --mode https"
    echo "  sudo $0 --mode http --path ./kant-relay"
}

# --- Parse Arguments ---
MODE="https"
DOMAIN=""
INSTALL_PATH="$INSTALL_DIR"
REPO="$REPO_URL"
USE_LOCAL=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -d|--domain) DOMAIN="$2"; shift ;;
        -m|--mode) MODE="$2"; shift ;;
        -p|--path) INSTALL_PATH="$2"; shift ;;
        -r|--repo) REPO="$2"; shift ;;
        -l|--local) USE_LOCAL=true ;;
        -h|--help) show_help; exit 0 ;;
        *) error "Unknown parameter passed: $1" ;;
    esac
    shift
done

# --- Validation ---
if [[ "$MODE" == "https" && -z "$DOMAIN" ]]; then
    error "Domain is required for HTTPS mode. Use --domain <domain>"
fi

if [[ "$MODE" != "https" && "$MODE" != "http" ]]; then
    error "Invalid mode: $MODE. Must be 'https' or 'http'."
fi

# --- Execution ---

log "Starting Kant Relay deployment..."
log "Mode: $MODE"
log "Path: $INSTALL_PATH"
[[ -n "$DOMAIN" ]] && log "Domain: $DOMAIN"

# 1. Install Dependencies
log "Checking for Docker and Docker Compose..."
if ! command -v docker &> /dev/null; then
    warn "Docker not found. Attempting to install..."
    # This is a basic Ubuntu/Debian install; in a real enterprise script, 
    # we might use a more robust method or assume pre-installed.
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
fi

# 2. Source Code Acquisition
if [ "$USE_LOCAL" = true ]; then
    log "Using local source files..."
    # Assume the script is run from within the repo or a known path
    # We copy the current directory to the install path
    CURRENT_DIR=$(pwd)
    if [ "$CURRENT_DIR" != "$INSTALL_PATH" ]; then
        log "Copying files from $CURRENT_DIR to $INSTALL_PATH..."
        sudo mkdir -p "$INSTALL_PATH"
        sudo cp -R "$CURRENT_DIR"/. "$INSTALL_PATH/"
    fi
    cd "$INSTALL_PATH"
else
    if [ ! -d "$INSTALL_PATH" ]; then
        log "Cloning repository into $INSTALL_PATH..."
        sudo mkdir -p "$INSTALL_PATH"
        sudo git clone "$REPO" "$INSTALL_PATH"
    else
        if [ -d "$INSTALL_PATH/.git" ]; then
            warn "Directory $INSTALL_PATH already exists and is a git repo. Pulling latest changes..."
            cd "$INSTALL_PATH" && sudo git pull
        else
            warn "Directory $INSTALL_PATH exists but is not a git repository."
            log "Proceeding with existing files in $INSTALL_PATH..."
            cd "$INSTALL_PATH"
        fi
    fi
    cd "$INSTALL_PATH"
fi

# 3. Configure Environment
log "Configuring environment..."
if [[ "$MODE" == "https" ]]; then
    cat <<EOF | sudo tee .env > /dev/null
RELAY_DOMAIN=$DOMAIN
RELAY_PUBLIC_HOST=$DOMAIN
RELAY_PUBLIC_PORT=443
RELAY_SECURE=true
RELAY_LOG_LEVEL=info
LOG_FORMAT=json
EOF
else
    cat <<EOF | sudo tee .env > /dev/null
RELAY_PUBLIC_HOST=0.0.0.0
RELAY_PUBLIC_PORT=3000
RELAY_SECURE=false
RELAY_LOG_LEVEL=info
LOG_FORMAT=pretty
EOF
fi

# 4. Deploy
COMPOSE_FILE="docker-compose.http.yml"
[[ "$MODE" == "https" ]] && COMPOSE_FILE="docker-compose.https.yml"

log "Building and starting containers using $COMPOSE_FILE..."
sudo RELAY_DOMAIN="$DOMAIN" docker compose -f "$COMPOSE_FILE" up -d --build

# 5. Verification
log "Verifying deployment..."
sleep 5

if sudo docker compose -f "$COMPOSE_FILE" ps | grep -q "healthy"; then
    success "Relay containers are up and healthy!"
else
    warn "Containers are starting, but not yet healthy. Please check logs: sudo docker compose -f $COMPOSE_FILE logs -f"
fi

# 6. Final Instructions
echo "--------------------------------------------------------------------------------"
if [[ "$MODE" == "https" ]]; then
    echo "Relay is now deploying at: https://$DOMAIN"
    echo "Check health: curl -fsS https://$DOMAIN/healthz"
else
    echo "Relay is now deploying in HTTP mode."
    echo "Check health: curl -fsS http://localhost:3001/healthz"
fi
echo "Logs: sudo docker compose -f $COMPOSE_FILE logs -f"
echo "--------------------------------------------------------------------------------"
