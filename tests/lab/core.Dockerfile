FROM node:20-bookworm
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json .npmrc ./
COPY packages/core ./packages/core
COPY tests/lab/tests/core.test.mjs ./tests/lab/tests/core.test.mjs
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @kant/core build
CMD ["node", "--experimental-global-webcrypto", "tests/lab/tests/core.test.mjs"]
