# Live deployment record — erp.britsyncai.com

Facts specific to the current production instance. The generic procedure lives
in [`DEPLOY.md`](./DEPLOY.md); this file records what is actually running, so the
next person does not have to rediscover it.

## Where it runs

| | |
|---|---|
| Host | `161.97.92.162` (Ubuntu 24.04, shared VPS) |
| Install path | `/opt/doner-erp` (git clone, `--depth 1`) |
| Public URL | `https://erp.britsyncai.com` |
| Origin port | `127.0.0.1:3100` (nginx proxies to it) |
| DNS | Cloudflare-proxied (orange cloud) → origin `161.97.92.162` |
| TLS | Let's Encrypt, expires **2027-01-04** |
| Docker project name | `donererp` |

## Containers

| Container | Image | Ports | Cap |
|---|---|---|---|
| `donererp-app-1` | built locally | `0.0.0.0:3100 → 3000` | 900 MB / 1.0 CPU |
| `donererp-db-1` | `postgres:16-alpine` | **not published** (internal only) | 512 MB / 1.0 CPU |
| Volume | `donererp_pgdata` | — | — |

`docker-compose.override.yml` lives **only on the host** (untracked). It carries
the resource caps that keep this project from starving the 6 other containers and
2 pm2 apps on the same box. Do not delete it.

## First OWNER account

Created with `prisma/bootstrap.ts` (not `prisma/seed.ts`, which writes demo
customer/supplier/product data and refuses weak credentials in production).

The password lives only in `/opt/doner-erp/.env` (`chmod 600`). It is a
temporary password: `mustChangePassword` is set, so the app forces a change at
first sign-in and the proxy blocks every other route until it is done.

## TLS renewal

The **host `certbot` package is broken** on this box — `josepy` cannot import
against the installed OpenSSL, so the systemd timer renews nothing.

Renewal therefore runs through the certbot container, scoped to this project
only:

- `/usr/local/bin/erp-cert-renew` — runs `certbot renew --cert-name erp.britsyncai.com`
  in a container, then reloads nginx **only after `nginx -t` passes**
- `/etc/cron.d/erp-cert-renew` — twice daily (03:17, 15:17 UTC)

`--cert-name` is essential. Without it, `certbot renew` walks every certificate
in `/etc/letsencrypt` and tries to renew other projects' nginx-plugin certs with
the webroot plugin, which fails.

## Day-to-day

```bash
cd /opt/doner-erp
git pull --ff-only && docker compose up -d --build   # deploy
docker compose logs -f app                            # logs
docker compose ps                                     # status
curl -s http://127.0.0.1:3100/api/health              # readiness (checks DB)
```

## Known host issues found during this deployment

Not caused by this project, but they will bite:

1. **Two certificates are already expired** and nothing is renewing them:
   `video.mayfairmarketing.online` (expired 2026-09-25),
   `postal.leadhunter.uk` (expired 2026-10-05).
2. **Three more expire within ~5 weeks**: `ahs.mayfairmarketing.online`
   (2026-10-18), `game.mayfairmarketing.online` (2026-11-06),
   `live.noblecircle.online` (2026-11-04).
3. Root cause is the broken host certbot. Fix with the same container-based
   approach used here, or by repairing the package:
   `apt install --reinstall certbot` or the official snap.

## Host capacity note

At deploy time the box was already loaded (4 vCPU, load ~4.5 before this project,
no swap). Memory is the constraint, and it is mostly **not** containers — several
long-lived `chrome` processes account for roughly 2 GB. The 900 MB / 512 MB caps
on this stack are what keep it safe alongside everything else.
