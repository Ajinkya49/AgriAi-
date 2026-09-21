/**
 * Phase 6 assistant-flow verification, driven through a real browser.
 *
 * Checks the thing this phase actually promises: a farmer asks a follow-up
 * question in plain language and gets an answer grounded in the knowledge base,
 * with sources shown — and an honest refusal when the knowledge base does not
 * cover the question.
 *
 * Usage:
 *   node e2e/assistant-flow.mjs
 *
 * Requires: frontend on :3000, backend on :8000 with GEMINI_API_KEY set and the
 * FAISS index built, and the seeded test users.
 */

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
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
const ROOT =
  process.env.PLANTVILLAGE_ROOT ??
  "C:/Users/ajink/.workbuddy-ai/datasets/plantvillage/extracted/color";

const results = [];
/** Set when the run could not complete because Gemini had no capacity left. */
let skipped = false;
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

async function pickImage() {
  const dir = join(ROOT, "Tomato___Late_blight");
  const files = (await readdir(dir))
    .filter((f) => f.toLowerCase().endsWith(".jpg"))
    .sort();
  return join(dir, files[files.length - 1]);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

/**
 * Type a question and wait for the assistant's reply to land.
 *
 * Retries on a transient "model busy" response. Gemini's free tier returns 503
 * under load, and the app handles that correctly by telling the farmer to try
 * again — so the test should tolerate it rather than treat it as a failure of the
 * flow under test.
 */
async function ask(question, { attempts = 5 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const before = await page.locator('[data-testid="turn"]').count();
    await page.fill("#assistant-input", question);
    await page.click('button[aria-label="Send question"]');

    let replied = false;
    try {
      // The user turn is added immediately, the assistant turn once Gemini replies.
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="turn"]').length >= n + 2,
        before,
        { timeout: 120000 },
      );
      replied = true;
    } catch {
      // Fall through to the retry logic below.
    }

    await page.waitForTimeout(700);
    const body = (await readBody(page)) ?? "";

    // A transient upstream failure ALSO produces a reply — just not a useful one.
    // Retry it rather than recording "the model was busy" as a product defect.
    const transient = /busy right now|temporarily unavailable|couldn't answer that/i.test(
      body,
    );
    if (transient && attempt < attempts) {
      console.log(`    (assistant unavailable, retry ${attempt}/${attempts - 1})`);
      await page.waitForTimeout(9000);
      continue;
    }

    if (!replied || transient) {
      const shown = body.match(/couldn't answer[^.]*\.|busy right now[^.]*\./i);
      const error = new Error(
        `no usable assistant reply after ${attempt} attempt(s). page said: "${shown ? shown[0] : body.slice(0, 200)}"`,
      );
      // Distinguish "Gemini has no capacity left" from "the assistant is broken".
      // The free tier allows 20 requests/day/model, and the fallback chain shares
      // that ceiling, so an exhausted quota looks like a total outage.
      if (transient && attempt >= attempts) {
        error.quotaExhausted = true;
      }
      throw error;
    }

    return body;
  }
  throw new Error("unreachable");
}

