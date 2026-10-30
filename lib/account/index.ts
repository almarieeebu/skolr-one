// Sign-in and password rules shared by /login, /forgot-password, /reset-password
// and the "Change password" panel. Pure TypeScript (tests in account.test.ts).
// The new-password rules themselves live in lib/applicant/password.ts.

export { checkNewPassword } from "../applicant/password";

/** One message for every failed sign-in: it never says whether the login exists. */
export const SIGN_IN_FAILED = "Wrong login or password.";

/** Shown after "Forgot password?", whether or not the email is on file. */
export const RESET_SENT = "If that email is on file, we sent a link to set a new password. Check your inbox (and the spam folder).";

/** Shown next to every new-password box. */
export const PASSWORD_HINT = "At least 8 characters, with a number.";

export function isEmailAddress(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Where the reset email sends people: the auth callback signs them in, then opens /reset-password. */
export function resetRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/auth/callback?next=/reset-password`;
}

/** Only a path on this site ("/reset-password"), never another site ("//evil.com", "https://..."). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
