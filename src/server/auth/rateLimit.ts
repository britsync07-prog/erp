import "server-only";

/**
 * In-process sliding-window limiter for sign-in attempts.
 *
 * Scope note: state lives in this Node process, so it protects a single
 * instance (the documented VPS + Docker Compose topology). If the app is ever
 * scaled horizontally, move this to Postgres or Redis — `Limiter` is
 * deliberately narrow so that swap stays mechanical.
 */

export interface Limiter {
  allow(key: string): boolean;
  record(key: string): void;
  reset(key: string): void;
  attempts(key: string): number;
}

interface Bucket {
  hits: number[];
  blockedUntil: number;
}

function createLimiter(windowMs: number, max: number): Limiter {
  // Survive dev-server module reloads and avoid leaking buckets across requests.
  const store = new Map<string, Bucket>();
  let lastSweep = Date.now();

  function prune(now: number) {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, b] of store) {
      b.hits = b.hits.filter((t) => now - t < windowMs);
      if (b.hits.length === 0 && b.blockedUntil <= now) store.delete(key);
    }
  }

  return {
    allow(key) {
      const now = Date.now();
      prune(now);
      const b = store.get(key);
      if (!b) return true;
      if (b.blockedUntil > now) return false;
      return b.hits.length < max;
    },
    record(key) {
      const now = Date.now();
      const b = store.get(key) ?? { hits: [], blockedUntil: 0 };
      b.hits.push(now);
      if (b.hits.length >= max) {
        // Escalating backoff, capped at one full window.
        const over = b.hits.length - max;
        b.blockedUntil = now + Math.min(windowMs, 30_000 * 2 ** Math.min(over, 5));
      }
      store.set(key, b);
    },
    reset(key) {
      store.delete(key);
    },
    attempts(key) {
      const b = store.get(key);
      if (!b) return 0;
      const now = Date.now();
      return b.hits.filter((t) => now - t < windowMs).length;
    },
  };
}

const WINDOW_MS = 15 * 60 * 1000;
/** Per-account ceiling. */
const MAX_ATTEMPTS = 8;
/** Per-IP ceiling, so one host cannot spray many different accounts. */
const MAX_PER_IP = 25;

type Global = typeof globalThis & {
  __loginLimiter?: Limiter;
  __ipLimiter?: Limiter;
};
const g = globalThis as Global;

export function loginLimiter(): Limiter {
  g.__loginLimiter ??= createLimiter(WINDOW_MS, MAX_ATTEMPTS);
  return g.__loginLimiter;
}

export function ipLimiter(): Limiter {
  g.__ipLimiter ??= createLimiter(WINDOW_MS, MAX_PER_IP);
  return g.__ipLimiter;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function __resetLimitersForTests(): void {
  delete g.__loginLimiter;
  delete g.__ipLimiter;
}