/**
 * Security regression tests for session handling.
 *
 * Covers the two production risks that unit tests cannot reach:
 *   1. A deactivated user must lose access immediately, not at token expiry.
 *   2. A role/permission change must take effect immediately.
 *   3. An invited user must carry the must-change-password flag so the proxy
 *      can force them onto the change-password page.
 *
 * The session JWT is signed exactly as production does, then presented through
 * a mocked `next/headers` cookie jar.
 */
import { execSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { PERMISSIONS, type Permission } from "@/domain/constants";

const TEST_DB = path.resolve(process.cwd(), "prisma", "test-session.db");
const ORG = "sec-org";
const SECRET = "test-secret-value-that-is-long-enough-32";

let client: PrismaClient;
let jar: { get(name: string): { value: string } | undefined };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => jar?.get(name),
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock("@/server/db", async () => {
  const { PrismaClient: C } = await import("@prisma/client");
  return { db: new C({ datasourceUrl: `file:${TEST_DB}` }) };
});

async function signToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

beforeAll(async () => {
  process.env.SESSION_SECRET = SECRET;
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

  await client.organisation.create({
    data: { id: ORG, name: "Security Org", currency: "EUR", locale: "en" },
  });
  const owner = await client.role.create({
    data: {
      organisationId: ORG, code: "OWNER", name: "Owner",
      permissions: [...PERMISSIONS], isSystem: true,
    },
  });
  const viewer = await client.role.create({
    data: {
      organisationId: ORG, code: "VIEWER", name: "Viewer",
      permissions: ["products.view"] as unknown as string[], isSystem: true,
    },
  });
  await client.user.create({
    data: {
      organisationId: ORG, roleId: owner.id, name: "Owner Person",
      email: "owner@sec.test", passwordHash: "x", isActive: true,
    },
  });
  await client.user.create({
    data: {
      organisationId: ORG, roleId: viewer.id, name: "Invited Person",
      email: "invited@sec.test", passwordHash: "x", isActive: true,
      mustChangePassword: true,
    },
  });
}, 120000);

afterAll(async () => {
  await client?.$disconnect();
  try {
    await unlink(TEST_DB);
  } catch {
    /* ignore */
  }
});

/** Fresh import so the per-request revalidation cache never leaks between cases. */
async function loadSession() {
  vi.resetModules();
  return (await import("@/server/auth/session")) as typeof import("@/server/auth/session");
}

async function tokenFor(email: string): Promise<string> {
  const user = await client.user.findUniqueOrThrow({
    where: { organisationId_email: { organisationId: ORG, email } },
    include: { role: true },
  });
  return signToken({
    id: user.id,
    orgId: ORG,
    name: user.name,
    email: user.email,
    roleCode: user.role.code,
    permissions: user.role.permissions as unknown as Permission[],
    mustChangePassword: user.mustChangePassword,
    roleId: user.roleId,
  });
}

beforeEach(async () => {
  await client.user.updateMany({ where: { organisationId: ORG }, data: { isActive: true } });
  const viewer = await client.role.findFirstOrThrow({
    where: { organisationId: ORG, code: "VIEWER" },
  });
  await client.user.update({
    where: { organisationId_email: { organisationId: ORG, email: "invited@sec.test" } },
    data: { mustChangePassword: true, roleId: viewer.id },
  });
  // Negative results are cached for a short TTL by design; clear it so cases
  // cannot leak into one another.
  vi.resetModules();
  const { invalidateAllSessions } = await import("@/server/auth/session");
  invalidateAllSessions();
});

describe("session revalidation", () => {
  it("returns null for a tampered or unsigned token", async () => {
    const { getSession } = await loadSession();
    jar = { get: () => ({ value: "not.a.jwt" }) };
    expect(await getSession()).toBeNull();
  });

  it("resolves a valid session to the live user record", async () => {
    const token = await tokenFor("owner@sec.test");
    jar = { get: () => ({ value: token }) };
    const { getSession } = await loadSession();
    expect((await getSession())?.email).toBe("owner@sec.test");
    expect((await getSession())?.roleCode).toBe("OWNER");
  });

  it("revokes the session immediately when the user is deactivated", async () => {
    const ownerToken = await tokenFor("owner@sec.test");
    const targetToken = await tokenFor("invited@sec.test");
    const owner = await client.user.findUniqueOrThrow({
      where: { organisationId_email: { organisationId: ORG, email: "owner@sec.test" } },
    });
    const target = await client.user.findUniqueOrThrow({
      where: { organisationId_email: { organisationId: ORG, email: "invited@sec.test" } },
    });

    jar = { get: () => ({ value: targetToken }) };
    vi.resetModules();
    expect(await (await import("@/server/auth/session")).getSession()).not.toBeNull();

    // Go through the real service so the invalidation hook actually runs.
    jar = { get: () => ({ value: ownerToken }) };
    vi.resetModules();
    const { setUserActive } = await import("@/server/services/admin");
    await setUserActive(
      { id: owner.id, name: owner.name, orgId: ORG },
      target.id,
      false,
    );

    jar = { get: () => ({ value: targetToken }) };
    vi.resetModules();
    const after = await import("@/server/auth/session");
    expect(await after.getSession()).toBeNull();
  });

  it("applies a role change immediately rather than trusting the token", async () => {
    const ownerToken = await tokenFor("owner@sec.test");
    const targetToken = await tokenFor("invited@sec.test");
    jar = { get: () => ({ value: targetToken }) };
    vi.resetModules();
    expect((await (await import("@/server/auth/session")).getSession())?.roleCode).toBe("VIEWER");

    const owner = await client.user.findUniqueOrThrow({
      where: { organisationId_email: { organisationId: ORG, email: "owner@sec.test" } },
    });
    const target = await client.user.findUniqueOrThrow({
      where: { organisationId_email: { organisationId: ORG, email: "invited@sec.test" } },
    });

    jar = { get: () => ({ value: ownerToken }) };
    vi.resetModules();
    const { setUserRole } = await import("@/server/services/admin");
    await setUserRole(
      { id: owner.id, name: owner.name, orgId: ORG },
      target.id,
      owner.roleId,
    );

    jar = { get: () => ({ value: targetToken }) };
    vi.resetModules();
    const after = await import("@/server/auth/session");
    const s = await after.getSession();
    // Live role wins over the role baked into the JWT.
    expect(s?.roleCode).toBe("OWNER");
    expect(s?.permissions).toContain("finance.manage");
  });

  it("surfaces mustChangePassword so the proxy can force a change", async () => {
    const token = await tokenFor("invited@sec.test");
    jar = { get: () => ({ value: token }) };
    vi.resetModules();
    const { getSession } = await import("@/server/auth/session");
    expect((await getSession())?.mustChangePassword).toBe(true);
  });
});