import { describe, it, expect, beforeEach } from "vitest";
import {
  loginLimiter,
  ipLimiter,
  __resetLimitersForTests,
} from "@/server/auth/rateLimit";

beforeEach(() => {
  __resetLimitersForTests();
});

describe("login rate limiter", () => {
  it("allows attempts up to the ceiling, then blocks", () => {
    const limiter = loginLimiter();
    const key = "1.2.3.4|user@example.com";
    // Ceiling is 8 for the per-account limiter.
    for (let i = 0; i < 8; i++) {
      expect(limiter.allow(key)).toBe(true);
      limiter.record(key);
    }
    expect(limiter.allow(key)).toBe(false);
  });

  it("counts attempts within the window", () => {
    const limiter = loginLimiter();
    limiter.record("k");
    limiter.record("k");
    expect(limiter.attempts("k")).toBe(2);
  });

  it("clears on a successful sign-in so a user is not locked out forever", () => {
    const limiter = loginLimiter();
    const key = "9.9.9.9|user@example.com";
    for (let i = 0; i < 8; i++) limiter.record(key);
    expect(limiter.allow(key)).toBe(false);
    limiter.reset(key);
    expect(limiter.allow(key)).toBe(true);
    expect(limiter.attempts(key)).toBe(0);
  });

  it("tracks keys independently", () => {
    const limiter = loginLimiter();
    for (let i = 0; i < 8; i++) limiter.record("a|b");
    expect(limiter.allow("a|b")).toBe(false);
    expect(limiter.allow("c|d")).toBe(true);
  });

  it("applies a separate, looser ceiling per IP", () => {
    const perAccount = loginLimiter();
    const perIp = ipLimiter();
    // Per-IP ceiling is 25, so 8 failures must not exhaust it.
    for (let i = 0; i < 8; i++) perAccount.record("5.5.5.5|x@y.z");
    expect(perIp.allow("5.5.5.5")).toBe(true);
    for (let i = 0; i < 25; i++) perIp.record("5.5.5.5");
    expect(perIp.allow("5.5.5.5")).toBe(false);
  });

  it("survives repeated module reloads by reusing the global store", () => {
    const first = loginLimiter();
    first.record("persist|key");
    // A second call must return the same limiter instance, not a fresh one.
    expect(loginLimiter().attempts("persist|key")).toBe(1);
  });
});