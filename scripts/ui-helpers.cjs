// Shared steps for the Playwright walkthroughs (one-page layout: rail | list | detail).
// Not a walkthrough itself; required by scripts/*-walkthrough.cjs.

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Switch the demo role from the account menu (rail on desktop, Account tab on phones). */
async function role(page, r) {
  await page.getByTestId(isPhone(page) ? "tab-account" : "account-button").click();
  await page.getByTestId("role-switcher").selectOption(r);
  await page.getByTestId("account-menu").waitFor({ state: "detached" }).catch(() => {});
  await page.waitForTimeout(300);
  console.log(`as ${r}`);
}

/** Open a module from the rail (desktop) or the bottom tab bar (phones). */
async function openModule(page, id) {
  await page.getByTestId(`${isPhone(page) ? "tab" : "module"}-${id}`).click();
  await page.waitForTimeout(200);
}

/** Open an enrollment from the list. A family with one enrollment has no list: it is already open. */
async function openRow(page, id) {
  const row = page.getByTestId(`row-${id}`);
  if (await row.isVisible().catch(() => false)) await row.click();
  await page.getByTestId("student-card").filter({ visible: true }).first().waitFor();
}

/** Pick a detail sub-tab (Profile, Papers, Load, Fees, Grades, Requests, History...). */
async function tab(page, id) {
  const t = page.getByTestId(`subtab-${id}`);
  if (await t.count()) await t.first().click();
}

async function expectText(page, testId, text) {
  await page.getByTestId(testId).filter({ hasText: text }).first().waitFor({ timeout: 10000 });
  console.log(`  ok: ${testId} shows "${text}"`);
}

async function toast(page, text) {
  await page.locator('[role="status"]', { hasText: text }).first().waitFor({ timeout: 10000 });
  console.log(`  ok: "${text}"`);
}

/** Wait for the toast to fade so it does not cover a screenshot. */
async function quiet(page) {
  await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
}

/** The page itself must not scroll vertically (only inner panes do). */
async function assertNoPageScroll(page, where) {
  const m = await page.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, ih: window.innerHeight }));
  if (m.sh > m.ih + 1) throw new Error(`page scrolls vertically on ${where}: ${m.sh} > ${m.ih}`);
  console.log(`  ok: no page scroll on ${where} (${m.sh} <= ${m.ih})`);
}

/** No sideways page scroll (phones). */
async function assertNoOverflow(page, where) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (m.sw > m.iw) throw new Error(`horizontal overflow on ${where}: ${m.sw} > ${m.iw}`);
  console.log(`  ok: no horizontal overflow on ${where}`);
}

module.exports = { isPhone, role, openModule, openRow, tab, expectText, toast, quiet, assertNoPageScroll, assertNoOverflow };
