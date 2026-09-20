#!/bin/sh
set -eu

data_dir=${RELAY_DATA_DIR:-/data}
relay_port=${RELAY_PORT:-3000}
seed_file="$data_dir/relay-seed-$relay_port.bin"

# Named volumes created by older images are root-owned. Perform the smallest
# possible migration as root, then permanently drop privileges before Node
# starts. Reject symlinks and malformed seeds rather than changing their target.
if [ "$(id -u)" -eq 0 ]; then
  if [ -L "$data_dir" ]; then
    echo "Relay data directory must not be a symlink: $data_dir" >&2
    exit 1
  fi
  mkdir -p "$data_dir"
  chown relay:relay "$data_dir"
  chmod 0700 "$data_dir"

  if [ -e "$seed_file" ]; then
    if [ ! -f "$seed_file" ] || [ -L "$seed_file" ]; then
      echo "Relay seed must be a regular file: $seed_file" >&2
      exit 1
    fi
    seed_size=$(wc -c < "$seed_file")
    if [ "$seed_size" -ne 32 ]; then
      echo "Relay seed must be exactly 32 bytes, got $seed_size" >&2
      exit 1
    fi
    chown relay:relay "$seed_file"
    chmod 0600 "$seed_file"
  fi

  exec su-exec relay "$@"
fi

exec "$@"
