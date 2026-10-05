/**
 * Production bootstrap: create the organisation, the RBAC roles, and the first
 * OWNER account. Idempotent — safe to re-run.
 *
 *   docker compose exec app npx tsx prisma/bootstrap.ts
 *
 * Deliberately separate from prisma/seed.ts: the seed writes demo master data
 * (customers, suppliers, products) that must never appear in production. This
 * script creates only what is required to sign in and invite real users.
 *
 * Required environment:
 *   INITIAL_ADMIN_EMAIL     real address, not the demo one
 *   INITIAL_ADMIN_PASSWORD  12+ chars, 3 of 4 character classes
 *   ORGANISATION_NAME       legal/trading name of the first company
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS, type RoleCode } from "../src/domain/constants";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "../src/domain/password";

const db = new PrismaClient();

async function main() {
  const email = (process.env.INITIAL_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD ?? "";
  const orgName = (process.env.ORGANISATION_NAME ?? "").trim();

  const problems: string[] = [];
  if (!email) problems.push("INITIAL_ADMIN_EMAIL is not set.");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push("INITIAL_ADMIN_EMAIL is not a valid address.");
  else if (email === "admin@demo.local") problems.push("INITIAL_ADMIN_EMAIL is still the demo address.");
  if (!password) problems.push("INITIAL_ADMIN_PASSWORD is not set.");
  else {
    const issue = passwordProblem(password);
    if (issue) problems.push(`INITIAL_ADMIN_PASSWORD rejected: ${issue}`);
  }
  if (!orgName) problems.push("ORGANISATION_NAME is not set.");
  if (problems.length > 0) {
    throw new Error(`Refusing to bootstrap:\n  - ${problems.join("\n  - ")}`);
  }

  const org = await db.organisation.upsert({
    where: { id: "org-1" },
    update: {},
    create: {
      id: "org-1",
      name: orgName,
      email,
      city: process.env.ORGANISATION_CITY ?? null,
      country: process.env.ORGANISATION_COUNTRY ?? "IT",
      currency: process.env.ORGANISATION_CURRENCY ?? "EUR",
      locale: "en",
    },
  });
  console.log(`Organisation ready: ${org.name} (${org.id})`);

  for (const code of Object.keys(ROLE_PERMISSIONS) as RoleCode[]) {
    await db.role.upsert({
      where: { organisationId_code: { organisationId: org.id, code } },
      update: { permissions: ROLE_PERMISSIONS[code] },
      create: {
        organisationId: org.id,
        code,
        name: code.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
        permissions: ROLE_PERMISSIONS[code],
        isSystem: true,
      },
    });
  }
  console.log(`Roles ready: ${Object.keys(ROLE_PERMISSIONS).length}`);

  const ownerRole = await db.role.findUniqueOrThrow({
    where: { organisationId_code: { organisationId: org.id, code: "OWNER" } },
  });

  const existing = await db.user.findFirst({
    where: { organisationId: org.id, email },
  });
  if (existing) {
    console.log(`Owner already exists for ${email} — leaving credentials untouched.`);
  } else {
    await db.user.create({
      data: {
        organisationId: org.id,
        roleId: ownerRole.id,
        name: process.env.INITIAL_ADMIN_NAME ?? "Owner",
        email,
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      },
    });
    console.log(`Owner created: ${email} (must change password at first sign-in)`);
  }

  console.log(`\nNext: sign in, then create real users in Admin → Users.`);
  console.log(`Password policy: minimum ${PASSWORD_MIN_LENGTH} characters.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());