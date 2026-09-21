# Agri AI — decisions log

Durable record of choices made where the founding documents were silent,
ambiguous, or contradicted themselves. **Read this before changing behaviour
that looks odd.**

- Phase 1 (Setup) — see `README.md`
- Phase 2 (Database) — see `supabase/DECISIONS.md` (schema + RLS specifics)
- Phase 3 (Auth) — below

---

## Phase 3 — Auth

### 1. `proxy.ts`, not `middleware.ts`

Next.js 16 **renamed** the `middleware` file convention to `proxy`, and the
exported function from `middleware` to `proxy`. The old name is deprecated.
Using `middleware.ts` on this version would have silently done nothing, so
route protection would have appeared to work while actually being absent.

Files: `frontend/proxy.ts`, `frontend/lib/supabase/session.ts`.

### 2. Bottom tab order — Upload is in position 3, not 2

The App Flow lists the tabs as *"Dashboard, Upload (center, prominent),
Assistant, Community, Profile"*. Five tabs have no second-position centre, so
these two instructions conflict. **Upload was placed in the actual centre
(position 3)** to honour "center, prominent", which is the more specific
instruction about layout.

Current order: **Dashboard · Assistant · Upload · Community · Profile**

To match the written order instead, reorder `NAV_ITEMS` in
`frontend/components/app-nav.tsx`.

### 3. `name` added to the sign-up form

The Backend Schema has `users.name`, and the `on_auth_user_created` trigger
reads it from `raw_user_meta_data->>'name'`. The App Flow's sign-up screen only
mentions email/phone, and onboarding only collects region + crops — so `name`
had no home and would have stayed empty forever. It is collected at sign-up.

### 4. The backend verifies JWTs by asking Supabase, not by decoding locally

`app/core/security.py` calls `GET /auth/v1/user` with the caller's token rather
than verifying the signature itself. That costs one HTTP round-trip but means:

- the backend never needs the project's JWT secret (not in the TRD's env list);
- revoked and expired sessions are honoured immediately.

If latency ever matters more than that, add `SUPABASE_JWT_SECRET` and verify
locally instead.

### 5. Sign-in errors are deliberately generic

A wrong email and a wrong password both return *"That email and password
combination did not work."* Returning "no such user" would let anyone enumerate
registered farmers.

### 6. Placeholder routes for later phases

`/upload`, `/assistant` and `/community` render a "Coming in Phase N" card. They
exist so the navigation and the protected-route rules are real rather than
aspirational. `/profile` is fully built because sign-out had to live somewhere.

### 7. Password minimum raised to 8 characters

Supabase's own floor is 6. 8 is used client-side; the project's Auth settings
should be raised to match (Authentication → Providers → Email → Minimum
password length), otherwise the client is stricter than the server.

---

## ⚠️ Two Supabase project settings that block a live sign-up test

Discovered while verifying Phase 3. **Both are project configuration, not code.**

### A. Email confirmation is ON, and the built-in SMTP is rate-limited

`GET /auth/v1/settings` reports `mailer_autoconfirm: false`, so every sign-up
requires clicking a link in a real email. Supabase's built-in SMTP allows only a
handful of messages per hour — a few test sign-ups exhaust it and further
attempts fail with `over_email_send_rate_limit`.

**For local development, turn confirmation off:**
Authentication → Providers → Email → *Confirm email* → off.

That makes `signUp()` return a session immediately, the app redirects straight to
`/onboarding`, and no email is sent. Turn it back on before production, and
configure custom SMTP (Resend / Postmark / SES) at the same time.

### B. `@example.com` is rejected by Supabase's email validation

Self-serve sign-up returns `email_address_invalid` for `example.com` and similar
reserved domains. The seeded test accounts use `@example.com` and still work
because the **Admin API bypasses that validation** — so do not copy that pattern
into anything user-facing.

### C. The callback URL must be whitelisted

The confirmation link returns to `/auth/callback`. Add
`http://localhost:3000/auth/callback` (and the production equivalent) to
Authentication → URL Configuration → **Redirect URLs**, or Supabase will bounce
the link to the Site URL and the session will never be created.

---

## Verification status (Phase 3)

| Check | Result |
|---|---|
| `frontend` typecheck · lint · build | pass |
| `backend` ruff · black · pytest | pass (3 tests) |
| `supabase/tests/run_db_tests.py` (local RLS) | 66 passed |
| `supabase/tests/verify_live_project.py` (live RLS) | 15 passed |
| `frontend/e2e/auth-flow.mjs` (real browser) | **13 passed** |
| `GET /api/auth/me` — no token / bad token / real JWT | 401 / 401 / 200 + own profile |
| Live **sign-up** through the UI | ⛔ blocked by settings A + B above |

---

## Phase 4 — Disease Detection Pipeline

### 1. v1 class set — 10 classes, and **no wheat**

`app/models/labels.py` defines the served taxonomy:

| Crop | Classes |
|---|---|
| Tomato | Early Blight, Late Blight, Leaf Mold, Septoria Leaf Spot, Healthy |
| Potato | Early Blight, Late Blight, Healthy |
| Pepper | Bacterial Spot, Healthy |

**⚠️ PlantVillage contains no wheat imagery**, so `"Wheat - Leaf Rust"` — which
appears in `supabase/seed.sql` — is **not diagnosable by this model**. Adding it
needs PlantDoc (a different, field-photo dataset). Until then a wheat photo will
be classified as one of the ten above.

**Phase 5 must populate `solutions` for exactly these ten `disease_name` values.**
The seed currently covers two of them (Tomato Early/Late Blight), which is enough
to prove the matching works end to end.

### 2. Head-only training by default, not full fine-tuning

The Implementation Plan says "fine-tune EfficientNet-B0". The machine used here
has **no GPU** (12 CPU cores), so `scripts/train_model.py` defaults to
`--mode head`: the ImageNet backbone is frozen, its features are cached once, and
only the classifier head is trained. That reached **95.7% validation accuracy in
140 seconds** — the frozen features are already highly discriminative for leaf
imagery.

`--mode full` unfreezes everything and is the right choice on a GPU machine. Both
modes emit the identical checkpoint format, so serving is unaffected.

### 3. ⚠️ Confidence display is capped at 99% — a real bug the e2e test caught

A genuinely correct score of 0.996 was rendering as **"100% confidence"**, because
`Math.round(0.996 * 100) === 100`. That directly violates the product principle
*"Never claim an image diagnosis is 100% certain."*

`formatConfidence()` / `confidencePercent()` in `frontend/lib/utils.ts` now
**round down and clamp at 99%**. The stored and API-returned score is unchanged —
only the label is clamped, because the true probability is what belongs in the
database.

### 4. A mismatched checkpoint is refused, not served

`loader.py` compares the checkpoint's stored `class_names` against
`labels.DISEASE_CLASSES` and **refuses to load if they differ**. Serving a
checkpoint trained on a different taxonomy would map output indices to the wrong
disease names — worse than serving nothing, because the result looks valid.

### 5. A missing model is non-fatal

Startup logs a warning and the API still boots; `/api/diagnose` returns **503**
and `/api/model` reports why. A broken checkpoint must not take down health checks
or the rest of the API.

### 6. Another farmer's diagnosis returns **404**, not 403

`GET /api/diagnoses/{id}` returns the same "we couldn't find that diagnosis" for
"does not exist" and "belongs to someone else". A 403 would confirm that a given
id exists, which is a small but real information leak. The history endpoint
(`/diagnoses/user/{id}`) *does* return 403, because there the caller already knows
the target user exists.

### 7. CORS must list **both** `localhost` and `127.0.0.1`

They are different origins to a browser. The e2e suite runs against
`127.0.0.1:3000` while the documented dev URL is `localhost:3000`, so the
allowlist carries both. Symptom if it is wrong: `No 'Access-Control-Allow-Origin'
header` on `POST /api/diagnose`, with the upload silently never completing.

### 8. Dataset and environment notes

