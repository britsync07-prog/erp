# Phase 0 — System Architecture (as built)

## Decisions & rationale

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, `src/` | Server Components by default; Server Actions for mutations; `src/proxy.ts` optimistic auth gate |
| Domain isolation | `src/domain/*` pure TS, zero imports from server/UI | Unit-testable pricing, stock, procurement math |
| Services | `src/server/services/*` own all DB access + Zod + permission asserts | Pages/actions never touch Prisma directly |
| DB | Prisma 6, SQLite now → Postgres later | Zero-Docker local dev; portable schema (cents-Int money, String statuses) |
| Auth | jose JWT in httpOnly cookie + bcryptjs, DAL in layouts/services | No external IdP needed for MVP; RBAC enforced twice (UI + service) |
| Money | Integer cents everywhere | No float rounding; forms convert € → cents at the boundary |
| Stock | Append-only `InventoryMovement` + `InventoryReservation` rows | Physical stock always derived; concurrency via row locks in TX (Phase 3 tests) |
| Prices | Append-only `ProductPrice`/`CustomerPrice`; order lines snapshot | History changes can never rewrite past orders (§9) |
| Audit | `audit()` + `activity()` sidecars on every mutation | Immutable by convention now, DB REVOKE on Postgres later |
| i18n | `src/i18n` dictionaries, `en` default, `it` shipped | No hardcoded UI strings blocking translation |

## State machines (enforced in services, Phases 4–8)

Order: DRAFT→CONFIRMED→PROCESSING|WAITING_FOR_STOCK→READY→DISPATCHED→DELIVERED→INVOICED→PAID
(+CANCELLED/PARTIAL/RETURNED). Confirm = 1 TX: price snapshot → reserve (locked) →
shortage → requirement → events → audit. PO: DRAFT→PENDING_APPROVAL→APPROVED→SENT→
CONFIRMED→PARTIAL→RECEIVED→CLOSED. Receipt TX posts ledger, updates PO, flips ready orders.

## Risks watched

Concurrent reservation over-allocation (locked TX + Phase 3 adversarial test) ·
unit-conversion drift (single `conversionFactor`, base-unit math, unit tests) ·
price-history rewrites (append-only + snapshot) · AI write escape (tool levels A–D,
Phase 10) · SQLite→Postgres drift (no raw SQL; migration doc; enum checklist).
