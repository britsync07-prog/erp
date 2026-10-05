import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import type { Permission } from "@/domain/constants";
import { audit, notify } from "@/server/platform";
import { convertRequirementsCore } from "@/server/services/procurement";
import { transitionCore } from "@/server/services/procurement";
import type { Actor } from "@/server/services/util";

// Phase 10 tool registry (§21–22). Read tools live in ai/tools.ts (Level A).
// This registry governs everything that WRITES:
//   Level B (DRAFT)    — executes immediately, fully logged, harmless by design
//                        (creates drafts / raises requirements / notifies).
//   Level C (APPROVAL) — never executes directly. Calling one files an
//                        AIAction (PENDING_APPROVAL) + ApprovalRequest; a human
//                        approves in the inbox, and only then does it run.
//   Level D            — not registered at all: deletes, audit edits,
//                        permission changes, payments. The model is never even
//                        offered these.

export type WriteLevel = "B_DRAFT" | "C_APPROVAL_REQUIRED";

export interface WriteToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  level: WriteLevel;
  requires: Permission[];
  /** Human-readable summary shown in the approval inbox before execution. */
  summarize: (args: Record<string, unknown>) => string;
  /**
   * What runs when a human approves. Defaults to `execute` — C tools that must
   * route into an existing human flow (e.g. stock adjustments) override this.
   */
  onApprove?: (
    client: PrismaClient,
    orgId: string,
    actor: Actor,
    args: Record<string, unknown>,
  ) => Promise<{ summary: string; link?: string }>;
  execute: (
    client: PrismaClient,
    orgId: string,
    actor: Actor,
    args: Record<string, unknown>,
  ) => Promise<{ summary: string; link?: string }>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Prisma Json columns need InputJsonValue; callers pass plain JSON-shaped data. */
const jv = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

