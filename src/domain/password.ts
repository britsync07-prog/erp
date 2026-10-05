/**
 * Password policy — pure domain logic, no I/O, so it is shared by the server
 * (bcrypt hashing) and by CLI bootstrap scripts that run outside Next.js.
 *
 * Deliberately length-first rather than symbol-class gymnastics: long
 * passphrases are both stronger and easier for non-technical staff to use.
 */
export const PASSWORD_MIN_LENGTH = 12;

const COMMON_FRAGMENTS = [
  "password", "passwort", "123456", "12345678", "qwerty", "admin", "welcome",
  "letmein", "changeme", "iloveyou", "monkey", "dragon", "football", "abc123",
  "erp", "doner",
];

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Please enter a password.";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password must be 200 characters or fewer.";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    return "Password must include at least three of: lowercase, uppercase, number, symbol.";
  }
  const lower = password.toLowerCase();
  if (COMMON_FRAGMENTS.some((c) => lower.includes(c))) {
    return "That password contains a very common word. Please choose something less predictable.";
  }
  return null;
}

export function isPasswordAcceptable(password: unknown): boolean {
  return passwordProblem(password) === null;
}

export function assertPasswordAcceptable(password: unknown): void {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
}