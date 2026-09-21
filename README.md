# Agri AI

An AI-powered agriculture platform for Indian farmers: detect crop diseases from a
photo, discover natural and traditional solutions, ask a grounded farming
assistant, and learn from a community of other farmers.

> Built phase-by-phase from the six founding documents (PRD, TRD, App Flow,
> UI/UX Design Brief, Backend Schema, Implementation Plan). Those documents are
> the single source of truth for this repo.

---

## Repository layout

```
agri-ai-proejct/
├── frontend/            # Next.js + TypeScript + Tailwind CSS
│   ├── app/             # App Router routes — (auth)/, (app)/, auth/callback/
│   ├── components/      # UI components (app-nav, auth-form, onboarding-form)
│   ├── lib/             # Supabase clients, auth actions/session, validation
│   ├── e2e/             # browser-driven verification scripts
│   └── proxy.ts         # request interceptor — session refresh + route protection
├── backend/             # Python + FastAPI
│   ├── app/
│   │   ├── api/         # FastAPI routes
│   │   ├── models/      # PyTorch / EfficientNet-B0 loading + inference
│   │   ├── rag/         # LlamaIndex + FAISS + OpenRouter/Gemini generation
│   │   ├── knowledge_base/  # trusted source documents
│   │   ├── core/        # settings, logging, Supabase clients, JWT verification
│   │   └── schemas/     # Pydantic models
│   ├── scripts/         # offline: FAISS index build, model training
│   └── tests/
├── supabase/            # Postgres migrations, RLS policies, seed data, tests
└── DECISIONS.md         # every interpretation and doc conflict, by phase
```

## Non-negotiable architectural constraints

These are enforced by code organisation, not just convention:

1. **The detection model and the LLM never touch each other.**
   `backend/app/models/` is PyTorch-only. `backend/app/rag/` is the only place an
   LLM is used. No LLM is ever used for image diagnosis; the PyTorch model is
   never used for conversation.
2. **Natural and Traditional solutions come only from the curated `solutions`
   table** — never generated freestanding by the LLM. Traditional entries are
   always labelled *"Traditional Practice — Not a Guaranteed Treatment."*
3. **Every diagnosis shows a confidence score**, and low confidence prompts
   expert confirmation. The app never claims 100% certainty.
4. **Keep the stack simple.** No Kubernetes, Kafka, Redis, Celery, microservices,
   multiple vector databases, or multiple LLM providers.
5. **Mobile-first UI** for users with limited technical literacy, following the
   UI/UX Design Brief exactly.
6. **Row Level Security** enforced exactly as defined in the Backend Schema.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS, React Query, Zod |
| Backend | Python + FastAPI, async endpoints |
| Disease detection | PyTorch + EfficientNet-B0 (fine-tuned on PlantVillage + PlantDoc) |
| Image processing | Pillow (validate, EXIF-fix, resize) |
| RAG | LlamaIndex + FAISS (index built offline, loaded at startup) |
| LLM | OpenRouter (primary) + Gemini (fallback) — conversational generation only |
| Database | Supabase PostgreSQL with RLS |
| Storage | Supabase Storage |
| Auth | Supabase Auth (JWT) |
| Hosting | Vercel (frontend), Render/Railway (backend), Supabase (data) |

## Getting started

### Prerequisites

- Node.js 20+ and npm
- Python 3.11+

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev                  # http://localhost:3000
```

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements-dev.txt
cp .env.example .env          # then fill in Supabase + OpenRouter + Gemini values
uvicorn app.main:app --reload --port 8000
```

- API root: http://localhost:8000
- Interactive docs: http://localhost:8000/docs
- Health: http://localhost:8000/api/health
- Dependency health: http://localhost:8000/api/health/dependencies

## Database

Schema, indexes and RLS policies live in `supabase/migrations/` and are applied
in filename order.

```bash
# against a linked Supabase project
supabase link --project-ref <your-ref>
supabase db push

# local: applies migrations + seed.sql to a throwaway Postgres
supabase db reset
```

**Verify locally without Docker or the Supabase CLI** — this boots an embedded
PostgreSQL, applies everything, then exercises every RLS policy as the real
`anon` / `authenticated` / `service_role` roles:

```bash
~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
    supabase/tests/run_db_tests.py
```

Read `supabase/DECISIONS.md` before changing any policy — it records every
interpretation made, including one genuine contradiction in the Backend Schema
about who may write to `solutions`.

## Auth

Sign-up, log-in and log-out go **directly from the browser to Supabase Auth** —
the backend never handles a password. The backend's job is *verifying* the
resulting session (`backend/app/core/security.py`), and route protection lives in
`frontend/proxy.ts`.