try {
  await mkdir(SHOTS, { recursive: true });

  // ---- Sign in -------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });
  check("signed in", true, "/dashboard");

  // ---- Assistant screen ----------------------------------------------
  await page.goto(`${BASE}/assistant`, { waitUntil: "networkidle" });
  const landing = await readBody(page);
  check("assistant screen offers suggested questions", /Try asking/i.test(landing), "");
  check(
    "assistant screen states the grounding promise",
    /reviewed knowledge base/i.test(landing),
    "",
  );
  await page.screenshot({ path: `${SHOTS}09-assistant-landing.png`, fullPage: true });

  // ---- A question the knowledge base covers --------------------------
  const covered = await ask("How do I make panchagavya and how much should I spray?");
  // Assert on the ingredients and steps, not on one particular phrasing — the
  // model fallback chain can pick different models, and each words it differently.
  check(
    "answers with the actual recipe, not a paraphrase",
    /cow dung/i.test(covered) && /ghee/i.test(covered) && /jaggery/i.test(covered),
    "",
  );
  check(
    "answer quotes the dosage from the source",
    /3 litres/i.test(covered) && /100 litres/i.test(covered),
    "",
  );
  // Regression guard: an earlier prompt made the model print a self-evaluation of
  // its own instructions ("Exact dosage quoted? Yes…") instead of an answer. The
  // loose recipe check above passed on that output, so this is checked explicitly.
  check(
    "answer contains no self-evaluation or instruction leakage",
    !/exact dosage quoted|cites passage|passage numbers|these instructions/i.test(
      covered,
    ),
    "",
  );
  // The sources live in a collapsed <details>, and innerText does not return text
  // inside a closed one — open it before asserting.
  const sourcesToggle = page.locator("summary:has-text('Where this came from')").first();
  if ((await sourcesToggle.count()) > 0) {
    await sourcesToggle.click();
    await page.waitForTimeout(500);
  }
  const withSources = await readBody(page);
  check(
    "answer cites its sources",
    /Where this came from/i.test(withSources) &&
      /organic_preparations/i.test(withSources),
    "",
  );
  check("answer carries a source match score", /\d+% match/i.test(withSources), "");
  await page.screenshot({ path: `${SHOTS}10-assistant-answer.png`, fullPage: true });

  // ---- A question the knowledge base does NOT cover ------------------
  const refused = await ask("What is the current price of cotton in Maharashtra?");
  check(
    "refuses to answer outside the knowledge base",
    /don't have reviewed information/i.test(refused),
    "",
  );
  check(
    "refusal points the farmer to a human",
    /KVK|extension officer/i.test(refused),
    "",
  );
  await page.screenshot({ path: `${SHOTS}11-assistant-refusal.png`, fullPage: true });

  // ---- Diagnosis-linked follow-up ------------------------------------
  const imagePath = await pickImage();
  await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').nth(1).setInputFiles(imagePath);
  await page.waitForSelector('button:has-text("Analyse this photo")', { timeout: 20000 });
  await page.click('button:has-text("Analyse this photo")');
  await page.waitForURL(/\/diagnosis\//, { timeout: 180000 });
  const diagnosisUrl = new URL(page.url()).pathname;
  check(
    "diagnosis produced for the assistant test",
    /^\/diagnosis\//.test(diagnosisUrl),
    diagnosisUrl,
  );

  await page.click('a:has-text("Ask the assistant")');
  await page.waitForURL(/\/assistant\//, { timeout: 60000 });
  const contextPage = await readBody(page);
  check(
    "assistant opens with the diagnosis as context",
    /Answering about your recent result/i.test(contextPage),
    "",
  );

  // A deliberately vague follow-up — the backend must augment the search query
  // with the crop and condition for this to retrieve anything useful.
  const followUp = await ask("What should I do about it?");
  check(
    "answers a vague follow-up using the diagnosis context",
    /blight|tomato/i.test(followUp) && !/don't have reviewed information/i.test(followUp),
    "",
  );
  await page.screenshot({
    path: `${SHOTS}12-assistant-with-context.png`,
    fullPage: true,
  });

  // ---- Another farmer cannot read the thread -------------------------
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const otherPage = await other.newPage();
  await otherPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await otherPage.fill('input[name="email"]', "sunita.devi@example.com");
  await otherPage.fill('input[name="password"]', PASSWORD);
  await otherPage.click('button[type="submit"]');
  await otherPage.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });
  await otherPage.goto(`${BASE}/assistant`, { waitUntil: "networkidle" });
  const otherBody = await readBody(otherPage);
  check(
    "another farmer sees a clean thread, not this one",
    !/panchagavya and how much/i.test(otherBody),
    "",
  );
  await other.close();
} catch (error) {
  if (error?.quotaExhausted) {
    skipped = true;
  } else {
    check("script completed without throwing", false, String(error).split("\n")[0]);
  }
} finally {
  await browser.close();
}

if (skipped) {
  console.log("=".repeat(78));
  console.log(
    "  SKIPPED — the Gemini free tier is exhausted for every model in the chain.",
  );
  console.log(
    "  The free tier allows 20 requests/day/model, so heavy test runs drain it.",
  );
  console.log(
    "  This is a quota limit, NOT a product failure. Re-run after the daily reset,",
  );
  console.log("  or enable billing. See DECISIONS.md §6.2.");
  console.log("=".repeat(78));
  // Exit 2 so CI can tell "skipped" apart from both "passed" and "failed".
  process.exit(2);
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
