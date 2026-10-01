# Contributing to Kant

Thanks for wanting to help. Bug reports, fixes, docs and relay operating
experience are all useful. Bigger changes go better if you talk to us first on
[Discord](https://discord.gg/kdn2tAPtRX) or in an issue.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and ideas

- **Security problems:** never in a public issue. Follow [SECURITY.md](SECURITY.md).
- **Bugs:** open an issue with the bug report template. Say which part is
  affected (Android, desktop, web, CLI, relay), the version, and how to
  reproduce it.
- **Questions:** ask in [Discussions](https://github.com/CecuTheMag/Kant/discussions)
  rather than opening an issue.
- **Feature ideas:** start a thread in [Discussions](https://github.com/CecuTheMag/Kant/discussions/categories/ideas)
  or on Discord. Once an idea is concrete, open an issue with the feature
  request template.

## Development setup

You need Node 22 and pnpm (the repo pins its version; `npx pnpm` works).

```bash
npx pnpm install
pnpm run typecheck
```

Run the web app with `pnpm run dev`. It needs a relay; start one with
`pnpm --dir packages/relay dev`. See the [README](README.md#local-development)
for more.

## Before you open a pull request

Run the checks for the parts you touched. CI runs the same ones:

| Area | Command |
| --- | --- |
| Whole repo types | `pnpm run typecheck` |
| Crypto and protocol (`packages/core`) | `pnpm --dir packages/core test` |
| App logic (`packages/app`) | `pnpm --dir packages/app test` |
| Relay (`packages/relay`) | `pnpm --dir packages/relay test` |
| Website (`packages/site`) | `npx tsc --noEmit -p packages/site` |

Add or update tests next to the code you change (`foo.ts` → `foo.test.ts`).

## Ground rules for changes

- **The relay never sees plaintext.** Any change that would let the relay read,
  store or infer message content is a regression, not a feature.
- **Crypto changes need extra care.** Read
  [docs/security/threat-model.md](docs/security/threat-model.md) first, and
  explain the reasoning in the pull request.
- **Stay compatible with older peers.** New message features are advertised as
  capabilities, so peers that don't support them keep working. Don't add
  content fields to the outer wire format; they belong inside the encrypted
  envelope.
- Keep pull requests focused: one fix or feature per pull request.
- Match the style of the code around you.

## Licensing

Kant is licensed under the [GNU AGPL-3.0](LICENSE), except `packages/admin`,
which has its own licence. By submitting a contribution you agree that it is
licensed under the AGPL-3.0, and that you have the right to submit it.
