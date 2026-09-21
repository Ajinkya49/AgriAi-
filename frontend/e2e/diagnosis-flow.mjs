/**
 * Phase 4 diagnosis-flow verification, driven through a real browser.
 *
 * Uploads a genuine PlantVillage leaf photo through the UI and checks that a
 * stored diagnosis comes back with a confidence score. The image is drawn from
 * the tail of the class folder, which `scripts/train_model.py` never trained on
 * (it takes the first N per class), so this is a held-out sample.
 *
 * Usage:
 *   node e2e/diagnosis-flow.mjs
 *   PLANTVILLAGE_ROOT=... node e2e/diagnosis-flow.mjs
 *
 * Requires: frontend on :3000, backend on :8000, the seeded test users, and a
 * trained checkpoint.
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

/** Pick a held-out image: the tail of the folder, beyond the training cap. */
async function pickImage() {
  const dir = join(ROOT, "Tomato___Late_blight");
  const files = (await readdir(dir))
    .filter((f) => f.toLowerCase().endsWith(".jpg"))
    .sort();
  if (files.length === 0) throw new Error(`No images in ${dir}`);
  return join(dir, files[files.length - 1]);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 300));
});

try {
  await mkdir(SHOTS, { recursive: true });
  const imagePath = await pickImage();
  console.log(`held-out image: ${imagePath}\n`);

  // ---- Sign in -------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });
  check("signed in", true, "/dashboard");

  // ---- Upload screen -------------------------------------------------
  await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
  const uploadBody = await readBody(page);
  check(
    "upload screen offers camera and gallery",
    uploadBody.includes("Take a photo") && uploadBody.includes("Choose from gallery"),
    "",
  );

  const fileInputs = await page.locator('input[type="file"]').count();
  console.log(`  file inputs on page: ${fileInputs}`);
  // Input 0 is the camera capture input, input 1 the plain gallery picker.
  // Drive the gallery one — it is the realistic desktop path and avoids the
  // `capture` attribute, which changes how the browser treats the element.
  await page.locator('input[type="file"]').nth(1).setInputFiles(imagePath);
  try {
    await page.waitForSelector('button:has-text("Analyse this photo")', {
      timeout: 15000,
    });
    check("selected photo shows a preview and an analyse action", true, "");
  } catch {
    const body = await readBody(page);
    throw new Error(
      `preview did not appear. body="${body.replace(/\s+/g, " ").slice(0, 1200)}"`,
    );
  }
  await page.screenshot({ path: `${SHOTS}05-upload-selected.png`, fullPage: true });

  // ---- Analyse -------------------------------------------------------
  await page.click('button:has-text("Analyse this photo")');
  await page.waitForURL(/\/diagnosis\//, { timeout: 120000 });
  const diagnosisUrl = new URL(page.url()).pathname;
  check(
    "redirected to /diagnosis/[id]",
    /^\/diagnosis\/[0-9a-f-]{36}$/.test(diagnosisUrl),
    diagnosisUrl,
  );

  // ---- Result screen -------------------------------------------------
  await page.waitForSelector("text=confidence", { timeout: 20000 });
  const result = await readBody(page);

  check(
    "result names the correct disease (held-out Late Blight image)",
    result.includes("Late Blight"),
    "",
  );
  // innerText applies CSS text-transform, and the crop label is uppercased.
  check("result shows the crop type", /tomato/i.test(result), "");
  check(
    "result shows a confidence score, not a bare claim",
    /\d+%/.test(result) && /confidence/i.test(result),
    "",
  );
  check("result never claims 100% certainty", !/100\s?%/.test(result), "");
  check(
    "result carries the 'never claims certainty' disclaimer",
    /never claims certainty/i.test(result),
    "",
  );
  check("result carries the model version", /v1\.0\.0/.test(result), "");
  await page.screenshot({ path: `${SHOTS}06-diagnosis-mobile.png`, fullPage: true });

  // ---- Solutions tabs (Phase 5) --------------------------------------
  const tabs = page.locator('[role="tab"]');
  check(
    "result shows both solution tabs",
    (await tabs.count()) === 2,
    `${await tabs.count()} tabs`,
  );

  const naturalPanel = page.locator('[role="tabpanel"]');
  const naturalCards = await naturalPanel.locator("li").count();
  check("Natural tab lists curated solutions", naturalCards > 0, `${naturalCards} cards`);
  check(
    "every solution card cites a source",
    (await naturalPanel.locator("text=Source:").count()) === naturalCards,
    "",
  );
  check(
    "Natural section is visually distinct (green)",
    (await naturalPanel.getAttribute("class"))?.includes("natural-bg") ?? false,
    "",
  );

  await page.click('[role="tab"]:has-text("Traditional")');
  await page.waitForTimeout(500);

  const traditionalPanel = page.locator('[role="tabpanel"]');
  const traditionalCards = await traditionalPanel.locator("li").count();
  const traditionalText = (await traditionalPanel.innerText()) ?? "";
  check(
    "Traditional tab lists curated solutions",
    traditionalCards > 0,
    `${traditionalCards} cards`,
  );
  check(
    "Traditional tab carries the required label",
    /Not a Guaranteed Treatment/i.test(traditionalText),
    "",
  );
  check(
    "Traditional section is visually distinct (brown)",
    (await traditionalPanel.getAttribute("class"))?.includes("traditional-bg") ?? false,
    "",
  );
  await page.screenshot({
    path: `${SHOTS}08-diagnosis-traditional-tab.png`,
    fullPage: true,
  });

  // ---- Persisted: appears in dashboard history -----------------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const dashboard = await readBody(page);
  check(
    "diagnosis is stored and appears in dashboard history",
    dashboard.includes("Late Blight"),
    "",
  );
  check(
    "empty state is gone once a diagnosis exists",
    !dashboard.includes("haven’t uploaded a crop photo") &&
      !dashboard.includes("haven't uploaded a crop photo"),
    "",
  );
  await page.screenshot({
    path: `${SHOTS}07-dashboard-with-diagnosis.png`,
    fullPage: true,
  });

  // ---- Another farmer cannot see it (RLS through the UI) -------------
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const otherPage = await other.newPage();
  await otherPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await otherPage.fill('input[name="email"]', "sunita.devi@example.com");
  await otherPage.fill('input[name="password"]', PASSWORD);
  await otherPage.click('button[type="submit"]');
  await otherPage.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });
  await otherPage.goto(`${BASE}${diagnosisUrl}`, { waitUntil: "networkidle" });
  const otherBody = await readBody(otherPage);
  check(
    "another farmer cannot open that diagnosis",
    !otherBody.includes("Late Blight"),
    "",
  );
  await other.close();
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