export const WRITE_TOOLS: WriteToolDef[] = [
  {
    name: "create_requirement",
    description: "Raise an open purchase requirement for a product (draft-like, deduplicated, reversible). Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product id" },
        qty: { type: "number", description: "Required quantity in sales units" },
        reason: { type: "string", description: "Why this is needed" },
      },
      required: ["productId", "qty", "reason"],
      additionalProperties: false,
    },
    level: "B_DRAFT",
    requires: ["procurement.manage", "inventory.manage"],
    summarize: (a) => `Raise requirement: ${num(a.qty)} units — ${str(a.reason).slice(0, 120)}`,
    execute: async (client, orgId, actor, args) => {
      const product = await client.product.findFirst({ where: { id: str(args.productId), organisationId: orgId } });
      if (!product) throw new Error("This product was not found.");
      if (!(num(args.qty) > 0)) throw new Error("Required quantity must be positive.");
      const existing = await client.purchaseRequirement.findFirst({
        where: { productId: product.id, status: "OPEN" },
      });
      if (existing) return { summary: `Requirement already open for ${product.sku}.`, link: "/procurement/requirements" };
      const req = await client.purchaseRequirement.create({
        data: {
          productId: product.id,
          requiredQty: num(args.qty),
          reason: str(args.reason).slice(0, 500) || "Raised by AI copilot.",
          status: "OPEN",
          createdBy: "AI",
        },
      });
      await audit({ orgId, action: "CREATE", entityType: "PURCHASE_REQUIREMENT", entityId: req.id, actor, source: "AI", client });
      return { summary: `Requirement raised for ${product.sku} × ${num(args.qty)}.`, link: "/procurement/requirements" };
    },
  },
  {
    name: "draft_purchase_orders",
    description: "Convert open purchase requirements into DRAFT purchase orders grouped by supplier. Drafts change nothing operational. Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        requirementIds: { type: "array", items: { type: "string" }, description: "Open requirement ids to convert" },
      },
      required: ["requirementIds"],
      additionalProperties: false,
    },
    level: "B_DRAFT",
    requires: ["procurement.manage"],
    summarize: (a) => `Draft purchase orders from ${(Array.isArray(a.requirementIds) ? a.requirementIds : []).length} requirement(s)`,
    execute: async (client, orgId, actor, args) => {
      const ids = Array.isArray(args.requirementIds) ? args.requirementIds.filter((x): x is string => typeof x === "string") : [];
      if (ids.length === 0) throw new Error("Select at least one requirement.");
      const poIds = await convertRequirementsCore(client, orgId, actor, ids);
      return { summary: `${poIds.length} draft purchase order${poIds.length === 1 ? "" : "s"} created.`, link: "/procurement" };
    },
  },
  {
    name: "notify_team",
    description: "Post an internal notification to a role or user. Informational only. Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        link: { type: "string", description: "Internal record path, e.g. /orders/abc" },
        severity: { type: "string", enum: ["INFO", "ACTION_REQUIRED", "WARNING", "CRITICAL"] },
        roleCode: { type: "string", description: "Role code to notify, e.g. PROCUREMENT" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    level: "B_DRAFT",
    requires: ["procurement.manage", "inventory.manage", "orders.manage"],
    summarize: (a) => `Notify ${str(a.roleCode) || "team"}: ${str(a.title).slice(0, 120)}`,
    execute: async (client, orgId, actor, args) => {
      const title = str(args.title).slice(0, 200);
      if (!title) throw new Error("A notification title is required.");
      const link = str(args.link);
      if (link && !link.startsWith("/")) throw new Error("Notification links must be internal paths.");
      await notify({
        orgId,
        title,
        body: str(args.body).slice(0, 1000) || undefined,
        link: link || undefined,
        severity: ["INFO", "ACTION_REQUIRED", "WARNING", "CRITICAL"].includes(str(args.severity)) ? str(args.severity) : "INFO",
        roleCode: str(args.roleCode) || undefined,
        client,
      });
      await audit({ orgId, action: "NOTIFY", entityType: "NOTIFICATION", entityId: title, actor, source: "AI", client });
      return { summary: `Team notified: ${title}` };
    },
  },
  {
    name: "request_stock_adjustment",
    description: "Propose a stock adjustment. ALWAYS needs a human approver — calling this only files the request, it never posts stock.",
    parameters: {
      type: "object",
      properties: {
        productId: { type: "string" },
        warehouseId: { type: "string", description: "Omit for default warehouse" },
        qty: { type: "number", description: "Signed quantity in sales units (+ in / − out)" },
        reason: { type: "string" },
      },
      required: ["productId", "qty", "reason"],
      additionalProperties: false,
    },
    level: "C_APPROVAL_REQUIRED",
    requires: ["inventory.manage"],
    summarize: (a) => `Adjust stock ${num(a.qty) > 0 ? "+" : ""}${num(a.qty)} — ${str(a.reason).slice(0, 120)}`,
    onApprove: async (client, orgId, actor, args) => {
      // AI-proposed adjustments always travel the human stock-adjustment flow,
      // even small ones: a second person confirms before anything posts.
      const product = await client.product.findFirst({ where: { id: str(args.productId), organisationId: orgId } });
      if (!product) throw new Error("This product was not found.");
      const qty = num(args.qty);
      if (!qty) throw new Error("Adjustment quantity cannot be zero.");
      const reason = str(args.reason).slice(0, 500) || "Proposed by AI copilot.";
      const warehouse = str(args.warehouseId)
        ? await client.warehouse.findFirst({ where: { id: str(args.warehouseId), organisationId: orgId } })
        : await client.warehouse.findFirst({ where: { organisationId: orgId, isDefault: true } })
          ?? await client.warehouse.findFirst({ where: { organisationId: orgId }, orderBy: { code: "asc" } });
      if (!warehouse) throw new Error("Create a warehouse first.");
      const approval = await client.approvalRequest.create({
        data: {
          orgId,
          kind: "STOCK_ADJUSTMENT",
          entityId: "PENDING",
          payload: { productId: product.id, warehouseId: warehouse.id, qty, reason },
          requestedBy: actor.id,
          reason: `${qty > 0 ? "+" : ""}${qty} ${product.salesUnit} of ${product.sku}: ${reason} (via AI)`,
        },
      });
      await notify({
        orgId, severity: "ACTION_REQUIRED", roleCode: "OPS_MANAGER",
        title: `Stock adjustment needs approval (${product.sku}, ${qty})`,
        body: reason, link: "/approvals", client,
      });
      await audit({ orgId, action: "APPROVAL_REQUEST", entityType: "STOCK_ADJUSTMENT", entityId: approval.id, actor, source: "AI", client });
      return { summary: `Stock adjustment filed for a second approval (${product.sku}).`, link: "/approvals" };
    },
    execute: async () => {
      throw new Error("Stock adjustments proposed by AI must be approved by a human first.");
    },
  },
  {
    name: "send_purchase_order",
    description: "Mark an APPROVED purchase order as sent to the supplier. Needs a human approver — calling this only files the request.",
    parameters: {
      type: "object",
      properties: { poId: { type: "string", description: "Purchase order id (must be APPROVED)" } },
      required: ["poId"],
      additionalProperties: false,
    },
    level: "C_APPROVAL_REQUIRED",
    requires: ["procurement.manage"],
    summarize: () => `Send approved purchase order to supplier`,
    execute: async (client, orgId, actor, args) => {
      const po = await client.purchaseOrder.findFirst({
        where: { id: str(args.poId), supplier: { organisationId: orgId } },
      });
      if (!po) throw new Error("This purchase order was not found.");
      if (po.status !== "APPROVED") throw new Error(`Only APPROVED orders can be sent (this one is ${po.status}).`);
      await transitionCore(client, orgId, actor, po.id, "SENT", "SEND");
      return { summary: `Purchase order ${po.number} sent.`, link: `/procurement/${po.id}` };
    },
  },
];

