# Kant Core Completion Plan - Double Ratchet Implementation

## Status: Pending Implementation (Awaiting User Confirmation)

### 1. Fix syntax and imports (Critical - unblocks dev server)
- [x] `packages/core/src/ratchet.ts`: Fix import to './sodium', remove broken `const get`, add types.\n- [x] `packages/core/src/identity.ts`: Change import './sodium.js' → './sodium'.\n- [x] Fix vite.config.ts libsodium exclude to unblock dev server.

### 2. Implement Ratchet primitives in ratchet.ts\n - [x] X25519 keygen, ed25519ToX25519.\n - [x] X3DH: x3dhSend/public bundle → shared secret; x3dhReceive/private bundle.\n - [x] Ratchet state init: sender/receiver.\n - [x] ratchetEncrypt/decrypt with DH ratcheting, header (pubkeys), ChaChaPoly.

### 3. Update exports and types\n - [x] Ensure index.ts exports work.\n - [x] Define types: RatchetState, EncryptedMessage, etc.

### 4. Test & Verify\n - [x] pnpm build && pnpm --filter @kant/app dev.\n - [x] Add ratchet.test.ts with X3DH + ratchet roundtrip.

### 5. Stretch
- [ ] Integrate with messages.ts for E2E ratcheted encryption.

*Next: User approval → execute step-by-step, update TODO on completion.*
