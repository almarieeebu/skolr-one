import { describe, expect, it } from "vitest";
import { PASSWORD_HINT, RESET_SENT, SIGN_IN_FAILED, checkNewPassword, isEmailAddress, resetRedirectUrl, safeNextPath } from ".";

describe("new password", () => {
  it("needs 8 characters, a letter and a number, typed twice the same", () => {
    expect(checkNewPassword("", "")).toEqual(["Use at least 8 characters.", "Use letters and at least one number."]);
    expect(checkNewPassword("abc1234", "abc1234")).toEqual(["Use at least 8 characters."]);
    expect(checkNewPassword("abcdefgh", "abcdefgh")).toEqual(["Use letters and at least one number."]);
    expect(checkNewPassword("12345678", "12345678")).toEqual(["Use letters and at least one number."]);
    expect(checkNewPassword("abcd1234", "abcd1235")).toEqual(["The two passwords do not match."]);
    expect(checkNewPassword("abcd1234", "abcd1234")).toEqual([]);
  });
  it("the hint says the same rules", () => {
    expect(PASSWORD_HINT).toMatch(/8 characters/);
  });
});

describe("forgot password", () => {
  it("checks the email shape only", () => {
    expect(isEmailAddress("rosa@school.edu.ph")).toBe(true);
    expect(isEmailAddress("  rosa@school.edu.ph ")).toBe(true);
    expect(isEmailAddress("SA-2026-0005")).toBe(false);
    expect(isEmailAddress("rosa@school")).toBe(false);
  });
  it("sends the link through the auth callback to /reset-password", () => {
    expect(resetRedirectUrl("https://skolr-one.vercel.app")).toBe("https://skolr-one.vercel.app/auth/callback?next=/reset-password");
    expect(resetRedirectUrl("http://localhost:3000/")).toBe("http://localhost:3000/auth/callback?next=/reset-password");
  });
  it("never says whether the email exists", () => {
    expect(RESET_SENT).toMatch(/^If that email is on file/);
  });
});

describe("sign in", () => {
  it("has one message for an unknown login and a wrong password", () => {
    expect(SIGN_IN_FAILED).toBe("Wrong login or password.");
  });
  it("only follows paths on this site after the callback", () => {
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("", "/login")).toBe("/login");
  });
});
