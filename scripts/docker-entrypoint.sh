#!/bin/sh
#
# Container entrypoint: bring the schema + database up to date, then hand the
# process over to the Next.js standalone server.
#
# Ensure the executable bit is set — the image does `chmod +x` on this file at
# build time, but on a bind mount or after a fresh git checkout you may need:
#
#   chmod +x scripts/docker-entrypoint.sh
#
# `set -e` means any failed step aborts the container instead of starting a
# server against a half-migrated database.

set -e

DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-60}"
DB_WAIT_INTERVAL="${DB_WAIT_INTERVAL:-2}"

log() {
  echo "[entrypoint] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
}

fail() {
  log "FATAL: $*"
  exit 1
}

# ─── Step 1: validate required configuration ─────────────────────────────────
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. It is provided by docker-compose.yml; do not start this image without it."
log "DATABASE_URL host=$(printf '%s' "$DATABASE_URL" | sed -e 's|.*@\([^/]*\)/.*|\1|')"

# ─── Step 2: wait for PostgreSQL to accept connections ───────────────────────
# The Compose healthcheck already gates this, but a managed/external database or
# a restarted db container can still be warming up. Poll the TCP port.
wait_for_db() {
  host="db"
  port="5432"
  # Pull host/port out of DATABASE_URL so this also works against a managed
  # PostgreSQL that is not named "db".
  parsed="$(printf '%s' "$DATABASE_URL" | sed -e 's|^[a-z+]*://||' -e 's|/.*$||' -e 's|^[^@]*@||')"
  case "$parsed" in
    *:*) host="${parsed%%:*}"; port="${parsed##*:}" ;;
    *)   host="$parsed" ;;
  esac

  log "waiting for database at ${host}:${port} (timeout ${DB_WAIT_TIMEOUT}s)"
  elapsed=0
  while [ "$elapsed" -lt "$DB_WAIT_TIMEOUT" ]; do
    if node -e "
      const net = require('net');
      const s = net.connect({ host: process.argv[1], port: Number(process.argv[2]) });
      s.on('connect', () => { s.end(); process.exit(0); });
      s.on('error', () => process.exit(1));
      setTimeout(() => { s.destroy(); process.exit(1); }, 2000);
    " "$host" "$port" >/dev/null 2>&1; then
      log "database is accepting connections after ${elapsed}s"
      return 0
    fi
    sleep "$DB_WAIT_INTERVAL"
    elapsed=$((elapsed + DB_WAIT_INTERVAL))
  done

  return 1
}

wait_for_db || fail "database at ${DATABASE_URL%%@*} unreachable after ${DB_WAIT_TIMEOUT}s"

# ─── Step 3: confirm the PostgreSQL schema is in sync with the datamodel ─────
# The repository keeps prisma/schema.prisma on SQLite so local development needs
# no Docker, and a generated PostgreSQL copy under prisma/postgres/. Production
# always targets the generated copy: the committed prisma/migrations are SQLite
# DDL (AUTOINCREMENT / PRAGMA) that PostgreSQL cannot execute.
PG_SCHEMA="prisma/postgres/schema.prisma"
[ -f "$PG_SCHEMA" ] || fail "missing $PG_SCHEMA — run: node scripts/make-pg-schema.mjs"
log "using PostgreSQL schema at ${PG_SCHEMA}"

# ─── Step 4: apply migrations ───────────────────────────────────────────────
# `migrate deploy` is the production-safe form: applies only pending migrations
# from prisma/postgres/migrations, never prompts, never resets data.
log "applying pending migrations (prisma migrate deploy)"
npx --no-install prisma migrate deploy --schema "$PG_SCHEMA"

# ─── Step 5: seed ───────────────────────────────────────────────────────────
# Opt-in: demo master data must never land in production by accident. The seed
# script itself refuses weak credentials when NODE_ENV=production.
if [ "${SEED_ON_START:-false}" = "true" ]; then
  log "SEED_ON_START=true — seeding demo data"
  npx --no-install tsx prisma/seed.ts || fail "seed failed"
fi

# ─── Step 6: start the server ───────────────────────────────────────────────
# exec replaces this shell so Node becomes PID 1 and receives SIGTERM directly,
# which makes `docker compose stop` shut down cleanly.
log "starting Next.js standalone server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node server.js
