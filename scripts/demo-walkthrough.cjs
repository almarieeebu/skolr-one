// Clicks through the whole enrollment flow in DEMO MODE and saves screenshots.
// Usage: start `npm run dev` (no Supabase env), then:
//   BASE_URL=http://localhost:3000 node scripts/demo-walkthrough.cjs
// Needs Playwright installed (npm i -D playwright && npx playwright install chromium).
const { chromium } = require("playwright");
const path = require("node:path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(__dirname, "..", "screenshots");
const JUAN = "00000000-0000-4000-8000-e00000000001";

async function expectText(page, testId, text) {
  await page.getByTestId(testId).filter({ hasText: text }).first().waitFor({ timeout: 10000 });
  console.log(`  ok: ${testId} shows "${text}"`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("role-switcher").waitFor();

  const role = async (r) => {
    await page.getByTestId("role-switcher").selectOption(r);
    await page.waitForTimeout(200);
    console.log(`as ${r}`);
  };
  const open = async () => {
    await page.getByTestId(`row-${JUAN}`).click();
    await page.getByTestId("student-card").waitFor();
  };

  await page.screenshot({ path: path.join(OUT, "desktop-start.png") });

  // 1. Registrar accepts papers, then assigns the ID
  await role("registrar");
  await open();
  await page.getByTestId("action-accept_papers").click();
  await expectText(page, "card-status", "Papers checked");
  await page.getByTestId("action-assign_id").click();
  await expectText(page, "student-no", "SA-2026-0005");

  // 2. Student picks subjects
  await role("student");
  await open();
  await page.getByTestId("action-set_load").click();
  for (const code of ["GE101", "GE102", "IT101", "MATH101", "PE1"]) {
    await page.getByTestId(`pick-${code}`).check();
  }
  await expectText(page, "units-total", "14 / 24");
  await page.getByTestId("save-load").click();
  await expectText(page, "card-status", "Load set");
  await expectText(page, "load-table", "MATH101");

  // 3. Cashier takes the downpayment with an OR number
  await role("cashier");
  await open();
  await page.getByTestId("pay-amount").fill("5000");
  await page.getByTestId("pay-or").fill("100300");
  await page.getByTestId("action-take_payment").click();
  await expectText(page, "card-status", "Assessed & paid");

  // 4. Registrar gives final approval
  await role("registrar");
  await open();
  await page.getByTestId("action-approve").click();
  await expectText(page, "card-status", "Officially enrolled");
  await page.getByText("History").click();
  await expectText(page, "history", "OR #100300");

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(3800); // let the toast fade
  await page.screenshot({ path: path.join(OUT, "desktop-1440.png") });
  await page.screenshot({ path: path.join(OUT, "desktop-1440-full.png"), fullPage: true });

  // Override path: Maria (transferee, no TOR) needs a typed reason.
  await page.getByTestId("row-00000000-0000-4000-8000-e00000000002").click();
  await page.getByTestId("action-accept_papers").click();
  await page.getByTestId("override-reason").fill("TOR to follow within 30 days");
  await page.getByTestId("override-submit").click();
  await expectText(page, "card-status", "Papers checked");

  // New application side panel
  await page.getByTestId("new-application").click();
  await page.getByTestId("new-application-form").waitFor();
  await page.getByRole("radio", { name: "K to 12" }).click();
  await page.screenshot({ path: path.join(OUT, "desktop-new-application.png") });
  await page.getByTestId("first-name").fill("Lea");
  await page.getByTestId("last-name").fill("Salonga");
  await page.getByTestId("submit-application").click();
  await expectText(page, "student-name", "Salonga, Lea");

  // Phone
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.goto(BASE); // new browser context: fresh demo data
  await phone.getByTestId("enrollment-list").waitFor();
  await phone.screenshot({ path: path.join(OUT, "phone-390-list.png") });
  await phone.getByTestId(`row-${JUAN}`).click();
  await phone.getByTestId("student-card").waitFor();
  await phone.screenshot({ path: path.join(OUT, "phone-390-card.png"), fullPage: true });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`phone horizontal overflow: ${overflow}`);

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
