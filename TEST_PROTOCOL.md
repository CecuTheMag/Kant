# Kant Phase 1 Manual Test Protocol

## Setup
1. Terminal 1: `cd packages/relay && node dist/index.js` (start relay server)
2. Terminal 2: `cd packages/app && pnpm dev` (or `npx vite`) open http://localhost:5173

## Tests
1. **Identity** (Tab1): Create identity → password \"test1234\" → copy hex pubkey
2. **Identity2** (Tab2): Create different identity → password \"test12345\"
3. **QR**: Tab1 generate QR, Tab2 scan QR → contact added
4. **Manual add**: Tab2 add hex pubkey from Tab1
5. **Auto-connect**: Click "🚀 Start & Connect Relay" → verify "Relay peer ID discovered", "Circuit ready", circuit addr appears (no WS server error)
6. **Handshake**: Send 20+ encrypted messages → verify decrypt
7. **Persistence**: Close Tab2, reopen same password → messages persist decrypted
8. **Offline queue**: Tab2 offline, Tab1 send → queue → reconnect → flush/delivered
9. **Receipts**: Verify sent → delivered status updates

## Verify
- No "WebSocket Servers can not be created" error
- Auto relay discovery + circuit addr automatic
- No manual relay input needed
- 2 tabs discover each other via relay
- No plain text leaks console/network
- Reconnects maintain ratchet state
- QR/hex add works bidirectional

**Success = full encrypted chat via relay.**

