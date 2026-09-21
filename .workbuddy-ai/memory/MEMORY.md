# Agri AI — project memory

Durable notes only. Daily detail in `YYYY-MM-DD.md`.

**Authoritative docs — check these before duplicating anything here:**
`docs_extracted/full.txt` (the 6 founding docs, source of truth) · `README.md` ·
`DECISIONS.md` (every judgement call, by phase) · `supabase/DECISIONS.md` (RLS) ·
`DEPLOYMENT.md` (runbook) · `docs/deploy-check.md` (Vercel pre-flight).

## What this is

**Agri AI** — an AI platform for Indian farmers: detect crop disease from a photo,
find natural/traditional solutions, ask a grounded assistant, learn from a farmer
community. Built phase-by-phase from 6 founding documents.

## Non-negotiable constraints

1. **Model and LLM stay architecturally separate.** `backend/app/models/` is
   PyTorch-only; `backend/app/rag/` is Gemini-only. Gemini never diagnoses images;
   the model never handles conversation.
2. **Natural/Traditional solutions come only from the curated `solutions` table** —
   never LLM-generated. Traditional entries always carry *"Traditional Practice —
   Not a Guaranteed Treatment."*
3. **Every diagnosis shows a confidence score**; low confidence prompts expert
   confirmation. Never claim 100% certainty.
4. **Simple stack.** No Kubernetes, Kafka, Redis, Celery, microservices, multiple
   vector DBs or LLM providers.
5. **Mobile-first**, audience with limited technical literacy — icons always paired
   with text.
6. **RLS policies exactly as written in the Backend Schema.**

## How we work: phase gating

Phases 1–10 (Setup → Database → Auth → Detection → Solutions → Assistant →
Community → UI Polish → Testing → Deploy). Phase 11 was a visual redesign at the
owner's request (`DECISIONS.md` §11).

**User's rules:** only the current phase; restate goal + "Done when" at the start;
summarise + flag assumptions at the end; **stop and wait** for "continue"; flag
ambiguities and proceed with a stated assumption, but ask if a requirement
conflicts with the constraints above.

## Stack

Next.js 16 (App Router) + TS + Tailwind v4 + React Query + Zod · FastAPI +
Pydantic v2 · PyTorch EfficientNet-B0 · Pillow · LlamaIndex + FAISS · **OpenRouter
(chat, primary) + Gemini (chat fallback, and the only embeddings provider)** ·
Supabase (Postgres + Auth + Storage + RLS) · Vercel + Render/Railway.

> Constraint #4 said "no multiple LLM providers". Two chat providers were added at
> the owner's request to escape the Gemini 20-req/day free tier — the provider
> chain already existed within Gemini, so this is the same pattern, not a new one.
> Recorded in `DECISIONS.md`. **Embeddings are still Gemini-only** (the FAISS index
> was built with `gemini-embedding-001`; `load_index()` refuses a mismatch).

## Auth is Supabase, not Clerk

**⚠️ `auth.uid()` casts the JWT `sub` to `uuid`** (verified against the live DB).
Clerk subjects are strings (`user_2abc...`), so adopting Clerk makes all **38**
`auth.uid()` call sites **raise** `invalid input syntax for type uuid` — they do
not merely mismatch. Clerk's own Supabase docs use `text` + `auth.jwt()->>'sub'`
and never `auth.uid()`.

Full scope + the half-applied `clerk init` state:
`docs/clerk-migration-assessment.md`. **Inert scaffolding is currently in the
frontend** (`@clerk/nextjs`, `ClerkProvider`, `/sign-in` + `/sign-up` routes
duplicating `/login` + `/signup`); `proxy.ts` was **skipped** by the CLI, so Clerk
enforces nothing.

**⚠️ `clerk init` must run where `package.json` is** (i.e. `frontend/`), or it
errors with "Non-interactive mode requires --framework for new projects".

Backup: `C:/Users/ajink/workbuddy-ai/_backup-agri-ai-20260920-145231/agri-ai.tar`.

## ⚠️ Environment traps

- **Backend venv is OUTSIDE the repo**:
  `~/.workbuddy-ai/binaries/python/envs/agri-ai-backend/Scripts/python.exe`. The
  sandbox blocks a project-local `.venv` — don't create one.
