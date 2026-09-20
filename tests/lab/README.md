# Kant isolated test lab

This directory is the disposable Docker lab for protocol, relay, network, browser UI, and desktop smoke testing.

## On node 2

```sh
cd /opt/kant
docker compose -f tests/lab/docker-compose.yml build
tests/lab/scripts/run.sh lan
```

The default relay advertisement is `192.168.0.130`. Set `RELAY_PUBLIC_HOST`
to the LXC's Tailscale or other reachable address before starting the relay
when clients are outside the LAN.

Use a profile for simulated routing:

```sh
tests/lab/scripts/run.sh nat
```

The run wrapper executes core crypto/file/QR tests, relay health checks, and
browser UI smoke checks. The standalone core layer can be run with
`docker compose -f tests/lab/docker-compose.yml run --rm core`.

Set `KANT_SKIP_UI=1` for a protocol-only run. Run UI tests separately with
`docker compose ... run --rm runner pnpm --dir tests/lab test:ui`.
Artifacts are written to `tests/lab/artifacts`. Keep only the latest five runs and remove the named Compose project when finished:

```sh
docker compose -f tests/lab/docker-compose.yml down --remove-orphans
```

The lab never uses production identity data or relay seeds. Do not publish its ports to the Internet.
