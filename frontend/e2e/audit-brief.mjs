/**
 * Audit the app against the design brief's measurable requirements.
 *
 * The brief states numbers, so this measures numbers: tap targets, body text
 * size, sticky primary actions, and the presence of the states and trust signals
 * it asks for. Eyeballing screenshots is how a 44px target passes for 48px.
 *
 * Usage: node e2e/audit-brief.mjs
 */

import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = "ramesh.patil@example.com";
const PASSWORD = "AgriAI#2026";

const ROUTES = [
  ["/dashboard", "Home"],
  ["/upload", "Crop photo / diagnosis"],
  ["/community", "Community"],
  ["/assistant", "Assistant"],
  ["/profile", "Profile"],
  ["/settings", "Settings"],
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|onboarding/, { timeout: 30000 });

const rows = [];

for (const [route, label] of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => {
    // Tap targets, measured in the DOM.
    //
    // A control can be small itself but have a large *effective* target if a
    // wrapping <label> carries the click — that is the standard visually-hidden
    // checkbox pattern, so the two cases must be told apart rather than counted
    // together. Counting the raw input would report a 20x20 checkbox as a
    // failure when tapping anywhere on its 350x48 chip toggles it.
    const targets = [];
    for (const el of document.querySelectorAll(
      "button, a, [role='button'], select, input[type='checkbox'], input[type='radio']",
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden") continue;

      let w = r.width;
      let h = r.height;
      const label = el.closest("label");
      if (label && label !== el) {
        const lr = label.getBoundingClientRect();
        w = Math.max(w, lr.width);
        h = Math.max(h, lr.height);
      }

      targets.push({
        w: Math.round(w),
        h: Math.round(h),
        text: (el.textContent ?? "").trim().slice(0, 24),
      });
    }

    // Body text: the size most characters are actually rendered at.
    const sizes = new Map();
    for (const el of document.querySelectorAll("p, span, li, label, td")) {
      if (!el.textContent?.trim() || el.children.length) continue;
      const size = Math.round(parseFloat(getComputedStyle(el).fontSize));
      const chars = el.textContent.trim().length;
      sizes.set(size, (sizes.get(size) ?? 0) + chars);
    }
    const dominant = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

    // Font families actually used.
    const families = new Set();
    for (const el of document.querySelectorAll("h1, h2, h3, p, span, button, a")) {
      const f = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim();
      if (f) families.add(f);
    }

    // Sticky / fixed primary action near the bottom?
    let stickyAction = false;
    for (const el of document.querySelectorAll("button, a[role='button']")) {
      const s = getComputedStyle(el);
      if ((s.position === "sticky" || s.position === "fixed") && s.bottom !== "auto") {
        stickyAction = true;
      }
    }

    return {
      targets,
      dominant,
      families: [...families],
      stickyAction,
      text: document.body.innerText,
    };
  });

  const under48 = m.targets.filter((t) => t.h < 48 || t.w < 48);
  const under44 = m.targets.filter((t) => t.h < 44 || t.w < 44);

  rows.push({
    label,
    route,
    targets: m.targets.length,
    under48: under48.length,
    under44: under44.length,
    worst: under48
      .sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))
      .slice(0, 3)
      .map((t) => `${t.w}x${t.h}"${t.text}"`)
      .join(" "),
    body: m.dominant,
    families: m.families.join(" / "),
    sticky: m.stickyAction,
    // Brief-specified signals, checked by text presence.
    langToggle: /हिंदी|Hindi|भाषा/.test(m.text),
    timestamp: /updated|min ago|last sync|आज|अभी/i.test(m.text),
    source: /source|IMD|mandi|स्रोत|KVK/i.test(m.text),
  });
}

await browser.close();

console.log("BRIEF COMPLIANCE — 390px, phone viewport\n");
console.log(
  "screen".padEnd(24) +
    "targets".padStart(8) +
    "<48".padStart(6) +
    "<44".padStart(6) +
    "body".padStart(7) +
    "sticky".padStart(8) +
    "lang".padStart(6) +
    "time".padStart(6) +
    "src".padStart(6),
);
console.log("-".repeat(80));
for (const r of rows) {
  console.log(
    r.label.padEnd(24) +
      String(r.targets).padStart(8) +
      String(r.under48).padStart(6) +
      String(r.under44).padStart(6) +
      `${r.body}px`.padStart(7) +
      (r.sticky ? "yes" : "NO").padStart(8) +
      (r.langToggle ? "yes" : "NO").padStart(6) +
      (r.timestamp ? "yes" : "NO").padStart(6) +
      (r.source ? "yes" : "NO").padStart(6),
  );
}

console.log("\nworst sub-48px targets per screen:");
for (const r of rows) {
  if (r.worst) console.log(`  ${r.label.padEnd(24)} ${r.worst}`);
}

console.log("\nfont families in use:");
for (const r of rows) console.log(`  ${r.label.padEnd(24)} ${r.families}`);