- **DB checks use a *separate* venv**, `.../envs/agri-ai-dbcheck` (Python 3.11 —
  `pgserver` has no 3.13 wheel). `pgserver`/`psycopg2` are test-only, deliberately
  absent from backend requirements.
- Node: `~/.workbuddy-ai/binaries/node/versions/22.22.2-2/` — add to PATH first.
  npm cache must go to `.../node/workspace/.npm-cache` (default is sandbox-blocked).
- **Turbopack HMR fails here** (`ERR_INVALID_HTTP_RESPONSE`), and while it fails
  **client components never hydrate** — interactive UI silently does nothing while
  server actions still work. **Use `next build && next start` to test anything
  interactive.** Build with `npx next build --webpack`; stop the dev server first
  (the build clears `.next/turbopack`, which the bulk-delete guard blocks).
- **Docker is unavailable** — the image was never built.

## Deployment (Phase 10 — config done, deploy pending)

**See `DEPLOYMENT.md`** (runbook) and **`docs/deploy-check.md`** (Vercel
pre-flight). Not run: needs the owner's Vercel/Render/Supabase accounts.

- **⚠️ THE PROJECT IS NOT IN A REPOSITORY — this blocks the deploy outright.**
  `git rev-parse --show-toplevel` = `C:/Users/ajink` (the **home directory**),
  **0 tracked files**, no remote. Vercel deploys from Git. **Not fixed
  unilaterally** — the owner's structural call, and the repo would sit inside the
  home directory, so read `git status` before `git add .`.
- **⚠️ THE BACKEND CANNOT RUN ON VERCEL — a hard platform limit, not a bug.**
  Vercel Python functions cap at **250 MB unzipped**; measured **torch alone is
  539 MB** (numpy 34, llama_index 28, faiss 16). Also the wrong shape: the model
  and FAISS index load once and stay resident (8.5 s cold start). **Backend goes to
  Render/Railway** (`render.yaml` is written for it, and its Dockerfile fails the
  build if the model or index is missing). Vercel serves the frontend only.
- **⚠️ `frontend/.env.local` points the API at `localhost:8000`** and is
  git-ignored, so Vercel never sees it — the browser would call localhost **on the
  farmer's phone**. Set `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the Vercel dashboard. **`NEXT_PUBLIC_*` is
  baked at build time** — changing one needs a redeploy, not a restart.
- **⚠️ `CORS_ORIGINS` must include the deployed Vercel origin**, set **on
  Render/Railway** (different service from the frontend). **No trailing slash** —
  it silently fails to match and presents as a network error. `ENVIRONMENT=production`
  makes `production_problems()` report it at startup, but it reports rather than
  refusing to boot, so it is easy to miss in logs.
- **⚠️ The ML artefacts ARE committed** (reversing the original gitignore policy).
  A self-trained model has no remote source. Verified **not** git-ignored.
- **One uvicorn worker on purpose** — extra workers each load their own model copy.
- **⚠️ `frontend/vercel.json` sets `Permissions-Policy: camera=(self),
  geolocation=(), microphone=()`.** Camera is correct; the other two **block**
  features the brief wants (auto-location, voice input). Harmless now, but it will
  silently block them later and look like a browser permissions error.
- Baselines (12 CPU cores): cold start **8.5 s**; diagnosis p50/p95 **1.64/1.74 s**.
  Re-measure with `backend/scripts/measure_performance.py`.

## Testing

```bash
# backend
cd backend && $PY -m ruff check . && $PY -m black --check . && $PY -m pytest  # 55
# database (embedded Postgres, no Docker)
~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe supabase/tests/run_db_tests.py        # 74  local RLS
~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe supabase/tests/verify_live_project.py # 44  LIVE RLS
# ⚠️ The live suite runs against the real project, where people sign up. Never
# assert a fixed row count — assert the policy under test instead. A hard-coded
# 'admin sees exactly 4 users' broke the first time the owner registered.
# frontend
npm run typecheck && npm run lint && npm run format:check && npm run build
# end to end (Chrome + both servers) — 149 assertions
cd frontend
node e2e/ui-audit.mjs        # 38  landing + app: tap targets, contrast, tokens
node e2e/edge-cases.mjs      # 24  auth / upload / low-confidence
node e2e/community-flow.mjs  # 23      node e2e/diagnosis-flow.mjs  # 20
node e2e/journey-flow.mjs    # 17      node e2e/auth-flow.mjs       # 13
node e2e/assistant-flow.mjs  # 14  needs Gemini quota
node e2e/capture-ui.mjs      # not a test — screenshots → .verify/redesign/
```

