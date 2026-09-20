FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/relay/package.json ./packages/relay/
COPY tsconfig.json ./

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate && pnpm install --frozen-lockfile

COPY packages/relay ./packages/relay

RUN cd packages/relay && pnpm exec tsc

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/relay/package.json ./packages/relay/

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate && pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/relay/dist ./packages/relay/dist
COPY packages/relay/docker-entrypoint.sh /usr/local/bin/kant-relay-entrypoint

RUN apk add --no-cache su-exec \
    && addgroup -S relay \
    && adduser -S -G relay relay \
    && mkdir -p /data \
    && chown -R relay:relay /app /data \
    && chmod 0555 /usr/local/bin/kant-relay-entrypoint

ENTRYPOINT ["/usr/local/bin/kant-relay-entrypoint"]

ENV RELAY_PORT=3000
ENV RELAY_INFO_PORT=3001
ENV RELAY_HTTP_BIND=0.0.0.0
ENV RELAY_DATA_DIR=/data

EXPOSE 3000
EXPOSE 3001

CMD ["node", "packages/relay/dist/index.js"]