- Source: `mohanty/PlantVillage` on HuggingFace (the original author's copy),
  `data.zip` ≈ 2.18 GB. Only the ten needed class folders are extracted.
- Folder spellings vary between releases (`Pepper,_bell___Bacterial_spot` vs
  `Pepper__bell___Bacterial_spot`), so `train_model.py` matches on an
  alphanumeric-normalised key rather than the literal name.
- **torch must be the CPU build** (`--extra-index-url .../whl/cpu`); the default
  PyPI wheels are multi-GB CUDA builds.
- If a torch install is interrupted, pip cannot repair it in place — it must
  delete ~500 MB first, which a sandboxed bulk-delete guard will block. Remove
  `site-packages/torch` and `site-packages/torchvision` and reinstall.
- **The Next.js dev server's Turbopack HMR does not work in this environment**,
  and while it is failing, client components never hydrate — so anything
  interactive (the upload preview, the password toggle) silently does nothing.
  Server actions and form posts still work, which makes the failure easy to miss.
  Run `next build && next start` to exercise client-side behaviour here.

## Verification status (Phase 4)

| Check | Result |
|---|---|
| Model trained | **95.7%** val accuracy, 10 classes, 140 s |
| Held-out image through the API | Tomato Late Blight, **99.6%** confidence, correct |
| `POST /api/diagnose` — no token / bad file / oversized | 401 / 422 / 422 |
| Owner vs other farmer on `GET /api/diagnoses/{id}` | 200 / 404 |
| Owner vs other farmer on `/diagnoses/user/{id}` | 200 / 403 |
| `backend` ruff · black · pytest | pass (21 tests) |
| `frontend` typecheck · lint · format · build | pass |
| `frontend/e2e/auth-flow.mjs` | **13 passed** |
| `frontend/e2e/diagnosis-flow.mjs` | **13 passed** |

---

## Phase 5 — Natural & Traditional Solutions

### 1. The knowledge base is a **migration**, not seed data

`solutions` moved from `seed.sql` to
`supabase/migrations/20260915000004_solutions_knowledge_base.sql`.

Seed data is disposable test fixtures; this is curated product content that ships
to farmers. Keeping it in a migration means it is versioned, applied to every
environment in order, and cannot be lost by skipping a dev seed. The Phase 2
placeholder rows — which were explicitly unsourced — were deleted.

### 2. ⚠️ What `verified` means, and what it does NOT mean

| Value | Meaning |
|---|---|
| `true` | The text is traced to the named source in the same row, and can be checked against it. |
| `false` | Recognised regional practice, recorded but not traced to an institutional publication. |

**This is NOT agronomist sign-off.** `verified = true` means "we can point at
where this came from", not "a qualified agronomist has approved this advice".

**Before launch, a qualified agronomist must review every row and either confirm
it or replace it.** That is a Phase 9 / pre-launch gate, and it is the single
largest remaining risk in the product.

### 3. Sources actually used

| Source | Used for |
|---|---|
| **TNAU Agritech Portal** (Tamil Nadu Agricultural University) | Panchagavya, Jeevamrut, Amirthakaraisal preparation methods and dosages |
| **ICAR** | Cultural, sanitation, rotation and varietal guidance |
| **Published biocontrol / botanical trials** | Pseudomonas fluorescens and neem efficacy against *Alternaria solani* |

Every Natural row cites a URL. Traditional rows either cite a source or are
marked `verified = false` — enforced by
`backend/tests/test_solutions_coverage.py`.

### 4. Healthy classes get **preventive** guidance, not an empty section

The Done-when criterion is that a diagnosis never returns an empty result. A
"Healthy" prediction has no disease to treat, so rather than showing nothing the
three Healthy classes carry preventive entries — scouting, base watering, canopy
management, Panchagavya — under the heading *"Keeping your crop healthy"*.

This is deliberate, not a loophole: "nothing to treat" and "we have no guidance"
are different messages, and only the second one is a failure.

### 5. Matching is exact — no fuzzy, no substring

`solutions.disease_name` must equal `diagnoses.predicted_disease` character for
character. A fuzzy match would attach advice for one disease to another, which is
worse than showing nothing, because the result still *looks* authoritative.

Drift in either direction is caught: `test_no_orphan_solutions` fails if a
solution references a class the model cannot predict, and
`test_every_class_has_both_sections` fails if a class has no solutions.

### 6. Neem appears in **both** categories, deliberately

Research-backed neem oil (with a dosage and a citation) sits under **Natural**.
The traditional overnight neem-leaf-extract preparation sits under
**Traditional**. They are different preparations with different evidence
standing, and merging them would blur the distinction the two tabs exist to make.

### 7. Incomplete coverage degrades honestly

If a section is empty the API returns `complete: false` and the UI says the other
category has no reviewed entries yet, rather than rendering a blank panel that
looks like a bug. If *both* are empty the screen says so and directs the farmer
to their KVK.

### 8. The invariant is enforced by a test, not by hope

`backend/tests/test_solutions_coverage.py` reads the migration and asserts:

- every class in `labels.py` has ≥1 Natural **and** ≥1 Traditional entry;
- no solution references an unknown disease;
- every `disease_name` follows `<Crop> - <Disease>`;
- Natural rows always cite a source URL;
- Traditional rows either cite a source or are explicitly `verified = false`;
- no description is a placeholder one-liner.

Adding a class to `labels.py` without adding solutions now fails the suite
instead of silently shipping a dead end to a farmer.

## Verification status (Phase 5)

| Check | Result |
|---|---|
| Knowledge base size | **50 solutions** — 30 Natural, 20 Traditional, 45 sourced |
| Coverage | all **10/10** classes have both sections |
| `backend` ruff · black · pytest | pass (**28 tests**) |
| `supabase/tests/run_db_tests.py` (local RLS) | **66 passed** |
| `supabase/tests/verify_live_project.py` (live) | **35 passed** (20 of them coverage) |
| `frontend` typecheck · lint · build | pass |
| `frontend/e2e/diagnosis-flow.mjs` | **20 passed** |
| `frontend/e2e/auth-flow.mjs` | **13 passed** |
| API returns matched solutions | 4 Natural + 3 Traditional for a real diagnosis |

---

## Phase 6 — AI Farming Assistant (RAG)

### 1. ⚠️ Model names: `gemini-2.5-flash` is retired, and thinking must be disabled

Two findings that cost real debugging time. Both are recorded so nobody repeats them.

**`gemini-2.5-flash` returns 404 for new API keys:**
> *"This model is no longer available to new users. Please update your code to use
> models/gemini-3.6-flash."*

The project uses **`gemini-3.6-flash`** for generation and **`gemini-embedding-001`**
for embeddings (3072 dimensions).

**Gemini 3.x models "think" by default, and thinking tokens are billed against
`maxOutputTokens`.** With the default budget and `maxOutputTokens: 1024`, answers
were being **truncated after roughly 150 characters** — mid-sentence, mid-list.
A truncated answer reads as a confident half-sentence, which is worse than an error.

`generationConfig.thinkingConfig.thinkingBudget = 0` disables it. This is a grounded
extraction task: the context is already retrieved and the reasoning is not needed.
`maxOutputTokens` is 2048, and a `finishReason: MAX_TOKENS` response is logged so
truncation is caught rather than shipped.

### 2. ⚠️ The free tier allows only **20 requests per day, per model**

`GenerateRequestsPerDayPerProjectPerModel-FreeTier: 20`.

Twenty answers a day is not enough to develop against, and it is not enough to run
the app on. That is why there is a **model fallback chain**
(`gemini_model_chain`: primary, then `gemini-3.5-flash`, `gemini-flash-latest`,
`gemini-3-flash-preview`), which multiplies the usable daily budget and rides out
the frequent 503s on any single model.

**Before any real deployment, billing must be enabled** — the free tier cannot
serve farmers.

### 3. Grounding is enforced in four layers, not by asking nicely

1. A system instruction that permits only the supplied passages.
2. `temperature: 0.2`, so the model does not embellish.
3. A post-check that logs loudly if the answer cites a passage number that was
   never supplied — that would mean the model invented a reference.
4. A **leakage guard**: an earlier version of the prompt made the model print a
   self-evaluation of its own rules (*"Exact dosage quoted? Yes…"*) instead of an
   answer. That output is now detected and the next model in the chain is tried.

Layer 4 exists because it actually happened, and because the loose "does the answer
mention a dosage" assertion in the first e2e test **passed on that broken output**.
The test now asserts the real recipe text and explicitly forbids instruction
leakage.

### 4. No retrieval means no LLM call

If nothing in the knowledge base scores above `MIN_SCORE = 0.55`, the pipeline
returns the refusal message **without calling Gemini at all**. Calling the model
with weak context is how a grounded assistant starts answering confidently about
the wrong thing — and on a 20-requests-per-day quota, spending a request on a
question you cannot answer is doubly wasteful.

Weak matches are dropped rather than padded in for the same reason.

### 5. Vague follow-ups get an augmented search query

"What should I do about it?" retrieves nothing useful on its own. When a diagnosis
is in context, the pipeline prepends the crop and condition **to the search query
only** — the model still sees the farmer's actual words as the question.

The prompt also states explicitly that the question is a follow-up about the
supplied diagnosis and that words like "it" refer to it. Without that, the model
refused a question it could answer.

### 6. Only cited sources are shown

The sources panel lists the passages the answer actually referenced, not every
chunk retrieved. Listing passages the model ignored would make the citations
decorative rather than evidence.

### 7. ⚠️ Deviation: LlamaIndex is used for embeddings only

The TRD specifies "LlamaIndex + FAISS". The implementation uses:

| Piece | What is used |
|---|---|
| Embedding interface | `llama_index.core.embeddings.BaseEmbedding` — a `GeminiEmbedding` subclass |
| Chunking | Own heading-aware splitter (`app/rag/index.py`) |
| Vector store | `faiss` directly (`IndexFlatIP`, cosine on normalised vectors) |
| Retrieval | Own (`app/rag/retriever.py`) |

**Why:** LlamaIndex's `VectorStoreIndex` persists a directory of JSON files with
base64-encoded vectors, which does not fit `FAISS_INDEX_PATH` naming a single
`.faiss` file; and this corpus is Markdown organised by `##` headings, so splitting
on those boundaries keeps a disease's symptoms with its management advice in a way
`SentenceSplitter` does not.

`faiss` and `llama-index-core` are both installed and pinned. Say the word if you
want the full `VectorStoreIndex` / `FaissVectorStore` flow instead — it is a
contained change to `app/rag/index.py`.

### 8. Installing llama-index upgrades pydantic

`llama-index-core` requires a newer pydantic than the Phase 1 pin.
`pydantic` moved **2.10.4 → 2.13.5**. The full backend suite passes on it
(verified before proceeding), and the pin in `requirements.txt` was updated.

### 9. The index refuses to load if the embedding model changed

Vectors from different embedding models are not comparable, so serving an index
built with one model against query vectors from another returns confident nonsense.
`load_index()` compares the recorded model and dimension and refuses to load on a
mismatch, rather than degrading silently.

## Verification status (Phase 6)

| Check | Result |
|---|---|
| Knowledge base | **8 documents, 39,165 chars → 74 chunks**, 3072 dims |
| Retrieval relevance | tomato question → `tomato_diseases` @ 0.782 |
| Grounded answer | complete 1,551-char Panchagavya recipe, cited `[1] [2]` |
| Out-of-scope question | refused, **no API call made** |
| Vague follow-up with diagnosis context | answered correctly |
| `backend` ruff · black · pytest | pass (**28 tests**) |
| `frontend` typecheck · lint · format · build | pass |
| `frontend/e2e/assistant-flow.mjs` | **14 passed** |
| `frontend/e2e/auth-flow.mjs` | 13 passed |
| `frontend/e2e/diagnosis-flow.mjs` | 20 passed |

---

## Phase 7 — Farmer Community

### 1. ⚠️ A deliberate, narrow privacy exception for author names

`public.users` is readable only by the row's owner or an admin
(`users_select_own_or_admin`). That is correct — the table holds email, phone,
region and crops.

But a community feed has to show **who** said something. Without an exception, the
frontend cannot resolve an author name for anyone else's post, and every post would
read "A farmer".

`supabase/migrations/20260917000001_public_profiles.sql` adds
`public.public_profiles(uuid[])` — a SECURITY DEFINER function returning **only**:

    id, name, role

**Why a function and not a widened table policy:** the exception is explicit,
named, greppable, and impossible to widen by accident. Adding a column to a policy
is an easy mistake to miss; adding one to a function is not.

**Enforced by tests, not by good intentions.** `run_db_tests.py` asserts the
function *raises* when asked for `email`, `phone`, `region` or `primary_crops`. If
someone widens the disclosure, the suite fails.

**The position taken:** a farmer's display name and role are public within the app;
their contact details and location are not.

### 2. A shared diagnosis is only visible to the farmer who owns it

`diagnoses` is owner-only under RLS. So when a post carries a `diagnosis_id`, the
"Tomato — Late Blight (99%)" badge resolves **only for the author**. Everyone else
sees the post text without the badge.

This is the honest outcome rather than a bug: the diagnosis, its confidence score
and its photo are private, and attaching one to a post shares the *question*, not
the medical record. The `image_url` on `posts` exists for a deliberately shared
image and is separate from the private diagnosis image.

### 3. Likes and joins are idempotent

Double-tapping a heart, or tapping Join twice on a slow connection, must not error.
`POST /api/posts/:id/like` and `POST /api/communities/:id/join` check for an
existing row first and return the current state. The unique constraint on
`post_likes` is the backstop.

### 4. Likes and joins update optimistically, and roll back

A farmer tapping a heart should not wait on a round trip. Both controls flip
immediately and revert to the last known server state if the write fails — showing
a like that did not save would be worse than a moment of latency.

### 5. Creating a community joins you to it

The intent is obvious, and it saves a tap. Without it a farmer lands in a community
they are not a member of, and cannot post in it.

### 6. The post composer only offers communities you have joined

Posting into a group you have not joined would be surprising. If the farmer has
joined none, the composer says so and links to the discovery list rather than
offering an empty dropdown.

### 7. Fixed: the post card's reply count went stale

The post card is server-rendered, so immediately after replying a farmer saw
**"0" beside "1 reply"** — the card still held the count from page load.

`components/community/post-thread.tsx` is a small client wrapper that owns the
count and feeds it to both the card and the comment list. The e2e suite now asserts
the two agree.

### 8. No duplicate index

Phase 2 already created `community_members_user_id_idx`. An earlier draft of the
Phase 7 migration added `community_members_user_idx` for the same column — pure
write overhead on every join. It was removed from both the migration and the
database.

## Verification status (Phase 7)

| Check | Result |
|---|---|
| Full flow through the UI (two farmers) | **23 passed** |
| `supabase/tests/run_db_tests.py` | **74 passed** (9 new for `public_profiles`) |
| `backend` ruff · black · pytest | pass (28 tests) |
| `frontend` typecheck · lint · format · build | pass |
| `frontend/e2e/auth-flow.mjs` | 13 passed |
| `frontend/e2e/diagnosis-flow.mjs` | 20 passed |
| `frontend/e2e/assistant-flow.mjs` | 14 passed (needs Gemini quota) |

---

## Phase 8 — UI Polish

### 1. ⚠️ There were no loading, error or 404 states anywhere

Every server-rendered route was expected to have them (the Done-when criterion is
"every screen ... has a defined state for empty/loading/error"), and **not one
existed**. Added:

| File | Purpose |
|---|---|
| `app/(app)/loading.tsx` | Shell-level skeleton — the tab bar/sidebar stay put while content loads |
| `app/(app)/dashboard/loading.tsx` | Dashboard-shaped skeleton |
| `app/(app)/diagnosis/[id]/loading.tsx` | Photo + result card + solutions skeleton |
| `app/(app)/community/[communityId]/loading.tsx` | Feed skeleton |
| `app/(app)/community/[communityId]/post/[postId]/loading.tsx` | Thread skeleton |
| `app/(app)/error.tsx` | Route error boundary — the shell survives a broken page |
| `app/not-found.tsx` | Custom 404 |
| `app/global-error.tsx` | Last resort; inline styles only, because a broken theme must not produce a broken error screen |

Loading skeletons always pair the animation with **readable text** and
`role="status"`, because the design brief requires state to be conveyed by more
than colour or motion.

### 2. `/settings` did not exist

The App Flow lists it, and it was already in `PROTECTED_PREFIXES` — so visiting it
404'd. Built as an account screen: display name, region, crops, and sign out.

The profile screen's "Update region and crops" button pointed at `/onboarding`,
which redirects to `/dashboard` after saving — so editing from your profile threw
you out of it. It now points at `/settings`, which saves in place.

### 3. The 404 wording is deliberately non-committal

`not-found.tsx` says **"We couldn't find that page"**, never "this does not
exist". RLS makes "no such record" and "someone else's record" deliberately
indistinguishable, so a 404 that confirmed absence would leak exactly what the
RLS design is hiding.

### 4. Error boundaries never show the error

Both boundaries log to the console and show a plain-language message. A stack
trace is meaningless to a farmer and can leak internals. The message also says the
records are safe, because that is the first thing a farmer will worry about.

### 5. Every empty state offers a way forward

"Nothing here" with no action is a dead end. Each empty state carries an icon, a
title, an explanation and a next step — `components/ui/state-message.tsx`.

### 6. The palette now lives in one place

Thirty hardcoded hex values were scattered through the components (the error reds,
the like pink, the confidence bands, the section card borders). All are now theme
tokens in `app/globals.css`: `--color-danger*`, `--color-like`,
`--color-confidence-*-text`, `--color-natural-border`, `--color-traditional-border`.

Only `themeColor` in `app/layout.tsx` remains a literal — metadata cannot read a
CSS variable.

The **darker text variants** of the confidence bands are new: the bar colours
(`#F9A825`, `#9E9E9E`) are fine as fills but do not carry enough contrast as text
on a light background. The audit below measures this rather than assuming it.

### 7. Tab labels are 12px, and that is a deliberate exception

The brief sets a 16px minimum for body text. Five tabs across a 390px screen leave
~78px each, and "Community" at 16px does not fit. Labels are 12px (up from 11px)
with the icon above them, and the tap target stays 44px. Documented in the
component.

### 8. ⚠️ Adding `loading.tsx` exposed that the e2e suites were passing for the wrong reason

The suites read the page body immediately after a navigation. With no loading
state, the content happened to be there in time. With streaming skeletons, the
tests were reading the **skeleton** — and three auth assertions plus six community
assertions failed.

Two fixes were needed, and both make the tests more honest:

- a `readBody()` helper that waits for `[data-testid="loading"]` to clear before
  asserting, so the assertion is about the page rather than the network speed;
- `textContent` → **`innerText`**, which returns only *visible* text. The RSC
  streaming payload lives in `<script>` tags, and `textContent` was picking it up.

One consequence worth knowing: **`innerText` applies CSS `text-transform`**, so the
uppercased crop label reads "TOMATO" and assertions about it must be
case-insensitive.

### 9. `global-error.tsx` deliberately does not use Tailwind

It replaces the root layout, so it cannot rely on the theme having loaded. Every
style is inline. A broken theme must not produce a broken error screen.

## Verification status (Phase 8)

| Check | Result |
|---|---|
| `frontend/e2e/ui-audit.mjs` | **33 passed** |
| ↳ every App Flow route renders | 12/12 |
| ↳ tap targets ≥ 44×44 (measured in the DOM) | all pass |
| ↳ WCAG AA contrast (computed from rendered colours) | all pass |
| ↳ icon + text pairing / labels | all pass |
| ↳ mobile bottom bar + desktop sidebar breakpoint | all pass |
| ↳ design-brief tokens applied | 6/6 exact |
| `frontend/e2e/auth-flow.mjs` | 13 passed |
| `frontend/e2e/diagnosis-flow.mjs` | 20 passed |
| `frontend/e2e/community-flow.mjs` | 23 passed |
| `supabase/tests/run_db_tests.py` | 74 passed |
| `backend` ruff · black · pytest | pass (28 tests) |
| `frontend` typecheck · lint · format · build | pass |

---

## Phase 9 — Testing

### 1. ⚠️ Found and fixed: a low-confidence "Healthy" hid the warning

The most serious bug this project has produced, and only Phase 9's explicit "test
the low-confidence flow" item found it.

The expert-confirmation prompt was gated on `!diagnosis.is_healthy`. A **flat grey
image** returns `Tomato - Healthy` at **26% confidence** — below the 0.30
reliability floor. So the screen showed:

> *"No disease symptoms were detected in this photo."*

…and **no warning at all**. A farmer photographing a sick crop could be told it
looked fine, at a confidence level the model itself treats as meaningless.

Two changes:

- the prompt is now shown whenever `needs_expert_confirmation`, regardless of
  `is_healthy`;
- the "healthy" message is only reassuring at **high** confidence. Below that it
  reads: *"The model did not find disease symptoms in this photo, but it is not
  confident about it. Look over the plant again, and ask your KVK if you are
  unsure."*

`e2e/edge-cases.mjs` asserts both the low-confidence and high-confidence paths, so
this cannot regress silently.

### 2. The low-confidence fixture is chosen by measurement, not guesswork

The model is 95.7% accurate on real leaf photos, so a low-confidence case had to be
found rather than assumed. Probing synthetic inputs:

| Input | Prediction | Confidence | Reliable |
|---|---|---|---|
| flat grey | Tomato - Healthy | 0.259 | **no** |
| flat blue | Tomato - Septoria | 0.251 | **no** |
| green blob | Potato - Healthy | 0.414 | yes |
| blurred leaf | Tomato - Healthy | 0.235 | **no** |
| **random noise** | **Tomato - Healthy** | **0.941** | yes |

Flat grey is the fixture: genuinely below every threshold.

**The last row is a known limitation worth recording.** The model is *confidently
wrong* on pure random noise — 94.1% on an image containing no leaf at all. Any
pre-launch work on out-of-distribution rejection should start here.

### 3. ⚠️ A near-miss that was a test bug, not a security hole

A new cross-user probe reported **"POST WAS DELETED"** — one farmer apparently
deleting another's post. That would have been a critical RLS failure.

It was the probe. `posts_select_authenticated` makes the feed readable by every
signed-in farmer — that is what a community feed *is* — so an unfiltered
`posts?select=id` returns everyone's posts, and the "victim" it picked was the
attacker's own post. Deleting your own post correctly succeeds.

Two fixes, and the second matters more than the first:

- filter the victim query by `user_id`;
- **assert the post still exists afterwards.** PostgREST returns **204** for a
  DELETE that matched zero rows, so the status code proves nothing. The original
  check (`status < 400`) would have passed whether or not RLS worked.

The probe now creates its own victim post, so it does not depend on seed data.

### 4. The e2e suites needed three fixes before they could be trusted

Adding `loading.tsx` in Phase 8 exposed that the suites were asserting against the
wrong things. All three are fixed across every suite:

| Problem | Fix |
|---|---|
| `textContent` returned the RSC payload inside `<script>` tags | use `innerText` |
| Pages stream a skeleton first, so reads caught the skeleton | `readBody()` waits for `[data-testid="loading"]` to clear |
| `innerText` omits collapsed `<details>`, hiding the sources panel | open the `<summary>` before asserting |

**These suites were previously passing for the wrong reasons.** They now assert
against visible content — what the user actually sees.

### 5. Gemini exhaustion is reported as SKIPPED, not FAILED

The free tier allows 20 requests/day/model and the fallback chain shares that
ceiling, so a heavy test run drains all four models and every assistant request
returns "busy". That is a quota limit, not a defect.

`assistant-flow.mjs` detects this, prints why, and **exits 2** — a distinct code so
CI can tell "skipped" apart from "passed" and "failed". Silently passing would hide
real regressions; failing would blame the code for the quota.

### 6. Coverage added this phase

| Suite | What it covers |
|---|---|
| `e2e/journey-flow.mjs` | diagnose → solutions → assistant → share to community, **in one session** |
| `e2e/edge-cases.mjs` | auth (wrong password, unknown email, 9 protected routes, tampered cookie), upload (non-image, oversized, network failure mid-upload), low-confidence flow |
| `verify_live_project.py` | +9 cross-user probes for assistant conversations and community posts |

The journey test exists because each phase was verified in isolation, and
integration bugs live in the hand-offs — the diagnosis id flowing into the
assistant, and the diagnosis flowing into a post.

## Verification status (Phase 9)

| Suite | Result |
|---|---|
| `e2e/journey-flow.mjs` | **17 passed** |
| `e2e/edge-cases.mjs` | **24 passed** |
| `e2e/auth-flow.mjs` | **13 passed** |
| `e2e/diagnosis-flow.mjs` | **20 passed** |
| `e2e/community-flow.mjs` | **23 passed** |
| `e2e/ui-audit.mjs` | **33 passed** |
| `e2e/assistant-flow.mjs` | 12/13 when quota available; **skips (exit 2)** when exhausted |
| `supabase/tests/verify_live_project.py` | **44 passed** |
| `supabase/tests/run_db_tests.py` | **74 passed** |
| `backend` ruff · black · pytest | pass (28 tests) |
| `frontend` typecheck · lint · build | pass |

---

## Phase 10 — Deploy

### 1. ⚠️ The ML artefacts must be committed, and that is a reversal

`.gitignore` excluded `*.pt` and `backend/app/rag/index/` from the start, on the
principle that weights and indexes are large and derived.

That principle is right in general and **wrong for this deploy**. Render and
Railway build the image from the repository, and there is nowhere for the build to
download a *locally trained* model from. A deploy from a clean clone would have
produced a container with no model and no index — `/api/diagnose` and the assistant
both returning 503, with no obvious cause.

The three artefacts now travel with the repo, via explicit negations in
`.gitignore`:

| File | Size |
|---|---|
| `efficientnet_b0_agri.pt` | ~16 MB |
| `knowledge_base.faiss` | ~892 KB |
| `knowledge_base.meta.json` | ~52 KB |

**The Dockerfile fails the build if any is missing**, so a broken image cannot ship
quietly.

**Revisit this if the weights grow past a few tens of MB** — move them to Git LFS
or object storage and download them in the Dockerfile. The build-time check stays
the same.

### 2. CPU-only torch, and the image is large because of it

The Dockerfile installs torch from PyTorch's CPU index. That is ~500 MB rather than
the ~2.5 GB CUDA build, and matches the TRD's no-GPU assumption. The image is still
~1.2 GB, which is normal for anything containing PyTorch.

### 3. One worker, not several

The model is ~16 MB and inference is CPU-bound at ~1.6 s. Extra uvicorn workers
would multiply memory without adding throughput on a small instance, and would each
load their own copy of the model. **Scale the instance, not the worker count**,
unless someone has measured otherwise.

### 4. Production config is checked at startup, and reported rather than fatal

`Settings.production_problems()` returns a list of what is missing or unsafe when
`ENVIRONMENT=production`. `main.py` logs it at ERROR and `/api/health/dependencies`
exposes it as `config_problems`.

**Why not fail to boot:** a container that dies on startup tells an operator far
less than one that boots, passes its health check, and reports exactly what is
wrong. It also keeps the health endpoint useful for diagnosing the problem.

It specifically checks for the two CORS mistakes, because both fail *silently in
the browser* — the API works, the frontend just gets blocked, and nothing in the
logs says why.

### 5. Fixed: `.env.example` set `GEMINI_MODEL` twice

A leftover Phase 1 line (`gemini-1.5-flash`, which returns 404 for new keys) came
*after* the correct one, so anyone copying the example got a dead assistant. Now
single-valued, and the file is verified to contain no duplicate keys.

### 6. What this phase could not do

**The actual deploy needs the user's Vercel, Render and Supabase accounts.** The
Dockerfile, Render blueprint, Vercel config, production checks and performance
baselines are complete and verified; the deploy itself is not.

Docker is not available in this environment either, so **the image was never built
or run**. The Dockerfile's artefact check was executed standalone and passes, and
everything it depends on was verified — but the image build itself is unverified
and should be the first thing tried.

The final "Done when" — a real user completing the journey on the production URL —
therefore cannot be signed off yet.

### 7. ⚠️ The project is not in a repository, which blocks the deploy outright

Found while verifying the artefacts were trackable:

```
git root : C:/Users/ajink      ← the home directory
project  : C:/Users/ajink/workbuddy-ai/agri-ai-proejct
tracked  : 0 files
remote   : none
```

The project sits inside a git repository rooted at the **home directory**, and none
of its files are tracked. Render and Vercel both deploy from a Git repository, so
**nothing can be deployed at all** until the project has one of its own.

`DEPLOYMENT.md` §3 now opens with the exact commands (`git init` in the project,
commit, add remote, push) and a check that the three ML artefacts made it in. It
also notes that a nested repository is fine here, but that the home-directory repo
must never be the one deployed.

**This was not something to fix unilaterally** — initialising a repository and
choosing a remote is the user's structural decision, and they may want to move the
project out of `C:/Users/ajink` first.

## Verification status (Phase 10)

| Check | Result |
|---|---|
| Cold start | **8.5 s** (torch 3.4 s, model 3.3 s, index 0.2 s) |
| Diagnosis latency p50 / p95 / max | **1.64 s / 1.74 s / 1.95 s** |
| Dockerfile artefact check | passes |
| `production_problems()` catches a bad config | 6 problems reported when unset |
| `.env.example` duplicate keys | none |
| `backend` ruff · black · pytest | pass (28 tests) |
| `frontend` typecheck · lint · build | pass |
| **`docker build` / deployed journey** | **not run** — no Docker, no cloud accounts |

---

# Phase 11 — Visual redesign

## 1. The visual direction was replaced, deliberately

The project owner supplied a screen recording of a dark violet SaaS site and asked
for the UI and its animations to be built from it. That **supersedes the UI/UX
Design Brief's palette** (natural green `#2E7D32`, warm off-white `#FAFAF7`,
near-black `#1B1B1B`, amber `#F9A825`, 12px radius).