Fixtures in `.verify/fixtures/`. `low_confidence.jpg` is a flat grey image chosen
by measurement to land below every confidence threshold.

### ⚠️ e2e gotchas (each cost real debugging time)

- **`innerText`, not `textContent`** — the latter picks up the RSC payload inside
  `<script>` tags.
- **`innerText` applies `text-transform`**, so uppercased labels read "TOMATO".
- After navigation use the `readBody()` helper — routes stream a skeleton first.
- **`ui-audit.mjs` audits `/` AND `/dashboard`.** The checks used to be inline and
  only ever ran against whatever page was loaded, so the landing page went
  unaudited. They now live in an `auditAccessibility(page)` helper.
- **The contrast check composites alpha, both directions.** It used to return the
  first non-transparent *background*, reading a 3%-white glass card as PURE WHITE
  (light-on-dark text reported as 1.10:1); it also dropped *foreground* alpha, so
  `text-primary/70` measured as fully opaque. Both are composited now.
- **Tap targets are measured from `getBoundingClientRect`, not class names.** A
  hand-written `min-h-[2.25rem]` slipped through as 36px, and a `size-10` button as
  40px. Use `min-h-tap` / `min-w-tap`; short text links need `min-w-tap` too, or
  they fall under 48px.

## ⚠️ Known limitations

- **The model is confidently wrong on pure random noise** — `Tomato - Healthy` at
  **94.1%** on an image with no leaf. Out-of-distribution rejection is unhandled.
  (DECISIONS §9.2)
- **OOD behaviour is inconsistent.** A rose leaf (no rose class exists) came back
  `Potato - Early Blight` at **47.6%** with the runner-up at 35% — appropriately
  hesitant. Noise returns 94.1% — confidently wrong. Real tomato/potato leaves
  score 94–99%. So there is no single "the model is too unsure" story; it depends
  on the input. **Check what the image actually is before changing any threshold.**
  The **top-1 vs top-2 margin** separates the cases well (0.13 for the rose leaf
  vs ~0.93 for a real potato leaf) and is the untried fix for saying "this doesn't
  look like a supported crop".
- **⚠️ `labels.py` claims the API refuses to name a disease below
  `CONFIDENCE_UNRELIABLE_THRESHOLD` (0.30). It does not** — the constant only sets
  an `is_reliable` boolean used to choose between two wordings of the same
  warning. A 0.18 result is still named and stored. Comment/code mismatch, left
  as-is pending a product call.
- **Gemini free tier = 20 requests/day/model.** `assistant-flow` and `journey-flow`
  exit **2** (not 1) when exhausted, so CI can tell "skipped" from "failed".

## Design system (Phase 12 — light green, rural-first)

Tokens in `frontend/app/globals.css`; the table is in `README.md`.

**Light, not dark.** Deep leaf green `#2E7D32` on warm off-white `#FAFAF5`, chosen
for **sunlight readability on budget Android screens** — the reason the original
brief specified light mode. A dark violet theme ran for one phase (Phase 11, from a
reference recording) and was reverted. **The motion system is palette-independent
and survived the switch untouched.**

- **⚠️ `--color-primary` and `--color-accent` are the SAME green here, and that is
  correct.** `#2E7D32` is 4.9:1 as text on off-white *and* 5.1:1 as a fill under
  white text, so one green does both jobs. On the dark theme they *had* to differ.
  `ui-audit.mjs` asserts **white is legible on the CTA fill**, not that the two differ.
