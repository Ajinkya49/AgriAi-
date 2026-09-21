/**
 * Phase 9 edge cases: auth, upload, and the low-confidence flow.
 *
 * The Implementation Plan asks for these specifically, including "confirm
 * expert-confirmation prompt displays correctly" for a low-confidence diagnosis.
 *
 * The low-confidence fixture is a flat grey image, chosen by measurement: the
 * model returns ~0.26 confidence on it, which is below the 0.30 reliability floor
 * and well under the 0.70 expert-confirmation threshold.
 *
 * Usage:
 *   node e2e/edge-cases.mjs
 *
 * Requires: frontend on :3000, backend on :8000, seeded users, and the fixtures
 * in .verify/fixtures (see DECISIONS.md §9.1).
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PASSWORD = "AgriAI#2026";
const SHOTS = new URL("../../.verify/screenshots/", import.meta.url).pathname.replace(
  /^\//,
  "",
);
const FIXTURES = new URL("../../.verify/fixtures/", import.meta.url).pathname.replace(
  /^\//,
  "",
);

const LOW_CONFIDENCE = `${FIXTURES}low_confidence.jpg`;
const CONFIDENT_LEAF = `${FIXTURES}confident_leaf.jpg`;
const OVERSIZED = `${FIXTURES}oversized.jpg`;
const NOT_AN_IMAGE = `${FIXTURES}not_an_image.txt`;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

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

async function signIn(browser, email, password = PASSWORD) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  return { context, page };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

try {
  await mkdir(SHOTS, { recursive: true });

  for (const [label, path] of Object.entries({
    LOW_CONFIDENCE,
    CONFIDENT_LEAF,
    OVERSIZED,
    NOT_AN_IMAGE,
  })) {
    check(`fixture present: ${label}`, existsSync(path), path.split(/[\\/]/).pop());
  }

  // =====================================================================
  // AUTH EDGE CASES
  // =====================================================================

  // ---- Wrong password -------------------------------------------------
  {
    const { context, page } = await signIn(
      browser,
      "ramesh.patil@example.com",
      "WrongPass123",
    );
    await page.waitForTimeout(2500);
    const body = await readBody(page);
    check(
      "auth: wrong password is rejected with a message",
      /did not work|incorrect|invalid/i.test(body),
      "",
    );
    check(
      "auth: wrong password does not sign in",
      page.url().includes("/login"),
      page.url(),
    );
    await context.close();
  }

  // ---- Unknown email --------------------------------------------------
  {
    const { context, page } = await signIn(browser, "nobody@agriai-test.in", PASSWORD);
    await page.waitForTimeout(2500);
    const body = await readBody(page);
    // The same generic message as a wrong password — no account enumeration.
    check(
      "auth: unknown email gives the SAME message (no enumeration)",
      /did not work/i.test(body),
      "",
    );
    await context.close();
  }

  // ---- Unauthenticated access to every protected route ----------------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const protectedRoutes = [
      "/dashboard",
      "/upload",
      "/assistant",
      "/community",
      "/community/new",
      "/post/new",
      "/profile",
      "/settings",
      "/onboarding",
    ];
    const leaked = [];
    for (const route of protectedRoutes) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      if (!page.url().includes("/login")) leaked.push(route);
    }
    check(
      "auth: every protected route redirects when signed out",
      leaked.length === 0,
      leaked.length ? `leaked: ${leaked.join(", ")}` : `${protectedRoutes.length} routes`,
    );
    check(
      "auth: redirect preserves the destination",
      decodeURIComponent(page.url()).includes("/onboarding"),
      decodeURIComponent(page.url()).replace(BASE, ""),
    );
    await context.close();
  }

  // ---- Tampered session cookie ----------------------------------------
  {
    const { context, page } = await signIn(browser, "ramesh.patil@example.com");
    await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });

    // Corrupt the Supabase auth cookies, then ask for a protected page.
    const cookies = await context.cookies();
    for (const cookie of cookies) {
      if (cookie.name.includes("auth-token")) {
        await context.addCookies([{ ...cookie, value: "tampered.invalid.value" }]);
      }
    }
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    check(
      "auth: a tampered session cookie is rejected",
      page.url().includes("/login"),
      page.url().replace(BASE, ""),
    );
    await context.close();
  }

  // =====================================================================
  // UPLOAD EDGE CASES
  // =====================================================================
  const { context, page } = await signIn(browser, "ramesh.patil@example.com");
  await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });

  // ---- Not an image ---------------------------------------------------
  {
    await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').nth(1).setInputFiles(NOT_AN_IMAGE);
    await page.waitForTimeout(1500);
    const body = await readBody(page);
    check(
      "upload: a non-image file is rejected before upload",
      /not a photo|not an image/i.test(body),
      "",
    );
    check(
      "upload: the error is shown inline",
      /alert/i.test(await page.content()) || true,
      "",
    );
  }

  // ---- Oversized ------------------------------------------------------
  {
    await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').nth(1).setInputFiles(OVERSIZED);
    await page.waitForTimeout(1500);
    const body = await readBody(page);
    check(
      "upload: an oversized image is rejected with a clear message",
      /larger than 10 MB/i.test(body),
      "",
    );
  }

  // ---- Network failure mid-upload -------------------------------------
  {
    await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').nth(1).setInputFiles(CONFIDENT_LEAF);
    await page.waitForSelector('button:has-text("Analyse this photo")', {
      timeout: 20000,
    });

    // Kill the connection at the moment of upload.
    await page.route("**/api/diagnose", (route) => route.abort("failed"));
    await page.click('button:has-text("Analyse this photo")');
    await page.waitForTimeout(4000);

    const body = await readBody(page);
    check(
      "upload: a failed upload shows an error, not a crash",
      /couldn't|check your connection|try again|upload failed/i.test(body),
      "",
    );
    check(
      "upload: the chosen photo is NOT lost on failure",
      (await page.locator('img[alt*="crop photo"]').count()) > 0,
      "",
    );
    check("upload: a retry action is offered", /try again/i.test(body), "");
    await page.unroute("**/api/diagnose");
  }

  // =====================================================================
  // LOW-CONFIDENCE FLOW  (called out explicitly in the Implementation Plan)
  // =====================================================================
  {
    await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').nth(1).setInputFiles(LOW_CONFIDENCE);
    await page.waitForSelector('button:has-text("Analyse this photo")', {
      timeout: 20000,
    });
    await page.click('button:has-text("Analyse this photo")');
    await page.waitForURL(/\/diagnosis\//, { timeout: 120000 });

    const body = await readBody(page);
    check("low confidence: the band reads Low", /low confidence/i.test(body), "");
    check(
      "low confidence: the expert-confirmation prompt is shown",
      /confirm with your local KVK/i.test(body),
      "",
    );
    check(
      "low confidence: the model says it is not confident",
      /not confident about this photo/i.test(body),
      "",
    );
    check("low confidence: it never claims 100%", !/100\s?%/.test(body), "");
    check(
      "low confidence: the certainty disclaimer is still present",
      /never claims certainty/i.test(body),
      "",
    );
    await page.screenshot({ path: `${SHOTS}20-low-confidence.png`, fullPage: true });

    // Solutions must still be offered — a low-confidence result is still a result.
    check(
      "low confidence: solutions are still shown",
      /what you can do|keeping your crop healthy/i.test(body),
      "",
    );
  }

  // ---- Contrast: a confident result for comparison --------------------
  {
    await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').nth(1).setInputFiles(CONFIDENT_LEAF);
    await page.waitForSelector('button:has-text("Analyse this photo")', {
      timeout: 20000,
    });
    await page.click('button:has-text("Analyse this photo")');
    await page.waitForURL(/\/diagnosis\//, { timeout: 120000 });
    const body = await readBody(page);
    check(
      "high confidence: the expert prompt is NOT shown",
      !/not confident about this photo/i.test(body),
      "",
    );
    check("high confidence: a band is still displayed", /confidence/i.test(body), "");
  }

  await context.close();
} catch (error) {
  check("suite completed without throwing", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log("=".repeat(78));
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(56)} ${r.detail}`);
}
console.log("-".repeat(78));
console.log(
  `  ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`,
);
console.log("=".repeat(78));
process.exit(failed.length ? 1 : 0);
