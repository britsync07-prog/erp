import { describe, it, expect } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  isPasswordAcceptable,
} from "@/domain/password";

describe("password policy", () => {
  it("rejects anything shorter than the minimum", () => {
    expect(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(/at least/);
    expect(passwordProblem("")).toMatch(/enter a password/);
  });

  it("requires at least three character classes", () => {
    // 12+ chars but lowercase + digits only.
    expect(passwordProblem("abcdefghij12")).toMatch(/three of/);
    // Three classes is enough.
    expect(passwordProblem("Abcdefghij12")).toBeNull();
  });

  it("rejects common and predictable fragments even when long enough", () => {
    expect(passwordProblem("Password12345!")).toMatch(/common word/);
    expect(passwordProblem("MyDonerERP2026")).toMatch(/common word/);
  });

  it("accepts a strong passphrase", () => {
    expect(passwordProblem("Coriander-Lantern-92!")).toBeNull();
    expect(isPasswordAcceptable("Coriander-Lantern-92!")).toBe(true);
  });

  it("caps absurd lengths so the input cannot be used as a buffer", () => {
    expect(passwordProblem("A1!".repeat(100))).toMatch(/200 characters or fewer/);
  });

  it("rejects non-string input defensively", () => {
    expect(passwordProblem(undefined)).toMatch(/enter a password/);
    expect(passwordProblem(12345678901234)).toMatch(/enter a password/);
  });
});