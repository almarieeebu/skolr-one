// Clicks through the whole enrollment flow in DEMO MODE and saves screenshots.
// Usage: start `npm run dev` (no Supabase env), then:
//   BASE_URL=http://localhost:3000 node scripts/demo-walkthrough.cjs
// Needs Playwright installed (npm i -D playwright && npx playwright install chromium).
const { chromium } = require("playwright");
const path = require("node:path");
const { role, openModule, openRow, tab, expectText, toast, quiet, assertNoPageScroll, assertNoOverflow } = require("./ui-helpers.cjs");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(__dirname, "..", "screenshots");
const JUAN = "00000000-0000-4000-8000-e00000000001";
const MARIA = "00000000-0000-4000-8000-e00000000002";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("workspace").waitFor();
  await page.getByTestId("enrollment-list").waitFor();
  await assertNoPageScroll(page, "start (1440x900)");
  await page.screenshot({ path: path.join(OUT, "desktop-start.png") });

  // 1. Registrar accepts papers, then assigns the ID
  await role(page, "registrar");
  await openModule(page, "enrollment");
  await openRow(page, JUAN);
  await page.screenshot({ path: path.join(OUT, "design-registrar-enrollment.png") });
  await assertNoPageScroll(page, "registrar Enrollment");
  await page.getByTestId("action-accept_papers").click();
  await expectText(page, "card-status", "Papers checked");
  await page.getByTestId("action-assign_id").click();
  await expectText(page, "student-no", "SA-2026-0005");

  // 2. Student picks subjects in the load panel
  await role(page, "student");
  await openRow(page, JUAN);
  await page.getByTestId("action-set_load").click();
  await page.getByTestId("load-panel").waitFor();
  for (const code of ["GE101", "GE102", "IT101", "MATH101", "PE1"]) {
    await page.getByTestId(`pick-${code}`).check();
  }
  await expectText(page, "units-total", "14 / 24");
  await page.getByTestId("save-load").click();
  await expectText(page, "card-status", "Load set");
  await tab(page, "load");
  await expectText(page, "load-table", "MATH101");

  // 3. Cashier takes the downpayment in the side panel
  await role(page, "cashier");
  await openModule(page, "cashier");
  await openRow(page, JUAN);
  await quiet(page);
  await page.getByTestId("action-take_payment").click();
  await page.getByTestId("pay-panel").waitFor();
  await page.getByTestId("pay-amount").fill("5000");
  await page.getByTestId("pay-or").fill("100300");
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "design-cashier-take-payment.png") });
  await page.getByTestId("pay-submit").click();
  await expectText(page, "card-status", "Assessed & paid");
  await toast(page, "Payment saved");

  // 4. Registrar gives final approval
  await role(page, "registrar");
  await openModule(page, "enrollment");
  await openRow(page, JUAN);
  await page.getByTestId("action-approve").click();
  await expectText(page, "card-status", "Officially enrolled");
  await tab(page, "history");
  await expectText(page, "history", "OR #100300");
  await quiet(page);
  await assertNoPageScroll(page, "registrar history");
  await page.screenshot({ path: path.join(OUT, "desktop-1440.png") });

  // Override path: Maria (transferee, no TOR) needs a typed reason.
  await openRow(page, MARIA);
  await page.getByTestId("action-accept_papers").click();
  await page.getByTestId("dock-problem").waitFor();
  await page.getByTestId("override-reason").fill("TOR to follow within 30 days");
  await page.getByTestId("override-submit").click();
  await expectText(page, "card-status", "Papers checked");

  // Keyboard: "/" focuses search, arrows move, Enter opens.
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 700, y: 5 } }).catch(() => {});
  await page.keyboard.press("/");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("type") || document.activeElement?.tagName);
  console.log(`  ok: "/" focuses ${focused}`);

  // New application side panel
  await page.getByTestId("new-application").click();
  await page.getByTestId("new-application-form").waitFor();
  await page.getByRole("radio", { name: "K to 12" }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "desktop-new-application.png") });
  await page.getByTestId("first-name").fill("Lea");
  await page.getByTestId("last-name").fill("Salonga");
  await page.getByTestId("submit-application").click();
  await expectText(page, "student-name", "Salonga, Lea");
  await toast(page, "Application saved");

  // Phone: list, then detail with a back button, bottom tabs.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(BASE); // new browser context: fresh demo data
  await phone.getByTestId("enrollment-list").waitFor();
  await phone.getByTestId("bottom-tabs").waitFor();
  await assertNoOverflow(phone, "phone list (390)");
  await phone.screenshot({ path: path.join(OUT, "design-phone-list.png") });
  await phone.screenshot({ path: path.join(OUT, "phone-390-list.png") });
  await phone.getByTestId(`row-${JUAN}`).click();
  await phone.getByTestId("student-card").filter({ visible: true }).first().waitFor();
  await phone.getByTestId("back").waitFor();
  await assertNoOverflow(phone, "phone detail (390)");
  await phone.screenshot({ path: path.join(OUT, "design-phone-detail.png") });
  await phone.screenshot({ path: path.join(OUT, "phone-390-card.png") });
  await phone.getByTestId("back").click();
  await phone.getByTestId("enrollment-list").waitFor();

  await browser.close();
  if (errors.length) {
    console.log("Browser errors:\n" + errors.join("\n"));
    process.exitCode = 1;
  }
  console.log("Walkthrough finished.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