What changed: colour, surfaces, elevation, motion, and the public landing page.

What did **not** change, because they are product constraints rather than styling:
the mobile-first layout and bottom tab bar, the 44px minimum tap target, 16px body
text, icon-always-paired-with-text navigation, the confidence bands never using
red, and the visual separation of Natural from Traditional solutions.

## 2. ⚠️ `--color-primary` and `--color-accent` are not interchangeable

In the light theme one token did both jobs: `--color-primary` was a dark green used
for text *and* as a fill behind white text. A single dark violet cannot do both on a
near-black canvas — as text it fails contrast, as a fill it is fine.

So the roles were split:

| Token | Value | Used for |
|---|---|---|
| `--color-primary` | `#A78BFA` (light violet) | text, icons, borders on the dark canvas |
| `--color-accent` | `#7C3AED` (deep violet) | fills behind white text — every CTA |

The 18 places that used a *solid* `bg-primary` were repointed at `bg-accent`; the
14 `bg-primary-soft` tinted surfaces were left alone. `ui-audit.mjs` now asserts the
two values stay distinct, because swapping them silently ships unreadable buttons
in both directions.

> **Editing hazard.** A naive `\bbg-primary\b` replacement also matches
> `bg-primary-soft` — a hyphen is a word boundary. It corrupted 14 tokens during
> this phase and had to be reverted. Match `bg-primary(?!-)` instead.

