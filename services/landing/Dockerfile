FROM --platform=$BUILDPLATFORM node:22-slim AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/landing/package.json ./services/landing/
RUN pnpm install --frozen-lockfile

COPY services/landing/ ./services/landing/
WORKDIR /app/services/landing
RUN pnpm build

FROM caddy:2-alpine
COPY --from=builder /app/services/landing/dist /srv
COPY services/landing/Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