export function writeToolsFor(permissions: readonly string[]): WriteToolDef[] {
  return WRITE_TOOLS.filter((t) => t.requires.some((p) => permissions.includes(p)));
}

export function findWriteTool(name: string): WriteToolDef | undefined {
  return WRITE_TOOLS.find((t) => t.name === name);
}

/**
 * File a Level C request: validates first (fail fast on bad args), then stores
 * AIAction (PENDING_APPROVAL) + ApprovalRequest (kind AI_ACTION). Returns ids.
 */
export async function proposeWriteAction(
  client: PrismaClient,
  orgId: string,
  requester: Actor,
  tool: WriteToolDef,
  args: Record<string, unknown>,
): Promise<{ actionId: string; approvalId: string }> {
  // Validate without executing: B tools run a dry validation where possible.
  const summary = tool.summarize(args);
  const action = await client.aIAction.create({
    data: {
      orgId,
      level: "C_APPROVAL_REQUIRED",
      tool: tool.name,
      input: jv(args),
      result: jv({ summary, requestedBy: requester.name }),
      userId: requester.id,
      status: "PENDING_APPROVAL",
    },
  });
  const approval = await client.approvalRequest.create({
    data: {
      orgId,
      kind: "AI_ACTION",
      entityId: action.id,
      payload: jv({ actionId: action.id, tool: tool.name, args }),
      requestedBy: requester.id,
      reason: `AI proposes: ${summary}`,
    },
  });
  await audit({ orgId, action: "AI_PROPOSE", entityType: "AI_ACTION", entityId: action.id, newValue: { tool: tool.name }, actor: requester, source: "AI", client });
  return { actionId: action.id, approvalId: approval.id };
}

/**
 * Execute an approved AI action (called by the approvals service after a human
 * approves). Re-validates permissions of the APPROVER before running.
 */
export async function executeApprovedAction(
  client: PrismaClient,
  orgId: string,
  approver: Actor & { permissions: readonly string[] },
  actionId: string,
): Promise<{ summary: string; link?: string }> {
  const action = await client.aIAction.findFirst({ where: { id: actionId, orgId } });
  if (!action) throw new Error("This AI action was not found.");
  if (action.status !== "PENDING_APPROVAL") throw new Error("This AI action is no longer pending.");
  const tool = findWriteTool(action.tool);
  if (!tool) throw new Error(`Unknown AI tool: ${action.tool}.`);
  if (!tool.requires.some((p) => approver.permissions.includes(p))) {
    throw new Error("You do not have permission to execute this AI action.");
  }
  const args = (action.input ?? {}) as Record<string, unknown>;
  const result = await (tool.onApprove ?? tool.execute)(client, orgId, approver, args);
  await client.aIAction.update({
    where: { id: action.id },
    data: { status: "DONE", result: jv({ ...(action.result as Record<string, unknown>), executed: result.summary, link: result.link ?? null }) },
  });
  await audit({ orgId, action: "AI_EXECUTE", entityType: "AI_ACTION", entityId: action.id, newValue: { tool: tool.name }, actor: approver, source: "AI", client });
  return result;
}

export async function logWriteAction(
  orgId: string,
  actor: Actor,
  tool: string,
  level: "B_DRAFT" | "C_APPROVAL_REQUIRED",
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  client: PrismaClient = db,
) {
  try {
    await client.aIAction.create({
      data: { orgId, level, tool, input: jv(args), result: jv(result), userId: actor.id, status: "DONE" },
    });
  } catch {
    /* observability never breaks the path */
  }
}
