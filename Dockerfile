# syntax=docker/dockerfile:1
#
# Multi-stage production image for the Next.js 16 App Router ERP.
# Requires next.config.ts to set `output: "standalone"`.
#
# Stage 1 deps    -> full node_modules for a deterministic, lockfile-exact install
# Stage 2 builder -> prisma generate + next build -> .next/standalone
# Stage 3 runner  -> prod-only deps + standalone output, non-root, no secrets
#
# Build:  docker compose build
# Run:    docker compose up -d

# ─── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Prisma's postinstall would try to generate before a schema is present; the
# builder stage does it explicitly instead.
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1 \
    NEXT_TELEMETRY_DISABLED=1

# Copy manifests first so the dependency layer is cached across source changes.
COPY package.json package-lock.json ./

# `npm ci` (not install) so the image always matches package-lock.json exactly.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client BEFORE `next build` so Server Components that
# import @prisma/client type-check and bundle correctly.
#
# The client must be generated from the PostgreSQL schema: the standalone server
# talks to Postgres at runtime, and the engine is chosen at generate time. The
# SQLite schema is for local development only.
RUN node scripts/make-pg-schema.mjs \
 && npx prisma generate --schema prisma/postgres/schema.prisma

RUN npm run build

# ─── Stage 3: runner ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    PRISMA_SKIP_POSTINSTALL_GENERATE=1

# Unprivileged runtime user. uid/gid 1001 keeps host bind-mount ownership
# predictable for log inspection.
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

# Production dependencies only. This is what supplies the `prisma` CLI that the
# entrypoint shells out to for `prisma migrate deploy`, plus @prisma/client.
# It is installed before the standalone tree is overlaid, so the standalone
# server's own traced node_modules simply wins on conflicts.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && npm cache clean --force

# Only the artifacts the server actually needs.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Startup script + the schema generator it depends on.
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY scripts/make-pg-schema.mjs ./scripts/make-pg-schema.mjs
RUN chmod +x ./scripts/docker-entrypoint.sh

# Standalone caches server-rendered output under .next/cache at runtime.
RUN chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+(process.env.HEALTHCHECK_PATH||'/api/health')).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
