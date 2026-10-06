# Production deployment — single VPS (Docker Compose + PostgreSQL)

Target topology: one Linux VPS running Caddy (TLS) → the `app` container →
the `db` container. PostgreSQL is **not** published to the internet.

---

## 1. Prerequisites

- Linux VPS, 2 vCPU / 4 GB RAM / 40 GB disk, Ubuntu 22.04+ or Debian 12+
- A domain with an `A` record pointing at the VPS
- Docker Engine 24+ with the Compose plugin
- Ports **80** and **443** open; 3000 stays closed to the internet
- Git installed, and this project in a repository (see §9)

```bash
docker --version && docker compose version
```

---

## 2. First deploy

```bash
git clone <your-repo> doner-erp && cd doner-erp
cp .env.example .env
```

Generate real secrets — do not reuse any value from `.env.example`:

```bash
echo "SESSION_SECRET=$(openssl rand -base64 48)"
echo "CRON_SECRET=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
echo "INITIAL_ADMIN_PASSWORD=$(openssl rand -base64 24)Aa1!"
```

Paste them into `.env` and set at minimum:

| Variable | Rule |
|---|---|
| `POSTGRES_PASSWORD` | 32+ random chars |
| `SESSION_SECRET` | 32+ random chars, unique to this environment |
| `CRON_SECRET` | 24+ random chars |
| `APP_BASE_URL` | `https://your-domain.tld` (must be `https://`) |
| `INITIAL_ADMIN_EMAIL` | your real address (not `admin@demo.local`) |
| `INITIAL_ADMIN_PASSWORD` | 12+ chars, 3 of 4 character classes |
| `ORGANISATION_NAME` | legal name of the first company |
| `SEED_ON_START` | `false` — demo data must not reach production |

Then start:

```bash
docker compose up -d --build
docker compose ps          # both services should be healthy
docker compose logs -f app
```

The app container waits for Postgres, applies `prisma migrate deploy` against
the generated PostgreSQL schema, then starts. **The boot fails loudly** if a
secret is missing, still set to an example value, or if `DATABASE_URL` is a
SQLite path.

Verify:

```bash
curl -fsS https://your-domain.tld/api/health
# {"status":"ok","database":"reachable","latencyMs":3}
```

### Smoke testing without TLS

If you only want to check the app works before wiring up a domain, set
`ALLOW_INSECURE_BASE_URL=true` in `.env` and use `http://<host>:<APP_PORT>`.
The app logs a warning on every boot. **This sends sign-in passwords and
session cookies in clear text** — use it for minutes, not minutes-to-launch,
then set up TLS (§4) and remove the variable.

---

## 3. Create the first (OWNER) account

Roles and the organisation are created by the bootstrap script. It writes **no
demo master data** — unlike `prisma/seed.ts`, which is for local development
only and refuses to run with weak credentials when `NODE_ENV=production`.

```bash
docker compose exec app npx tsx prisma/bootstrap.ts
```

Sign in with `INITIAL_ADMIN_EMAIL`. You will be forced to set your own password
before the app becomes usable.

> Admins create further users in **Admin → Users**. Each invited user gets a
> temporary password and must change it at first sign-in, so nobody keeps a
> shared credential.

---

## 4. TLS

Caddy terminates TLS and forwards to the app container. `/api/health` is the
only path worth exposing unauthenticated; everything else requires a session.

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddy
your-domain.tld {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    }
}
```

```bash
sudo systemctl reload caddy
```

Change `docker-compose.yml` to bind the app to loopback only:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

The app also sets HSTS, CSP, `X-Frame-Options: DENY`, `nosniff` and a strict
Referrer-Policy itself, so the header block above is belt-and-braces.

---

## 5. Backups

The database is the only stateful component. Daily logical dump plus weekly
full snapshot:

```bash
sudo tee /usr/local/bin/erp-backup >/dev/null <<'SH'
#!/bin/sh
set -eu
DEST=/var/backups/erp
mkdir -p "$DEST"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f /opt/doner-erp/docker-compose.yml exec -T db \
  pg_dump -U erp -Fc erp > "$DEST/erp-$STAMP.dump"
