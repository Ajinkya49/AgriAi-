/**
 * Fails the build if the proxy (middleware) would not actually run.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * `proxy.ts` — renamed from `middleware.ts` in Next.js 16 — silently did
 * **nothing** in one production build configuration while every other check in
 * the repo reported success:
 *
 *   * No error. `next build` printed "Compiled successfully".
 *   * The route guard stopped working — an unauthenticated `GET /dashboard`
 *     returned **200** instead of redirecting to `/login`.
 *   * `updateSession()` stopped running, so Supabase auth cookies were never
 *     refreshed and sessions died mid-visit instead of rotating.
 *   * The E2E suites could not see it: they run against `next dev`, where the
 *     file is loaded straight from source.
 *
 * ---------------------------------------------------------------------------
 * What actually determines whether it runs
 * ---------------------------------------------------------------------------
 * On Next 16 with a **Node-runtime** proxy, the runtime does NOT use
 * `middleware-manifest.json` (that stays empty and is expected to). The real
 * path is `NextNodeServer.loadNodeMiddleware()`:
 *
 *   1. read `.next/server/functions-config-manifest.json`
 *   2. if it declares a `/_middleware` function, `require()` —
 *      `.next/server/middleware.js`
 *   3. if that `require` throws `MODULE_NOT_FOUND`, swallow the error and return
 *      `undefined`, so middleware is skipped **in silence**
 *
 * Both bundlers write step 1. Only Turbopack writes step 2. So a `--webpack`
 * build declares a middleware file that was never emitted, and the failure is
 * invisible. That mismatch is precisely what this check asserts against.
 *
 * A silent auth bypass that presents as a passing build is worth a hard failure.
 *
 * Run automatically via the `postbuild` script.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const serverDir = join(process.cwd(), ".next", "server");
const functionsConfig = join(serverDir, "functions-config-manifest.json");
const middlewareJs = join(serverDir, "middleware.js");
const proxyJs = join(serverDir, "proxy.js");

function fail(lines) {
  console.error(
    "\n" +
      "=".repeat(78) +
      "\n[verify-proxy-registered] FAILED — the proxy would not run.\n" +
      "=".repeat(78) +
      "\n\n" +
      lines.join("\n") +
      "\n" +
      "=".repeat(78) +
      "\n",
  );
  process.exit(1);
}

if (!existsSync(serverDir)) {
  fail([`No ${serverDir}. The build did not produce server output.`]);
}

// Which file did the bundler emit for the proxy, if any?
const emitted = [middlewareJs, proxyJs].filter(existsSync);

if (emitted.length === 0) {
  fail([
    "Neither `.next/server/middleware.js` nor `.next/server/proxy.js` exists,",
    "but `proxy.ts` is present in the project.",
    "",
    "So no proxy was compiled at all. Every route is unprotected and Supabase",
    "sessions will never refresh.",
    "",
    "Check that the file still exports a function named `proxy` (or a default",
    "export) and that its `config.matcher` is intact.",
  ]);
}

// The runtime only reaches the proxy through this declaration.
if (!existsSync(functionsConfig)) {
  fail([
    "`.next/server/functions-config-manifest.json` is missing, so the runtime",
    "has nothing telling it a `/_middleware` function exists.",
    "",
    "The proxy would be skipped. Re-run the build; if it persists, this is a",
    "Next.js bug worth reporting.",
  ]);
}

let functions;
try {
  functions = JSON.parse(readFileSync(functionsConfig, "utf8")).functions ?? {};
} catch (error) {
  fail([`Could not parse ${functionsConfig}: ${error.message}`]);
}

if (!functions["/_middleware"]) {
  fail([
    "`functions-config-manifest.json` does not declare a `/_middleware` function,",
    "so `loadNodeMiddleware()` will not look for one and the proxy will not run.",
    "",
    "The delegated proxy was compiled but not registered. Re-run the build; if it",
    "persists, this is a Next.js bug worth reporting.",
  ]);
}

// The declaration must point at a file that actually exists.
//
// This is the `--webpack` case on Next 16.3.5: the manifest declares
// `/_middleware`, but only `proxy.js` is emitted, and the runtime requires
// `middleware.js`. `loadNodeMiddleware()` requires exactly `middleware.js`, gets
// MODULE_NOT_FOUND, swallows it, and silently disables the proxy.
if (!existsSync(middlewareJs)) {
  fail([
    "`functions-config-manifest.json` declares a `/_middleware` function, but",
    "`.next/server/middleware.js` was not emitted — so the runtime cannot load it.",
    "",
    `  declared : /_middleware  (runtime: ${functions["/_middleware"].runtime})`,
    `  emitted  : ${emitted.map((p) => p.replace(serverDir, ".next/server")).join(", ")}`,
    "  required : .next/server/middleware.js  <-- missing",
    "",
    "Because `loadNodeMiddleware()` swallows MODULE_NOT_FOUND, this produces NO",
    "error at build or run time — the proxy is simply skipped. The route guard",
    "would be unenforced and sessions would never refresh.",
    "",
    "KNOWN CAUSE — Next.js 16.3.5 with the webpack bundler does not emit",
    "`middleware.js` for a Node-runtime proxy. Turbopack does.",
    "",
    "FIX: build with Turbopack (the default).",
    "",
    "    npm run build                 # correct — Turbopack, emits middleware.js",
    "    npx next build --webpack      # broken — proxy silently never runs",
    "",
    "Vercel runs `npm run build`, so a normal deploy is already correct. The",
    "--webpack flag is what breaks it.",
  ]);
}

console.log(
  "[verify-proxy-registered] OK — proxy registered as /_middleware " +
    `(runtime: ${functions["/_middleware"].runtime}) and middleware.js is present.`,
);
