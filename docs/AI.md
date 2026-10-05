# Phase 9 — Intelligence (OpenAI API)

## Setup

```powershell
# .env
OPENAI_API_KEY="sk-..."     # empty = rule-based mode (no LLM calls, no cost)
OPENAI_MODEL="gpt-4o-mini"  # any OpenAI-compatible model
OPENAI_BASE_URL=""          # optional: gateway / compatible endpoint
CRON_SECRET="long-random"   # guards GET /api/cron/daily-brief
```

Without a key the copilot and briefs run on deterministic rules over the same
governed tools — the UI badges every answer as **AI** or **Rule-based**.

## How it works

```
User question → askCopilot → permission-filtered tools → OpenAI function calling
(max 6 rounds) → Finding/Reason/Evidence/Action answer + links → AIAction log
```

- **Tools are read-only** (`src/server/ai/tools.ts`): aggregates and deep links
  only — never credentials, password hashes, attachments, or raw secrets.
- **Permission-gated twice**: the model only receives tools the caller may use
  (§38), and every tool re-checks before running. Unknown tool names are rejected.
- **No autonomous writes.** The copilot cannot create, change, or delete
  business records. The brief only writes `AIRecommendation` drafts for humans
  to accept/dismiss (Level B). Approvals, sending, and payments stay human
  (Phase 10 adds approval-gated actions).

## Daily brief

- Manual: **Intelligence → Generate brief** (needs `intelligence.manage`).
- Scheduled: `GET /api/cron/daily-brief?org=<id>&secret=<CRON_SECRET>`
  (VPS cron, e.g. daily 07:00). One brief per run; findings link their records.
- Triage findings to ACCEPTED/DISMISSED; history is kept for audit.

## Guardrails & cost

- Temperature 0.2, max 1200 tokens/answer, 2000/brief, 30–60s hard timeouts,
  6 tool rounds max, tool outputs truncated to ~6k chars.
- Every answer and brief logs model, tools used, and token count to `AIAction`
  (visible on the Intelligence page).
- If the API fails, the copilot degrades to rule-based answers with a notice —
  operators are never left without data.

## Privacy notes (for the DPO file)

- The LLM provider receives **aggregated operational figures** (counts, sums,
  SKUs, company names needed to answer) — never authentication material.
- Prefer an API endpoint with **zero data retention** for EU data, and note the
  transfer in your RoPA/DPIA. The rule-based mode sends nothing anywhere.
- Customer can disable AI per role by removing `intelligence.view`.

## Phase 10 — orchestration (delivered)

- **Tool registry** (`src/server/ai/registry.ts`): every writing tool declares
  Level B (executes now: `create_requirement`, `draft_purchase_orders`,
  `notify_team`) or Level C (files approval only: `request_stock_adjustment`,
  `send_purchase_order`). Level D (deletes, audit edits, permission changes,
  payments) is never registered — the model cannot even ask for it.
- **Approval flow**: C calls create `AIAction` (PENDING_APPROVAL) +
  `ApprovalRequest` (kind `AI_ACTION`). Approval executes via
  `executeApprovedAction` (re-validates the approver, routes adjustments into
  the human stock-adjustment flow); rejection closes both rows. Second-person
  rule applies throughout.
- **Recommendation engine**: brief findings carry `evidence.proposedAction`;
  one click executes Level B and accepts the finding.
- **Specialised agents** (`src/server/ai/agents.ts`): Inventory, Procurement,
  Sales, Finance, Management + General — focused tool subsets and prompts over
  the same governed layer. Picker on the Ask page.
- **Automation engine** (`src/server/ai/automation.ts`): four default monitors
  (low stock → requirements; overdue invoices / late POs / stale orders →
  digests), all deduplicated, toggleable in Admin → Automation, runnable via
  `GET /api/cron/monitor?org=<id>&secret=…` and logged to audit.
- **AI activity page** (`/intelligence/activity`): every answer, brief,
  proposal and execution with tool, level, status and tokens.

## Phase 11 preview

Email/WhatsApp messaging, accounting + fattura elettronica connectors,
logistics APIs, supplier APIs, e-commerce and ordering channels — all behind
the same permission and audit contracts.
