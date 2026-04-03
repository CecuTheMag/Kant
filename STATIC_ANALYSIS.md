# Kant Static Analysis Report

## ratchet.ts
✅ Double Ratchet correct:
- KDF chain derivation with crypto_kdf_derive_from_key
- DH ratchet advances root/sending chains on new pubkey
- XSalsa20-Poly1305 (xchacha20poly1305_ietf_encrypt) with nonce
- X3DH shared secret: Sender DH1(ephem*IK), DH2(ephem*SPK), DH3(IK*IK); Receiver DH3(IK*ephem), DH4(SPK*ephem) - symmetric

## contacts.ts
✅ addContact validates /^[0-9a-fA-F]{64}$/ regex (32-byte hex)
- No double-hexing bug
- QR kant|nickname parse good
- IndexedDB persist

## messages.ts
✅ encryptText/decryptText: secretbox (XSalsa20-Poly1305) nonce prefixed
- deriveMessageKey from privKey.slice(0,32) KDF
- MessageStatus exported as type

## queue.ts
✅ enqueue/dequeue IndexedDB
- startQueueRetry libp2p peer:connect handler returns cleanup

## discovery.ts
✅ startDiscovery peer:connect + peerStore circuit filter, returns cleanup
- getKnownPeers filters /p2p-circuit addrs

**No major bugs. Minor: any types in libp2p handlers.**

