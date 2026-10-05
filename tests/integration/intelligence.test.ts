/**
 * Phase 9 tests: the copilot answers from governed tools (stubbed LLM loop and
 * rule fallback), and the daily brief persists triageable findings — all
 * against an isolated database.
 */
import { execSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "@/domain/constants";
import { askCopilot, ruleBasedAnswer } from "@/server/ai/copilot";
import { generateBrief } from "@/server/ai/brief";

const TEST_DB = path.resolve(process.cwd(), "prisma", "test-ai.db");
const ORG = "ai-org";
const SESSION = { id: "ai-user", name: "AI Tester", orgId: ORG, permissions: [...PERMISSIONS] };

let client: PrismaClient;

beforeAll(async () => {
  try {
    await unlink(TEST_DB);
  } catch {
    /* fresh start */
  }
  execSync("npx prisma db push --accept-data-loss --skip-generate", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    stdio: "pipe",
  });
  client = new PrismaClient({ datasourceUrl: `file:${TEST_DB}` });

  await client.organisation.create({ data: { id: ORG, name: "AI Org", currency: "EUR", locale: "en" } });
  const warehouse = await client.warehouse.create({
    data: { organisationId: ORG, code: "A-01", name: "AI Warehouse", isDefault: true },
  });
  await client.customer.create({ data: { organisationId: ORG, code: "CUS-AI", company: "AI Customer" } });
  const product = await client.product.create({
    data: {
      organisationId: ORG, sku: "AI-LOW-1", name: "AI Low Item",
      salesUnit: "PCS", purchaseUnit: "PCS", conversionFactor: 1,
      costCents: 100, standardPriceCents: 200, reorderPoint: 20, safetyStock: 15,
    },
  });
  await client.inventoryMovement.create({
    data: { productId: product.id, warehouseId: warehouse.id, quantity: 5, type: "ADJUSTMENT_IN", reference: "TEST-OPENING" },
  });
}, 120000);

afterAll(async () => {
  await client?.$disconnect();
  try {
    await unlink(TEST_DB);
  } catch {
    /* best effort */
  }
});

describe("copilot", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("answers reorder questions from live data in rule mode", async () => {
    const answer = await ruleBasedAnswer(
      { orgId: ORG, userId: SESSION.id, permissions: SESSION.permissions, client },
      "What should we reorder?",
    );
    expect(answer.mode).toBe("rules");
    expect(answer.text).toContain("AI-LOW-1");
    expect(answer.toolsUsed).toContain("stock_risks");
    expect(answer.evidence.length).toBeGreaterThan(0);
  });

  it("drives the stubbed LLM loop through tools to a linked answer", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const calls: string[] = [];
    const answer = await askCopilot(
      SESSION,
      "What is low on stock?",
      [],
      (async (_messages: never, defs: never[]) => {
        calls.push(`turn with ${defs.length} tools`);
        if (calls.length === 1) {
          return {
            content: null,
            toolCalls: [{ id: "c1", name: "stock_risks", args: {} }],
            tokens: 50,
          };
        }
        return {
          content: "**Finding:** [AI-LOW-1](/products/abc) is low.\n**Reason:** below reorder.\n**Evidence:** ledger.\n**Recommended action:** reorder.",
          toolCalls: [],
          tokens: 60,
        };
      }) as never,
      client,
    );
    expect(answer.mode).toBe("ai");
    expect(answer.toolsUsed).toEqual(["stock_risks"]);
    expect(answer.tokens).toBe(110);
    expect(answer.evidence).toEqual([{ label: "AI-LOW-1", link: "/products/abc" }]);
    const logged = await client.aIAction.findFirst({
      where: { tool: "copilot.query" },
      orderBy: { createdAt: "desc" },
    });
    expect(logged).not.toBeNull();
    expect((logged!.result as { mode: string }).mode).toBe("ai");
  });

  it("falls back to rules when the LLM fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const answer = await askCopilot(SESSION, "What should we reorder?", [], (async () => {
      throw new Error("boom");
    }) as never, client);
    expect(answer.mode).toBe("rules");
    expect(answer.text).toContain("AI-LOW-1");
  });
});

describe("daily brief", () => {
  it("persists a triageable brief with linked findings", async () => {
    delete process.env.OPENAI_API_KEY;
    const { briefId, mode } = await generateBrief({
      orgId: ORG,
      userId: SESSION.id,
      actorName: "Tester",
      permissions: SESSION.permissions,
      client,
    });
    expect(mode).toBe("rules");
    const brief = await client.aIRecommendation.findUniqueOrThrow({ where: { id: briefId } });
    expect(brief.kind).toBe("DAILY_BRIEF");
    expect(brief.title).toContain("orders today");
    const findings = await client.aIRecommendation.findMany({
      where: { orgId: ORG, NOT: { id: briefId } },
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect((f.evidence as { briefId?: string } | null)?.briefId).toBe(briefId);
      if (f.actionLink) expect(f.actionLink.startsWith("/")).toBe(true);
    }
  });
});