| Route | Behaviour |
|---|---|
| `/` | Landing page — public |
| `/signup` | Create account → confirmation email → `/auth/callback` → `/onboarding` |
| `/login` | Email + password → `/dashboard`, or the `?redirect=` target |
| `/onboarding` | Region + primary crops — optional, skippable |
| `/dashboard`, `/upload`, `/assistant`, `/community/*`, `/profile`, `/settings` | Protected |

Signed-out visitors to a protected route go to `/login?redirect=<original path>`
with the path preserved. Signed-in users hitting `/login` or `/signup` are
bounced to `/dashboard`.

> **For local development, turn off email confirmation** (Authentication →
> Providers → Email → *Confirm email*). Supabase's built-in SMTP allows only a
> few messages per hour, so repeated test sign-ups start failing with
> `over_email_send_rate_limit`. `DECISIONS.md` lists the two other project
> settings the auth flow depends on.

## Disease detection

EfficientNet-B0 with a 10-class head over Tomato (5), Potato (3) and Pepper (2).
Weights are loaded **once at API startup**; a missing or mismatched checkpoint is
non-fatal — the API boots and `POST /api/diagnose` returns 503.

```bash
cd backend
# CPU-friendly: frozen backbone, trains only the head (~2 min on 12 cores)
python scripts/train_model.py --data-root <plantvillage-root> --mode head

# End-to-end fine-tune — wants a GPU
python scripts/train_model.py --data-root <plantvillage-root> --mode full --epochs 8
```

Flow: `POST /api/diagnose` → Pillow validates / fixes EXIF / resizes → PyTorch
inference → image to Supabase Storage → row in `diagnoses` → result with a
confidence score.

**Every prediction carries a confidence score**, and the displayed percentage is
**capped at 99%** — the app never claims certainty. Low confidence is a normal
result state that prompts for expert confirmation, not an error.

`disease_name` strings (`"<Crop> - <Disease>"`) are matched **exactly** against
`solutions.disease_name`. See `DECISIONS.md` for the class set and the wheat
caveat.

## Solutions knowledge base

Natural and Traditional guidance is **read from the `solutions` table** — the LLM
never generates it. The table is populated by
`supabase/migrations/20260915000004_solutions_knowledge_base.sql` and is writable
only by an admin.

- **50 entries** across all 10 diagnosable classes, each traced to ICAR, the TNAU
  Agritech Portal, or published biocontrol trials.
- Matching is on `disease_name`, **exactly** against `diagnoses.predicted_disease`.
  No fuzzy matching — a near-miss would attach advice for one disease to another.
- Traditional entries always render with the badge *"Traditional Practice — Not a
  Guaranteed Treatment."*
- `verified = true` means **traced to a named source**, not agronomist-approved.
  **An agronomist must review every row before launch** — see `DECISIONS.md` §5.2.

`backend/tests/test_solutions_coverage.py` enforces that every class has both a
Natural and a Traditional entry, so adding a class to `labels.py` without adding
solutions fails the test suite rather than shipping a dead end.

## Farming assistant

Answers are generated **only from retrieved knowledge-base passages**, and every
answer shows the sources it used. The assistant never diagnoses an image (that is
the PyTorch model) and never invents a Natural or Traditional solution (those come
from the curated `solutions` table).

```bash
cd backend
python scripts/build_faiss_index.py --dry-run   # check chunking, no API calls
python scripts/build_faiss_index.py             # embed and persist the index
```

The index is built **offline** and only *loaded* at API startup — never rebuilt per
request. It lives in `backend/app/rag/index/`.

- Corpus: `backend/app/knowledge_base/documents/*.md` — 8 documents, 74 chunks.
- Embeddings: `gemini-embedding-001` (3072 dims) — **Gemini only**.
- Chat: **OpenRouter first, Gemini as fallback.** Both are conversation-only.
- **If the knowledge base changes, rebuild the index.** Changing the embedding
  model also requires a rebuild — `load_index()` refuses a mismatch rather than
  returning confident nonsense.

### Language

Answers come back in the language the farmer asked in — **English or Hindi**. The
UI has a language toggle that switches the starter questions and placeholder, but
it only changes the app's own wording: a Hindi question is answered in Hindi
whatever the toggle says, and romanised Hindi ("tamatir ke patte") works too.

> ⚠️ **Free tiers on both providers are rate-limited per model**, and answers take
> **9–37 s (median ~19 s)** on them. That is the provider's generation speed, not
> the code. Billing is the fix. See `DECISIONS.md` (assistant §8).

> ⚠️ **Do not disable reasoning on the OpenRouter model.** It looks like a 2× win
> on a short prompt, but against the real prompt it is 2× *slower* — without a
> planning step the model rambles. Measured numbers are in `app/rag/llm.py`.

> ⚠️ **Gemini thinking must stay disabled** (`thinkingConfig.thinkingBudget = 0`).
> Gemini 3.x bills thinking tokens against `maxOutputTokens`, which truncated
> answers to ~150 characters mid-sentence. See `DECISIONS.md` §6.1.

