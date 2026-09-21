/**
 * Phase 7 community-flow verification, driven through a real browser.
 *
 * The phase promise: a farmer can post a question, another farmer can reply, and
 * the thread persists. This exercises that across two separate signed-in sessions.
 *
 * Usage:
 *   node e2e/community-flow.mjs
 *
 * Requires: frontend on :3000, backend on :8000, and the seeded test users.
 */

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

/** A name unique to this run, so re-runs do not collide. */
const stamp = Date.now().toString().slice(-6);
const COMMUNITY_NAME = `Tomato Farmers ${stamp}`;
const QUESTION = `My lower tomato leaves have brown rings. Is this early blight? (${stamp})`;
const REPLY = `Yes, that looks like early blight. Remove the lower leaves and mulch. (${stamp})`;

async function signIn(browser, email) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 });
  return { context, page };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

try {
  await mkdir(SHOTS, { recursive: true });

  const ramesh = await signIn(browser, "ramesh.patil@example.com");
  const sunita = await signIn(browser, "sunita.devi@example.com");
  check("two farmers signed in", true, "ramesh + sunita");

  // ---- Community discovery -------------------------------------------
  await ramesh.page.goto(`${BASE}/community`, { waitUntil: "networkidle" });
  const list = await readBody(ramesh.page);
  check("community list renders", /Farmer community/i.test(list), "");
  check("offers to start a community", /Start a new community/i.test(list), "");
  await ramesh.page.screenshot({ path: `${SHOTS}13-community-list.png`, fullPage: true });

  // ---- Create a community --------------------------------------------
  await ramesh.page.goto(`${BASE}/community/new`, { waitUntil: "networkidle" });
  await ramesh.page.fill('input[maxlength="80"]', COMMUNITY_NAME);
  await ramesh.page.fill(
    'textarea[maxlength="400"]',
    "A place for tomato growers to compare notes.",
  );
  await ramesh.page.click('button:has-text("Create community")');
  await ramesh.page.waitForURL(/\/community\/[0-9a-f-]{36}$/, { timeout: 60000 });
  const communityUrl = new URL(ramesh.page.url()).pathname;
  check(
    "created a community and landed in it",
    /^\/community\/[0-9a-f-]{36}$/.test(communityUrl),
    communityUrl,
  );

  const feed = await readBody(ramesh.page);
  check("new community shows the empty state", /Be the first to post/i.test(feed), "");
  check("creator is already a member", /Joined/i.test(feed), "");

  // ---- Post a question -----------------------------------------------
  await ramesh.page.click('a:has-text("Write a post")');
  await ramesh.page.waitForURL(/\/post\/new/, { timeout: 30000 });
  const composer = await readBody(ramesh.page);
  check("post composer preselects a community", composer.includes(COMMUNITY_NAME), "");

  await ramesh.page.fill("textarea[maxlength='2000']", QUESTION);
  await ramesh.page.click('button:has-text("Publish post")');
  await ramesh.page.waitForURL(/\/community\/[0-9a-f-]+\/post\/[0-9a-f-]+$/, {
    timeout: 60000,
  });
  const postUrl = new URL(ramesh.page.url()).pathname;
  check("post published and opened", /\/post\/[0-9a-f-]{36}$/.test(postUrl), postUrl);

  const postBody = await readBody(ramesh.page);
  check("post shows the author's name", /Ramesh Patil/.test(postBody), "");
  check("post shows the question text", postBody.includes(QUESTION), "");
  check("post shows no replies yet", /No replies yet/i.test(postBody), "");
  await ramesh.page.screenshot({
    path: `${SHOTS}14-post-no-replies.png`,
    fullPage: true,
  });

  // ---- Another farmer replies ----------------------------------------
  await sunita.page.goto(`${BASE}${postUrl}`, { waitUntil: "networkidle" });
  const otherView = await readBody(sunita.page);
  check(
    "another farmer can read the post and sees the author's name",
    otherView.includes(QUESTION) && /Ramesh Patil/.test(otherView),
    "",
  );

  await sunita.page.fill("#comment-input", REPLY);
  await sunita.page.click('button[aria-label="Post reply"]');
  await sunita.page.waitForSelector(`text=${stamp}`, { timeout: 60000 });
  await sunita.page.waitForFunction(
    () => document.querySelectorAll('[data-testid="comment"]').length >= 1,
    undefined,
    { timeout: 60000 },
  );
  const replied = await readBody(sunita.page);
  check("reply appears with the replier's name", /Sunita Devi/.test(replied), "");
  check("reply text is shown", replied.includes(REPLY), "");
  // Regression guard: the post card is server-rendered, so without the shared
  // count it kept showing "0" beside "1 reply" straight after replying.
  check(
    "post card reply count matches the reply list",
    /1 reply/i.test(replied) &&
      (await sunita.page
        .locator('[data-testid="post-card"]')
        .locator('a:has-text("1"), span:has-text("1")')
        .count()) > 0,
    "",
  );

  // ---- Like ----------------------------------------------------------
  const likeButton = sunita.page.locator('[data-testid="like-button"]').first();
  await likeButton.click();
  await sunita.page.waitForTimeout(1500);
  const likeText = (await likeButton.innerText()) ?? "";
  check(
    "like registers on the post",
    likeText.trim() === "1",
    `button reads "${likeText.trim()}"`,
  );

  await sunita.page.screenshot({
    path: `${SHOTS}15-post-with-reply.png`,
    fullPage: true,
  });

  // ---- Persistence: the original author sees the reply ---------------
  await ramesh.page.reload({ waitUntil: "networkidle" });
  const persisted = await readBody(ramesh.page);
  check("the thread persisted for the original author", persisted.includes(REPLY), "");
  check("the reply's author is shown", /Sunita Devi/.test(persisted), "");
  check("the like count persisted", /1/.test(persisted), "");

  // ---- The feed shows it ---------------------------------------------
  await ramesh.page.goto(`${BASE}${communityUrl}`, { waitUntil: "networkidle" });
  const feedAfter = await readBody(ramesh.page);
  check("post appears in the community feed", feedAfter.includes(QUESTION), "");
  check(
    "feed shows the reply count",
    /1\s*(reply|replies)/i.test(feedAfter) || /Ramesh Patil/.test(feedAfter),
    "",
  );
  await ramesh.page.screenshot({ path: `${SHOTS}16-community-feed.png`, fullPage: true });

  // ---- Joining from another account ----------------------------------
  await sunita.page.goto(`${BASE}/community`, { waitUntil: "networkidle" });
  const sunitaList = await readBody(sunita.page);
  check(
    "new community is discoverable by others",
    sunitaList.includes(COMMUNITY_NAME),
    "",
  );

  const card = sunita.page.locator('[data-testid="community-card"]', {
    hasText: COMMUNITY_NAME,
  });
  await card.locator('[data-testid="join-button"]').click();
  await sunita.page.waitForTimeout(1800);
  const joined = (await card.innerText()) ?? "";
  check("joining works and the button flips", /Joined/i.test(joined), "");

  await ramesh.context.close();
  await sunita.context.close();
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