## 3. `bg-white` was hardcoded in 60 places

The light theme leaned on `bg-white` for cards rather than a token, so no token
change could darken them. All 60 were repointed at a surface, and the 43 card
instances of `border-border … border bg-surface-2` were collapsed into the single
`.glass` utility (translucent white + hairline + backdrop blur).

The substitution deliberately refuses to swallow layout classes — a greedy match
would have eaten `flex flex-col gap-4` and silently broken every card's layout.

One colour escaped the sweep entirely because it was never in the source:
**native form controls take the OS accent colour**. The crop checkboxes rendered as
bright green squares — both the browser default *and* an explicit
`accent-confidence-high` on the input, i.e. the confidence-band green, which is
semantically wrong for a checkbox and clashed with the violet highlight on its own
label. `globals.css` now pins `input[type=checkbox|radio]` to the brand violet, so
this cannot come back per-component.

## 4. Chrome that content scrolls under is near-opaque, not glass

`.glass-strong` is 82% opaque. That reads well for a floating nav at rest, but the
bottom tab bar has content scrolling *underneath* it, and at 82% the card text
behind the bar stayed legible through it — which looks like a rendering fault, not
a deliberate blur. `.glass-nav` (96%) exists for that case, plus a gradient fade so
content dissolves before it reaches the bar.

