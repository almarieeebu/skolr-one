// Clicks through the Applicant Portal in DEMO MODE and saves screenshots/applicant-*.png.
// Usage: start the app with no Supabase env (`npm run dev` or `npm run build && npm start`), then:
//   BASE_URL=http://localhost:3000 node scripts/applicant-walkthrough.cjs
// Needs Playwright (npm i -D playwright && npx playwright install chromium).
//
// Flow: fill /apply (4 pages, phone 390) -> credentials -> sign in to /portal -> new password ->
// "checking your papers" -> update a detail -> send a follow-up -> registrar (desktop 1440)
// replies + needs fix -> applicant sees the note, re-uploads -> registrar accepts papers +
// assigns the ID -> the applicant is now a student.
const { chromium } = require("playwright");
const path = require("node:path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(__dirname, "..", "screenshots");
const TERM_COLLEGE_1ST = "00000000-0000-4000-8000-7e0000000001";

// A tiny valid PNG (1x1) and PDF for the uploads.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function expectText(page, testId, text) {
  await page.getByTestId(testId).filter({ hasText: text }).first().waitFor({ timeout: 10000 });
  console.log(`  ok: ${testId} shows "${text}"`);
}

(async () => {
  const browser = await chromium.launch();
  // One context: the phone and the desktop page share the demo data (localStorage).
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  const desk = await context.newPage();
  await desk.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  for (const p of [phone, desk]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  }
  const shot = async (page, name, opts = {}) => {
    // Full-page shots: start at the top so the sticky header sits where it belongs.
    if (opts.fullPage) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, `applicant-${name}.png`), ...opts });
    console.log(`  saved applicant-${name}.png`);
  };
  const quiet = (page) => page.locator('[role="status"]').waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
  const noOverflow = async (page, where) => {
    const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (o) throw new Error(`horizontal overflow on the phone: ${where}`);
  };

  // ---------- 1. the public form (phone) ----------
  console.log("form");
  await phone.goto(`${BASE}/apply`);
  await phone.evaluate(() => localStorage.clear());
  await phone.goto(`${BASE}/apply/SA`);
  await phone.getByTestId("ap-page-1").waitFor();
  // Next with empty fields shows what is missing.
  await phone.getByTestId("ap-next").click();
  await phone.getByText("Please enter the last name.").waitFor();
  await phone.getByTestId("ap-last-name").fill("Santos");
  await phone.getByTestId("ap-first-name").fill("Lea");
  await phone.getByTestId("ap-middle-name").fill("Reyes");
  await phone.getByTestId("ap-birth-date").fill("2008-02-14");
  await phone.getByTestId("ap-sex-F").click();
  await phone.getByTestId("ap-contact").fill("0917 123 4567");
  await phone.getByTestId("ap-email").fill("lea.santos@example.com");
  await phone.getByTestId("ap-address").fill("12 Mabini St, Brgy. San Isidro, Cainta, Rizal");
  await phone.getByTestId("ap-guardian-name").fill("Rosa Santos");
  await phone.getByTestId("ap-guardian-contact").fill("09187654321");
  await shot(phone, "1-form-personal", { fullPage: true });
  await noOverflow(phone, "form page 1");
  await phone.getByTestId("ap-next").click();

  await phone.getByTestId("ap-page-2").waitFor();
  await phone.getByTestId("ap-track-college").click();
  await phone.getByTestId("ap-school-year").selectOption("2026-2027");
  await phone.getByTestId("ap-semester").selectOption(TERM_COLLEGE_1ST);
  await phone.getByTestId("ap-course").selectOption("BSIT");
  await phone.getByTestId("ap-level").selectOption("1st Year");
  await phone.getByTestId("ap-student-type").selectOption("new");
  await shot(phone, "2-form-program", { fullPage: true });
  await noOverflow(phone, "form page 2");
  await phone.getByTestId("ap-next").click();

  await phone.getByTestId("ap-page-3").waitFor();
  await phone.getByTestId("ap-next").click();
  await phone.getByText("Please add a picture of the student.").waitFor();
  await phone.getByTestId("ap-file-photo").setInputFiles({ name: "lea-2x2.png", mimeType: "image/png", buffer: PNG });
  await phone.getByTestId("ap-file-form_138").setInputFiles({ name: "form138-lea.pdf", mimeType: "application/pdf", buffer: PDF });
  await shot(phone, "3-form-papers", { fullPage: true });
  await noOverflow(phone, "form page 3");
  await phone.getByTestId("ap-next").click();

  await phone.getByTestId("ap-page-4").waitFor();
  await phone.getByTestId("ap-certify").check();
  await phone.getByTestId("ap-signed-name").fill("Lea Reyes Santos");
  const pad = await phone.getByTestId("ap-signature-pad").boundingBox();
  await phone.mouse.move(pad.x + 30, pad.y + 80);
  await phone.mouse.down();
  for (let i = 0; i <= 20; i++) await phone.mouse.move(pad.x + 30 + i * 12, pad.y + 80 - Math.sin(i / 2) * 30);
  await phone.mouse.up();
  await shot(phone, "4-form-confirm", { fullPage: true });
  await noOverflow(phone, "form page 4");
  await phone.getByTestId("ap-submit").click();

  await phone.getByTestId("ap-success").waitFor();
  const applicantNo = (await phone.getByTestId("ap-cred-no").innerText()).trim();
  const tempPassword = (await phone.getByTestId("ap-cred-password").innerText()).trim();
  if (applicantNo !== "APP-2026-00003") throw new Error(`unexpected applicant number ${applicantNo}`);
  if (!/^[a-z]+-[a-z]+-[a-z]+-\d{2}$/.test(tempPassword)) throw new Error(`unexpected password ${tempPassword}`);
  console.log(`  ok: credentials ${applicantNo} / ${tempPassword}`);
  await shot(phone, "5-credentials", { fullPage: true });
  await noOverflow(phone, "credentials");

  // ---------- 2. the portal (phone) ----------
  console.log("portal");
  await phone.getByTestId("ap-go-portal").click();
  await phone.getByTestId("portal-login").waitFor();
  await phone.getByTestId("portal-login-id").fill(applicantNo.toLowerCase());
  await phone.getByTestId("portal-login-password").fill(tempPassword);
  await phone.getByTestId("portal-login-submit").click();
  await phone.getByTestId("portal-new-password").waitFor();
  console.log("  ok: asked for a new password");
  await phone.getByTestId("portal-new-pw").fill("leasantos2026");
  await phone.getByTestId("portal-new-pw2").fill("leasantos2026");
  await phone.getByTestId("portal-new-pw-save").click();
  await expectText(phone, "portal-stage", "We are checking your papers");
  await quiet(phone);
  await shot(phone, "6-portal-checking", { fullPage: true });
  await noOverflow(phone, "portal");

  // Update a detail (new mobile number).
  await phone.getByRole("button", { name: /Update details/ }).click();
  await phone.getByTestId("portal-details").getByTestId("ap-contact").fill("09201112222");
  await phone.getByTestId("portal-details-save").click();
  await phone.getByText("Saved. The registrar can see your changes.").waitFor();
  console.log("  ok: details saved");

  // Send a follow-up.
  await phone.getByTestId("portal-request-type-follow_up").click();
  await phone.getByTestId("portal-request-message").fill("I uploaded my Form 138. My PSA birth certificate will follow tomorrow.");
  await phone.getByTestId("portal-request-send").click();
  await expectText(phone, "request-list", "PSA birth certificate will follow");
  await quiet(phone);
  await phone.getByTestId("portal-request-form").scrollIntoViewIfNeeded();
  await shot(phone, "7-portal-follow-up", { fullPage: true });

  // ---------- 3. the registrar replies and asks for a fix (desktop) ----------
  console.log("registrar");
  await desk.goto(BASE);
  await desk.getByTestId("role-switcher").waitFor();
  await desk.getByTestId("role-switcher").selectOption("registrar");
  await desk.waitForTimeout(250);
  await desk.getByTestId("requests-chip").getByRole("button").click();
  const leaRow = desk.getByTestId("enrollment-list").locator('[data-testid^="row-"]', { hasText: "Santos, Lea" });
  await leaRow.click();
  await expectText(desk, "card-requests", "will follow tomorrow");
  await desk.getByRole("button", { name: /History/ }).click();
  await expectText(desk, "history", "Contact number: 09171234567 → 09201112222");
  await desk.getByTestId("reply-text").fill("Thanks, Lea! We got your Form 138. Please upload the PSA here when you have it.");
  await shot(desk, "8-registrar-requests");
  await desk.getByTestId("reply-send").click();
  await expectText(desk, "card-requests", "We got your Form 138");
  await desk.getByTestId("action-needs_fix").click();
  await desk.getByTestId("reason-text").fill("Your PSA birth certificate is missing. Please upload a clear copy.");
  await desk.getByRole("button", { name: "Confirm needs fix" }).click();
  await expectText(desk, "card-status", "Applied");
  await quiet(desk);
  await shot(desk, "9-registrar-needs-fix");

  // ---------- 4. the applicant sees the note and re-uploads (phone) ----------
  console.log("applicant fixes");
  await phone.goto(`${BASE}/portal`);
  await expectText(phone, "portal-stage", "Needs a fix: Your PSA birth certificate is missing");
  await expectText(phone, "request-reply", "We got your Form 138");
  await phone.getByTestId("portal-upload-psa_birth_cert").setInputFiles({ name: "psa-lea.pdf", mimeType: "application/pdf", buffer: PDF });
  await phone.getByText("PSA birth certificate uploaded.").waitFor();
  await expectText(phone, "portal-papers", "psa-lea.pdf");
  await quiet(phone);
  await shot(phone, "10-portal-needs-fix-reuploaded", { fullPage: true });
  await noOverflow(phone, "portal needs fix");

  // ---------- 5. the registrar accepts the papers and assigns the ID (desktop) ----------
  console.log("registrar accepts");
  await desk.goto(BASE);
  await desk.getByTestId("enrollment-list").locator('[data-testid^="row-"]', { hasText: "Santos, Lea" }).click();
  await desk.getByTestId("action-accept_papers").click();
  await expectText(desk, "card-status", "Papers checked");
  await desk.getByTestId("action-assign_id").click();
  await expectText(desk, "student-no", "SA-2026-0005");
  await quiet(desk);
  await shot(desk, "11-registrar-assigned-id");

  // ---------- 6. the applicant is now a student (phone) ----------
  console.log("now a student");
  await phone.goto(`${BASE}/portal`);
  await expectText(phone, "portal-stage", "Accepted! Your student number is SA-2026-0005");
  await phone.getByTestId("portal-now-student").waitFor();
  await phone.getByRole("button", { name: /Update details/ }).click();
  await phone.getByTestId("portal-details-locked").waitFor();
  console.log("  ok: details locked after the papers were checked");
  await shot(phone, "12-portal-now-student", { fullPage: true });
  // Same password, and the student number works as a login too.
  await phone.getByTestId("portal-signout").click();
  await phone.getByTestId("portal-login-id").fill("SA-2026-0005");
  await phone.getByTestId("portal-login-password").fill("leasantos2026");
  await phone.getByTestId("portal-login-submit").click();
  await phone.getByTestId("portal-now-student").waitFor();
  console.log("  ok: signed in with the student number");
  await phone.getByTestId("portal-open-main").click();
  await expectText(phone, "enrollment-list", "Santos, Lea");
  const role = await phone.getByTestId("role-switcher").inputValue();
  if (role !== "student") throw new Error(`main app role is ${role}, not student`);
  console.log("  ok: main app opens as the student");
  await shot(phone, "13-student-app");

  // ---------- 7. the header's "Applicant" opens the seeded applicant ----------
  await desk.goto(BASE);
  await desk.getByTestId("role-switcher").selectOption("applicant");
  await expectText(desk, "portal-stage", "Needs a fix: Your Form 138 photo is blurry");
  await expectText(desk, "request-reply", "You can change it in Update details");
  console.log("  ok: header Applicant opens Kevin's portal");

  await browser.close();
  if (errors.length) {
    console.log("Browser errors:\n" + errors.join("\n"));
    process.exitCode = 1;
  }
  console.log("Applicant walkthrough finished.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
