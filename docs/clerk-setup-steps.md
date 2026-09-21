# Clerk setup — the remaining steps

**Status: steps 4, 6 and 7 are DONE.** Steps 1–2 are yours (dashboards), step 3
needs them, and step 5 is written but deliberately **not applied** — see why below.

The app is fully working on Supabase Auth throughout. Nothing here is urgent.

---

## Done

| # | Step | Notes |
|---|---|---|
| 4 | **Backend JWT verification** | Rewritten to resolve identity via PostgREST — issuer-agnostic |
| 6 | **Profile-row creation** | `ensure_profile()` creates the row on first request |
| 7 | **Duplicate auth routes** | `/sign-in` + `/sign-up` removed (404 now); `/login` + `/signup` intact |

### Step 4 — how it was done, and why not the obvious way

`security.py` used to call `GET /auth/v1/user`. That is GoTrue's own endpoint and
only accepts **Supabase-issued** tokens, so it would reject a Clerk session
outright.

Rather than add a JWT library and fetch Clerk's JWKS, it now calls
`POST /rest/v1/rpc/ensure_profile` with the caller's own token. Supabase verifies
the signature. This needs **no JWT library, no JWKS fetching and no Clerk domain
in the backend**, and it works for both issuers.

More importantly it is the **same path RLS uses**. If identity resolves here, that
subject is what `public.current_user_id()` sees inside every policy — a stronger
guarantee than verifying against a different system and hoping the two agree.

Verified against the live project: GoTrue and this agree on the subject, and a
bogus token returns 401. Reproduce with
`backend/scripts/verify_identity_resolution.py`.

`email` and `phone` now come from the profile row rather than the auth payload,
because the row is the app's own record and looks identical for either issuer.

### Step 6 — why a lazy upsert and not a webhook

`public.users` rows are created by `on_auth_user_created`, which fires on inserts
into `auth.users`. With Clerk there is no such row, so **nothing would create the
profile** — and without a row `current_app_role()` returns NULL, so every policy
denies.

`ensure_profile()` closes that gap. Chosen over a Clerk webhook deliberately: a
webhook needs a public endpoint, a signing secret and retry handling, and it can
miss events. This self-heals on the next request with no new infrastructure —
which fits the "simple stack" constraint.

It is `SECURITY DEFINER` but not abusable: it only ever inserts a row whose id is
the **caller's own** subject, read from the caller's own verified JWT. There is no
parameter to pass someone else's id.

> **⚠️ One thing to know:** the `users` table requires an email *or* phone
> (`users_email_or_phone_check`), and **Clerk's default session token carries
> neither** — only `sub`, `iss`, `exp`, `sid`, `azp`. So `ensure_profile()` will
> resolve identity but skip row creation until you add an `email` claim:
> **Clerk Dashboard → Sessions → Customize session token.**
>
> It returns the subject anyway rather than raising, because making the whole API
> unusable is a worse failure than an unknown caller.

### Step 7 — removed

`clerk init` had created `app/sign-in/` and `app/sign-up/`, orphaned (nothing
linked to them) and duplicating the working `/login` and `/signup`. Both removed;
`/sign-in` now 404s.

**Kept on purpose:** `@clerk/nextjs`, `ClerkProvider` in `layout.tsx` and the five
`NEXT_PUBLIC_CLERK_*` vars. They are inert without a publishable key, and removing
them would mean re-running `clerk init` later. The provider is what the moment a
key exists.

---

## Still to do

### ⚠️ Step 5 — `proxy.ts` is written but NOT applied

The change is understood, but applying it now would mean editing the auth path of
a working app with **no way to test it**, because Clerk isn't configured yet. An
untestable change to authentication is exactly the kind of risk worth deferring.

When the dashboards are done, `proxy.ts` needs Clerk's middleware *composed* with
the existing Supabase `updateSession`, not replacing it — plus `'/__clerk/:path*'`
added to the matcher after `'/(api|trpc)(.*)'`, per Clerk's docs.

`clerk init` skipped this file itself, in its own words: *"Existing middleware
uses an unsupported shape for automatic Clerk composition."*

### Step 3 — needs steps 1–2 first

Verifying a real Clerk token resolves correctly is only possible once Supabase
trusts Clerk. I'll do it as soon as the dashboards are done.

---

## Part A — the dashboard steps (only you can do these)

### ⚠️ First: you're on a Clerk *development* instance

```
app:         app_3JYSBZLKb4Ga3gIdSrUzi1E9SLj  (agri-ai)
instance:    ins_3JYSBcs2x6AGgtUk9x1FaLKN4Fa
environment: development
```

Development instances are for building. Clerk's own docs are explicit:

> You cannot migrate users from your Development instance to your Production
> instance.

So real farmers signing up against a development instance would have to be
recreated later. **Create a production instance before launch**, and do these
steps against that one when you do. Development is fine for now.

### Step 1 — Clerk dashboard: activate the Supabase integration

1. Go to **https://dashboard.clerk.com/setup/supabase**
2. Choose your configuration options
3. Click **Activate Supabase integration**
4. This reveals the **Clerk domain** for your instance — copy it

The domain looks like `your-app-12.clerk.accounts.dev` for a development instance
(`clerk.yourdomain.com` once you add a custom domain in production). It is *only*
revealed here, which is why this step is manual — it isn't exposed through the
API or the instance config.

### Step 2 — Supabase dashboard: tell it to trust Clerk

1. Go to **https://supabase.com/dashboard/project/_/auth/third-party**
2. **Add provider** → select **Clerk**
3. Paste the Clerk domain from Step 1

That's it. Supabase will now accept Clerk session tokens, and
`auth.jwt()->>'sub'` — which the 28 rewritten policies already read — resolves to
the Clerk user id.

### Step 3 — tell me, and I'll verify

Once both are done I can confirm end-to-end that a Clerk token resolves to the
right rows, and apply step 5.

---

## Order

| # | Step | Who | Status |
|---|---|---|---|
| 1 | Activate Clerk↔Supabase in the Clerk dashboard | **you** | pending |
| 2 | Add Clerk as a provider in Supabase | **you** | pending |
| 3 | Verify a Clerk token resolves correctly | me | needs 1–2 |
| 4 | Backend JWT verification | me | **done** |
| 5 | `proxy.ts` | me | **written, not applied** — needs 1–2 to test |
| 6 | Profile-row creation | me | **done** |
| 7 | Remove duplicate auth routes | me | **done** |
| — | Add an `email` claim to the Clerk session token | **you** | see step 6 |
| — | **Create a production Clerk instance** before launch | **you** | pending |

Steps 1–2 gate the rest, and I can't do them — they need your logins.

---

## If you'd rather not continue

The app is fully working on Supabase Auth, with the schema now accepting either
issuer and the backend already issuer-agnostic. To abandon the Clerk path:

1. Remove `@clerk/nextjs` from `package.json` and the `ClerkProvider` from
   `app/layout.tsx`
2. Remove the `NEXT_PUBLIC_CLERK_*` vars from `.env.local`

The two migrations stay — they're harmless, and they make a future Clerk adoption
much cheaper. Or restore from
`_backup-agri-ai-20260920-145231/agri-ai.tar`.