## Farmer community

Communities, posts, comments and likes — all guarded by RLS, with the API never
re-implementing those rules.

| Route | Purpose |
|---|---|
| `/community` | Discover communities; join or leave |
| `/community/new` | Start a community (you become its first member) |
| `/community/[communityId]` | The community feed |
| `/community/[communityId]/post/[postId]` | One post with its replies |
| `/post/new` | Write a post, optionally attaching a diagnosis (`?diagnosis=<id>`) |

> **⚠️ Author names come from `public.public_profiles()`**, a deliberately narrow
> SECURITY DEFINER function returning only `id, name, role` — never email, phone,
> region or crops. `public.users` stays self-or-admin only. Five tests in
> `run_db_tests.py` assert the function raises if asked for a private column.
> See `DECISIONS.md` §7.1.

> **A shared diagnosis badge is visible only to the farmer who owns it.** The
> diagnosis is private under RLS, so attaching one to a post shares the *question*,
> not the diagnosis. Everyone else sees the post text without the badge.

## Design system

Tokens live in `frontend/app/globals.css` — verify with `node e2e/ui-audit.mjs`,
which reads them from the rendered page rather than from the source, and runs its
tap-target and WCAG AA contrast checks against **both the public landing page and
the signed-in screens**.

> **Light, rural-first: deep leaf green on warm off-white.** Chosen for sunlight
> readability on budget Android screens — the reason the original UI/UX Design
> Brief specified light mode. A dark violet system was used for one phase, taken
> from a reference recording, and reverted. See `DECISIONS.md` §12.

