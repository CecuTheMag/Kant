FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY tests/lab/package.json tests/lab/package.json
COPY tests/lab ./tests/lab
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @kant/core build
CMD ["pnpm", "--dir", "tests/lab", "test"]
