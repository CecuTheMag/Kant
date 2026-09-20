# Kant Push Proxy

This service is the enterprise-safe Android push gateway for Kant. It is fully open source and can be self-hosted by any operator.

## Purpose

Relays never hold Firebase credentials. They only call this service with a wake request when a peer is offline.

This service is the single place that knows:
- Firebase project configuration
- the Firebase service account JSON
- the device token mapping for each identity key

It never stores message content. It only wakes the app so it can reconnect and fetch the real encrypted payload over libp2p.

## Security model

- Firebase credentials live only on the proxy host
- relay operators need only `PUSH_PROXY_URL` and `PUSH_PROXY_SECRET`
- wake requests are authenticated with a bearer token when `PUSH_PROXY_SECRET` is configured
- token storage is persisted atomically with mode `0600` when `PUSH_PROXY_DATA_FILE` is set
- no payload data is sent through the FCM wake event

## Environment variables

Required:

```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

Optional:

```bash
PUSH_PROXY_PORT=4001
PUSH_PROXY_BIND=0.0.0.0
PUSH_PROXY_SECRET=super-long-random-secret
PUSH_PROXY_DATA_FILE=/data/tokens.json
LOG_LEVEL=info
```

## Endpoints

### `GET /healthz`
Returns service health and token count.

### `POST /register`
Body:

```json
{
  "identityKeyHex": "...",
  "token": "..."
}
```

### `DELETE /register`
Body:

```json
{
  "identityKeyHex": "..."
}
```

### `POST /wake`
Body:

```json
{
  "identityKeyHex": "..."
}
```

If the identity key has a stored FCM token, the proxy sends the empty `type: "wake"` payload to Firebase using the project credentials.

## Deployment

This service can be run on your own infrastructure with Docker or Node directly.

### Docker

```bash
docker build -t kant-push-proxy -f packages/push-proxy/Dockerfile .
docker run --rm -p 4001:4001 \
  -v kant-push-data:/data \
  -e FIREBASE_PROJECT_ID=... \
  -e FIREBASE_SERVICE_ACCOUNT_JSON='...' \
  -e PUSH_PROXY_SECRET=... \
  -e PUSH_PROXY_DATA_FILE=/data/tokens.json \
  kant-push-proxy
```

## Enterprise note

For larger deployments, replace the local JSON file with Redis or a database-backed token registry. Enforce TLS, firewalling, and secret rotation policies.
