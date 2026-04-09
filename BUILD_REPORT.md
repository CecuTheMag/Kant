# BUILD_REPORT — Multi-Instance Support

## Changes Made

| File | Change |
|------|--------|
| `start.sh` | Accepts `INSTANCE` arg; calculates `RELAY_PORT`, `RELAY_INFO_PORT`, `APP_PORT` from it; passes ports via env to relay and Vite |
| `packages/relay/src/index.ts` | Reads `RELAY_PORT` / `RELAY_INFO_PORT` from `process.env`; defaults to `3000` / `3001` |
| `packages/core/src/index.ts` | `getRelayInfo(httpPort?)` accepts optional port; falls back to `VITE_RELAY_HTTP_PORT` env var, then `3001` |
| `packages/app/vite.config.ts` | Adds `VITE_RELAY_HTTP_PORT` to `define` so it's baked into the browser bundle at build time |
| `packages/app/src/App.tsx` | `relayHttpPort` state initialised from `import.meta.env.VITE_RELAY_HTTP_PORT`; instance selector dropdown in sidebar; port passed to `getRelayInfo()` |

## Port Assignment

| Instance | Relay WS | HTTP info | App (Vite) |
|----------|----------|-----------|------------|
| 1 | 3000 | 3001 | 5173 |
| 2 | 3002 | 3003 | 5174 |
| 3 | 3004 | 3005 | 5175 |
| N | 3000+(N-1)×2 | 3001+(N-1)×2 | 5172+N |

## Test Protocol

```
# Terminal 1
./start.sh 1
# → relay on :3000, HTTP on :3001, app on http://localhost:5173

# Terminal 2
./start.sh 2
# → relay on :3002, HTTP on :3003, app on http://localhost:5174
```

**Browser 1** — http://localhost:5173
- Instance selector auto-shows "Instance 1 (relay :3000 / http :3001)"
- Click "🚀 Start & Connect" → fetches relay info from :3001 → connects

**Browser 2** — http://localhost:5174
- Instance selector auto-shows "Instance 2 (relay :3002 / http :3003)"
- Click "🚀 Start & Connect" → fetches relay info from :3003 → connects

Each browser connects to its own relay. To chat cross-instance, copy the circuit
multiaddr from Browser 1 and paste it into Browser 2's "Chat with …" prompt
(or use the discovered peers panel if both browsers connect to the same relay).

## TypeScript Check Results

- `packages/core`: ✅ no new errors
- `packages/app`: ✅ no new errors (pre-existing: test file outside rootDir)
- `packages/relay`: ✅ no new errors (pre-existing: deprecated `baseUrl` warning)

## Backward Compatibility

`./start.sh` (no argument) defaults to `INSTANCE=1`, identical behaviour to before.
