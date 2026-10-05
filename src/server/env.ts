import "server-only";

/**
 * Fail-fast environment validation.
 *
 * Imported for its side effect from the proxy and from `instrumentation.ts`,
 * so a misconfigured production deploy refuses to boot instead of silently
 * running with a known dev secret. In development it only warns.
 */

const DEV_SESSION_SECRETS = new Set([
  "dev-only-change-me-min-32-chars-1234567890",
  "generate-a-32-plus-byte-secret-per-environment",
]);
const DEV_CRON_SECRETS = new Set([
  "dev-only-cron-secret-change-me",
  "generate-a-long-random-secret",
]);

const problems: string[] = [];

function requireSecret(name: string, devValues: Set<string>, minLength: number): void {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    problems.push(`${name} is not set.`);
    return;
  }
  if (value.length < minLength) {
    problems.push(`${name} must be at least ${minLength} characters (got ${value.length}).`);
  }
  if (devValues.has(value)) {
    problems.push(`${name} still uses the example value from .env.example — generate a real one.`);
  }
  if (/^(change-?me|secret|password)/i.test(value)) {
    problems.push(`${name} looks like a placeholder.`);
  }
}

function check() {
  if (problems.length > 0) return;

  requireSecret("SESSION_SECRET", DEV_SESSION_SECRETS, 32);
  requireSecret("CRON_SECRET", DEV_CRON_SECRETS, 24);

  const url = process.env.DATABASE_URL;
  if (!url) {
    problems.push("DATABASE_URL is not set.");
  } else if (process.env.NODE_ENV === "production" && url.startsWith("file:")) {
    problems.push(
      "DATABASE_URL points at SQLite in production. Use PostgreSQL — SQLite is single-writer and its file is not durable across deploys.",
    );
  }

  const base = process.env.APP_BASE_URL;
  if (!base) {
    problems.push("APP_BASE_URL is not set.");
  } else if (process.env.NODE_ENV === "production" && !base.startsWith("https://")) {
    problems.push("APP_BASE_URL must use https:// in production.");
  }

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const seedEmail = process.env.SEED_ADMIN_EMAIL;
    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (seedEmail && seedPassword && seedPassword === "ChangeMe123!") {
      problems.push("SEED_ADMIN_PASSWORD is still the demo value — never seed production with it.");
    }
  }

  if (problems.length > 0 && isProd) {
    throw new Error(
      `Refusing to start: invalid environment configuration.\n  - ${problems.join("\n  - ")}`,
    );
  }
  if (problems.length > 0 && !isProd) {
    console.warn(
      `[env] development warnings:\n  - ${problems.join("\n  - ")}\n` +
        "These are acceptable locally but will block a production boot.",
    );
  }
}

check();

export const envChecked = true;