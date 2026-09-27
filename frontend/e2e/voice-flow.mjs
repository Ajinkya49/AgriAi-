/**
 * Voice input e2e — verifies the mic button on the Assistant composer.
 *
 * The Web Speech API in headless Chrome has no audio input device, so a true
 * speech→transcript pass is not possible here (and real speech verification is
 * a manual demo step). What CAN be verified end-to-end on the real prod build:
 *
 *   1. Chrome reports speech support → the mic button renders (and would be
 *      absent on unsupported browsers — enforced in unit terms by the hook's
 *      capability detection).
 *   2. The mic is a ≥48px tap target, aria-pressed reflects state, and it is
 *      positioned in the composer next to Send.
 *    tap 3. The composer still works normally (typed flow unaffected).
 *   4. The language toggle swaps the mic's aria-label copy EN↔HI.
 */
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = "ramesh.patil@example.com";
const PASSWORD = "AgriAI#2026";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

try {
  // ---- Sign in ---------------------------------------------------------
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="loading"]'),
    undefined,
    { timeout: 30000 },
  );

  await page.goto(`${BASE}/assistant`);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="loading"]'),
    undefined,
    { timeout: 30000 },
  );

  // ---- 1. Mic renders in a supporting browser --------------------------
  const micCount = await page.locator('[data-testid="mic-button"]').count();
  check(
    "mic button renders in Chrome (speech supported)",
    micCount === 1,
    `count=${micCount}`,
  );

  // ---- 2. Tap target ≥48px and in the composer -------------------------
  if (micCount === 1) {
    const box = await page.locator('[data-testid="mic-button"]').boundingBox();
    check(
      "mic is a ≥48px tap target",
      box && box.height >= 48 && box.width >= 48,
      box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "no box",
    );

    const sendBox = await page
      .locator('button[aria-label="Send question"]')
      .boundingBox();
    check(
      "mic sits in the composer next to Send",
      box && sendBox && Math.abs(box.y - sendBox.y) < 24 && sendBox.x > box.x,
      box && sendBox ? `mic.y=${Math.round(box.y)} send.x=${Math.round(sendBox.x)}` : "",
    );
    check(
      "mic starts idle (aria-pressed=false)",
      (await page.locator('[data-testid="mic-button"]').getAttribute("aria-pressed")) ===
        "false",
    );

    // ---- 3. Typed flow still works ------------------------------------
    await page.fill("#assistant-input", "What is this screen for?");
    await page.click('button[aria-label="Send question"]');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="turn"]').length >= 1,
      undefined,
      { timeout: 20000 },
    );
    check("typed question still sends", true);
    await page.waitForTimeout(500);
  }

  // ---- 4. Language toggle swaps mic copy EN ↔ HI -----------------------
  const enLabel = await page
    .locator('[data-testid="mic-button"]')
    .getAttribute("aria-label");
  await page.getByRole("button", { name: "हिंदी" }).click();
  const hiLabel = await page
    .locator('[data-testid="mic-button"]')
    .getAttribute("aria-label");
  check(
    "mic aria-label switches EN → HI with the language toggle",
    enLabel === "Speak your question" && hiLabel === "बोलकर पूछें",
    `en="${enLabel}" hi="${hiLabel}"`,
  );
} catch (error) {
  check("script completed without throwing", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log("=".repeat(78));
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(58)} ${r.detail}`);
}
console.log("-".repeat(78));
console.log(
  `  ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`,
);
console.log("=".repeat(78));
process.exit(failed.length ? 1 : 0);
