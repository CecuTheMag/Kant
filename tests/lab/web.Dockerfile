FROM node:20-bookworm AS build
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json .npmrc ./
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @kant/app build

FROM nginx:1.27-alpine
COPY --from=build /workspace/packages/app/dist /usr/share/nginx/html
EXPOSE 80
