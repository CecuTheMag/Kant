# Merge, Release, Canary, and Rollback

## Required merge gates

Protect `main` and require these CI jobs:

- `Lockfile Check`
- `Security Audit`
- `Build and Test`
- `Lab Tests (Playwright)`
- `E2E Tests (Gated)`

Require an up-to-date branch, one review, resolved conversations, and no administrator bypass. Direct pushes to `main` are not a release path.

## Release evidence

A release candidate is eligible only when all of the following artifacts refer to the same commit:

- Core unit and coverage output
- Full Playwright E2E artifacts
- Relay health/readiness/metrics smoke output
- Group restart/churn output
- 1 MiB file-transfer SHA-256 integrity output
- A successful N>=100 load run from the previous 24 hours
- `pnpm audit --prod --audit-level=high` with no high/critical findings
- Dependency compatibility matrix reviewed for any libp2p change
- External security review current for the release's scope; this is an external gate and cannot be self-certified

## Candidate creation

```bash
git checkout main
git pull --ff-only
git tag -s vX.Y.Z-rc.N -m "Kant vX.Y.Z release candidate N"
git push origin vX.Y.Z-rc.N
```

Never rebuild a published tag with different bytes. Create a new candidate.

## Staging deployment

Use `.github/workflows/staging-canary.yml` with the signed candidate tag. The workflow:

1. Resolves the tag to a commit.
2. Backs up the staging relay seed and current Git ref.
3. Checks out the candidate.
4. Rebuilds and starts the relay/web stack.
5. Gates on `/healthz`, `/readyz`, and `/metrics`.
6. Runs lab smoke and E2E tests.
7. Automatically restores the previous ref if deployment or smoke verification fails.

Staging must use its own domain, TLS certificates, registry, and relay seed. It must otherwise mirror production limits and configuration.

## Canary

- Advertise the staging-tested canary relay to at most 5% of opted-in clients.
- Keep the stable relay available; do not rotate its seed during a software canary.
- Observe for at least 60 minutes and at least 100 successful client sessions.
- Promote only when all alert rates remain below the thresholds in `monitoring.md`.

Immediate rollback triggers:

- readiness false for 2 minutes
- `NO_RESERVATION` above 50/min for 5 minutes
- circuit error rate above 10/min for 5 minutes
- any file hash mismatch
- OPK burn failures above 5/min for 5 minutes
- registry utilization above 95%

## Production promotion

Promote the exact candidate commit/image tested in staging. Record:

- signed tag and immutable image digest
- CI and load-test artifact URLs
- previous production ref/image digest
- deploy start/end UTC timestamps
- relay PeerID before and after deployment (must match unless rotation was explicitly approved)

## Rollback

Software rollback must preserve the current relay seed:

```bash
PREVIOUS_REF=<recorded-previous-ref>
git checkout "$PREVIOUS_REF"
docker compose -f docker-compose.https.yml build relay
docker compose -f docker-compose.https.yml up -d relay
curl -fsS https://relay.example.com/healthz
curl -fsS https://relay.example.com/readyz
curl -fsS https://relay.example.com/relay-info | jq -r '.peerId'
```

Restore a seed only for identity loss/corruption, using `backup-recovery.md`. Do not combine seed restoration and software rollback unless both are independently required.

## Post-release monitoring

For the first hour:

- watch readiness, reservations, peers, registry size, NO_RESERVATION, circuit errors, OPK burn failures, CPU, memory, and event-loop lag
- run an encrypted bidirectional message smoke every 5 minutes
- run one 1 MiB attachment integrity smoke at 5, 30, and 60 minutes
- retain deployment, relay, E2E, and Prometheus artifacts for at least 30 days

Close the release only after the one-hour checklist is clean.
