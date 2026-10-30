// Clicks through the Fees module in DEMO MODE and saves screenshots/fees-*.png.
// Usage: start the app with no Supabase env (`npm run dev` or `npm run build && npm start`), then:
//   BASE_URL=http://localhost:3000 node scripts/fees-walkthrough.cjs
// Needs Playwright (npm i -D playwright && npx playwright install chromium).
const { chromium } = require("playwright");
const path = require("node:path");
const { role: asRole, openModule, openRow, tab, expectText, toast, quiet: fade, assertNoPageScroll, assertNoOverflow } = require("./ui-helpers.cjs");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(__dirname, "..", "screenshots");
const JUAN = "00000000-0000-4000-8000-e00000000001";

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: path.join(OUT, `fees-${name}.png`), ...opts });
    console.log(`  saved fees-${name}.png`);
  };
  const quiet = () => fade(page);

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("workspace").waitFor();

  const role = (r) => asRole(page, r);
  const open = (id = JUAN) => openRow(page, id);
  const pay = async (amount, extra) => {
    await page.getByTestId("action-take_payment").click();
    await page.getByTestId("pay-panel").waitFor();
    await page.getByTestId("pay-amount").fill(amount);
    if (extra) await extra();
    await page.getByTestId("pay-submit").click();
    await page.getByTestId("pay-panel").waitFor({ state: "detached" });
  };

  // 1. Registrar: fee setup (major subjects now 1,600 per unit)
  await role("registrar");
  await openModule(page, "setup");
  await page.getByTestId("setup-fees").click();
  await page.getByTestId("fee-setup").waitFor();
  await page.getByTestId("fs-major-rate").fill("1600");
  await page.getByTestId("fs-misc-add").click();
  await page.getByTestId("fs-misc-name-6").fill("Laboratory insurance");
  await page.getByTestId("fs-misc-amount-6").fill("250");
  await page.getByTestId("detail-body").filter({ visible: true }).first().evaluate((el) => el.scrollTo(0, 0));
  await shot("1-setup");
  await page.screenshot({ path: path.join(OUT, "design-setup-fee-setup.png") });
  await assertNoPageScroll(page, "Setup, Fee setup");
  await page.getByTestId("fs-save").click();
  await toast(page, "Fee setup saved");

  // Registrar moves Juan to step 3 (papers + student ID)
  await openModule(page, "enrollment");
  await open();
  await page.getByTestId("action-accept_papers").click();
  await expectText(page, "card-status", "Papers checked");
  await page.getByTestId("action-assign_id").click();
  await expectText(page, "student-no", "SA-2026-0005");

  // 2. Student picks the load -> charges posted from the setup
  await role("student");
  await open();
  await page.getByTestId("action-set_load").click();
  for (const code of ["GE101", "GE102", "IT101", "MATH101", "PE1"]) await page.getByTestId(`pick-${code}`).check();
  // 11 units x 1,200 + 3 major units x 1,600 + 1,500 lab + 4,250 misc
  await expectText(page, "fee-estimate", "₱23,750.00");
  await page.getByTestId("save-load").click();
  await expectText(page, "card-status", "Load set");
  await openModule(page, "fees");
  await openRow(page, JUAN);
  await expectText(page, "fee-balance", "₱23,750.00");
  await expectText(page, "schedule-table", "Prelim");
  await quiet();
  await shot("2-student-load");

  // 3. Cashier: downpayment, OR number filled in from the series
  await role("cashier");
  await openModule(page, "cashier");
  await open();
  await pay("3000", async () => {
    const orNo = await page.getByTestId("pay-or").inputValue();
    if (orNo !== "100246") throw new Error(`expected OR 100246, got ${orNo}`);
  });
  await expectText(page, "card-status", "Assessed & paid");
  await tab(page, "fees");
  await expectText(page, "payment-list", "OR #100246");
  await quiet();
  await shot("3-downpayment");

  // 4. Registrar: academic scholarship, 50% of tuition, with a reason
  await role("registrar");
  await openModule(page, "enrollment");
  await open();
  await page.getByTestId("action-apply_discount").click();
  await page.getByTestId("discount-form").waitFor();
  await page.getByTestId("disc-reason").fill("Dean's lister, 2nd sem 2025-2026");
  await expectText(page, "disc-preview", "-₱9,000.00"); // 50% of (13,200 + 4,800)
  await page.waitForTimeout(300);
  await shot("4-discount");
  await page.getByTestId("disc-submit").click();
  await tab(page, "fees");
  await expectText(page, "discount-list", "Academic scholarship");
  await expectText(page, "fee-balance", "₱11,750.00");

  // 5. Cashier: second payment by GCash
  await role("cashier");
  await openModule(page, "cashier");
  await open();
  await pay("2750", async () => {
    if ((await page.getByTestId("pay-or").inputValue()) !== "100247") throw new Error("OR series did not move on");
    await page.getByTestId("pay-mode").selectOption("gcash");
    await page.getByTestId("pay-ref").fill("GC-5550001234");
  });
  await tab(page, "fees");
  await expectText(page, "payment-list", "GC-5550001234");
  await expectText(page, "fee-balance", "₱9,000.00");
  await quiet();
  await assertNoPageScroll(page, "cashier fees");
  await shot("5-second-payment");

  // 6. Statement of account (print view)
  await page.emulateMedia({ media: "print" });
  await page.getByTestId("statement").waitFor();
  await expectText(page, "statement-balance", "₱9,000.00");
  await shot("6-statement-print", { fullPage: true });
  await page.emulateMedia({ media: "screen" });

  // 7. Registrar: Juan enrolls for the 2nd semester, then the 1st semester is closed
  await role("registrar");
  await openModule(page, "enrollment");
  await page.getByTestId("new-application").click();
  await page.getByTestId("new-application-form").waitFor();
  await page.getByTestId("term-select").selectOption({ label: "2026-2027, 2nd semester" });
  await page.getByTestId("returning-select").selectOption({ label: "Dela Cruz, Juan S. (SA-2026-0005)" });
  await page.getByTestId("submit-application").click();
  await expectText(page, "card-status", "Student ID made");
  await openModule(page, "setup");
  await page.getByTestId("setup-close").click();
  await page.getByTestId("close-term").waitFor();
  await page.getByTestId("close-term-select").selectOption({ label: "2026-2027 1st sem" });
  await expectText(page, "close-preview", "Dela Cruz, Juan S.");
  await expectText(page, "close-preview", "2026-2027 2nd sem");
  await quiet();
  await shot("7-close-term");
  await page.getByTestId("close-term-sure").check();
  await page.getByTestId("close-term-confirm").click();
  await toast(page, "Term closed");

  // 8. The carried balance shows first on the next term
  await openModule(page, "enrollment");
  await page.getByTestId("enrollment-list").locator('[data-testid^="row-"]', { hasText: "2nd sem" }).filter({ hasText: "Dela Cruz" }).click();
  await page.getByTestId("student-card").filter({ visible: true }).first().waitFor();
  await tab(page, "fees");
  await expectText(page, "back-account", "₱9,000.00");
  await expectText(page, "schedule-table", "Previous balance");
  await quiet();
  await shot("8-carried-balance");
  // The old term is closed at zero
  await open();
  await tab(page, "fees");
  await expectText(page, "fees-section", "carried to the student");

  // 9. Phone, same data: the student's own fees (closed 1st sem, then the 2nd sem)
  await role("student");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByTestId("bottom-tabs").waitFor();
  await openModule(page, "fees");
  await page.getByTestId("enrollment-list").locator('[data-testid^="row-"]', { hasText: "1st sem" }).click();
  await expectText(page, "schedule-table", "Carried");
  await shot("9-phone-390");
  await assertNoOverflow(page, "phone fees, 1st sem");
  await page.getByTestId("back").filter({ visible: true }).first().click();
  await page.getByTestId("enrollment-list").locator('[data-testid^="row-"]', { hasText: "2nd sem" }).click();
  await expectText(page, "back-account", "₱9,000.00");
  await quiet();
  await shot("10-phone-390-next-term");
  await assertNoOverflow(page, "phone fees, 2nd sem");

  // Teacher sees nothing of fees
  await page.setViewportSize({ width: 1440, height: 900 });
  await role("teacher");
  await openModule(page, "students");
  const rows = page.getByTestId("enrollment-list").locator('[data-testid^="row-"]');
  if ((await rows.count()) > 0) {
    await rows.first().click();
    if (await page.getByTestId("fees-section").count()) throw new Error("teacher can see fees");
    if (await page.getByTestId("subtab-fees").count()) throw new Error("teacher has a Fees tab");
    console.log("  ok: teacher sees no Fees section");
  }

  await browser.close();
  if (errors.length) {
    console.log("Browser errors:\n" + errors.join("\n"));
    process.exitCode = 1;
  }
  console.log("Fees walkthrough finished.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
