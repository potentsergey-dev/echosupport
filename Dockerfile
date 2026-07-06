# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/widget/package.json apps/widget/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @echosupport/backend db:generate
RUN pnpm build:prod

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /app/apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY --from=builder /app/apps/backend/public ./apps/backend/public
COPY --from=builder /app/apps/admin/dist ./apps/admin/dist
COPY docker/backend-entrypoint.sh /usr/local/bin/echosupport-entrypoint

RUN chmod +x /usr/local/bin/echosupport-entrypoint \
  && mkdir -p /app/apps/backend/uploads

WORKDIR /app/apps/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/ready >/dev/null || exit 1

ENTRYPOINT ["echosupport-entrypoint"]
