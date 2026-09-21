# Pre-deploy check — Vercel

Everything runs locally. **Three things stand between this and a working Vercel
deploy**, and one of them is not a bug but a platform limit.

---

## Verdict

| | |
|---|---|
| **Frontend → Vercel** | ✅ Ready, once §1 and §3 are done |
| **Backend → Vercel** | ❌ **Cannot work.** See §2 — use Render or Railway |

---

## 🔴 1. This is not a git repository — Vercel cannot deploy it

```
$ git rev-parse --show-toplevel
C:/Users/ajink          ← your home directory, not the project
$ git ls-files | wc -l
0
$ git remote -v | wc -l
0
```

Vercel deploys **from a Git repository**. With zero tracked files and no remote,
there is nothing for it to build. This is the single thing blocking the deploy.

```bash
cd C:/Users/ajink/workbuddy-ai/agri-ai-proejct
git init
git add .
git commit -m "Agri AI — initial commit"
git branch -M main
git remote add origin https://github.com/<you>/agri-ai.git
git push -u origin main
```

Then import the repo in Vercel and set **Root Directory** to `frontend`.

> ⚠️ **Check the first commit before pushing.** `git init` here is safe because the
> project has its own `.gitignore` — verified: `.env`, `.env.local` and `.env.*.local`
> are all ignored, with `!.env.example` re-included. But the repo lives inside your
> home directory, so `git status` is worth reading before `git add .` in case
> anything above the project folder gets picked up.

**Two files MUST be committed** and are correctly *not* ignored:

| File | Size |
|---|---|
| `backend/app/models/weights/efficientnet_b0_agri.pt` | 16 MB |
| `backend/app/rag/index/knowledge_base.faiss` | 889 KB |

Without them the backend boots with no model and no knowledge base.

---

## 🔴 2. The backend cannot run on Vercel — this is a hard platform limit

Vercel's Python functions are capped at **250 MB unzipped**. The backend's runtime
dependencies:

| Package | Size |
|---|---|
| **torch** | **539 MB** |
| numpy | 34 MB |
| llama_index | 28 MB |
| faiss | 16 MB |
| Pillow | 7.8 MB |
| torchvision | 7.7 MB |
| fastapi | 1.3 MB |

**torch alone is 2.2× the entire function limit**, before the 16 MB model, the
FAISS index, or any other dependency. There is no configuration that fixes this.

It is also the wrong *shape* for serverless: the model and FAISS index load once
into memory and stay there (an 8.5 s cold start), which is exactly what a
long-running server is for and what a per-request function is not.

**The backend goes on Render or Railway.** `render.yaml` at the repo root is
already written for it — including a Dockerfile that **fails the build if the
model or index is missing**, which is the behaviour you want.

Vercel then serves only the frontend, and the two talk over the public internet
(§3).

---

## 🔴 3. The frontend is hard-wired to localhost

`frontend/.env.local` (git-ignored, so Vercel never sees it):

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

In production the browser would try to reach `localhost:8000` — **on the farmer's
phone**, which is not your backend. Every API call fails.

**Set these three in the Vercel dashboard** (Project → Settings → Environment
Variables), for Production *and* Preview:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://<your-backend>.onrender.com` — **no trailing slash** |
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key |

`NEXT_PUBLIC_*` values are baked in at **build** time — changing one needs a
redeploy, not just a restart.

---

## 🔴 4. CORS will reject the deployed frontend

`backend/.env` currently allows only:

```
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

The backend is the one that has to allow the Vercel origin, and it is a
**different service** — so this must be set on Render/Railway, not Vercel:

```
CORS_ORIGINS=https://<your-app>.vercel.app,http://localhost:3000
```

Keep `localhost` so local development still works. **No trailing slash** — a
trailing slash makes the origin not match, and the failure looks like a network
error rather than a config error.

`ENVIRONMENT=production` makes the app check this at startup and report it
(`production_problems()`), but it reports rather than refuses to boot — so it is
easy to miss in the logs.

---

## Test results

| Check | Result |
|---|---|
| `ruff` · `black` | clean |
| `pytest` | **61 passed** |
| RLS local (embedded Postgres) | **74 passed** |
| `tsc --noEmit` | clean |
| `eslint` | clean |
| `prettier --check` | clean |
| **`next build`** (what Vercel runs) | **compiles successfully** |
| `auth-flow` | 13 passed |
| `diagnosis-flow` | 20 passed |
| `ui-audit` | 38 passed |
| `edge-cases` | 24 passed |
| `community-flow` | 23 passed |
| `journey-flow` | ⚠️ **skipped — quota** |
| `assistant-flow` | ⚠️ **skipped — quota** |

**118 passed, 0 failed.** Both servers healthy; `config_problems` empty; Supabase
reachable; model loaded (10 classes); RAG index loaded (74 chunks).

> ⚠️ **The two skipped suites matter for a deploy.** They exit `2` rather than
> failing, which is deliberate — but the reason is the **free tier is exhausted**.
> Both chat providers are rate-limited per model, and this is the same ceiling that
> will hit real farmers on day one. See `DECISIONS.md` (assistant §8). Billing is
> the fix, and it is a decision, not a task.

---

## ✅ Already correct

- **`frontend/vercel.json`** — `framework: nextjs`, `regions: ["sin1"]`
  (Singapore, right for India), and security headers.
- **Build command** — `npm run build`; Next.js is auto-detected.
- **`.gitignore`** — `.env*` ignored, `.env.example` kept.
- **Backend config validation** — `production_problems()` checks the Supabase keys,
  `DATABASE_URL` and `CORS_ORIGINS` when `ENVIRONMENT=production`.

### ⚠️ One thing to check in `vercel.json` before you ship

```json
"Permissions-Policy": "camera=(self), geolocation=(), microphone=()"
```

`camera=(self)` is right — the photo capture needs it. But this header **blocks
geolocation and microphone entirely**. Both are things you have said you want:

- **auto-detected location** (the design brief asks for it)
- **voice input** (the brief asks for it, and it is the single biggest lever for
  low-literacy users)

Nothing uses them yet, so this is not a bug today. It will silently block the
feature when you build it — and the failure looks like a permissions error in the
browser console, not like a config file. Change to
`geolocation=(self), microphone=(self)` when you get there.

---

## Checklist

- [ ] `git init` + first commit + push to GitHub
- [ ] Import the repo in Vercel, **Root Directory = `frontend`**
- [ ] Set the 3 `NEXT_PUBLIC_*` vars in Vercel (§3)
- [ ] Deploy the backend to **Render/Railway**, not Vercel (§2)
- [ ] Set `CORS_ORIGINS` on the backend to include the Vercel domain (§4)
- [ ] Rotate the OpenRouter key that was shared in chat
- [ ] Decide on paid chat tiers — free tier is already exhausting in testing
