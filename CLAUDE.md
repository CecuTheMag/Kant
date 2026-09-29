# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kant is a serverless, end-to-end encrypted P2P messenger built on libp2p + libsodium. There is no central message store: peers connect directly (or via a stateless circuit-relay v2 bootstrap node when NAT/firewalls block direct dialing). The relay only ever sees encrypted noise packets and signed registry records — never plaintext.

pnpm monorepo, workspaces defined in `pnpm-workspace.yaml` (`packages/*` + `tests/lab`).

## Commands

Install (from repo root):
```bash
npx pnpm install
```

Typecheck (root `tsc --noEmit` over the `packages/**` tree, per `tsconfig.json` `paths` mapping `@kant/*` → `packages/*/src`; `packages/site` is excluded: it is a Next.js app with its own `@/` alias and global types, checked by `npx tsc --noEmit -p packages/site`):
```bash
pnpm run typecheck   # == pnpm run lint
```

Run the app in dev (Vite dev server only — relay must be started separately, see below):
```bash
pnpm run dev
# or: ./start.sh [--relay <url>] [--port <port>]
```

Build the web app:
```bash
pnpm run build
```

### Per-package builds/dev
Most packages are plain `tsc` builds; run from repo root with `pnpm --dir packages/<name> <script>` or `cd` into the package:
- `packages/core` — `pnpm run build` / `build:test` (see tests below)
- `packages/relay` — `pnpm run build`, `pnpm run dev` (runs TS directly via `ts-node/esm`), `pnpm run start` (runs compiled `dist/`)
- `packages/app` — `pnpm run dev`, `pnpm run build` (`tsc && vite build`), `pnpm run build:electron`, `pnpm run build:android[:debug]`
- `packages/cli` — `pnpm run build`, `pnpm run start`
- `packages/push-proxy` — `pnpm run build`, `pnpm run dev`, `pnpm run start`
- `packages/desktop` — Electron packaging; `pnpm run dev` runs the app + electron concurrently; `pnpm run build:*` variants bundle a `relay-runtime` deploy of `@kant/relay` plus the built app
- `packages/admin` — placeholder, not an active product surface

### Core package tests
`packages/core` has its own Node test suite (no framework — `node --test` + a libsodium loader shim). From `packages/core`:
```bash
pnpm test              # build, build:test, then run keypair/x3dh/groups/files tests
pnpm test:coverage      # same, with node --experimental-test-coverage and coverage thresholds
```
To run a single compiled test file directly (after `pnpm run build && pnpm run build:test`):
```bash
node --loader ./sodium-loader.mjs --import ./sodium-loader.mjs --test ./dist-test/groups.test.js
```
Test sources are colocated as `*.test.ts` next to the module under test (e.g. `groups.ts` / `groups.test.ts`) and compiled via `tsconfig.test.json` into `dist-test/`.

### App unit tests
`packages/app` runs pure-logic tests (`src/**/*.test.ts`) with Node's built-in TypeScript support and `node --test` — no build step. `test/ts-resolve.mjs` lets the extension-less sibling imports Vite uses resolve under Node, so test-covered modules must stay free of DOM/Capacitor imports (see `src/ui/preview/`). From `packages/app`:
```bash
pnpm test
```

### Relay tests
`packages/relay`: `pnpm test` (unit tests for federation parsing, tokens, tunnel splice, wire-safe limits). Two-relay federation end-to-end (real relay processes + real libp2p nodes): `pnpm --dir packages/core test:federation`.

### Root-level lab / E2E tests
`tests/lab` is a disposable Docker-based lab (protocol, relay, network, browser UI, desktop smoke tests) — **not** run locally by default, designed to run on a dedicated test node:
```bash
pnpm run test:lab            # pnpm --dir tests/lab test (Playwright)
pnpm run test:lab:ui         # Playwright UI mode
pnpm run test:lab:preflight  # bash tests/lab/scripts/preflight.sh
```
See `tests/lab/README.md` for the Docker-compose based workflow (`tests/lab/scripts/run.sh lan|nat`). The lab never uses production identity/relay data and its ports must not be exposed to the Internet.

## Architecture

### Packages
| Package | Role |
| --- | --- |
| `packages/core` (`@kant/core`) | All crypto and protocol logic: identity, X3DH handshake + double-ratchet, group messaging, file transfer, onion routing, prekeys, contacts, IndexedDB-backed message/queue storage, Tor SOCKS5 transport, licensing. This is the shared library consumed by app/cli/desktop. |
| `packages/relay` (`@kant/relay`) | Stateless libp2p circuit-relay-v2 bootstrap node. Plain Node `http` server (no framework) exposing `/relay-info`, `/healthz`, `/readyz`, `/metrics` (Prometheus via `prom-client`), `/register`, `/lookup`, `/admin/*` (bearer-token gated), `/push/*`. Deterministic relay identity derived from a seed so its multiaddr is stable across restarts. |
| `packages/app` (`@kant/app`) | React 18 + Vite web client. Also the base for the Electron desktop build (`build:electron`) and Capacitor Android build (`build:android`). |
| `packages/desktop` | Electron shell wrapping `packages/app`'s build output plus a bundled `relay-runtime` (a `pnpm deploy` of `@kant/relay`), and an MCP/AI server (`ai-server.ts`, `mcp-server.ts`). |
| `packages/cli` (`@kant/cli`) | Terminal client (`blessed`-based TUI) using `@kant/core` directly, with an IndexedDB shim (`idb-shim.ts`) since there's no browser. |
| `packages/push-proxy` | Small service holding Firebase credentials; relays wake-up push pings from relay operators without giving relays access to Firebase creds directly. |
| `packages/admin` | Placeholder — part of the paid "corporate bundle" per the licensing model, not implemented in the free/community build. |

