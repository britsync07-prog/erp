# DonerERP — AI-Powered Distribution ERP (Italy · döner kebab supply)

Phases 1–8 (operational ERP) + 9 (Intelligence) + 10 (Orchestration) implemented.
See `docs/ARCHITECTURE.md` for the Phase 0 system design, `docs/AI.md` for the
intelligence setup, and `docs/POSTGRES_MIGRATION.md` for the production DB path.

## Deploying to production

**[`DEPLOY.md`](./DEPLOY.md) is the runbook** — single VPS, Docker Compose,
PostgreSQL, TLS, backups, rollback, monitoring.

Short version:

```bash
cp .env.example .env      # then set real secrets (openssl rand -base64 48)
docker compose up -d --build
docker compose exec app npx tsx prisma/bootstrap.ts   # first OWNER account
```

Production uses **PostgreSQL** (`prisma/postgres/schema.prisma`, generated from
the SQLite dev schema by `scripts/make-pg-schema.mjs`). Local development stays
on SQLite so it needs no Docker. The app refuses to boot with example secrets, a
weak password, or a SQLite `DATABASE_URL` in production.

## Stack

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind v4 ·
Prisma 6 (SQLite locally → PostgreSQL in production) · jose sessions + bcryptjs ·
Zod validation · Vitest.

## Quickstart (Windows PowerShell)

```powershell
npm install
npx prisma migrate dev      # creates prisma/dev.db
npx tsx prisma/seed.ts      # demo org + RBAC + demo master data
npm run dev                 # http://localhost:3000
```

Demo login: `admin@demo.local` / `ChangeMe123!` (change immediately; seed creds via `.env`).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (96 tests: pricing, stock, procurement, units, RBAC, auth) |
| `npm run verify` | lint + typecheck + test + build (run before each release) |
| `npx prisma migrate dev` | Apply migrations (SQLite, local dev) |
| `npx tsx prisma/seed.ts` | Seed demo org (local dev only) |
| `npx tsx prisma/bootstrap.ts` | Production bootstrap: org + roles + first OWNER |
| `npm run db:pg:migrate` | Apply PostgreSQL migrations |
| `npx prisma studio` | DB browser |

## Security posture

| Control | Where |
|---|---|
| Password policy (12+ chars, 3 character classes, common-word blocklist) | `src/domain/password.ts` |
| Forced password change for invited users; self-service rotation | `/account/password`, `mustChangePassword` |
| Sign-in rate limiting + escalating lockout (per-account **and** per-IP) | `src/server/auth/rateLimit.ts` |
| Failed sign-ins audited | `AuditLog` action `LOGIN_FAILED` |
| Sessions re-validated per request — deactivation and role changes bite immediately | `src/server/auth/session.ts` |
| Fail-fast boot on missing/weak/example secrets | `src/server/env.ts` via `src/instrumentation.ts` |
| CSP, HSTS, `frame-ancestors 'none'`, `nosniff`, Referrer-Policy | `next.config.ts` |
| Seed refuses demo credentials when `NODE_ENV=production` | `prisma/seed.ts` |
| Cron endpoints authenticated by `CRON_SECRET`, not a session | `src/app/api/cron/*` |
| Server-side RBAC re-asserted in every service (not just the UI) | `src/server/auth/permissions.ts` |
| Prisma error codes never surfaced to users | `friendlyError` in `src/server/platform.ts` |

No public signup: accounts are created by an administrator (Admin → Users), and
each one must set its own password at first sign-in.

## What's working (Phase 1 + 2)

- Auth (session JWT in httpOnly cookie, optimistic `src/proxy.ts` gate, full DAL checks),
  8 roles with configurable permissions, user admin, audit log, notifications, global
  search + ⌘K palette, command-centre home.
- Customers (addresses, contacts, customer prices, balance, activity), suppliers
  (contacts, product links, performance counts), products (units + conversion, supplier
  links, price history/rules, opening stock, per-warehouse stock), categories, pricing
  overview, warehouses + locations.
- Inventory: ledger-derived stock overview, movement ledger with filters, adjustments
  (significant ones need a second person's approval), atomic warehouse transfers,
  stock counts with post-to-ledger corrections, reservations view, low-stock board
  with one-click purchase requirements, approvals inbox with sidebar badge.
- Orders: draft → confirm pipeline with price snapshotting (standard/group/
  customer/promo/contract), margin + totals, StockGuard-guarded reservation
  transaction (never over-allocates — proven by the concurrency integration test),
  shortage → purchase requirements, fulfilment shell rows, recheck, cancel with
  reservation release, full activity timeline.
- Procurement: requirements board (order/low-stock demand), one-click conversion
  into supplier-grouped draft POs (base→purchase-unit rounding, MOQ, preferred
  costs), PO lifecycle draft → approval → sent → confirmed → received → closed
  with second-person approval, send/confirm/close/cancel, cancel reopens
  requirements, full receipt history shell for Phase 6.
- Receiving: work queue with overdue flags, mobile-first receive form (scan/type
  filter, fill-remaining, big touch inputs), partial + damaged + overdelivery
  handling (damaged never enters stock), atomic receipt → ledger → PO progress,
  automatic waiting-order recalculation with sales notifications.
- Fulfilment: warehouse-simple board (no prices on the floor), start picking,
  scan-filtered pick confirmation with over-pick guards, dispatch (ledger +
  reservation release + shipment in one transaction), delivery, returns with
  restock-vs-damaged split and finance handoff for credit notes.
- Finance: invoices from delivered orders (snapshotted lines), issue/void with
  order promotion to INVOICED, partial payments with overpayment guards walking
  invoice and order to PAID, receivables board with aging buckets and
  credit-adjusted customer balances, credit notes from returns, order + product
  margin intelligence.
- Intelligence (OpenAI API, optional): copilot chat grounded in live data via
  permission-filtered read-only tools, AI daily brief with triageable findings,
  rule-based fallback when no key is set, full AI action log. See `docs/AI.md`.
- Orchestration: Level B/C write-tool registry (drafts execute, sensitive
  actions file human approvals), actionable brief findings, six specialist
  agents, automation monitor with seeded rules + cron, AI activity ledger.
- Every mutation: Zod validation → permission check → transaction where multi-row →
  audit + activity → friendly (non-technical) errors. No dead buttons, no mock data.

## Project map

```
prisma/            schema + migrations + seed + bootstrap
prisma/postgres/   generated PostgreSQL schema + baseline migration (production)
scripts/           pg schema generator, docker entrypoint
src/domain/        pure logic: constants, units, pricing, stock, procurement, password policy
src/i18n/          en (default) + it dictionaries
src/server/auth/   password, session (revalidation), rate limit, permissions (DAL)
src/server/env.ts  fail-fast environment validation
src/server/services/  customers, suppliers, catalog, warehouses, admin, platformRead
src/server/actions/   thin "use server" wrappers + revalidation
src/server/platform.ts  audit / activity / notify / friendly errors
src/app/           routes: (app) shell + modules, login, account/password, api/*
src/components/    ui, client, shell, entity-forms, role-editor, account-forms
tests/unit/        domain + RBAC + auth tests
tests/integration/ end-to-end flows + session security
docs/              ARCHITECTURE.md, POSTGRES_MIGRATION.md, AI.md
DEPLOY.md          production runbook
```

## Next (per master prompt)

Phase 11 integrations (email/messaging, accounting + fattura elettronica,
logistics, supplier APIs, e-commerce). The full operating system (1–10)
is complete and verified.
