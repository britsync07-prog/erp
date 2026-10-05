# PostgreSQL migration (production path)

Local dev runs SQLite so Phase 1–4 can move without Docker. The schema was written
for a mechanical migration. Do this once, before any production data exists:

1. `npm install` a Postgres server (or managed: Neon/Supabase/RDS) + set
   `DATABASE_URL="postgresql://..."`.
2. In `prisma/schema.prisma`: `provider = "postgresql"`.
3. Convert status/type `String` columns to native enums. Recommended mapping:
   - `ORDER_STATUSES`, `PO_STATUSES`, `MOVEMENT_TYPES`, plus `status` fields on
     Customer/Supplier/Product/Warehouse/Invoice/Fulfilment/etc.
   - Source of truth stays `src/domain/constants.ts` — generate the Prisma enums
     from it, keep Zod literals in sync.
4. Convert money `Int` (cents) → keep as `Int`, or move to `Decimal(12,2)` if the
   accountants require it (domain code stays cents-based either way).
5. `quantity Float` → `Decimal(12,3)` for exact ledger arithmetic.
6. `npx prisma migrate dev --name postgres-init` on a fresh DB, re-seed, run
   `npm run test`, then run the concurrency test (Phase 3: two workers reserving
   the last units — must never over-allocate; uses `SELECT … FOR UPDATE`).
7. Turn on `pgcrypto`/`pg_stat_statements`, nightly `pg_dump`, and set Postgres
   `REVOKE UPDATE, DELETE ON AuditLog, ActivityEvent FROM app_role` for
   append-only enforcement at the DB layer.
8. Point object storage at S3-compatible bucket for `Attachment.storageKey`.

No application code changes are needed beyond the datasource + enum types:
services use no raw SQL and no SQLite-specific behaviour.
