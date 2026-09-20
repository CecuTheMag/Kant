# Secrets and Rotation Runbook

This runbook covers operational secrets and rotation for the public relay deployment. It is intentionally limited to the launch-critical assets that must be protected and replaced on a schedule or after a suspected compromise.

## What counts as a secret

The deployment has a small number of security-sensitive assets:

- relay PeerID seed file
- TLS certificate material held by Caddy
- relay auth tokens for admin endpoints or operational tooling
- any deployment token or password used in Docker or orchestration
- any host-level credentials used for external log shipping or backup systems

## Required protections

### Relay seed
The relay seed file is the long-term identity of the relay. It should be treated as equivalent to a private key.

Requirements:
- file permissions must be restrictive
- the file must be encrypted in transit and at rest when moved off-host
- the file must be stored in a restricted backup location
- access must be limited to the deployer and operational owner

### TLS certificate material
Caddy stores certificate state in the data volume. This should never be exposed broadly and should be backed up if the deployment is production-critical.

Requirements:
- keep the Caddy data volume intact
- avoid copying certificate material into repositories
- rotate out stale certificate paths when changing domains or ownership

### Admin tokens
If admin endpoints are enabled, their bearer token or other auth secret must be protected with the same discipline as database credentials.

Requirements:
- store in a secret manager or protected environment file
- do not commit tokens to git
- rotate on a schedule or after a suspected leak

---

## Rotation policy

### Relay identity seed rotation
Use this only if the relay identity must be replaced.

Procedure:
1. Stop the relay service and Caddy service.
2. Back up the existing seed file.
3. Generate a new relay seed in the configured relay data directory.
4. Validate the new PeerID is the one advertised by `/relay-info`.
5. Update any public references or cached peer configuration.
6. Re-announce or re-discover the new public identity in dependent clients.
7. Keep the old seed backup only as a controlled, encrypted recovery artifact and destroy it once the new identity is confirmed.

### TLS certificate rotation
For public internet deployments, Caddy handles certificate issuance and renewal automatically if the domain is correctly configured and the service remains reachable.

Procedure:
1. Validate that the domain resolves to the host and that ports 80/443 are reachable.
2. Confirm the Caddyfile is valid and the domain matches the configured route.
3. Trigger a reload or allow automatic renewal.
4. Confirm the certificate is valid and the public relay advertises the expected hostname.

### Admin token rotation
Procedure:
1. Generate a new token.
2. Update the runtime environment or secret store.
3. Restart the impacted service with the new token.
4. Remove or revoke the old token.
5. Validate the protected admin route rejects the old token and accepts the new one.

---

## Backup and restore of secrets

### Relay seed backup
Use the procedure described in the backup runbook. Critical points:
- copy the seed file only from the live runtime path
- move it encrypted off-host
- store the backup in a restricted, access-limited location
- verify size and checksum before trusting the backup

### Caddy backup
If the deployment needs a fast restore of TLS state, back up the Caddy data volume.

### Secret manager guidance
For production deployments, prefer a secret manager or OS-level secret injection method rather than `.env` files on disk whenever possible.

---

## Verification after rotation

After any secret rotation, verify all of the following:

- relay health endpoint returns healthy status
- `relay-info` returns the expected public host and PeerID
- Caddy serves the configured domain over HTTPS successfully
- admin endpoints continue to work with the new token and reject the old one
- monitoring and alerting continue to emit the expected signals

---

## Incident response trigger

Rotate a secret immediately if:

- the host is suspected compromised
- a private key material or token is exposed in logs or config files
- the relay identity is unexpectedly changed
- the TLS certificate or Caddy data volume is lost or tampered with

---

## Minimum operational controls

These should be treated as non-optional for production:

- restricted filesystem permissions on key material
- encrypted backup for all secret material
- host-level access control for operators
- no secrets in Git history
- documented rotation schedule
- verification after every rotation
