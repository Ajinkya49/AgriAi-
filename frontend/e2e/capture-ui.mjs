/**
 * Capture the UI for visual review.
 *
 * Produces viewport-sized frames of every screen and every landing-page
 * section, on both a desktop and a phone viewport.
 *
 * Two things this script has to get right:
 *  - Landing sections are revealed by IntersectionObserver. A full-page
 *    screenshot taken without scrolling shows every section below the fold at
 *    opacity 0, so `settle()` walks the page first.
 *  - A full-page mobile screenshot of the landing page is ~29,000px tall and
 *    useless for review, so mobile captures are viewport-sized and taken at
 *    each section anchor.
 *
 * Usage:
 *   node e2e/capture-ui.mjs            # everything
 *   node e2e/capture-ui.mjs landing    # landing page only
 *   node e2e/capture-ui.mjs app        # signed-in screens only
 *
 * Requires: frontend on :3000, backend on :8000, seeded test users.
 */

import { mkdir } from "node:fs/promises";

import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL ?? "ramesh.patil@example.com";
const PASSWORD = process.env.TEST_PASSWORD ?? "AgriAI#2026";
const OUT = "../../.verify/redesign/";

const only = process.argv[2];
const want = (part) => !only || only === part;

const dir = new URL(OUT, import.meta.url).pathname.replace(/^\//, "");
await mkdir(dir, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

/** Walk the page so every reveal observer fires, then return to the top. */
async function settle(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 450) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(85);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

const save = (name) => `${dir}${name}.png`;

async function capture(page, name, { full = false, scroll = true } = {}) {
  if (scroll) await settle(page);
  await page.screenshot({ path: save(name), fullPage: full });
  console.log(`  ${name}`);
}

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|onboarding/, { timeout: 30000 });
}

/* ------------------------------------------------------------------ landing */

if (want("landing")) {
  console.log("landing (desktop)");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await capture(page, "01-landing-desktop", { full: true });

  // Section-by-section, at a legible size.
  await capture(page, "sec-1-hero");
  for (const [id, name] of [
    ["showcase", "sec-2-showcase"],
    ["how-it-works", "sec-3-how-it-works"],
    ["features", "sec-4-features"],
    ["safety", "sec-5-safety"],
    ["solutions", "sec-6-solutions"],
    ["community", "sec-7-community"],
    ["stats", "sec-8-stats"],
    ["cta", "sec-9-cta"],
  ]) {
    await page.evaluate((target) => {
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    }, id);
    await page.waitForTimeout(550);
    await page.screenshot({ path: save(name) });
    console.log(`  ${name}`);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: save("sec-10-footer") });
  console.log("  sec-10-footer");
  await context.close();

  console.log("landing (mobile)");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mpage = await mobile.newPage();
  await mpage.goto(BASE, { waitUntil: "networkidle" });
  await settle(mpage);
  await capture(mpage, "mob-1-hero", { scroll: false });
  for (const [id, name] of [
    ["showcase", "mob-2-showcase"],
    ["how-it-works", "mob-3-how-it-works"],
    ["features", "mob-4-features"],
    ["safety", "mob-5-safety"],
    ["solutions", "mob-6-solutions"],
    ["community", "mob-7-community"],
    ["stats", "mob-8-stats"],
    ["cta", "mob-9-cta"],
  ]) {
    await mpage.evaluate((target) => {
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    }, id);
    await mpage.waitForTimeout(550);
    await mpage.screenshot({ path: save(name) });
    console.log(`  ${name}`);
  }
  await mobile.close();
}

/* --------------------------------------------------------------- signed in */

if (want("app")) {
  for (const [label, viewport, scale] of [
    ["desktop", { width: 1440, height: 900 }, 2],
    ["mobile", { width: 390, height: 844 }, 3],
  ]) {
    console.log(`app (${label})`);
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      isMobile: label === "mobile",
      hasTouch: label === "mobile",
    });
    const page = await context.newPage();
    await signIn(page);

    for (const [route, name] of [
      ["/dashboard", `app-dashboard-${label}`],
      ["/upload", `app-upload-${label}`],
      ["/assistant", `app-assistant-${label}`],
      ["/community", `app-community-${label}`],
      ["/profile", `app-profile-${label}`],
      ["/settings", `app-settings-${label}`],
    ]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      await capture(page, name);
    }

    // The diagnosis result is only reachable through a stored diagnosis.
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    const link = page.locator('a[href^="/diagnosis/"]').first();
    if ((await link.count()) > 0) {
      await link.click();
      await page.waitForURL(/\/diagnosis\//, { timeout: 30000 });
      await page.waitForTimeout(1000);
      await capture(page, `app-diagnosis-${label}`);
    } else {
      console.log(`  (no diagnosis rows — skipped app-diagnosis-${label})`);
    }

    await context.close();
  }
}

await browser.close();
console.log("done");
