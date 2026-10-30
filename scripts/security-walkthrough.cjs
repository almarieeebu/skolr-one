// Clicks through the password screens in DEMO MODE and saves screenshots:
// "Forgot password?" on /login, the neutral "If that email is on file" message,
// /reset-password, and the Change password panel (staff app and Applicant Portal).
// Usage: start `npm run dev` (no Supabase env), then:
//   BASE_URL=http://localhost:3000 node scripts/security-walkthrough.cjs
const { chromium } = require("playwright");
const path = require("node:path");
const { toast, quiet, assertNoOverflow } = require("./ui-helpers.cjs");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.SHOTS_DIR || path.join(__dirname, "..", "screenshots");
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `security-${name}.png`) });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());

  // 1. /login shows "Forgot password?"
  await page.goto(`${BASE}/login`);
  await page.getByTestId("forgot-password").filter({ hasText: "Forgot password?" }).waitFor();
  console.log('  ok: /login shows "Forgot password?"');
  await shot(page, "1-login");

  // 2. Forgot password: the same message for any email
  await page.getByTestId("forgot-password").click();
  await page.getByTestId("forgot-form").waitFor();
  await page.getByTestId("forgot-email").fill("someone@school.edu.ph");
  await page.getByTestId("forgot-submit").click();
  await page.getByTestId("reset-sent").filter({ hasText: "If that email is on file" }).waitFor();
  console.log("  ok: neutral message after Forgot password");
  await shot(page, "2-forgot-sent");

  // 3. Reset page (demo: practice only): mismatched, then a good password
  await page.getByRole("link", { name: "Open the page the link would open" }).click();
  await page.getByTestId("reset-new-password").waitFor();
  await page.getByTestId("reset-new-pw").fill("short1");
  await page.getByTestId("reset-new-pw2").fill("short2");
  await page.getByTestId("reset-new-pw-save").click();
  await page.getByRole("alert").filter({ hasText: "Use at least 8 characters." }).waitFor();
  await page.getByRole("alert").filter({ hasText: "The two passwords do not match." }).waitFor();
  console.log("  ok: reset page checks length and the second box");
  await shot(page, "3-reset-checks");
  await page.getByTestId("reset-new-pw").fill("newpass2026");
  await page.getByTestId("reset-new-pw2").fill("newpass2026");
  await page.getByTestId("reset-new-pw-save").click();
  await page.getByTestId("reset-done").waitFor();
  console.log("  ok: reset page saved (demo)");

  // 4. Staff app: account menu -> Change password
  await page.goto(BASE);
  await page.getByTestId("workspace").waitFor();
  await page.getByTestId("account-button").click();
  await page.getByTestId("change-password").click();
  await page.getByTestId("password-panel").waitFor();
  console.log("  ok: Change password panel opens");
  await page.getByTestId("account-new-pw").fill("abc");
  await page.getByTestId("account-new-pw2").fill("abc");
  await page.getByTestId("account-new-pw-save").click();
  await page.getByTestId("password-panel").getByRole("alert").filter({ hasText: "Use at least 8 characters." }).waitFor();
  await shot(page, "4-change-password");
  await page.getByTestId("account-new-pw").fill("registrar2026");
  await page.getByTestId("account-new-pw2").fill("registrar2026");
  await page.getByTestId("account-new-pw-save").click();
  await toast(page, "Password changed.");
  await quiet(page);

  // 5. Phone: Account tab -> Change password
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(BASE);
  await phone.getByTestId("workspace").waitFor();
  await phone.getByTestId("tab-account").click();
  await phone.getByTestId("change-password").click();
  await phone.getByTestId("password-panel").waitFor();
  await assertNoOverflow(phone, "change password (390)");
  await shot(phone, "5-change-password-phone");

  // 6. Applicant Portal: sign-in has "Forgot password?", and Change password still works
  await page.goto(`${BASE}/portal`);
  await page.getByTestId("portal-forgot-password").waitFor();
  await page.getByTestId("portal-login-id").fill("APP-2026-00002");
  await page.getByTestId("portal-login-password").fill("wrong-pass-1");
  await page.getByTestId("portal-login-submit").click();
  await page.getByRole("alert").filter({ hasText: "Wrong login or password." }).waitFor();
  await page.getByTestId("portal-login-id").fill("APP-2099-99999");
  await page.getByTestId("portal-login-submit").click();
  await page.getByRole("alert").filter({ hasText: "Wrong login or password." }).waitFor();
  console.log("  ok: same message for a wrong password and an unknown number");
  await page.getByTestId("portal-login-id").fill("APP-2026-00002");
  await page.getByTestId("portal-login-password").fill("password123");
  await page.getByTestId("portal-login-submit").click();
  await page.getByTestId("portal").waitFor();
  await page.getByTestId("account-button").click();
  await page.getByTestId("portal-change-password").click();
  await page.getByTestId("portal-password-panel").waitFor();
  await shot(page, "6-portal-change-password");
  console.log("  ok: portal Change password panel opens");

  await browser.close();
  if (errors.length) {
    console.error("Console errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("security walkthrough done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