### Networking model (core)
- `createNode()` in `packages/core/src/index.ts` builds a libp2p node (WebSockets transport, noise encryption, yamux muxing, circuit-relay-v2 transport) with a deterministic Ed25519 keypair derived from the user's identity seed, so PeerID/circuit address are stable across restarts.
- Peers register their circuit address with the relay's `/register` endpoint (signed with the identity key) and discover each other via `/lookup`. The relay is a rendezvous/relay point only — never a message store.
- Direct peer messaging uses a custom length-prefixed framing protocol over two libp2p protocols: `PING_PROTOCOL` (`/kant/ping/1.0.0`, encrypted payloads/group messages) and `RECEIPT_PROTOCOL` (`/kant/receipt/1.0.0`, delivery/read receipts). Frames are unidirectional — the sender closes the write side rather than expecting a reply.
- `transportManager.faultTolerance = NO_FATAL` is deliberate: circuit-relay reservation handshakes are intermittently flaky, and letting a single failed reservation abort startup would drop the whole node to "Offline"; the reservation store keeps retrying in the background instead.
- Group messaging, file transfer (chunked, encrypted, resumable), and onion routing (`onion.ts`, cover traffic via `COVER_TYPE`) are each separate protocols/handlers registered on the same node, all exported from `packages/core/src/index.ts`.
- DM and group payloads carry structured content (reply quotes, edits) in the content envelope (`packages/core/src/envelope.ts`) *inside* the encryption. Never add content fields to the outer wire JSON. DMs only send the envelope to peers that advertised `content-envelope-1` in `kant-presence` (`caps`, persisted on the contact); older peers get the text without the quote. Edits (`edit: { id }`) need `message-edit-1`; older peers get the correction as a new message prefixed with ✎. DM edits rewrite the stored message (`editStoredMessage`); group edits are stored as their own rows and folded onto the target when a group loads (`rowsToThread` in `useGroups.ts`). Reactions (`react: { id, emoji }`, `message-react-1`) and delete for everyone (`del: { id }`, `message-delete-1`) are sent only to peers advertising them. DM changes (edit/react/delete) go out as control messages via `sendControl` in `useKant.ts` and are recorded on the target as `unsynced` until the peer's receipt (`markOpSynced`), so `reclaimUnacked` can re-send them — like unacknowledged text — after a session reset. Deletion tombstones the message and scrubs quotes of it (`deleteStoredMessage`; groups: `purgeGroupMessage`, which also drops the edit/reaction rows that carry its content and remembers deletions that arrive before the message). Reactions are encrypted at rest like text.
- Voice notes are ordinary file transfers whose FILE_META carries `voice: { durationMs, waveform }`; group files carry `groupId` so the receiver's file handler (in `useKant`) hands them to `useGroups.handleIncomingFile` instead of the sender's DM. Group file messages are persisted with `saveGroupFileRecord`.
- All core logging goes through `clog()` / `setCoreLogger()` so the app can surface low-level transport events (dial retries, onion forwarding, inbound frames) in its in-app `DebugLog` component, not just the browser devtools console.

