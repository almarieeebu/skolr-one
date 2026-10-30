// Clicks through the Grades module in DEMO MODE and saves screenshots/grades-*.png.
// Usage: start the app with no Supabase env (`npm run dev` or `npm run build && npm start`), then:
//   BASE_URL=http://localhost:3000 node scripts/grades-walkthrough.cjs
// Needs Playwright (npm i -D playwright && npx playwright install chromium).
//
// Flow: Juan enrolls (1st sem) -> teacher enters IT102 grades -> submits (the
// registrar allows late periods) -> registrar approves -> Juan sees his GWA ->
// teacher enters Grade 7 WW/PT/QA scores -> registrar posts -> parent prints the
// report card -> teacher files a change request -> registrar approves ->
// Juan can now take IT201 (needs IT102) in the 2nd semester.
const { chromium } = require("playwright");
const path = require("node:path");
const H = require("./ui-helpers.cjs");
const { expectText, tab, assertNoPageScroll, assertNoOverflow } = H;

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(__dirname, "..", "screenshots");
const JUAN = "00000000-0000-4000-8000-e00000000001";
const PAOLO = "00000000-0000-4000-8000-e00000000012";
let current = null; // the page, for a screenshot when something fails

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  current = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  let overflow = false;
  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: path.join(OUT, `grades-${name}.png`), ...opts });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (wide) console.log(`  !! horizontal page overflow on ${name}`);
    overflow = overflow || wide;
    console.log(`  saved grades-${name}.png`);
  };
  const quiet = () => H.quiet(page);

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("workspace").waitFor();

  const role = (r) => H.role(page, r);
  const go = (m) => H.openModule(page, m);
  // Enrollment module for staff, "My enrollment" for families.
  const open = async (id, m) => {
    if (m) await go(m);
    await H.openRow(page, id);
  };
  const openClass = async (code, term, m = "grades") => {
    await go(m);
    await page.getByTestId("class-list").waitFor();
    const all = page.getByTestId("filter-all");
    if (await all.count()) await all.first().click();
    await page.getByTestId("class-rows").locator(`[data-testid="class-${code}"]`, { hasText: term ?? "" }).first().click();
    await page.getByTestId("grade-sheet").waitFor();
    await expectText(page, "class-title", code);
  };
  const toast = (t) => H.toast(page, t);
  const pay = async (amount) => {
    await page.getByTestId("action-take_payment").click();
    await page.getByTestId("pay-amount").fill(amount);
    await page.getByTestId("pay-submit").click();
    await page.getByTestId("pay-panel").waitFor({ state: "detached" });
  };

  // ---------- A. Juan enrolls in the 1st semester ----------
  await role("registrar");
  await open(JUAN, "enrollment");
  await page.getByTestId("action-accept_papers").click();
  await expectText(page, "card-status", "Papers checked");
  await page.getByTestId("action-assign_id").click();
  await expectText(page, "student-no", "SA-2026-0005");
  await role("student");
  await open(JUAN, "my");
  await page.getByTestId("action-set_load").click();
  for (const code of ["GE101", "GE102", "IT101", "IT102", "NSTP1"]) await page.getByTestId(`pick-${code}`).check();
  await page.getByTestId("save-load").click();
  await expectText(page, "card-status", "Load set");
  await role("cashier");
  await open(JUAN, "cashier");
  await pay("5000");
  await expectText(page, "card-status", "Assessed & paid");
  await role("registrar");
  await open(JUAN, "enrollment");
  await page.getByTestId("action-approve").click();
  await expectText(page, "card-status", "Officially enrolled");

  // ---------- B. Teacher enters IT102 grades (college) ----------
  await role("teacher");
  await page.getByTestId("class-list").waitFor(); // teachers start on "My classes"
  await openClass("IT102", "2026-2027 1st sem", "classes");
  const cell = (p) => page.getByTestId(`cell-${p}-0`);
  await cell("prelim").click();
  await cell("prelim").fill("88");
  await page.keyboard.press("Tab");
  await page.keyboard.type("90");
  await page.keyboard.press("Tab");
  await page.keyboard.type("89");
  await page.keyboard.press("Tab");
  await page.keyboard.type("92");
  // (88 + 90 + 89 + 92) / 4 = 89.75 -> 90% -> 1.75
  await expectText(page, "final-0", "1.75");
  await page.getByTestId("grade-save").click();
  await toast("Draft saved");
  await page.getByTestId("period-prelim").click();
  await page.getByTestId("grade-submit").click();
  // The 1st sem deadlines are over: the teacher sees the warning.
  await expectText(page, "grade-error", "deadline");
  await quiet();
  await shot("1-teacher-college-sheet");
  await assertNoPageScroll(page, "teacher grade sheet");

  // Registrar allows late submission for each period
  await role("registrar");
  await openClass("IT102", "2026-2027 1st sem");
  for (const p of ["prelim", "midterm", "semifinal", "final"]) {
    await page.getByTestId(`period-${p}`).click();
    if (await page.getByTestId("grade-allow-late").count()) {
      await page.getByTestId("grade-allow-late").click();
      await toast("Late submission allowed");
    }
  }

  // Teacher submits all four periods
  await role("teacher");
  await openClass("IT102", "2026-2027 1st sem", "classes");
  for (const p of ["prelim", "midterm", "semifinal", "final"]) {
    await page.getByTestId(`period-${p}`).click();
    await page.getByTestId("grade-submit").click();
    await toast("submitted for approval");
  }
  await expectText(page, "sheet-locked", "Waiting for the registrar");

  // Registrar: "Grades to approve" -> approve the four periods
  await role("registrar");
  await openClass("IT102", "2026-2027 1st sem");
  await tab(page, "approve");
  await expectText(page, "approve-queue", "Waiting for approval (4)");
  await quiet();
  await shot("2-registrar-approve");
  for (const p of ["prelim", "midterm", "semifinal", "final"]) {
    await page.getByTestId(`approve-${p}`).click();
    await toast("approved and posted");
  }
  await expectText(page, "approve-queue", "Waiting for approval (0)");

  // Student sees the posted grade and GWA
  await role("student");
  await open(JUAN, "mygrades");
  await expectText(page, "grades-section", "IT102");
  await expectText(page, "gwa", "1.75");
  await quiet();
  await shot("3-student-gwa");

  // ---------- C. K to 12: Grade 7 Q2 Mathematics ----------
  await role("teacher");
  await openClass("G7-SAMPAGUITA", "K to 12", "classes");
  await page.getByTestId("area-select").selectOption("MATH");
  await page.getByTestId("period-q2").click();
  await page.getByTestId("score-qa-0-0").fill("42");
  await page.getByTestId("score-qa-0-0").press("Enter"); // Enter moves down to the next learner
  await page.keyboard.type("38");
  await page.getByTestId("quarterly-0").filter({ hasText: /\d\d/ }).waitFor();
  const q = await page.getByTestId("quarterly-0").innerText();
  console.log(`  ok: live quarterly grade ${q.replace(/\s+/g, " ")}`);
  await quiet();
  await shot("4-teacher-k12-sheet");
  await page.screenshot({ path: path.join(OUT, "design-teacher-grade-sheet.png") });
  await assertNoPageScroll(page, "teacher K to 12 sheet");
  await page.getByTestId("grade-submit").click();
  const late = await page.getByTestId("grade-error").filter({ hasText: "deadline" }).count().catch(() => 0);
  if (late) {
    await role("registrar");
    await openClass("G7-SAMPAGUITA", "K to 12");
    await page.getByTestId("area-select").selectOption("MATH");
    await page.getByTestId("period-q2").click();
    await page.getByTestId("grade-allow-late").click();
    await role("teacher");
    await openClass("G7-SAMPAGUITA", "K to 12", "classes");
    await page.getByTestId("area-select").selectOption("MATH");
    await page.getByTestId("period-q2").click();
    await page.getByTestId("grade-submit").click();
  }
  await toast("submitted for approval");

  // Registrar posts it
  await role("registrar");
  await openClass("G7-SAMPAGUITA", "K to 12");
  await tab(page, "approve");
  await page.getByTestId("approve-q2-MATH").click();
  await toast("approved and posted");

  // Parent sees the report card (Q1 all areas, Q2 Mathematics)
  await role("parent");
  await open(PAOLO, "mygrades");
  await expectText(page, "grades-section", "Mathematics");
  await quiet();
  await shot("5-parent-grades");
  await page.screenshot({ path: path.join(OUT, "design-parent-grades.png") });
  await assertNoPageScroll(page, "parent grades");
  await page.evaluate(() => (window.print = () => {}));
  await page.getByTestId("print-report-card").click();
  await page.emulateMedia({ media: "print" });
  await page.getByTestId("report-card").waitFor();
  await shot("6-report-card-print", { fullPage: true });
  await page.emulateMedia({ media: "screen" });

  // ---------- D. Change grade request ----------
  await role("teacher");
  await openClass("IT102", "2026-2027 1st sem", "classes");
  await page.getByTestId("period-final").click();
  await page.getByTestId("cgr-open").click();
  await page.getByTestId("cgr-panel").waitFor();
  await page.getByTestId("cgr-value").fill("97");
  await page.getByTestId("cgr-reason").fill("Final exam re-checked: project score was not added.");
  await page.getByTestId("cgr-submit").click();
  await toast("Change request sent");
  await role("registrar");
  await openClass("IT102", "2026-2027 1st sem");
  await tab(page, "changes");
  await expectText(page, "change-requests", "92% → 97%");
  await quiet();
  await shot("7-change-request");
  await page.getByTestId("cgr-approve").first().click();
  await toast("Grade change approved");
  // (88 + 90 + 89 + 97) / 4 = 91 -> 1.50
  await tab(page, "sheet");
  await expectText(page, "final-0", "1.50");
  await tab(page, "history");
  await expectText(page, "sheet-history", "Grade changed 92% → 97%");
  await role("student");
  await open(JUAN, "mygrades");
  await expectText(page, "gwa", "1.50");

  // ---------- E. Prerequisite from a real passed grade ----------
  await role("registrar");
  await go("enrollment");
  await page.getByTestId("new-application").click();
  await page.getByTestId("new-application-form").waitFor();
  await page.getByTestId("term-select").selectOption({ label: "2026-2027, 2nd semester" });
  await page.getByTestId("returning-select").selectOption({ label: "Dela Cruz, Juan S. (SA-2026-0005)" });
  await page.getByTestId("submit-application").click();
  await expectText(page, "card-status", "Student ID made");
  await role("student");
  await go("my");
  await page.getByTestId("enrollment-list").locator('[data-testid^="row-"]', { hasText: "2nd sem" }).click();
  await page.getByTestId("student-card").waitFor();
  await page.getByTestId("action-set_load").click();
  await page.getByTestId("pick-IT202").check();
  await expectText(page, "load-picker", "IT202 needs IT201"); // not passed yet: warning
  await page.getByTestId("pick-IT202").uncheck();
  for (const code of ["GE103", "IT201"]) await page.getByTestId(`pick-${code}`).check();
  if (await page.getByTestId("load-picker").filter({ hasText: "IT201 needs" }).count()) throw new Error("IT201 still blocked");
  console.log("  ok: IT201 has no prerequisite warning (IT102 passed)");
  await shot("8-prerequisite-ok");
  await page.getByTestId("save-load").click();
  await expectText(page, "card-status", "Load set");
  await tab(page, "load");
  await expectText(page, "load-table", "IT201");

  // ---------- F. Grade settings (registrar) ----------
  await role("registrar");
  await go("setup");
  await page.getByTestId("setup-grades").click();
  await page.getByTestId("grade-settings").waitFor();
  await page.waitForTimeout(300);
  await shot("9-grade-settings");
  await assertNoPageScroll(page, "Setup, Grade settings");

  // ---------- G. Phone (390px) ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await role("teacher");
  await page.reload();
  await page.getByTestId("class-list").waitFor();
  await shot("10-phone-390-classes");
  await page.getByTestId("class-rows").locator('[data-testid="class-G7-SAMPAGUITA"]').click();
  await page.getByTestId("grade-sheet").waitFor();
  await page.getByTestId("area-select").selectOption("ENG");
  await page.getByTestId("period-q2").click();
  await page.waitForTimeout(300);
  await shot("11-phone-390-k12-sheet");
  const inner = await page.getByTestId("sheet-scroll").evaluate((el) => el.scrollWidth > el.clientWidth);
  console.log(`  grade sheet scrolls inside its own box: ${inner}`);
  await page.getByTestId("back").filter({ visible: true }).first().click();
  await page.getByTestId("class-rows").locator('[data-testid="class-IT102"]', { hasText: "2026-2027 1st sem" }).click();
  await page.getByTestId("grade-sheet").waitFor();
  await shot("12-phone-390-college-sheet");
  await role("parent");
  await page.reload();
  await go("mygrades");
  await H.openRow(page, PAOLO);
  await page.getByTestId("grades-section").filter({ visible: true }).first().waitFor();
  await shot("13-phone-390-parent-grades");
  await role("student");
  await page.reload();
  await go("mygrades");
  await page.getByTestId("enrollment-list").locator('[data-testid^="row-"]', { hasText: "1st sem" }).click();
  await page.getByTestId("grades-section").filter({ visible: true }).first().waitFor();
  await shot("14-phone-390-student-gwa");
  await assertNoOverflow(page, "phone grades (390)");

  await browser.close();
  if (errors.length) {
    console.log("Browser errors:\n" + errors.join("\n"));
    process.exitCode = 1;
  }
  if (overflow) process.exitCode = 1;
  console.log("Grades walkthrough finished.");
})().catch(async (e) => {
  console.error(e);
  if (current) await current.screenshot({ path: path.join(OUT, "grades-FAILED.png"), fullPage: true }).catch(() => {});
  process.exit(1);
});
