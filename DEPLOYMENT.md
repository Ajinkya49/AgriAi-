# Deploying Agri AI

Everything needed to put this on Vercel + Render. Written as a runbook: follow it
top to bottom.

> **What is already done vs what needs your accounts.** The Dockerfile, the Render
> blueprint, the Vercel config, the production config checks and the performance
> baselines are all in place and verified. **The actual deploy needs your Vercel,
> Render and Supabase accounts** — those steps are marked 👤 below. The final
> "Done when" (a real user completing the journey on the production URL) can only
> be signed off after you run them.

---

## 1. What is being deployed

```
   Browser
      │
      ├──► Vercel ────────────── Next.js 16 (App Router)
      │                           · server components fetch with the user's JWT
      │                           · proxy.ts guards protected routes
      │
      └──► Render ────────────── FastAPI (Docker)
                                  · PyTorch EfficientNet-B0  (baked in)
                                  · FAISS index              (baked in)
                                  · Gemini for the assistant
      │
      └──► Supabase ──────────── Postgres + Auth + Storage (RLS enforced)
```

Two services, one database, no Kubernetes / Redis / Celery / queue — per the
TRD's simplicity constraint.

---

## 2. ⚠️ The one non-obvious problem: the ML artefacts

`.gitignore` excludes `*.pt` and `backend/app/rag/index/`. A deploy that builds
from GitHub would therefore ship **a container with no model and no assistant
index** — `/api/diagnose` returning 503 and the assistant returning 503, with no
obvious cause.

There is nowhere for the build to download a locally-trained model from, so the
two artefacts must travel with the repository:

| Artefact | Size | Why it must ship |
|---|---|---|
| `backend/app/models/weights/efficientnet_b0_agri.pt` | ~16 MB | Trained locally; no remote source |
| `backend/app/rag/index/knowledge_base.faiss` | ~892 KB | Derived from the knowledge base |
| `backend/app/rag/index/knowledge_base.meta.json` | ~52 KB | The chunk text and dimension — the index is unusable without it |

`.gitignore` already negates the exclusions for exactly these three paths, and the
Dockerfile **fails the build** if any is missing, so a broken image cannot ship.

**If the weights later grow past a few tens of MB**, move them to Git LFS or
object storage and download them in the Dockerfile instead. The build-time check
stays the same.

---

## 3. Prerequisites

### ⚠️ Step 0: this project is not in a repository yet

Both Render and Vercel deploy **from a Git repository**. Right now:

```
git root : C:/Users/ajink          ← the home directory, not the project
project  : C:/Users/ajink/workbuddy-ai/agri-ai-proejct
tracked  : 0 files
remote   : none
```

The project sits *inside* a git repository rooted at your home directory, and none
of its files are tracked. **Nothing can be deployed until it has a repository of
its own.**

Do this first:

```bash
cd C:/Users/ajink/workbuddy-ai/agri-ai-proejct

# Its own repository — do not reuse the home-directory one.
git init
git add .
git status --short | head          # sanity-check what is about to be committed

# ⚠️ Confirm the three ML artefacts are in the list before committing.
git ls-files --others --exclude-standard | grep -E "\.pt$|\.faiss$|\.meta\.json$"

git commit -m "Agri AI — MVP"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

> **A nested repository is fine here.** Git will treat `agri-ai-proejct/` as its
> own repo and the home-directory repo will ignore it. If that bothers you, move
> the project out of `C:/Users/ajink` first — but do not deploy from the
> home-directory repo.

Then confirm the artefacts made it:

```bash
git ls-files backend/app/models/weights backend/app/rag/index
# must list efficientnet_b0_agri.pt, knowledge_base.faiss, knowledge_base.meta.json
```

If that prints nothing, the `.gitignore` negations are not taking effect and the
deployed container will have no model. See §2.

### Everything else

- [ ] A Supabase **production** project (do not point production at a dev project)
- [ ] A Gemini API key **with billing enabled** — see §7
- [ ] Accounts on Render and Vercel, both connected to your Git host

---

## 4. Supabase production settings

👤 **Do these in the Supabase dashboard before deploying.**

| Setting | Where | What to set |
|---|---|---|
| **Redirect URLs** | Authentication → URL Configuration | Add `https://<your-app>.vercel.app/auth/callback` and any preview URLs |
| **Site URL** | Authentication → URL Configuration | `https://<your-app>.vercel.app` |
| **Confirm email** | Authentication → Providers → Email | **Turn ON** for production (it is off for local dev) |
| **Custom SMTP** | Authentication → Emails | Configure Resend / Postmark / SES. **The built-in SMTP is rate-limited to a handful of emails per hour and is not usable in production.** |
| **Password minimum** | Authentication → Providers → Email | Set to 8, matching the client-side rule |
| **Storage bucket** | Storage | Confirm the private bucket named in `SUPABASE_STORAGE_BUCKET` exists with a 10 MB limit and `image/jpeg,png,webp` allowed |

