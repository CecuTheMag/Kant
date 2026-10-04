# Releasing Kant

A release has two independent parts: the **clients** (Android, Linux, Windows),
built by the release workflow, and the **relay**, deployed to your server.
Clients and relays stay wire-compatible across minor versions, so they don't
have to ship together.

## One-time repository setup

Settings → Secrets and variables → Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `KANT_DEFAULT_RELAY` | The relay baked into release builds, e.g. `https://relay.example.com`. Check `<url>/healthz` answers first. |
| Secret | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 packages/app/android/keystore/kant-release.keystore` |
| Secret | `ANDROID_KEYSTORE_PASSWORD` | `storePassword` from `kant-release.keystore.properties` |
| Secret | `ANDROID_KEY_PASSWORD` | `keyPassword` from the same file |
| Secret | `GOOGLE_SERVICES_JSON` | Optional. Firebase config for push notifications; without it the APK builds without push, as local builds do. |

The keystore is the only copy of the Android signing key that existing installs
trust (certificate SHA-256 `1106d101…faee9`). Keep an offline backup — losing it
means nobody can update in place again. The workflow refuses to publish an APK
signed with any other certificate.

## Before tagging

All of these on the commit you are about to tag:

1. CI is green ([`ci.yml`](../../.github/workflows/ci.yml): core, federation, app, relay, site, CLI/push-proxy/admin/desktop builds, `pnpm audit --prod --audit-level high`).
2. The Docker lab passes, including the browser suites:
   ```bash
   docker compose -f tests/lab/docker-compose.yml build
   tests/lab/scripts/profile-up.sh lan
   docker compose -f tests/lab/docker-compose.yml run --rm core
   docker compose -f tests/lab/docker-compose.yml run --rm runner pnpm --dir tests/lab test
   docker compose -f tests/lab/docker-compose.yml run --rm runner pnpm --dir tests/lab test:ui
   docker compose -f tests/lab/docker-compose.yml down --remove-orphans
   ```
3. For changes to messaging or networking: `pnpm run test:reconnect` (about 8 minutes; `KANT_FEDERATE=1` for linked relays). It and the app builds share `packages/app/dist`, so don't build while it runs.
4. Versions bumped together: `packages/app/package.json`, `packages/desktop/package.json`, and `versionCode` (+1) / `versionName` in `packages/app/android/app/build.gradle`. The workflow fails if they differ from each other or from the tag.
5. Release notes written to `release-notes/<version>.md` — they become the release description.

## Tag and build

```bash
git tag -a 0.5.0-beta -m "Kant 0.5.0 (Beta)"
git push origin 0.5.0-beta
```

The tag format is `X.Y.Z-beta` (no `v`): the website's download links use it.

[`release.yml`](../../.github/workflows/release.yml) then:

1. runs every CI check again on the tagged commit;
2. checks the tag and all three version numbers agree;
3. builds the signed APK and verifies its signing certificate;
4. builds the Linux AppImage and the Windows installer and portable exe, and **launches each one** — it has to start, its bundled relay has to answer `/healthz`, and the window has to render the app ([`packages/desktop/scripts/smoke.mjs`](../../packages/desktop/scripts/smoke.mjs));
5. creates a **draft** prerelease with all files and `SHA256SUMS.txt`.

To build and smoke-test without releasing, run the workflow by hand from the Actions tab; the files are attached to the run as artifacts.

Never move or reuse a published tag. If something is wrong, fix it and tag the next patch version.

## Publish

1. Download the draft's APK and AppImage and try them: install over the previous version, unlock, send a message both ways.
2. Copy the sizes (decimal MB) and SHA-256s from `SHA256SUMS.txt` into the `RELEASE` block of `packages/site/src/lib/config.ts`, along with the version and date, and deploy the site.
3. Publish the draft.

## Relay deployment

Deploy relay changes with [`relay-deployment.md`](relay-deployment.md). Record the previous Git ref and the relay's PeerID before deploying; the PeerID must not change unless you rotated the seed on purpose.

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
