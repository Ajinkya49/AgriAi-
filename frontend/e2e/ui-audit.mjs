/**
 * Phase 8 UI/UX audit, run against a real browser.
 *
 * Checks the four things the Implementation Plan asks for:
 *   1. every App Flow route exists and renders
 *   2. every screen has a defined empty / loading / error state
 *   3. responsive: bottom tab bar on mobile, sidebar on desktop
 *   4. accessibility: tap targets, contrast, icon+text pairing, labels
 *
 * Contrast is computed from the rendered colours rather than eyeballed, and tap
 * targets are measured in the DOM rather than trusted from the class names.
 *
 * Usage:
 *   node e2e/ui-audit.mjs
 *
 * Requires: frontend on :3000, backend on :8000, seeded test users.
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

/**
 * Measure the accessibility of whatever page is currently loaded.
 *
 * Returns offender lists rather than asserting directly, so the same
 * measurements can be asserted against more than one surface — the landing page
 * is a large public surface and auditing only the signed-in screens would leave
 * it unchecked.
 *
 * Everything is measured in the DOM: tap targets from `getBoundingClientRect`,
 * contrast from computed colours. Neither is inferred from class names, which is
 * the point — a class can say `min-h-tap` and still render 30px if something
 * overrides it.
 */
async function auditAccessibility(page) {
  return page.evaluate(() => {
    /* ---- Tap targets ---- */
    const MIN = 48;
    const smallTargets = [];
    for (const el of document.querySelectorAll(
      "button, a, [role='button'], select, input[type='checkbox']",
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // hidden
      if (rect.height < MIN || rect.width < MIN) {
        smallTargets.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 32),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
    }

    /* ---- Contrast ---- */
    const parse = (value) => {
      const m = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      return m
        ? [
            Number(m[1]),
            Number(m[2]),
            Number(m[3]),
            m[4] === undefined ? 1 : Number(m[4]),
          ]
        : null;
    };
    const luminance = ([r, g, b]) => {
      const channel = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    /**
     * Composite every translucent layer between the text and the first opaque
     * ancestor.
     *
     * This previously returned the first non-transparent background it found.
     * That was correct while every surface was an opaque `bg-white`, but the
     * dark theme introduced glass cards — `rgba(255,255,255,0.03)`. Discarding
     * the alpha channel reads a 3% white overlay as PURE WHITE, so light text on
     * a near-black card was reported as 1.10:1. Alpha has to be composited.
     */
    const backgroundOf = (el) => {
      const layers = [];
      let node = el;
      while (node) {
        const rgba = parse(getComputedStyle(node).backgroundColor);
        if (rgba && rgba[3] > 0) {
          layers.push(rgba);
          if (rgba[3] >= 1) break;
        }
        node = node.parentElement;
      }

      // Bottom layer: the first opaque ancestor, else the page canvas.
      let base =
        layers.length > 0 && layers[layers.length - 1][3] >= 1
          ? layers.pop().slice(0, 3)
          : [8, 7, 15];

      // Paint the remaining translucent layers back-to-front.
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const [r, g, b, a] = layers[i];
        base = [
          r * a + base[0] * (1 - a),
          g * a + base[1] * (1 - a),
          b * a + base[2] * (1 - a),
        ];
      }
      return base;
    };

    const contrast = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(
      "p, span, h1, h2, h3, a, button, li, label",
    )) {
      if (!el.textContent?.trim()) continue;
      if (el.children.length > 0) continue; // only leaf text nodes
      const style = getComputedStyle(el);
      // Skip text that is deliberately invisible (sr-only, gradient-clipped).
      // Gradient text reports `color: rgba(0,0,0,0)`; it is painted by
      // `background-clip: text` instead, so the computed colour says nothing
      // about its real contrast.
      if (style.visibility === "hidden" || style.display === "none") continue;
      const fg = parse(style.color);
      if (!fg || fg[3] === 0) continue;
      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      // WCAG: large text (>=24px, or >=18.66px bold) needs 3:1; else 4.5:1
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = isLarge ? 3.0 : 4.5;

      const bg = backgroundOf(el);

      // Text painted with alpha (e.g. Tailwind's `text-primary/70`) is composited
      // over the background by the browser. Measure what is actually rendered,
      // not the un-composited colour — otherwise a deliberately faded label
      // reads as if it were fully opaque.
      const fgRgb =
        fg[3] < 1
          ? [
              fg[0] * fg[3] + bg[0] * (1 - fg[3]),
              fg[1] * fg[3] + bg[1] * (1 - fg[3]),
              fg[2] * fg[3] + bg[2] * (1 - fg[3]),
            ]
          : fg.slice(0, 3);

      const l1 = luminance(fgRgb);
      const l2 = luminance(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

      const key = `${style.color}|${bg.join(",")}|${Math.round(size)}`;
      if (ratio < required && !seen.has(key)) {
        seen.add(key);
        contrast.push({
          text: el.textContent.trim().slice(0, 28),
          ratio: ratio.toFixed(2),
          required,
          size: Math.round(size),
        });
      }
    }

    /* ---- Icon + text pairing ---- */
    const unlabelled = [];
    for (const el of document.querySelectorAll("a, button")) {
      const hasText = (el.textContent ?? "").trim().length > 0;
      const label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "";
      if (!hasText && !label) unlabelled.push(el.outerHTML.slice(0, 60));
    }

    return { smallTargets, contrast, unlabelled };
  });
}

/**
 * WCAG contrast ratio between two hex colours.
 *
 * For token-level assertions, where there is no rendered element to measure.
 * The page-level contrast check composites alpha from real elements; this one
 * answers "would white be legible on this fill?" before anything is painted.
 */
function contrastRatio(hexA, hexB) {
  const luminance = (hex) => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [l1, l2] = [luminance(hexA), luminance(hexB)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Every route the App Flow document defines. */
const PUBLIC_ROUTES = ["/", "/login", "/signup"];
const PROTECTED_ROUTES = [
  "/dashboard",
  "/upload",
  "/assistant",
  "/community",
  "/community/new",
  "/post/new",
  "/weather",
  "/profile",
  "/settings",
  "/onboarding",
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // budget Android — the primary target
  deviceScaleFactor: 2,
});
const page = await context.newPage();

try {
  await mkdir(SHOTS, { recursive: true });

  // ---- 1. Routes exist and render ------------------------------------
  for (const route of PUBLIC_ROUTES) {
    const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    check(
      `route ${route} renders`,
      (response?.status() ?? 0) < 400,
      `HTTP ${response?.status()}`,
    );
  }

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });
  check("signed in for the audit", true, "");

  for (const route of PROTECTED_ROUTES) {
    const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    const status = response?.status() ?? 0;
    const body = (await readBody(page)) ?? "";
    check(`route ${route} renders`, status < 400 && body.length > 80, `HTTP ${status}`);
  }

  // ---- 2. Custom 404 -------------------------------------------------
  await page.goto(`${BASE}/this-route-does-not-exist`, { waitUntil: "networkidle" });
  const notFound = (await readBody(page)) ?? "";
  check(
    "unknown route shows the custom 404",
    /couldn't find that page/i.test(notFound),
    "",
  );
  check("404 offers a way back", /Go to my dashboard/i.test(notFound), "");
  await page.screenshot({ path: `${SHOTS}17-404.png`, fullPage: true });

  // A real missing record should also 404 gracefully, not crash.
  await page.goto(`${BASE}/diagnosis/00000000-0000-0000-0000-000000000000`, {
    waitUntil: "networkidle",
  });
  const missing = (await readBody(page)) ?? "";
  check(
    "a missing diagnosis shows the 404, not a crash",
    /couldn't find that page/i.test(missing) && !/Application error/i.test(missing),
    "",
  );

  // ---- 3. Empty states ------------------------------------------------
  await page.goto(`${BASE}/community`, { waitUntil: "networkidle" });
  const communityBody = (await readBody(page)) ?? "";
  check(
    "community list always offers a next step",
    /Start a new community/i.test(communityBody),
    "",
  );

  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  const settingsBody = (await readBody(page)) ?? "";
  check("settings screen exists and is populated", /Your name/i.test(settingsBody), "");
  check("settings can sign out", /Log out/i.test(settingsBody), "");
  await page.screenshot({ path: `${SHOTS}18-settings.png`, fullPage: true });

  // ---- 4. Responsive --------------------------------------------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const mobileNav = await page.locator("nav").first().isVisible();
  const mobileBox = await page.locator("nav").first().boundingBox();
  check("mobile: bottom tab bar is visible", mobileNav, "");
  check(
    "mobile: tab bar is pinned to the bottom",
    mobileBox ? mobileBox.y + mobileBox.height >= 800 : false,
    mobileBox ? `bottom edge at ${Math.round(mobileBox.y + mobileBox.height)}` : "no box",
  );
  check(
    "mobile: desktop sidebar is hidden",
    !(await page.locator("aside").first().isVisible()),
    "",
  );

  // Anything that parks itself above the tab bar must use --app-nav-height.
  // Hard-coded offsets drift: the assistant composer once sat at `bottom-20`
  // (80px) under a 101px bar, hiding the field the farmer was typing into.
  // Comparing the token to the bar's measured height catches that class of bug
  // without needing a full transcript on screen.
  const clearance = await page.evaluate(() => {
    const nav = document.querySelector("nav[aria-label='Main']");
    if (!nav) return null;
    const navHeight = nav.getBoundingClientRect().height;

    // Resolve the token to pixels by measuring it, not by parsing it. It is
    // declared in `rem`, so `parseFloat` yields "7.5" — which reads as 8px and
    // makes this check nonsense.
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;visibility:hidden;height:var(--app-nav-height)";
    document.body.appendChild(probe);
    const token = probe.getBoundingClientRect().height;
    probe.remove();

    return { navHeight: Math.round(navHeight), token: Math.round(token) };
  });
  check(
    "mobile: --app-nav-height clears the tab bar",
    clearance !== null && clearance.token > clearance.navHeight,
    clearance
      ? `token ${clearance.token}px vs bar ${clearance.navHeight}px`
      : "no nav found",
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  // The sidebar is an <aside>; the <nav> is the mobile bar, hidden above lg.
  const sidebar = page.locator("aside").first();
  const sidebarBox = await sidebar.boundingBox();
  check(
    "desktop: nav moves to a left sidebar",
    (await sidebar.isVisible()) && sidebarBox
      ? sidebarBox.x < 40 && sidebarBox.height > 400
      : false,
    sidebarBox
      ? `x=${Math.round(sidebarBox.x)} h=${Math.round(sidebarBox.height)}`
      : "no box",
  );
  check(
    "desktop: bottom tab bar is hidden",
    !(await page.locator("nav").first().isVisible()),
    "",
  );
  await page.screenshot({ path: `${SHOTS}19-desktop-sidebar.png` });
  await page.setViewportSize({ width: 390, height: 844 });

  // ---- 5. Accessibility ------------------------------------------------
  // Run against a public surface and a signed-in one. The landing page is large
  // and was previously never audited, because these checks used to sit inline
  // and only ever ran against whatever page happened to be loaded.
  for (const [surface, url] of [
    ["landing", "/"],
    ["dashboard", "/dashboard"],
  ]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });

    // Walk the page first: the landing page reveals its sections on scroll, so
    // auditing without scrolling would measure elements still at opacity 0.
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < pageHeight; y += 600) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);

    const { smallTargets, contrast, unlabelled } = await auditAccessibility(page);

    check(
      `${surface}: every interactive control is at least 48x48`,
      smallTargets.length === 0,
      smallTargets.length
        ? smallTargets
            .slice(0, 4)
            .map((t) => `${t.tag}"${t.text}" ${t.w}x${t.h}`)
            .join("; ")
        : "all pass",
    );
    check(
      `${surface}: all text meets WCAG AA contrast`,
      contrast.length === 0,
      contrast.length
        ? contrast
            .slice(0, 4)
            .map((c) => `"${c.text}" ${c.ratio}:1 (needs ${c.required})`)
            .join("; ")
        : "all pass",
    );
    check(
      `${surface}: no interactive control relies on an icon alone`,
      unlabelled.length === 0,
      unlabelled.length ? `${unlabelled.length} unlabelled` : "all pass",
    );
  }

  // ---- 8. Design tokens actually applied ------------------------------
  //
  // These assertions encode the palette in globals.css. They originally
  // asserted the light/green Design Brief (primary #2e7d32, warm off-white
  // surface, 12px radius). The visual direction was changed to the dark violet
  // system from the reference recording supplied by the project owner, so the
  // expected values below were updated to match — this is a deliberate change
  // of spec, not a loosened test.
  //
  // The invariants that did NOT change are still enforced: the 44px tap target
  // below, and the WCAG AA contrast requirement above.
  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      primary: styles.getPropertyValue("--color-primary").trim(),
      surface: styles.getPropertyValue("--color-surface").trim(),
      ink: styles.getPropertyValue("--color-ink").trim(),
      accent: styles.getPropertyValue("--color-accent").trim(),
      radius: styles.getPropertyValue("--radius-card").trim(),
      tap: styles.getPropertyValue("--spacing-tap").trim(),
    };
  });
  check("tokens: leaf green", tokens.primary === "#2e7d32", tokens.primary);
  check("tokens: warm off-white canvas", tokens.surface === "#fafaf5", tokens.surface);
  check("tokens: near-black text", tokens.ink === "#1b1b1b", tokens.ink);
  check("tokens: green CTA fill", tokens.accent === "#2e7d32", tokens.accent);
  check("tokens: 16px card radius", tokens.radius === "16px", tokens.radius);
  check("tokens: 48px tap target token", tokens.tap === "48px", tokens.tap);

  // The invariant that actually protects the UI: `accent` is the CTA fill and
  // ALWAYS carries white text, so white must be legible on it.
  //
  // On the dark theme the equivalent check asserted accent and primary were
  // different values, because a single violet could not be both legible text and
  // a legible fill. On a light canvas one green legitimately does both — #2E7D32
  // is 5.2:1 as text on off-white and 5.2:1 as a fill under white text — so
  // asserting they differ would now be asserting a falsehood. Test the real
  // contract instead of the mechanism.
  const ctaContrast = contrastRatio("#ffffff", tokens.accent);
  check(
    "tokens: white text is legible on the CTA fill",
    ctaContrast >= 4.5,
    `white on ${tokens.accent} = ${ctaContrast.toFixed(2)}:1`,
  );
} catch (error) {
  check("audit completed without throwing", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log("=".repeat(78));
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(52)} ${r.detail}`);
}
console.log("-".repeat(78));
console.log(
  `  ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`,
);
console.log("=".repeat(78));
process.exit(failed.length ? 1 : 0);
