FROM --platform=$BUILDPLATFORM node:22-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared-types/ ./packages/shared-types/
COPY services/backend/package.json ./services/backend/
RUN pnpm install --frozen-lockfile
COPY services/backend/ ./services/backend/
WORKDIR /app/services/backend
RUN pnpm build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/services/backend/package.json ./services/backend/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/services/backend/dist ./services/backend/dist
COPY --from=builder /app/services/backend/src/db/migrations ./services/backend/dist/db/migrations
WORKDIR /app/services/backend
USER node
EXPOSE 3002
CMD ["node", "dist/index.js"]
