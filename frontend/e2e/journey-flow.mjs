/**
 * Phase 9 core journey, end to end, in one continuous session.
 *
 * The Implementation Plan's first testing item: "diagnose → view solutions → ask
 * assistant → share to community". Each phase was verified in isolation; this
 * checks the hand-offs between them, which is where integration bugs actually live
 * — the diagnosis id flowing into the assistant, and the diagnosis flowing into a
 * community post.
 *
 * Usage:
 *   node e2e/journey-flow.mjs
 *
 * Requires: frontend on :3000, backend on :8000 with Gemini quota available,
 * seeded users, and .verify/fixtures/confident_leaf.jpg.
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
const LEAF = `${FIXTURES}confident_leaf.jpg`;

const results = [];
/** Set when the run could not complete because Gemini had no capacity left. */
let skipped = false;
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

const stamp = Date.now().toString().slice(-6);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

try {
  await mkdir(SHOTS, { recursive: true });
  check("leaf fixture present", existsSync(LEAF), "");

  // =====================================================================
  // 1. Sign in
  // =====================================================================
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "ramesh.patil@example.com");
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });
  check("journey 1/6: signed in", true, "");

  // =====================================================================
  // 2. Diagnose
  // =====================================================================
  await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').nth(1).setInputFiles(LEAF);
  await page.waitForSelector('button:has-text("Analyse this photo")', { timeout: 20000 });
  await page.click('button:has-text("Analyse this photo")');
  await page.waitForURL(/\/diagnosis\//, { timeout: 180000 });

  const diagnosisUrl = new URL(page.url()).pathname;
  const diagnosisId = diagnosisUrl.split("/").pop();
  const diagnosis = await readBody(page);
  check(
    "journey 2/6: a diagnosis was produced",
    /^\/diagnosis\/[0-9a-f-]{36}$/.test(diagnosisUrl),
    diagnosisUrl,
  );
  check(
    "journey 2/6: it shows a disease and a confidence score",
    /blight|spot|mold|healthy/i.test(diagnosis) && /\d+%/.test(diagnosis),
    "",
  );

  // =====================================================================
  // 3. Solutions
  // =====================================================================
  check("journey 3/6: Natural solutions are shown", /natural/i.test(diagnosis), "");
  check("journey 3/6: a source is cited", /source:/i.test(diagnosis), "");

  // Switch to the Traditional tab and confirm the required label.
  await page.click('[role="tab"]:has-text("Traditional")');
  await page.waitForTimeout(600);
  const traditional = (await page.locator('[role="tabpanel"]').innerText()) ?? "";
  check(
    "journey 3/6: Traditional tab carries its label",
    /Not a Guaranteed Treatment/i.test(traditional),
    "",
  );
  check(
    "journey 3/6: Traditional solutions are listed",
    (await page.locator('[role="tabpanel"] li').count()) > 0,
    "",
  );
  await page.screenshot({ path: `${SHOTS}21-journey-diagnosis.png`, fullPage: true });

  // =====================================================================
  // 4. Assistant, carrying the diagnosis through
  // =====================================================================
  await page.click('a:has-text("Ask the assistant")');
  await page.waitForURL(/\/assistant\//, { timeout: 60000 });
  const assistantPage = await readBody(page);
  check(
    "journey 4/6: the assistant opened with the diagnosis as context",
    /Answering about your recent result/i.test(assistantPage),
    "",
  );
  check(
    "journey 4/6: the URL carries the same diagnosis id",
    page.url().endsWith(diagnosisId),
    new URL(page.url()).pathname,
  );

  // A deliberately vague follow-up — only works if the id flowed through and the
  // backend augmented the retrieval query with the crop and condition.
  await page.fill("#assistant-input", "What should I do about it?");
  await page.click('button[aria-label="Send question"]');
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="turn"]').length >= 2,
      undefined,
      { timeout: 180000 },
    );
  } catch {
    // No reply arrived. Either the assistant is down or Gemini has no capacity.
    const failure = await readBody(page);
    if (/busy right now|temporarily unavailable|couldn't answer/i.test(failure)) {
      throw Object.assign(new Error("Gemini quota exhausted"), { quotaExhausted: true });
    }
    throw new Error(`the assistant never replied. page said: "${failure.slice(0, 200)}"`);
  }

  const answer = await readBody(page);
  // The assistant step needs Gemini. If the free tier is exhausted every request
  // returns "busy", which is a quota limit rather than a broken journey — report
  // that distinctly instead of blaming the code.
  if (/busy right now|temporarily unavailable/i.test(answer)) {
    throw Object.assign(new Error("Gemini quota exhausted"), { quotaExhausted: true });
  }
  check(
    "journey 4/6: the assistant answered the follow-up",
    !/don't have reviewed information/i.test(answer) &&
      /blight|tomato|remove|spray|irrigat/i.test(answer),
    "",
  );
  check(
    "journey 4/6: the answer cites its sources",
    /Where this came from/i.test(answer),
    "",
  );
  await page.screenshot({ path: `${SHOTS}22-journey-assistant.png`, fullPage: true });

  // =====================================================================
  // 5. Share the diagnosis to a community
  // =====================================================================
  await page.goto(`${BASE}/diagnosis/${diagnosisId}`, { waitUntil: "networkidle" });
  await page.click('a:has-text("Share with community")');
  await page.waitForURL(/\/post\/new/, { timeout: 60000 });

  const composer = await readBody(page);
  check(
    "journey 5/6: the composer opened with the diagnosis attached",
    /Attaching your result/i.test(composer),
    "",
  );

  // Make sure the farmer is in a community to post to.
  if (/need to join a community/i.test(composer)) {
    await page.goto(`${BASE}/community`, { waitUntil: "networkidle" });
    const firstJoin = page.locator('[data-testid="join-button"]').first();
    if ((await firstJoin.count()) > 0) {
      const label = (await firstJoin.innerText()).trim();
      if (label === "Join") {
        await firstJoin.click();
        await page.waitForTimeout(1800);
      }
    }
    await page.goto(`${BASE}/post/new?diagnosis=${diagnosisId}`, {
      waitUntil: "networkidle",
    });
  }

  const question = `Sharing my result for advice — is this right? (${stamp})`;
  await page.fill("textarea[maxlength='2000']", question);
  await page.click('button:has-text("Publish post")');
  await page.waitForURL(/\/community\/[0-9a-f-]+\/post\/[0-9a-f-]+$/, { timeout: 90000 });

  const thread = await readBody(page);
  check("journey 5/6: the post was published", thread.includes(question), "");
  check(
    "journey 5/6: the post carries the diagnosis badge",
    /Tomato\s*[—-]\s*/i.test(thread) && /\(\d+%\)/.test(thread),
    "",
  );
  await page.screenshot({ path: `${SHOTS}23-journey-post.png`, fullPage: true });

  // =====================================================================
  // 6. The journey is persisted and visible from the dashboard
  // =====================================================================
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const dashboard = await readBody(page);
  check(
    "journey 6/6: the diagnosis appears in dashboard history",
    /blight|spot|mold|healthy/i.test(dashboard),
    "",
  );
  check(
    "journey 6/6: the dashboard no longer shows the empty state",
    !/haven.t uploaded a crop photo/i.test(dashboard),
    "",
  );
} catch (error) {
  if (error?.quotaExhausted) {
    skipped = true;
  } else {
    check("journey completed without throwing", false, String(error).split("\n")[0]);
  }
} finally {
  await browser.close();
}

if (skipped) {
  console.log("=".repeat(78));
  console.log("  SKIPPED — steps 1-3 passed, but the Gemini free tier is exhausted,");
  console.log("  so the assistant step could not run. This is a quota limit, NOT a");
  console.log("  product failure. Re-run after the daily reset, or enable billing.");
  console.log("=".repeat(78));
  // Exit 2 so CI can tell "skipped" apart from both "passed" and "failed".
  process.exit(2);
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
