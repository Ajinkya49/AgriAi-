/**
 * Phase 3 auth-flow verification, driven through a real browser.
 *
 * Runs against the local dev server and a real Supabase project, so it exercises
 * the parts a unit test cannot: the proxy redirect, the server action writing the
 * session cookie, and RLS deciding what the dashboard is allowed to show.
 *
 * Usage:
 *   node e2e/auth-flow.mjs
 *
 * Requires: frontend dev server on :3000, backend on :8000, and the seeded test
 * users (supabase/scripts/seed_test_users.py).
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = "ramesh.patil@example.com";
const PASSWORD = "AgriAI#2026";
const SHOTS = new URL("../../.verify/screenshots/", import.meta.url).pathname.replace(
  /^\//,
  "",
);

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/**
 * Read the visible text of a page, waiting out any streaming loading state.
 *
 * Routes render a `loading.tsx` skeleton first and stream the real content in
 * afterwards, so reading the body straight after a navigation can catch the
 * skeleton. Waiting for it to clear is what makes these assertions about the
 * page rather than about how fast the network was.
 */
async function readBody(target) {
  await target
    .waitForFunction(
      () => !document.querySelector('[data-testid="loading"]'),
      undefined,
      {
        timeout: 30000,
      },
    )
    .catch(() => {});
  return target.innerText("body");
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // a typical budget Android
  deviceScaleFactor: 2,
});
const page = await context.newPage();

try {
  await mkdir(SHOTS, { recursive: true });

  // ---- 1. Protected route, signed out --------------------------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check(
    "signed out: /dashboard redirects to /login",
    page.url().includes("/login"),
    page.url().replace(BASE, ""),
  );
  check(
    "signed out: return path preserved in ?redirect=",
    page.url().includes("redirect") &&
      decodeURIComponent(page.url()).includes("/dashboard"),
    decodeURIComponent(page.url()).replace(BASE, ""),
  );
  await page.screenshot({ path: `${SHOTS}01-login.png` });

  // ---- 2. Log in -----------------------------------------------------
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });

  check(
    "login: server action signed the user in and redirected",
    new URL(page.url()).pathname === "/dashboard",
    page.url().replace(BASE, ""),
  );

  const dashboard = await readBody(page);
  check("dashboard: greets the farmer by name", dashboard.includes("Ramesh"), "");
  check("dashboard: shows their region", dashboard.includes("Maharashtra"), "");
  const hasEmptyState = dashboard.includes("uploaded a crop photo");
  const hasHistory = /confidence/i.test(dashboard);
  check(
    "dashboard: shows the empty state or the diagnosis history",
    hasEmptyState || hasHistory,
    hasEmptyState ? "empty state" : "diagnosis history",
  );
  check(
    "dashboard: renders the bottom tab bar",
    dashboard.includes("Upload") && dashboard.includes("Community"),
    "",
  );
  await page.screenshot({ path: `${SHOTS}02-dashboard-mobile.png`, fullPage: true });

  // ---- 3. Profile (RLS-scoped read) ----------------------------------
  await page.goto(`${BASE}/profile`, { waitUntil: "networkidle" });
  const profile = await readBody(page);
  check("profile: shows the caller's own email", profile.includes(EMAIL), "");
  check("profile: shows account type", profile.includes("Farmer"), "");
  check("profile: shows primary crops from onboarding", profile.includes("Tomato"), "");
  await page.screenshot({ path: `${SHOTS}03-profile-mobile.png`, fullPage: true });

  // ---- 4. Desktop layout (sidebar breakpoint) ------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}04-dashboard-desktop.png` });

  // ---- 5. Signed-in users bounced off /login -------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  check(
    "signed in: /login redirects to /dashboard",
    new URL(page.url()).pathname === "/dashboard",
    page.url().replace(BASE, ""),
  );

  // ---- 6. Log out ----------------------------------------------------
  await page.goto(`${BASE}/profile`, { waitUntil: "networkidle" });
  await page.click('button:has-text("Log out")');
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30000 });
  check(
    "logout: lands on the landing page",
    new URL(page.url()).pathname === "/",
    page.url().replace(BASE, ""),
  );

  // ---- 7. Session really ended --------------------------------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check(
    "logout: session cookie cleared, /dashboard protected again",
    page.url().includes("/login"),
    page.url().replace(BASE, ""),
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