### App layer (`packages/app`)
- `useKant.ts` (`packages/app/src/hooks/useKant.ts`) is the central state hook — screen/navigation state, node lifecycle, contacts, per-contact message threads, unread counts — and is the main integration point between the UI and `@kant/core`. It's large; when touching messaging/contact/group flows, start there.
- `App.tsx` routes between onboarding (`ui/Onboarding.tsx`: welcome + terms → network step only when no `VITE_RELAY_URL` was baked in → create password), unlock, and the signed-in app (`ui/KantApp.tsx`).
- All screens live in `src/ui/` (Apple-style design system in `ui/kant.css`, light/dark following the OS). The UI talks only to the `Store` interface in `ui/core/store.tsx`; `ui/core/realkant.tsx` implements it on top of `useKant` + `useGroups`. Add new backend capabilities there rather than calling the hooks from components.
- Contacts created by an inbound message from an unknown sender are flagged `request` (shown as message requests); `blocked` contacts have their messages dropped on arrival (see `hideFromUser` in `useKant.ts`).
- Voice: recording UI and gestures in `ui/VoiceComposer.tsx` (MediaRecorder wrapper in `ui/voice/recorder.ts`), the in-thread player in `ui/VoiceNote.tsx`; pure helpers in `ui/voice/waveform.ts` are unit-tested. Android needs `RECORD_AUDIO` (Capacitor's WebChromeClient forwards the WebView prompt); macOS needs `NSMicrophoneUsageDescription` (desktop `package.json`).
- Editing tables/text files and creating new ones: `ui/FileEditor.tsx` (model and CSV writer in `ui/preview/tableEdit.ts`). The edited copy is sent as a new attachment, keeping the original's line endings and BOM; the original message is never changed.
- File preview (`ui/FilePreview.tsx`, pure parsers in `ui/preview/`) renders attachments in-app; "Open with…" and external links go through `lib/fileActions.ts`, which detects the native `KantFiles` plugin by availability, not platform. That file documents the plugin contract an iOS implementation must satisfy (Android: `KantFilesPlugin.java`).
- Chat formatting (inert Markdown via `ui/preview/markdown.ts`, `breaks: true`), swipe to reply, double-tap / long-press reactions and the composer formatting bar live in `ui/chat/` (pure logic in `chatLogic.ts`, unit-tested); their toggles are device-local `ui/chat/prefs.ts` (Settings → Chats).
- Unlock security: `unlock()` in `useKant.ts` uses `unlockIdentityChecked` (core) to tell the password from the duress password (`duressReset` wipes via `eraseAllLocalData` and creates a fresh identity); fingerprint unlock is `lib/biometric.ts` (native `KantBiometric` plugin, contract documented there; Android `KantBiometricPlugin.java`) gated by the pure `lib/securityPolicy.ts` (restart / age / failure rules, auto-lock timing). Locking = `lock()`: stop networking and reload, so no key survives in memory.
- Backup file and moving to a new phone: `packages/core/src/bundle.ts` (sealed export/restore of every store; backups exclude sessions) and `packages/core/src/transfer.ts` (QR + SAS device-to-device move over `/kant/transfer/1.0.0`, old device erased after). App side: `createBackup` / `restoreBackup` / `receiveMove` / `sendMove` in `useKant.ts`, screens in `ui/TransferSheets.tsx` and `ui/Onboarding.tsx` (`MoveInScreen`, `RestoreScreen`).
- Relay URL resolution: `VITE_RELAY_URL` (preferred) or legacy `VITE_RELAY_HTTP_PORT`, see `packages/app/.env.example`.

### Licensing / feature gating
`packages/core/src/license.ts` defines `COMMUNITY_FEATURES` / `PROFESSIONAL_FEATURES` / `ENTERPRISE_FEATURES` and gating helpers (`isFeatureAvailable`, `getLicenseTier`, etc.). The repo is open core: everything except `packages/admin` is `AGPL-3.0-only` (root `LICENSE`); `packages/admin` (the paid "corporate bundle": admin, governance, audit tooling) is under the Kant Dual-Use Licence in `packages/admin/LICENSE` and is intentionally a placeholder here. Since core is AGPL, these gates are a product boundary, not a legal one.

## Deployment
Two deployment patterns, both centered on `packages/relay` sitting behind a TLS terminator (Caddy config at repo root: `Caddyfile`, `Dockerfile.caddy`):
- `docker-compose.https.yml` — public relay behind TLS
- `docker-compose.http.yml` — local/LAN relay over plain HTTP
- `docker-compose.push-proxy.yml` — the push-proxy service

Runtime env vars for the relay (`packages/relay/src/index.ts`): `RELAY_PORT`, `RELAY_PUBLIC_PORT`, `RELAY_INFO_PORT`, `RELAY_PUBLIC_HOST`, `RELAY_HTTP_BIND`, `RELAY_DATA_DIR`, `RELAY_SECURE`, `RELAY_LAB_CONTROL_TOKEN`, `RELAY_FEDERATION` (peer relays, `<url>#<peerId>`), `RELAY_FEDERATION_MAX_TUNNELS[_PER_CLIENT]`, `RELAY_FEDERATION_TUNNEL_ADDR`, `RELAY_INFO_PUBLIC_PORT`. Relay federation (user1 → relay1 → relay2 → user2 through an encrypted tunnel) is `packages/relay/src/federation*.ts` + `packages/core/src/federation.ts`; `pnpm --dir packages/core test:federation` runs it end to end with two real relays. Keep the circuit data limit out of [2^31, 2^32) — see `packages/relay/src/limits.ts`. `/lookup` answers from the local registry while an entry is fresh (clients re-register every 10 s); a stale entry, or one whose device holds no reservation here, is checked against peer relays and the most recently refreshed registration wins (`pickRegistration` in `packages/relay/src/federation.ts`) — this is what keeps an identity reachable after it moves between relays (device move, changed relay). Operational runbooks live under `docs/runbooks/` (deploy, monitoring, incident response, backup/recovery, secrets rotation, release process).

## Security-sensitive context
- `docs/security/threat-model.md` and `docs/security/privacy-data-policy.md` describe the security posture; read these before changing crypto, relay trust boundaries, or data-retention behavior.
- The relay is explicitly designed to never hold plaintext or persistent message data — treat any change that would let it retain/observe message content as a regression against the core design goal, not just a feature.