- **⚠️ `--color-highlight` (#FFB300 amber) is LIGHT.** Never a text colour on white,
  never behind white text. White on it is 1.9:1. It carries dark ink or is a badge.
- **⚠️ Glow opacity does not transfer between themes.** A 0.4 bloom over near-black
  is a light source; the same over off-white is a stain that breaks every text
  contrast on it. Orbs are now 0.07–0.14.
- **Cards are solid white with a soft shadow, not glass.** `backdrop-filter` is
  expensive on budget Androids, and translucent-white-on-off-white just looks
  dirty. Translucency survives only where content is genuinely behind it (tab bar,
  composer).
- **⚠️ Editing hazard:** `bg-primary` also matches `bg-primary-soft` (hyphen =
  word boundary). Use `bg-primary(?!-)` — this once corrupted 14 tokens.
- Form fields use the single `.input` rule — don't re-declare per form.
- **Native `input[type=checkbox|radio]` takes the OS accent colour**; `globals.css`
  pins it to the green. Don't set `accent-*` per component.
- **⚠️ Confidence is never shown in red.** Bands are green/amber/**gray**;
  `--color-danger*` is for real errors only.
- **⚠️ A token whose VALUE encodes an assumption about the canvas is a trap.** The
  landing mockup's `bg-natural-text` + dark ink was right on dark (light teal) and
  became dark-on-dark on light (`#1B5E20`). Re-derive the pairing, don't just swap.
- **⚠️ `--app-nav-height` is the single source of truth for the floating tab bar.**
  The assistant composer and the layout's bottom padding both use it. Hard-coded
  offsets once left the composer *underneath* the bar. Resolve it by **measuring**,
  not parsing — it is in `rem`, so `parseFloat("7.5rem")` is 8.
- Every route has empty/loading/error states. `not-found.tsx` says "couldn't find",
  never "does not exist" — RLS makes "no such record" and "someone else's"
  indistinguishable. `global-error.tsx` uses **inline styles only**.
- Bottom-nav labels are **12px** (five tabs won't fit 16px at 390px). Tap target
  stays 48px.

## Assistant — providers, Hindi, latency

Chat runs on **OpenRouter first, Gemini as fallback** (`app/rag/llm.py`).
**Embeddings are still Gemini-only** — the FAISS index was built with
`gemini-embedding-001` and `load_index()` refuses a mismatch.

- **⚠️ Verify model IDs against `/api/v1/models` — plausible names written from
  memory do not exist**, and `.env` silently overrides `config.py` defaults.
  Working free models: `deepseek/deepseek-v4-flash-0731:free` (primary),
  `nvidia/nemotron-3-ultra-550b-a55b:free`, `google/gemma-4-31b-it:free`.
- **⚠️ Free-tier limits are PER MODEL** and 429 often — that is why the chain exists.
  A 429 is now non-retryable (moves straight to the next model); 5xx is still retried.
- **⚠️ An HTTP-200 response with EMPTY content must fall through to the next model**,
  not fail the farmer. Observed once in five requests.
- **Language:** the **model** picks the answer language (covers romanised Hindi);
  **code** picks the refusal wording (`detect_language` → `REFUSAL_BY_LANGUAGE`).
  **⚠️ There are TWO refusal paths** — `llm.py` and the no-retrieval short-circuit
  in `pipeline.py`. Fixing only one leaves Hindi farmers refused in English.
- **⚠️ `GET /api/assistant/status` must use `is_rag_configured`, not
  `bool(gemini_api_key)`** — the latter reports the assistant as down while it works.
- **⚠️ Latency is 9-37s (median ~19s) and that is the provider, not the code.**
  **Do NOT disable reasoning** on the OpenRouter model: on a short test prompt it
  looked 2x faster, but against the real prompt it was 2x SLOWER (13.6s with vs
  29.4s without) — without a planning step the model rambles and emits more output
  tokens. Measure with `backend/scripts/time_assistant.py` before tuning. The chain
  is capped at 90s total / 45s per request. Paid tier is the real fix.

## Per-phase gotchas

**Database (2).** Migrations in `supabase/migrations/`, filename order; seed in
`supabase/seed.sql`. Migrations **are applied** to the hosted project. RLS helpers
`current_app_role()` / `is_admin()` / `is_moderator_or_admin()` are SECURITY DEFINER
with pinned `search_path` — use them; **never read `users.role` inside a policy**
(infinite recursion). `solutions` writes are admin-only. `solutions.disease_name` is
`"<Crop> - <Disease>"`, matched **exactly**. Seed solution rows are placeholders,
not ICAR/KVK sourced.

**Auth (3).** **⚠️ Next.js 16 renamed `middleware.ts` → `proxy.ts`** (export
`middleware` → `proxy`); the old name is deprecated and **silently does nothing**.
Auth goes browser → Supabase directly; the backend never handles a password. JWT
verification calls `GET /auth/v1/user` (no `SUPABASE_JWT_SECRET`; revocation
honoured immediately). `user_scoped_client(token)` forwards the caller's JWT so
**RLS applies inside handlers** — prefer it over service-role. Protected prefixes in
`PROTECTED_PREFIXES`. **⚠️ Supabase rejects `@example.com`** on self-serve signup.
**⚠️ Email confirmation is ON** and SMTP rate-limits fast. Nav order **Dashboard ·
Assistant · Upload · Community · Profile**.

**Detection (4).** `app/models/` is PyTorch-only — never import `app.rag` there.
**10 classes** in `app/models/labels.py`. **⚠️ PlantVillage has no wheat imagery**,
so `"Wheat - Leaf Rust"` in the seed is NOT diagnosable. Weights 95.7% val accuracy,
head-only on CPU. **⚠️ torch must be the CPU build**; an interrupted install can't be
repaired in place (remove `site-packages/torch` + `torchvision`, reinstall).
**⚠️ Displayed confidence is capped at 99%**, rounded down — the stored score is
unchanged. Missing model is non-fatal (503). Another farmer's diagnosis returns
**404**, not 403. **CORS must list both `localhost:3000` and `127.0.0.1:3000`.**

**Solutions (5).** The `solutions` table is the only source of guidance. Content
lives in `supabase/migrations/20260915000004_solutions_knowledge_base.sql`, not
`seed.sql` (product content, not fixtures) — 50 entries. **⚠️ `verified = true` means
"traced to a named source", NOT agronomist-approved — the biggest launch risk.** A
review pack exists: `docs/solutions-review/`, generated by
`supabase/scripts/export_solutions.py` (reads the *built* table, so it fails loudly
if a migration stops applying). **⚠️ 5 of the 50 rows are `verified = false`** — all
traditional "Regional practice" (cow-urine spray, wood-ash dusting). They render like
any other row. Matching is exact; `test_solutions_coverage.py` fails if a class lacks
coverage. Healthy classes carry preventive guidance so a result is never empty.

**Assistant (6).** See the assistant section above.

**Community (7).** **⚠️ Author names come from `public.public_profiles(uuid[])`** —
SECURITY DEFINER returning ONLY `id, name, role`; 5 tests assert it **raises** if
asked for email/phone/region/crops. **⚠️ A shared diagnosis badge is owner-only** —
`diagnoses` is private under RLS, so a post shares the *question*, not the medical
record. Intended. Likes/joins are idempotent on the API, optimistic with rollback in
the UI. The composer offers only communities you've joined.

## Supabase project

- Ref **`gjphxdzxezqfpxlcaytd`** · `https://gjphxdzxezqfpxlcaytd.supabase.co`
- Keys live only in `frontend/.env.local` and `backend/.env` (git-ignored).
  **Never write keys into memory files, READMEs, or anything committed.**
- Bucket **`agri-ai`**: private, 10 MB, jpeg/png/webp. Layout
  `uploads/{user_id}/{diagnosis_id}.jpg`, `posts/{post_id}/{image_id}.jpg`. Served
  via signed URLs — never public.
- **⚠️ The direct connection is IPv6-only and unusable from this machine.** Use the
  **session pooler** (IPv4): `aws-0-ap-northeast-1.pooler.supabase.com:5432`, user
  `postgres.<ref>`. A wrong region answers `FATAL: (ENOTFOUND) tenant/user … not
  found` — don't brute-force regions.
- **The DB password contains `@`** — percent-encode it (`%40`).
- **⚠️ Never `INSERT INTO auth.users` on the hosted project** — GoTrue resolves
  sign-in via `auth.identities`, so a hand-written row fails with
  `500 unexpected_failure`. Use `supabase/scripts/seed_test_users.py`.
- Dev accounts (password `AgriAI#2026`): `ramesh.patil@example.com`,
  `sunita.devi@example.com`, `moderator@agriai.example`, `admin@agriai.example`.
  **Delete before any real deployment.**
