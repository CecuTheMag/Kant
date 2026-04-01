# Kant Phase 1 Implementation TODO

## Completed
1. Explored codebase with search_files/read_file
2. Created plan and got user approval

## In Progress / Pending
3. Add dependencies: `pnpm add qrcode @types/qrcode --filter @kant/core && pnpm add qrcode.react @types/qrcode__react --filter @kant/app && pnpm install`
4. Update `packages/core/src/identity.ts`: Set DB_VERSION=2, add `onupgradeneeded` for new stores `'contacts'`, `'messages'` (objectStore with keyPath 'publicKeyHex')
5. Create `packages/core/src/contacts.ts`: Contact interface, DB helpers (add/get/delete), generateQR(pubKeyHex:nickname), parseQR(qrData:string)
6. Create `packages/core/src/messages.ts`: Message/Conversation interfaces, deriveMessageKey(identityPriv), encrypt/decrypt text, save/getConversation(s), delete
7. Update `packages/core/src/index.ts`: `export * from './contacts.js'; export * from './messages.js';` Add receipt handler to createNode (`/kant/receipt/1.0.0`), sendReceipt helper, update sendPing for multi-protocol/multi-msg
8. Update `packages/core/package.json`, `packages/app/package.json` (post-pnpm deps)
9. Major refactor `packages/app/src/App.tsx`: Add state (contacts[], selectedContact?, conversations:Record<string,Message[]>, statuses), load on unlock, sidebar: contacts list + add/QR/share/delete, chat per-contact (load ratchet? derive sender from addr), persist on send/recv, status icons (⏳✓✓✓👁), QR scanner (file input + canvas?)
10. Test: `pnpm --filter @kant/app dev` — verify unlock→add contact→QR→chat→persist→receipts
11. Update README.md: Add Phase 1 testing guide (2 tabs: add contacts, chat, check IndexedDB)
12. `attempt_completion` with demo command `pnpm --filter @kant/app dev`

