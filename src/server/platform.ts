import "server-only";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";

// §28 audit: every important mutation writes actor/action/entity/old/new/source.
// Audit rows are append-only — no service in this codebase updates or deletes them.
export async function audit(input: {
  orgId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  actor?: Pick<SessionUser, "id" | "name"> | null;
  source?: string;
  client?: PrismaClient;
}): Promise<void> {
  const client = input.client ?? db;
  await client.auditLog.create({
    data: {
      orgId: input.orgId,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? "system",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValue: (input.oldValue ?? null) as never,
      newValue: (input.newValue ?? null) as never,
      source: input.source ?? "USER",
    },
  });
}

// §31 activity timeline: human-readable per-entity feed.
export async function activity(input: {
  orgId: string;
  entityType: string;
  entityId: string;
  message: string;
  actor?: Pick<SessionUser, "id" | "name"> | null;
  source?: string;
  client?: PrismaClient;
}): Promise<void> {
  const client = input.client ?? db;
  await client.activityEvent.create({
    data: {
      orgId: input.orgId,
      entityType: input.entityType,
      entityId: input.entityId,
      message: input.message,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? "system",
      source: input.source ?? "USER",
    },
  });
}

export async function notify(input: {
  orgId: string;
  title: string;
  body?: string;
  link?: string;
  severity?: string;
  userId?: string;
  roleCode?: string;
  client?: PrismaClient;
}): Promise<void> {
  const client = input.client ?? db;
  await client.notification.create({
    data: {
      orgId: input.orgId,
      title: input.title,
      body: input.body,
      link: input.link,
      severity: input.severity ?? "INFO",
      userId: input.userId,
      roleCode: input.roleCode,
    },
  });
}

// §30: never leak technical errors (e.g. "P2002") to normal users.
export function friendlyError(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof Error) {
    const msg = e.message;
    if (msg.includes("P2002")) {
      const field = /Unique constraint failed on the fields?: `([^`]+)`/.exec(msg)?.[1];
      return field
        ? `A record with this ${field.replace(/([A-Z])/g, " $1").trim().toLowerCase()} already exists. Please use another value.`
        : "This record already exists. Please use another value.";
    }
    if (msg.includes("P2003") || msg.includes("Foreign key")) {
      return "This record is still referenced elsewhere and cannot be removed.";
    }
    if (msg.includes("P2025")) return "The record was not found. It may have been deleted.";
    if (e.name === "AuthError" || e.name === "ForbiddenError") return msg;
    if (msg.startsWith("Invalid ") || msg.startsWith("You ") || msg.startsWith("This ") || msg.startsWith("A record")) return msg;
    // Password-policy rejections are user-actionable, not internal errors.
    if (msg.startsWith("Password ")) return msg;
  }
  return fallback;
}

export interface ActionResult<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

export function ok<T>(data?: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}