## 5. ⚠️ The contrast check had a real bug, exposed by translucency

`ui-audit.mjs` computed contrast by walking up the DOM and returning the **first
non-transparent `background-color`**. That was correct while every surface was an
opaque `bg-white`. With `.glass` at `rgba(255,255,255,0.03)`, the parser discarded
the alpha channel and read a 3% white overlay as **pure white** — reporting
light-on-dark text as **1.10:1**.

The fix composites alpha properly: collect the layer stack up to the first opaque
ancestor, then paint each translucent layer back-to-front. Contrast now passes for
real rather than by accident.

> This is worth remembering: the audit was not wrong about the colours, it was
> wrong about *what was behind them*. Any future translucent surface would have
> hit the same false positive.

## 6. The design-token assertions were updated, not loosened

`ui-audit.mjs` §8 asserted the old palette by value. Those assertions were rewritten
to the new one. This is a change of spec, and it is called out here so it is not
mistaken for a test weakened to make a build go green — the two invariants that
matter (44px tap targets, WCAG AA contrast) are still enforced, and contrast is now
stricter than before because it actually composites.

## 7. The landing page is now a real marketing page

`/` previously rendered the five value props and a development-only connectivity
panel. It is now the full reference structure: floating pill nav, hero with a
rotating headline and glow orbs, a scroll-driven 3D showcase of the app, a
"trained to recognise" marquee, workflow, bento features, a safety section, a
before/after comparison, the architecture flow diagram, community, animated stats,
and a closing CTA.

