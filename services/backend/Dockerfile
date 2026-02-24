FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
COPY packages/shared-types/ ./packages/shared-types/
COPY services/backend/package.json ./services/backend/
RUN pnpm install --frozen-lockfile
COPY services/backend/ ./services/backend/
WORKDIR /app/services/backend
RUN pnpm build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/services/backend/dist ./dist
COPY --from=builder /app/services/backend/package.json ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3002
CMD ["node", "dist/index.js"]
