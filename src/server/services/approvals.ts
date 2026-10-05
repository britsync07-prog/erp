import "server-only";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { assertPermission, assertAnyPermission } from "@/server/auth/permissions";
import { audit, notify } from "@/server/platform";
import { PAGE_SIZE, paged } from "./util";
import { applyAdjustment } from "./inventory";
import { applyPOApprovalCore, revertPOToDraftCore } from "./procurement";
import { executeApprovedAction } from "@/server/ai/registry";
import type { Actor } from "./util";

const APPROVER_PERMS = {
  STOCK_ADJUSTMENT: "inventory.manage",
  PO_APPROVAL: "procurement.approve",
  AI_ACTION: "intelligence.manage",
  PRICE_OVERRIDE: "pricing.manage",
  DISCOUNT: "orders.manage",
} as const;

type ApproverPerm = (typeof APPROVER_PERMS)[keyof typeof APPROVER_PERMS];

export function approverPermFor(kind: string): ApproverPerm {
  return APPROVER_PERMS[kind as keyof typeof APPROVER_PERMS] ?? "inventory.manage";
}

export async function listApprovals(orgId: string, status = "PENDING", page = 1) {
  await assertAnyPermission(["inventory.view", "procurement.view"]);
  const where = { orgId, ...(status === "ALL" ? {} : { status }) };
  const [total, items] = await Promise.all([
    db.approvalRequest.count({ where }),
    db.approvalRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const userIds = [...new Set([...items.map((i) => i.requestedBy), ...items.map((i) => i.decidedBy).filter(Boolean)])] as string[];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return paged(
    items.map((i) => ({
      ...i,
      requestedByName: names.get(i.requestedBy) ?? "—",
      decidedByName: i.decidedBy ? (names.get(i.decidedBy) ?? "—") : null,
      payload: (i.payload ?? null) as {
        productId?: string; warehouseId?: string; qty?: number; reason?: string;
        poId?: string; actionId?: string; tool?: string; args?: Record<string, unknown>;
      } | null,
    })),
    total,
    page,
  );
}

export async function pendingApprovalsCount(orgId: string) {
  return db.approvalRequest.count({ where: { orgId, status: "PENDING" } });
}

async function loadPending(client: PrismaClient, orgId: string, id: string) {
  const req = await client.approvalRequest.findFirst({ where: { id, orgId } });
  if (!req) throw new Error("This approval request was not found.");
  if (req.status !== "PENDING") throw new Error("This request has already been decided.");
  return req;
}

/**
 * Auth-free core: applies the approved action. The wrapper authenticates and
 * enforces the second-person rule; the integration test drives this directly.
 */
export async function approveRequestCore(client: PrismaClient, orgId: string, approver: Actor & { permissions: readonly string[] }, id: string) {
  const req = await loadPending(client, orgId, id);
  if (req.requestedBy === approver.id) {
    throw new Error("Approvals require a second person — you cannot decide your own request.");
  }
  if (req.kind === "STOCK_ADJUSTMENT") {
    const p = (req.payload ?? {}) as { productId?: string; warehouseId?: string; qty?: number; reason?: string };
    if (!p.productId || !p.warehouseId || typeof p.qty !== "number") {
      throw new Error("This approval has an invalid payload and cannot be applied.");
    }
    await applyAdjustment(orgId, approver, {
      productId: p.productId, warehouseId: p.warehouseId, qty: p.qty,
      reason: p.reason ?? "Approved adjustment", reference: "ADJ-APPR",
    }, client);
  } else if (req.kind === "PO_APPROVAL") {
    const p = (req.payload ?? {}) as { poId?: string };
    if (!p.poId) throw new Error("This approval has an invalid payload and cannot be applied.");
    await applyPOApprovalCore(client, orgId, approver, p.poId);
  } else if (req.kind === "AI_ACTION") {
    const p = (req.payload ?? {}) as { actionId?: string };
    if (!p.actionId) throw new Error("This approval has an invalid payload and cannot be applied.");
    await executeApprovedAction(client, orgId, approver, p.actionId);
  }
  await client.approvalRequest.update({ where: { id }, data: { status: "APPROVED", decidedBy: approver.id, decidedAt: new Date() } });
  await audit({ orgId, action: "APPROVE", entityType: "APPROVAL", entityId: id, oldValue: { status: "PENDING" }, newValue: { status: "APPROVED" }, actor: approver, client });
  await notify({ orgId, severity: "INFO", userId: req.requestedBy, title: `Approved: ${req.reason ?? req.kind}`, link: "/approvals", client });
}

export async function rejectRequestCore(client: PrismaClient, orgId: string, approver: Actor, id: string, comment: string) {
  const req = await loadPending(client, orgId, id);
  if (req.requestedBy === approver.id) {
    throw new Error("Approvals require a second person — you cannot decide your own request.");
  }
  if (!comment.trim()) throw new Error("Please give a reason for rejection.");
  if (req.kind === "PO_APPROVAL") {
    const p = (req.payload ?? {}) as { poId?: string };
    if (p.poId) await revertPOToDraftCore(client, orgId, approver, p.poId);
  }
  if (req.kind === "AI_ACTION") {
    const p = (req.payload ?? {}) as { actionId?: string };
    if (p.actionId) {
      await client.aIAction.updateMany({ where: { id: p.actionId, orgId }, data: { status: "REJECTED" } });
    }
  }
  await client.approvalRequest.update({
    where: { id },
    data: { status: "REJECTED", decidedBy: approver.id, decidedAt: new Date(), reason: `${req.reason ?? ""} — Rejected: ${comment.trim()}` },
  });
  await audit({ orgId, action: "REJECT", entityType: "APPROVAL", entityId: id, oldValue: { status: "PENDING" }, newValue: { status: "REJECTED" }, actor: approver, client });
  await notify({ orgId, severity: "WARNING", userId: req.requestedBy, title: `Rejected: ${req.reason ?? req.kind}`, body: comment.trim(), link: "/approvals", client });
}

export async function approveRequest(actor: Actor, id: string) {
  const req0 = await db.approvalRequest.findFirst({ where: { id, orgId: actor.orgId } });
  if (!req0) throw new Error("This approval request was not found.");
  const me = await assertPermission(approverPermFor(req0.kind));
  await approveRequestCore(db, actor.orgId, me, id);
}

export async function rejectRequest(actor: Actor, id: string, comment: string) {
  const req0 = await db.approvalRequest.findFirst({ where: { id, orgId: actor.orgId } });
  if (!req0) throw new Error("This approval request was not found.");
  const me = await assertPermission(approverPermFor(req0.kind));
  await rejectRequestCore(db, actor.orgId, me, id, comment);
}

export async function canSeeApprovals(): Promise<boolean> {
  try {
    await assertAnyPermission(["inventory.manage", "procurement.approve", "intelligence.manage"]);
    return true;
  } catch {
    return false;
  }
}