The app "screenshot" in the showcase is **drawn in HTML/CSS**, not an image. It
imports the same icons and tokens the real screens use, so it stays sharp at any
density and cannot silently drift out of date. It is `aria-hidden` — the real app is
one click away and announcing a fake dashboard would only confuse a screen reader.

> The labels in that mockup are the **exact** strings from
> `backend/app/models/labels.py` (`Tomato - Late Blight`, capital B). A near-miss
> would misrepresent what the model actually predicts.

## 8. Motion is additive and always reversible

Six primitives in `frontend/components/ui/`: `Reveal`, `TiltCard`, `SpotlightCard`,
`Marquee`, `RotatingText`, `Counter`.

- Scroll-driven transforms are written to `style` inside a `requestAnimationFrame`
  callback, never held in React state. A `setState` per scroll frame re-renders on
  every frame and stutters on the mid-range Android devices this app targets.
- `prefers-reduced-motion` disables all of them, **and `.reveal` is forced to
  `opacity: 1`** — a zero-duration animation would otherwise strand every section
  below the fold at opacity 0.
- `RotatingText` announces its full phrase list once via `sr-only` and marks the
  visible node `aria-hidden`, so a screen reader is not read a sentence that keeps
  changing.

## 9. The reference is a desktop SaaS site; this app stayed mobile-first

The recording shows a wide, desktop-oriented marketing page. The app itself keeps
the bottom tab bar, 44px targets and 16px body text, because the audience is
farmers on phones. Only the marketing page adopts desktop-width layouts, and it
collapses to the mobile treatment below `md`.

## 10. ⚠️ The landing page had never been accessibility-checked

The tap-target, contrast and icon-pairing checks used to sit inline in
`ui-audit.mjs`, so they ran against whatever page happened to be loaded — always a
signed-in screen. The redesign added a large public page that none of them ever
touched.

The three checks were extracted into an `auditAccessibility(page)` helper and are
now asserted against **both `/` and `/dashboard`**. It immediately found three real
defects on the landing page:

| Defect | Cause | Fix |
|---|---|---|
| Footer links **36px** tall | `min-h-[2.25rem]` written by hand instead of the `min-h-tap` token | use the token |
| Footer "Log in" **41px** wide | short text link with no horizontal padding | `min-w-tap` |
| Nav/footer logo **32px** tall | the link wrapped a `size-8` icon with no minimum | `min-h-tap` |
| Flow-diagram step number at **1.21:1** | drawn in `--color-border`, i.e. the same colour as the card edge | `text-muted` |

> The lesson is the same one as §5: a class can say `min-h-tap` and still render
> 36px if something else wins, which is exactly why these are measured from
> `getBoundingClientRect` rather than trusted from the class name.

**The audit was also under-measuring contrast.** It composited the *background*
alpha but dropped the *foreground* alpha, so a deliberately faded label
(`text-primary/70`) was measured as if fully opaque. Text is now composited over
its background before the ratio is taken, which is what the browser actually
paints.

## Verification status (Phase 11)

| Check | Result |
|---|---|
| `ui-audit` | **37 passed** (was 33) — landing **and** app surfaces |
| `auth-flow` · `diagnosis-flow` · `community-flow` | 13 · 20 · 23 |
| `edge-cases` | **24** |
| `journey-flow` · `assistant-flow` | **17 · 14** (quota had reset) |
| `frontend` typecheck · lint · format · build | pass (16/16 routes) |
| Reduced-motion path | static, nothing stranded at `opacity: 0` |
| Screens reviewed | every screen + every landing section, desktop and mobile |
| **Behaviour changes** | **none intended** — this phase is presentation only |

---

# The expert-confirmation prompt: narrowed to the low band

## 1. It was firing on almost every result

`needs_expert_confirmation` was gated on `CONFIDENCE_HIGH_THRESHOLD` (0.70), so a
full-width "The model is not fully certain — confirm with your local KVK" panel
appeared on **every** result below 70%. On a 10-class problem a 69% call is a solid
one, and prompting for a human on it makes the prompt wallpaper: farmers stop
reading it, which is worse than not showing it at all.

It is now gated on `CONFIDENCE_LOW_THRESHOLD` (0.45), in both places that compute
it — `models/inference.py` (fresh predictions) and `schemas/diagnosis.py` (a stored
diagnosis read back). Those two **must** agree; a divergence would make a result
change shape between the response that created it and the page that later displays
it. A backend test pins `_band` and `confidence_band` to the same answers.

The medium band is still signalled — amber bar, "Medium confidence" label — so the
farmer is not told a 47% result is certain. Only the explicit prompt moved.

**Product constraint #3 still holds**: low confidence (<45%) prompts expert
confirmation, and `edge-cases.mjs` asserts the banner appears for the 25.9%
fixture and not for the 99.2% one.

## 2. ⚠️ What the reported case actually was

The result that prompted this was `Potato - Early Blight` at **47.6%**. Before
changing a number, the image was pulled back out of storage and inspected.

**It is a rose leaf.** Serrated margins, and rose black spot — concentric-ring
lesions with yellow halos. There is no rose class in the model, and there never
was: the ten classes are tomato, potato and pepper only.

Measured against the real thing:

| Image | Prediction | Confidence |
|---|---|---|
| The uploaded photo (rose) | Early Blight | **47.6%** (runner-up: Bacterial Spot 35%) |
| Real `Potato___Early_blight` #1 | Early Blight | **95.6%** |
| Real `Potato___Early_blight` #2 | Early Blight | **99.3%** |
| Real `Potato___Early_blight` #3 | Early Blight | **94.6%** |