Apply the migrations to the production database:

```bash
# migrations run in filename order; the 5th is the Phase 7 public_profiles function
psql "$PRODUCTION_DATABASE_URL" -f supabase/migrations/20260915000001_init_schema.sql
psql "$PRODUCTION_DATABASE_URL" -f supabase/migrations/20260915000002_storage.sql
psql "$PRODUCTION_DATABASE_URL" -f supabase/migrations/20260915000003_rls_policies.sql
psql "$PRODUCTION_DATABASE_URL" -f supabase/migrations/20260915000004_solutions_knowledge_base.sql
psql "$PRODUCTION_DATABASE_URL" -f supabase/migrations/20260917000001_public_profiles.sql
```

> **Do NOT run `supabase/seed.sql` against production.** It creates test users with
> a known password (`AgriAI#2026`) and a sample community. It is a dev fixture.

Verify the migrations landed:

```bash
psql "$PRODUCTION_DATABASE_URL" -c "select count(*) from public.solutions;"     # expect 50
psql "$PRODUCTION_DATABASE_URL" -c "select proname from pg_proc where proname='public_profiles';"
```

---

## 5. Backend → Render

👤 **Render Dashboard → New → Blueprint → select this repository.** Render reads
`render.yaml` and provisions the service.

Then fill in the secrets it marks as `sync: false`:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | Project Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role (**server-only, never expose**) |
| `DATABASE_URL` | Project Settings → Database → Connection string (use the **pooler** URI) |
| `OPENROUTER_API_KEY` | Your key — **primary chat provider** |
| `GEMINI_API_KEY` | Your key — **required for embeddings**, and the chat fallback |
| `CORS_ORIGINS` | `https://<your-app>.vercel.app` — **comma-separated, no trailing slash** |

`ENVIRONMENT=production`, `MODEL_PATH`, `FAISS_INDEX_PATH` and the model names for
both providers are set in `render.yaml` and need no editing.

> **⚠️ `GEMINI_API_KEY` is not optional even though OpenRouter handles chat.** The
> FAISS index was built with `gemini-embedding-001`; `load_index()` refuses a
> mismatched model, so without it the index cannot be rebuilt.

**The first build takes 5-10 minutes** — it installs the CPU torch wheel
(~500 MB). Subsequent builds reuse the layer unless `requirements.txt` changes.

### Confirm the model and index loaded

The startup log must show both:

```
INFO | app.main | Disease detection ready (10 classes)
INFO | app.main | Farming assistant ready (74 chunks)
```

If either is missing, the app still boots and reports why:

```bash
curl -s https://<your-backend>.onrender.com/api/health/dependencies | jq
```

`model.error` and `rag.error` carry the reason; `config_problems` lists anything
misconfigured. **A deploy with `config_problems` non-empty is not ready.**

---

## 6. Frontend → Vercel

👤 **Vercel → Add New Project → import this repository.** Set:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Next.js (detected) |
| Build Command | `npm run build` (from `vercel.json`) |

Environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon key |
| `NEXT_PUBLIC_API_BASE_URL` | `https://<your-backend>.onrender.com` — **no trailing slash** |

> **⚠️ `NEXT_PUBLIC_*` values are baked in at build time.** Changing one requires a
> redeploy, not just a restart.

Then go back and set `CORS_ORIGINS` on Render to the Vercel domain and redeploy
the backend. **Both must agree or every browser call fails the preflight** — this
is the single most common deploy mistake, and it fails silently in the UI.

---

## 7. ⚠️ Before this faces real farmers

| Gate | Why |
|---|---|
| **A chat provider that can serve a village** | OpenRouter is primary, Gemini the fallback — both on **free tiers**, both rate-limited per model (Gemini: 20 requests/day/model). Measured latency on the free tier is **9–37 s per answer, median ~19 s**, which is slow for a farmer in a field. Enable billing on one of them. |
| **Agronomist review of all 50 `solutions` rows** | `verified = true` means "traced to a named source", **not** agronomist-approved. See `DECISIONS.md` §5.2. **A review sheet is ready — see below.** |
| **Decide on out-of-distribution handling** | The model returns `Tomato - Healthy` at **94% confidence on pure image noise**. See §9. |
| **Configure custom SMTP** | Without it, sign-up confirmation emails are rate-limited to a handful per hour. |
| **Rotate the API keys** | Any key pasted into a chat or committed by accident should be rotated. |

### Running the agronomist review