find "$DEST" -name 'erp-*.dump' -mtime +14 -delete
SH
sudo chmod +x /usr/local/bin/erp-backup
```

```cron
15 2 * * * /usr/local/bin/erp-backup >> /var/log/erp-backup.log 2>&1
```

**Restore drill** (do this before you need it):

```bash
docker compose exec -T db pg_restore -U erp -d erp --clean --if-exists \
  < /var/backups/erp/erp-<stamp>.dump
```

---

## 6. Scheduled automation

`/api/cron/*` is server-to-server and authenticated with `CRON_SECRET`, not a
session. Wire it to the host cron (not the container, which has no cron):

```cron
30 6 * * *  curl -fsS "https://your-domain.tld/api/cron/monitor?org=org-1&secret=$CRON_SECRET"      >> /var/log/erp-cron.log 2>&1
0  7 * * *  curl -fsS "https://your-domain.tld/api/cron/daily-brief?org=org-1&secret=$CRON_SECRET" >> /var/log/erp-cron.log 2>&1
```

Read `CRON_SECRET` from `/opt/doner-erp/.env` rather than inlining it in crontab.

Confirm the secret is enforced — a wrong value must be rejected:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://your-domain.tld/api/cron/monitor?org=org-1&secret=wrong"   # 401
```

---

## 7. Updates and rollback

```bash
cd /opt/doner-erp
git pull
docker compose up -d --build      # migrate deploy runs automatically
```

Rollback — because migrations run forward, roll back **code and image** first,
then the schema if the release included a destructive migration:

```bash
git checkout <previous-tag>
docker compose up -d --build
```

```bash
# Only if a migration must be reverted. Take a fresh dump first.
docker compose exec -T db pg_restore -U erp -d erp --clean --if-exists < backup.dump
```

Prefer additive migrations (add column, backfill, then switch reads). A release
that drops a column should ship as two deploys.

---

## 8. Monitoring

- Point an external uptime monitor at `GET /api/health`. It returns `503` when
  the database is unreachable, so a database outage pages you.
- `docker compose logs -f app` for application logs; failed sign-ins are audited
  (`AuditLog`, action `LOGIN_FAILED`) and visible under **Audit log**.
- Alert on repeated `503` from the health endpoint or on `restart` count growth:
  `docker inspect -f '{{.RestartCount}}' $(docker compose ps -q app)`.

---

## 9. Before you launch

- [ ] Put the project in **git** (`git init && git add -A && git commit`). There is no rollback path without it, and `.env` is already gitignored.
- [ ] Change the admin password (you are forced to at first sign-in).
- [ ] Remove or rotate any credential that was ever committed.
- [ ] Point `OPENAI_API_KEY` at a **zero-retention** endpoint, or leave it empty to run in rule-based mode (no data leaves the host).
- [ ] Run `npm run verify` locally before each release.

---

## 10. Operational limits worth knowing

| Limit | Detail | When it bites |
|---|---|---|
| Rate limiting is in-process | `src/server/auth/rateLimit.ts` | Only if you scale to **more than one app instance**. Move it to Postgres/Redis first. |
| `Float` quantities | Decimal arithmetic is not used | Rounding on fractional units. The migration notes suggest `Decimal(12,3)`. |
| Status columns are `String`, not enums | Enforced by Zod in services | Fine; a native-enum conversion is optional hardening. |
| Password change does not revoke other sessions | Sessions are stateless JWTs | A leaked session survives up to 12h. Deactivating the user revokes it immediately. |
| Backups are host-local | `pgdata` is one disk | Copy dumps off-box for real disaster recovery. |

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Refusing to start: invalid environment configuration` | Example/weak secret, or SQLite `DATABASE_URL` | Fix the named variable in `.env`; see §2 |
| App restarts, log shows `migrate deploy` error | Stale schema or a migration that cannot apply | `docker compose logs app`; for a first deploy, `docker compose down -v` and retry |
| `503` from `/api/health` | Database down or still initialising | `docker compose ps`; check `pg_isready` |
| Sign-in says "Too many failed sign-in attempts" | Lockout after 8 failures / 15 min | Wait, or `docker compose restart app` (in-process counters reset) |
| Blank page, dev overlay | — | Production shows the friendly error page; check `docker compose logs app` |