So the model is **not** underconfident, and 47.6% is the honest answer: it was
shown a plant it has never been trained on and it hedged, with the top two classes
nearly tied. Across the 110 diagnoses in the live project the mean confidence is
**86%**.

**The confidence was therefore left alone.** Scaling it up would have manufactured
certainty that the model does not have, on an input outside its training
distribution — the precise failure mode constraints #1 and #3 exist to prevent, and
the one that could cost a farmer a crop. The real defect this exposed is not the
number; it is that **the model answers at all for a leaf it cannot know**, which is
the out-of-distribution gap already recorded in `DECISIONS.md` §9.2.

A concrete next step, not yet implemented: the **top-1 vs top-2 margin** separates
these two cases cleanly (0.13 for the rose leaf, ~0.93 for a real potato leaf) and
would let the UI say "this doesn't look like a tomato, potato or pepper leaf"
instead of naming a disease. That is a new signal, not a re-scaled one.

## 3. Found while in here: a comment that describes code that does not exist

`labels.py` says of `CONFIDENCE_UNRELIABLE_THRESHOLD` (0.30):

> "Below this, the model is not meaningfully better than a guess, so the API
> refuses to name a disease at all rather than inventing one."

Nothing refuses. The constant is only used to set an `is_reliable` boolean, which
the UI uses to pick between two wordings of the same warning. A 0.18 result is
still named and stored. Either the refusal should be implemented or the comment
should be corrected — **not fixed here**, because changing it would alter what the
API returns and that is a separate product decision.

## Verification

| Check | Result |
|---|---|
| `backend` ruff · black · pytest | pass (28) |
| Banner at 47.6% | **absent** — reproduced end to end by re-uploading the image |
| Banner at 25.9% | present (`edge-cases`) |
| Banner at 99.2% | absent (`edge-cases`) |
| `_band` and `confidence_band` agree | yes, across the range |
| `edge-cases` · `diagnosis-flow` · `journey-flow` | 24 · 20 · 17 |
| `ui-audit` · `auth-flow` · `community-flow` | 37 · 13 · 23 |

---

# Pre-launch — the solutions review pack

## 1. The blocker had no artifact to act on

`DECISIONS.md` §5.2 and `DEPLOYMENT.md` §7 both record the same gate: `verified =
true` means *traced to a named source*, which is a **provenance** check, not an
agronomic one, and a qualified agronomist must review every row before launch. It
is repeatedly described as the biggest remaining risk.

What did not exist was anything to hand a reviewer — the 50 rows were only
readable as one 23 KB SQL `insert` statement.

`supabase/scripts/export_solutions.py` now generates a review pack into
`docs/solutions-review/`: a printable HTML sheet grouped by disease with
Approve/Amend/Remove boxes, a CSV with blank verdict columns for tracking, and the
raw JSON.

## 2. It reads the database, not the SQL text

The export spins up the embedded Postgres, applies the shim → migrations → seed,
and queries `solutions`. Parsing the `insert` statement would have been faster to
write and would have silently produced a stale or wrong extract the moment a
migration changed shape. Reading the built table means **the export fails loudly if
a migration stops applying** — it doubles as a check on the migration itself.

It needs the `agri-ai-dbcheck` venv, since `pgserver`/`psycopg2` are deliberately
test-only dependencies.

## 3. ⚠️ Five of the fifty rows have no institutional source

Generating the pack surfaced something the row count alone hid: **5 entries are
marked `verified = false`**, and all five are traditional remedies attributed to
"Regional practice" — cow-urine spray at 10% (pepper bacterial spot, potato and
tomato late blight) and wood-ash dusting (potato and tomato late blight).

They render to a farmer exactly like the sourced rows. They are the highest-risk
entries in the product, and the sheet flags each one. This is now called out in
`DEPLOYMENT.md` §7.

## Verification

| Check | Result |
|---|---|
| Export runs against the migrations | 50 entries, 10 disease classes |
| HTML well-formed | 10 sections · 50 entries · 45 source links · 0 unclosed tags |
| `docs/` is not git-ignored | review pack will ship with the repo |

---

# The assistant: OpenRouter, and Hindi

## 1. OpenRouter is the primary chat provider; Gemini is the fallback

The owner supplied an OpenRouter key and asked for the assistant to run on it. This
relaxes constraint #4 ("no multiple LLM providers") — recorded here rather than
quietly done.

What made it acceptable: the constraint's intent is *do not over-engineer*, and the
provider chain already existed **within** Gemini (`gemini_model_chain`). Extending
it to a second provider is the same pattern, not a new one. It is also the only way
to satisfy a real requirement — the Gemini free tier is **20 requests/day/model**,
which cannot serve one village, let alone the assistant.

**Embeddings stay on Gemini.** They are a different capability, not a second chat
provider, and the FAISS index was built with `gemini-embedding-001`.
`load_index()` refuses a mismatched model, so switching would mean rebuilding the
index — a separate change with its own risk.

**Constraint #1 is untouched**: `app/models/` is still PyTorch-only, `app/rag/` is
still the only place an LLM is used, and neither crossed into the other.

## 2. ⚠️ The model IDs had to be verified, not guessed

The first set written into `.env` — `meta-llama/llama-3.3-70b-instruct:free` and
friends — **do not exist on OpenRouter**. They were plausible names written from
memory, and the provider's own catalogue reported them missing. `.env` also
overrides the defaults in `config.py`, so the wrong values silently won.

Every candidate was then probed against the live API and tested on the actual task.
Two worked and two were rate-limited:

| Model | Hindi | Grounding | Refusal |
|---|---|---|---|
| `deepseek/deepseek-v4-flash-0731:free` | 91% Devanagari | cites correctly | exact sentence |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 100% Devanagari | cites correctly | exact sentence |
| `google/gemma-4-31b-it:free` | — | — | 429 at the time |
| `qwen/qwen3.8-27b:free` | — | — | 429 at the time |

The two that were rate-limited are kept as fallbacks precisely *because* free-tier
capacity fluctuates per model. The chain is: DeepSeek → Nemotron → Gemma, then
Gemini.

## 3. Hindi: the answer language follows the question, the refusal follows code

Two separate mechanisms, deliberately:

**The answer language** is the model's job. The system instruction says to reply in
the language the farmer wrote in, which also covers **romanised Hindi** ("tamatar ke
patte par dhabbe") that no script check could catch.

**The refusal wording** is code's job, not the model's. `detect_language()` reads
the script — Devanagari is unambiguous, so a threshold on the letter ratio is
reliable and free — and picks the message from `REFUSAL_BY_LANGUAGE`. A farmer must
never get an English "I don't know" because the model felt like paraphrasing.

> **⚠️ There were two refusal paths and only one was fixed at first.** The
> no-retrieval short-circuit lives in `pipeline.py`, not `llm.py`, and had its own
> hard-coded English string. A Hindi farmer asking an off-topic question would have
> been refused in English. Both now read from the same table.

Romanised Hindi is **not** detected (pinned by a test). It only affects the refusal
wording; the model mirrors the question language either way.

## 4. The UI toggle exists so farmers discover Hindi at all

A farmer who cannot read English will never find out that the assistant understands
Hindi. The toggle switches the starter chips, placeholder and help text — the
answer language is unaffected, and a Hindi question typed with the toggle on
"English" is still answered in Hindi.

Both suggestion sets ship in one response so switching is instant, rather than a
refetch on a rural connection.

## 5. ⚠️ Fixed: `available` reported the assistant as down

`GET /api/assistant/status` computed `available=bool(settings.gemini_api_key)`.
With OpenRouter as the provider and Gemini unset, the assistant would have reported
itself **unavailable while working perfectly**. Now `is_rag_configured`, which
accepts either key.

## 6. ⚠️ Fixed: the composer sat underneath the tab bar

Found while screenshotting the Hindi UI: with a long transcript the assistant's
`sticky` composer parked at `bottom-20` (80px) under a **101px** tab bar, hiding
the field the farmer was typing into. Measuring an empty chat proves nothing — the
composer only reaches its offset once the content is tall enough to push it there.

Both the composer and the layout's bottom padding now derive from a single
`--app-nav-height` token, so they cannot drift apart again. `ui-audit.mjs` asserts
the token clears the bar's measured height, and the token is resolved to pixels by
**measuring** it — it is declared in `rem`, so `parseFloat` read "7.5" as 8px.

## 7. ⚠️ The API key is in `.env` only

`OPENROUTER_API_KEY` lives in `backend/.env` (git-ignored, verified with
`git check-ignore`). `.env.example` carries the key name with an empty value.
It was pasted into a chat to get here, so **it should be rotated**.

## 8. ⚠️ Latency: the free tier is slow, and no client-side tuning fixes that

Measured end to end with `backend/scripts/time_assistant.py` (real retrieval, real
generation, real prompt):

| | min | median | max | failures |
|---|---|---|---|---|
| Before | 10.3s | 18.6s | 58.2s | **1 in 5** |
| After | 9.3s | 19.5s | 37.3s | **0 in 6** |

Two real defects were fixed, and one hypothesis was **wrong and reverted**:

**Fixed — an empty response failed the farmer.** A provider returned HTTP 200 with
empty content once in five requests. The chain treated that as a terminal error
*after* the loop, so it raised "I couldn't answer that one" while three other
models were sitting there willing to try. It is now a per-model bad attempt, like
the instruction-commentary case, and the chain moves on.

**Fixed — 429 burned the backoff budget.** A rate limit is *per model*, so retrying
the same model rarely helps: the quota does not clear in the seconds a 3s+6s
backoff buys. Each rate-limited model now costs one request instead of three
requests and nine seconds. 5xx is still retried, because that is a genuine
transient.

**Reverted — disabling reasoning.** The primary model is a reasoning model and
spends hidden tokens thinking. On a short test prompt, disabling it looked like a
clear win: 21.2s → 10.1s, and no reasoning tokens. **Against the real prompt it was
the opposite** — 13.6s/14.2s with reasoning versus 29.4s/25.5s without, because
without a planning step the model rambled and produced *more* output tokens
(1016 vs 421). The short-prompt test was not representative and nearly shipped a
two-fold regression. Reasoning is left on, with the measurements recorded in
`llm.py` so nobody "optimises" it again.

**Bounded — the worst case.** Seven models each allowed a 60s timeout is a
seven-minute worst case, and no farmer stands in a field for that. There is now a
90s ceiling on the whole chain and a 45s per-request cap; when the budget runs out
the farmer gets a clean apology instead of a spinner.

**What is left is the provider, not the code.** 9-37s per answer is the free tier's
own generation speed; the payload is ~1600 prompt tokens and the model writes
400-1000 tokens of Hindi or English. Cutting retrieval depth would barely dent it,
because the cost is output, not context. **For a farmer-facing response time the
paid tier on the same key is the fix** — that is a billing decision, not an
engineering one.

## Verification

| Check | Result |
|---|---|
| `backend` ruff · black · pytest | pass (**58** — 30 new in `test_assistant_llm.py`) |
| English question, in scope | grounded answer, 5 sources, citations |
| Hindi question, in scope | grounded **Hindi** answer, 92% Devanagari |
| Hindi question, off-topic | refused **in Hindi** |
| English question, off-topic | refused in English |
| Hindi UI toggle | chips + placeholder switch; answer unaffected |
| `ui-audit` | **38** (was 37) — incl. nav clearance |
| `edge-cases` · `community-flow` · `diagnosis-flow` | 24 · 23 · 20 |
| `journey-flow` · `assistant-flow` · `auth-flow` | 17 · 14 · 13 |


---

# Phase 12 — Back to a light, rural-first theme

## 1. The dark violet was reverted, on purpose

The owner supplied a rural-first design brief specifying **deep leaf green
`#2E7D32` on warm off-white `#FAFAF5`**, and asked for it to be applied.

This reverses Phase 11. That was not a mistake being undone — it was a reference
recording being followed, and it produced a good-looking dark UI. But the brief's
palette is the better answer for *this* audience, and the original UI/UX Design
Brief said why: **light mode for outdoor/sunlight readability on mobile.** Dark
violet looks better on a designer's monitor; dark text on off-white is more legible
under a real sun. The Phase 11 decision optimised for fidelity to a reference; this
one optimises for a farmer in a field.

**The motion system was not touched.** `Reveal`, `TiltCard`, `SpotlightCard`,
`Marquee`, `RotatingText` and `Counter` were never palette-specific, so all the
animation work from Phase 11 carries over intact.

## 2. Re-deriving rather than recolouring

Swapping hex values is not a theme change. Four things had to be re-derived:

**Glows invert in meaning.** A `rgba(124,58,237,0.4)` bloom over near-black is a
light source. The same over off-white is a stain that pulls every text contrast on
it below AA. The orbs were rebuilt at **0.07–0.14** opacity, and the grid backdrop
dropped from 0.18 to 0.05.

**Frosted glass stops earning its cost.** `backdrop-filter` is expensive on the
budget Android phones this targets, and on a light canvas a translucent white over
off-white just reads as a slightly dirty card. Cards are now **solid white with a
soft shadow** — which is also literally what the brief asks for. Translucency is
kept only where there is genuinely content behind it: the floating tab bar and the
assistant composer.

**One green does both jobs.** On dark, `--color-primary` (light violet, for text)
and `--color-accent` (deep violet, a fill under white text) *had* to differ — a
single violet cannot be legible both ways. `#2E7D32` is 4.9:1 as text on off-white
and 5.1:1 as a fill under white text, so on a light canvas it legitimately carries
both. The `ui-audit` assertion that the two "stay distinct" was therefore asserting
a falsehood, and was replaced with the contract that actually matters: **white must
be legible on the CTA fill** (5.13:1).

**Amber is a trap.** `--color-highlight` (#FFB300) is *light*. White on it is
1.9:1. It is only ever used with dark ink, or as a badge — never as a button fill
behind white text and never as a text colour on white.

## 3. 44px → 48px, and it really was one token

The brief specifies 48dp. The app was on 44px, and the audit found **46 controls
sitting at exactly 44** — every one of them from the same `--spacing-tap` token.
Raising it to 48 fixed all 46 at once.

Two did *not* come from the token and had to be found by measurement: the landing
page's mobile menu toggle (`size-11`, 44px) and the photo-remove button on the
upload screen (`size-10`, 40px). Both are now 48. `ui-audit.mjs`'s floor moved from
44 to 48 to match.

## 4. A chip that inverted on its own

The landing page's mockup used `bg-natural-text` with dark ink — correct on the
dark theme, where `--color-natural-text` was a light teal. On the light theme that
token is `#1B5E20`, so the same markup became **dark-on-dark**. Fixed to white ink.

This is the general hazard of a token whose *value* carries an implicit assumption
about the canvas. Worth remembering: a token rename would not have caught it, only
re-deriving the pairing does.

## 5. What the theme change did NOT fix

The audit's substantive findings are untouched by colour, and are still open:

- **The crop picker offers 12 crops; the model diagnoses 3.** The most serious
  finding in the audit — a farmer can select Rice, photograph a rice leaf, and get
  a tomato disease name confidently. `docs/design-audit.md` §2.2.
- Home still has no primary action.
- No offline cache, no language toggle outside the Assistant, no voice input.

## Verification

| Check | Result |
|---|---|
| `ui-audit` | **38 passed** — contrast clean on **both** landing and app |
| White on the CTA fill | **5.13:1** |
| Gradient stops on canvas | 4.90 · 3.93 · 7.52 :1 (large text needs 3:1) |
| Tap targets ≥ 48px | **0 failures** on both surfaces |
| `edge-cases` · `community-flow` · `diagnosis-flow` | 24 · 23 · 20 |
| `journey-flow` · `assistant-flow` · `auth-flow` | 17 · 14 · 13 |
| `backend` ruff · black · pytest | pass (58) |
| Violet left in the codebase | **none** |
