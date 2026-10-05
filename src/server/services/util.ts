import "server-only";
import type { SessionUser } from "@/server/auth/session";

export const PAGE_SIZE = 20;

export function pageOf(sp?: { page?: string | string[] }): number {
  const raw = Array.isArray(sp?.page) ? sp?.page[0] : sp?.page;
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function paged<T>(items: T[], total: number, page: number, pageSize = PAGE_SIZE) {
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Suggest the next human-friendly code (CUS-004). Uniqueness is still enforced by DB. */
export async function suggestCode(
  countFn: () => Promise<number>,
  prefix: string,
): Promise<string> {
  const n = (await countFn()) + 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export type Actor = Pick<SessionUser, "id" | "name" | "orgId">;