`docs/solutions-review/` contains a ready-to-send review pack:

| File | Use |
|---|---|
| `solutions-review.html` | Grouped by disease, one card per entry with its source link and Approve / Amend / Remove boxes. Open in a browser and print to PDF to send. |
| `solutions-review.csv` | The same 50 rows with blank `verdict` / `reviewer` / `reviewed_on` / `notes` columns, for tracking in a spreadsheet. |
| `solutions.json` | The raw extract, so the sheet can be regenerated without a database. |

Regenerate after any change to the solutions migration:

```bash
~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
    supabase/scripts/export_solutions.py
```

> **⚠️ Five of the fifty rows are marked "not traced".** They record regional
> practice with no institutional publication behind them — cow-urine spray and
> wood-ash dusting for late blight and bacterial spot. They render to farmers like
> any other row, so they need the closest reading of the set. The sheet flags them.

---

## 8. Verification checklist

Run these against the deployed URLs.

```bash
BACKEND=https://<your-backend>.onrender.com
FRONTEND=https://<your-app>.vercel.app

# 1. Backend is up and reports no config problems
curl -s $BACKEND/api/health | jq
curl -s $BACKEND/api/health/dependencies | jq '{model, rag, config_problems}'
#    expect: model.loaded true, rag.loaded true, config_problems []

# 2. CORS actually allows the frontend origin
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS $BACKEND/api/diagnose \
  -H "Origin: $FRONTEND" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization'
#    expect: 200 (a 4xx means CORS_ORIGINS does not match)

# 3. Protected routes redirect
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' $FRONTEND/dashboard
#    expect: 307 -> /login?redirect=%2Fdashboard
```

Then, in a browser on the deployed URL, complete the full journey:

1. Sign up with a real email and confirm it
2. Complete or skip onboarding → land on the dashboard
3. Upload a crop photo → receive a diagnosis with a confidence score
4. Read the Natural and Traditional solutions
5. Ask the assistant a follow-up question → answer with sources
6. Post the diagnosis to a community, and reply from a second account

You can also point the existing suites at the deployed URLs:

```bash
cd frontend
BASE_URL=$FRONTEND node e2e/journey-flow.mjs
BASE_URL=$FRONTEND node e2e/auth-flow.mjs
BASE_URL=$FRONTEND node e2e/ui-audit.mjs
```

---

## 9. Performance baselines

Measured locally on 12 CPU cores, using the same CPU-only torch build the
container uses. **Compare your hosted numbers against these** — a large gap means
the instance is undersized.

| Metric | Measured |
|---|---|
| Cold start, total | **8.5 s** |
| ↳ import torch | 3.4 s |
| ↳ load model | 3.3 s |
| ↳ load FAISS index | 0.2 s |
| Diagnosis latency, p50 | **1.64 s** |
| Diagnosis latency, p95 | 1.74 s |
| Diagnosis latency, max | 1.95 s |
| Assistant (retrieval + Gemini) | 2-45 s — dominated by Gemini, not by us |

Re-measure on the host:

```bash
cd backend
API=https://<your-backend>.onrender.com python scripts/measure_performance.py
```

**Cold start is the number to watch.** Render's free tier spins down after
inactivity; an 8.5 s model load on top of the platform's own wake-up makes the
first request after idle slow. The `starter` plan (set in `render.yaml`) avoids
spin-down.

---

## 10. Known limitations

Recorded honestly rather than discovered in production.

| Limitation | Impact | Where |
|---|---|---|
| **Confidently wrong on out-of-distribution images** | `Tomato - Healthy` at 94% on pure noise. No rejection path. | `DECISIONS.md` §9.2 |
| **`solutions` are not agronomist-reviewed** | `verified` means "traced to a source", not "approved" | `DECISIONS.md` §5.2 |
| **Wheat is not diagnosable** | PlantVillage has no wheat imagery; a wheat photo is classified as one of the ten trained classes | `DECISIONS.md` §4.1 |
| **Free-tier chat is slow and rate-limited** | Both providers are per-model rate-limited, and answers take 9–37 s. Billing is the fix | `DECISIONS.md` (assistant §8) |
| **LlamaIndex is used for embeddings only** | Chunking, the FAISS store and retrieval are own code | `DECISIONS.md` §6.7 |

---

## 11. Rolling back

Vercel and Render both keep previous deploys — use their dashboards to promote an
earlier one. The backend image is immutable per commit, so a rollback also rolls
back the model and index.

**Database migrations do not roll back automatically.** All five are additive
(tables, policies, indexes, inserts) except `20260915000004`, which deletes and
re-inserts the `solutions` rows. Restore from a Supabase backup if a migration
must be undone.
