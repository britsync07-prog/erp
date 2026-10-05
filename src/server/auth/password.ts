import "server-only";
import bcrypt from "bcryptjs";

// Password policy lives in src/domain/password.ts (pure, shared with CLI
// scripts that run outside Next.js). Re-exported here so server code has one
// obvious import site.
export {
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  isPasswordAcceptable,
  assertPasswordAcceptable,
} from "@/domain/password";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}