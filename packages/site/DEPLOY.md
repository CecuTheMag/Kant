# Deploying to Vercel

This package lives inside the `kant-monorepo` pnpm workspace, so the Vercel
project needs to know where it is.

## First-time setup (Vercel dashboard)

1. **New Project** → import this repository.
2. **Root Directory** → set to `packages/site`. Vercel will still clone the
   whole repo and detect the pnpm workspace automatically; this just tells
   it which package to build and serve.
3. Framework preset should auto-detect as **Next.js** — leave install/build
   commands on their defaults (`vercel.json` in this folder already pins
   them to run from the workspace root via pnpm).
4. **Environment variables** — none are required for the current build; add
   any here if that changes later.
5. **Domains** → add `kant.network` (and `www.kant.network` if you want the
   redirect), then point your DNS at Vercel per its instructions.

## Before going live

Two placeholders in [`src/lib/config.ts`](src/lib/config.ts) need real
values:

```ts
discordUrl: "https://discord.gg/kant", // replace with the real invite
githubUrl: "https://github.com/kant-project/kant", // replace with the real repo
```

Everything else on the site reads from that one file.

## Local build check

```bash
cd packages/site
pnpm run build
pnpm run start
```
