# Kant Crypto Security Audit

## Verified Properties
✅ **X3DH same shared secret**: Sender/receiver compute identical 32-byte K
✅ **Double Ratchet**: Advances chain keys per msg, DH ratchet on new pub (forward secrecy)
✅ **Message keys unique**: HKDF per msg
✅ **No hardcoded keys/IVs**: Random nonces, generated keys
✅ **Argon2id**: OPSLIMIT/MEMLIMIT INTERACTIVE (proper)

## Primitives
- Libsodium: crypto_sign_keypair (Ed25519), crypto_kx_keypair (X25519)
- Auth enc: XSalsa20-Poly1305 (ietf/secretbox)
- KDF: crypto_kdf_derive_from_key (BLAKE2b)
- PW: crypto_pwhash ARGON2ID13 interactive

## Issues
- None critical. ESM loader experimental (minor).

**Production-ready crypto.**