| Token | Value | Role |
|---|---|---|
| `--color-surface` | `#FAFAF5` | Warm off-white canvas |
| `--color-surface-2` | `#FFFFFF` | Card surface |
| `--color-ink` | `#1B1B1B` | Primary text (16:1) |
| `--color-muted` | `#6B6B66` | Secondary text (5.6:1) |
| `--color-primary` | `#2E7D32` | Leaf green — text, icons, borders (4.9:1) |
| `--color-accent` | `#2E7D32` | CTA fill, always under white text (5.1:1) |
| `--color-secondary` | `#8D6E63` | Soil brown |
| `--color-highlight` | `#FFB300` | Harvest amber — **dark text only** |
| `--radius-card` | `16px` | Rounded corners throughout |
| `--spacing-tap` | `48px` | Minimum tap target (the brief's 48dp) |

> **⚠️ `--color-highlight` (amber) is light.** It is never a text colour on white
> and never sits behind white text — it carries `--color-ink`, or acts as a badge.
> White on `#FFB300` is 1.9:1.

> **`--color-primary` and `--color-accent` are the same green here**, and that is
> correct: `#2E7D32` is 4.9:1 as text on off-white *and* 5.1:1 as a fill under
> white text, so one green carries both roles. On the dark theme they had to be
> different values. `ui-audit.mjs` asserts the real contract — that white is
> legible on the CTA fill — rather than that the two differ.

**Cards are solid white with a soft shadow**, not frosted glass. `backdrop-filter`
is expensive on the budget Android phones this targets, and on a light canvas a
translucent white over off-white just reads as a slightly dirty card. Translucency
is kept only where there is genuinely content behind it — the floating tab bar and
the assistant composer.

**Motion is unchanged** and was never palette-specific: `Reveal`, `TiltCard`,
`SpotlightCard`, `Marquee`, `RotatingText` and `Counter` in `components/ui/`. All
no-op under `prefers-reduced-motion`, and `.reveal` is forced visible so content
can never be stranded at `opacity: 0`.

**Every screen has a defined empty, loading and error state.** Loading skeletons
always pair the animation with readable text; error boundaries never show a stack
trace; every empty state offers a next step.

> **⚠️ Confidence is never shown in red.** A low-confidence result is a normal
> outcome, not an error, so the confidence bands are green / amber / **gray**. Red
> (`--color-danger*`) is reserved for genuine errors.

## Testing

```bash
# backend + database
cd backend && pytest                                    # 28
python supabase/tests/run_db_tests.py                   # 74  (local RLS, embedded Postgres)
python supabase/tests/verify_live_project.py            # 44  (live RLS + cross-user probes)

# end to end (needs Chrome + both servers running)
cd frontend
node e2e/journey-flow.mjs     # 17  diagnose → solutions → assistant → community
node e2e/edge-cases.mjs       # 24  auth, upload and low-confidence edge cases
node e2e/auth-flow.mjs        # 13
node e2e/diagnosis-flow.mjs   # 20
node e2e/community-flow.mjs   # 23
node e2e/ui-audit.mjs         # 37  tap targets, contrast, responsive, tokens
node e2e/assistant-flow.mjs   # 14  needs chat quota — exits 2 if exhausted

# not a test — captures screenshots of every screen for visual review
node e2e/capture-ui.mjs            # → ../../.verify/redesign/
node e2e/capture-ui.mjs landing    # landing page only
node e2e/capture-ui.mjs app        # signed-in screens only
```

> **⚠️ `assistant-flow.mjs` exits 2 when the free chat tier is exhausted.** That
> is a distinct code so CI can tell "skipped" from "passed" and "failed". See
> `DECISIONS.md` §9.5.

> **⚠️ Two known limitations found in testing**, both recorded in `DECISIONS.md`:
> the model is **confidently wrong on pure noise** (94% on an image with no leaf in
> it), and the low-confidence "Healthy" path once hid its own warning.

## Deployment

**See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full runbook.** The short version:

| Target | Config | Notes |
|---|---|---|
| Backend | `backend/Dockerfile` + `render.yaml` | CPU torch, model and FAISS index baked in |
| Frontend | `frontend/vercel.json` | Root directory must be set to `frontend` |

```bash
# build the backend image from the REPOSITORY ROOT
docker build -f backend/Dockerfile -t agri-ai-backend .
docker run -p 8000:8000 --env-file backend/.env agri-ai-backend
```

**Measured on 12 CPU cores** (same CPU torch build as the container):

| Metric | Value |
|---|---|
| Cold start | **8.5 s** |
| Diagnosis p50 / p95 | **1.64 s / 1.74 s** |

> **⚠️ The ML artefacts must be committed.** `.gitignore` excludes `*.pt` and the
> index directory, with explicit negations for the three files the container needs.
> Without them the image builds but serves no model — the Dockerfile fails the
> build rather than letting that ship. See `DEPLOYMENT.md` §2.

> **⚠️ `CORS_ORIGINS` must include the deployed frontend origin**, or every browser
> call fails the preflight and the UI fails silently. Set `ENVIRONMENT=production`
> and the app checks this at startup, reporting problems from
> `/api/health/dependencies` as `config_problems`.

## Build phases

| # | Phase | Status |
|---|---|---|
| 1 | Setup | **Complete** |
| 2 | Database | **Complete** |
| 3 | Auth | **Complete** |
| 4 | Core Feature — Disease Detection Pipeline | **Complete** |
| 5 | Core Feature — Natural & Traditional Solutions | **Complete** |
| 6 | Core Feature — AI Farming Assistant (RAG) | **Complete** |
| 7 | Core Feature — Farmer Community | **Complete** |
| 8 | UI Polish | **Complete** |
| 9 | Testing | **Complete** |
| 10 | Deploy | **Config complete** — deploy pending your accounts |

## Environment variables

Both apps read the same names defined in the TRD. See `frontend/.env.example`
and `backend/.env.example` for the full annotated list.

| Variable | Used by | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | frontend | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | frontend | RLS-respecting public key |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | Server-side RLS-bypassing key |
| `OPENROUTER_API_KEY` | backend | **Primary** chat provider (assistant) |
| `GEMINI_API_KEY` | backend | Chat fallback, and the **only** embeddings provider |
| `MODEL_PATH` | backend | Fine-tuned PyTorch weights (Phase 4) |
| `FAISS_INDEX_PATH` | backend | Persisted vector index (Phase 6) |
| `SUPABASE_STORAGE_BUCKET` | both | Image storage bucket |
| `DATABASE_URL` | backend | Direct Postgres connection |

## Scripts

| Command | Location | What it does |
|---|---|---|
| `npm run dev` | `frontend/` | Start the Next.js dev server |
| `npm run build` | `frontend/` | Production build |
| `npm run lint` | `frontend/` | ESLint |
| `npm run format` | `frontend/` | Prettier write |
| `npm run typecheck` | `frontend/` | TypeScript, no emit |
| `node e2e/auth-flow.mjs` | `frontend/` | Browser-driven auth flow check (uses installed Chrome) |
| `node e2e/diagnosis-flow.mjs` | `frontend/` | Browser-driven upload → diagnosis check |
| `node e2e/assistant-flow.mjs` | `frontend/` | Browser-driven grounded-answer check (needs chat quota) |
| `node e2e/community-flow.mjs` | `frontend/` | Browser-driven post → reply → like check (two farmers) |
| `node e2e/ui-audit.mjs` | `frontend/` | UI/UX audit — routes, tap targets, contrast, responsive |
| `node e2e/journey-flow.mjs` | `frontend/` | Full journey: diagnose → solutions → assistant → community |
| `node e2e/edge-cases.mjs` | `frontend/` | Auth, upload and low-confidence edge cases |
| `ruff check .` | `backend/` | Python lint + import order |
| `black .` | `backend/` | Python formatting |
| `pytest` | `backend/` | Backend tests |
