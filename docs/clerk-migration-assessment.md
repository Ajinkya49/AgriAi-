# Clerk → Supabase: migration assessment

**Status: database layer DONE and verified on live.** Supabase Auth still works —
the schema now accepts either issuer, so the Clerk switch is a toggle rather than
a cutover. The backend, `proxy.ts` and the dashboard steps are still to do (§6).

A backup exists at
`C:/Users/ajink/workbuddy-ai/_backup-agri-ai-20260920-145231/agri-ai.tar`
(plus `live-data-snapshot.json`, 726 rows).

---

## 0. What landed

Migration `20260920000001_clerk_compatible_identity.sql`, applied to the live
project.

The key decision was **not** to swap identity outright. Instead:

```sql
create or replace function public.current_user_id()
returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  );
$$;
```

It returns the raw `sub` **as TEXT, with no cast** — the single thing `auth.uid()`
gets wrong for Clerk. It is correct for both issuers:

| Issuer | `sub` | Result |
|---|---|---|
| Supabase | `a1b2c3d4-…` | a uuid, as text |
| Clerk | `user_2abc…` | a Clerk id |

Because both are text, `users.id = current_user_id()` works either way. **The app
runs on Supabase throughout**, and the Clerk switch becomes a dashboard toggle.

| | Before | After |
|---|---|---|
| `users.id` | `uuid` | `text` |
| `user_id` columns | `uuid` | `text` (6) |
| Policies on `auth.uid()` | 28 | **0** |
| Policies on `current_user_id()` | 0 | **28** |
| `auth.users` FK | present | **dropped** |
| `public_profiles` | `(uuid[])` | `(text[])` |

**Verified live:** `users.id`=text · 6 text `user_id` columns · 0 `auth.uid()` ·
28 `current_user_id()` · 5 users preserved.

**Tests:** RLS local **74/74** · RLS live **44/44** · e2e **118/118**.

### ⚠️ Two Postgres rules that would have hit production

Both were caught by the embedded-Postgres harness, and neither is visible by
reading the SQL:

1. `cannot alter type of a column used in a policy definition` — policies must be
   **dropped first**, then the type changed, then recreated.
2. `foreign key … cannot be implemented: uuid and text` — doing drop/alter/add
   **per table** fails on the second table, because `users.id` is already text
   while that table's column is still uuid. The fix is three explicit phases:
   drop **all** FKs → alter **all** columns → recreate **all** FKs.

### Tooling added

| Script | Purpose |
|---|---|
| `generate_clerk_migration.py` | Regenerates the migration from the *deployed* policy definitions — 28 policies is too many to transcribe, and a typo in an RLS policy is a data leak |
| `apply_migrations.py` | Applies pending migrations to live, with a `schema_migrations` ledger, one transaction each, `--dry-run` / `--baseline` |
| `bootstrap_migration_ledger.py` | One-time: verifies migrations 1–5 really are applied before recording them, so baselining can't hide a missing schema |
| `snapshot_live_data.py` | Data snapshot before the change |

> **Note:** `apply_migrations.py` did not exist. The live schema had been drifting
> from the repo, applied by hand. That is now fixed.

---

## ⚠️ Correction to what I said earlier

I told you that registering Clerk as a Supabase third-party provider would "keep
all 38 policies and 118 tests working". **That was wrong, and it matters.**

I checked it against your live database rather than trusting my memory:

```sql
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql STABLE
AS $function$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid                      -- ← this cast
$function$
```

`auth.uid()` **casts the JWT `sub` to `uuid`.** A Clerk subject is a string like
`user_2abcXYZ…`. So a Clerk token does not make `auth.uid()` return a *different*
value — it makes it **raise**:

```
invalid input syntax for type uuid: "user_2abcXYZ..."
```

Every one of the **38** `auth.uid()` call sites would throw, not silently mismatch.

Clerk's own integration docs confirm the shape they expect — note `text`, and
note that `auth.uid()` never appears:

```sql
user_id text not null default auth.jwt()->>'sub'
...
using ((select auth.jwt()->>'sub') = (user_id)::text)
```

---

## Real scope

| # | Change | Count |
|---|---|---|
| 1 | `public.users.id`: `uuid` → `text` | 1 |
| 2 | `user_id` columns typed `uuid` → `text` | **6** |
| 3 | `auth.uid()` call sites → `(auth.jwt()->>'sub')` | **38** |
| 4 | Drop `users.id references auth.users(id) on delete cascade` | 1 |
| 5 | Replace the Supabase signup trigger with a Clerk webhook | 1 |
| 6 | Rewrite RLS tests (they simulate a Supabase JWT `sub`) | **118** |

Item 4 is not cosmetic. With Clerk, **there is no `auth.users` row** — Clerk is the
identity system, and Supabase's auth schema stays empty. The FK has no parent, and
the trigger that creates `public.users` on signup never fires. User rows have to
arrive via a Clerk webhook or a lazy upsert on first request.

Item 3 is the security-critical one: all 38 policies are the mechanism behind
"another farmer's diagnosis returns 404". They need rewriting and re-verifying.

---

## What `clerk init` actually did

It ran, printed its plan, and was stopped. It **had already applied**:

| Action | Target |
|---|---|
| CHANGED | `frontend/package.json` — `@clerk/nextjs ^7.9.4` |
| CHANGED | `frontend/app/layout.tsx` — `ClerkProvider` wrapping `<Providers>` |
| CHANGED | `frontend/.env.local` — 4 `NEXT_PUBLIC_CLERK_*` URL vars |
| CREATED | `frontend/app/sign-in/[[...sign-in]]/page.tsx` |
| CREATED | `frontend/app/sign-up/[[...sign-up]]/page.tsx` |
| **SKIPPED** | `frontend/proxy.ts` |

The skip is in Clerk's own words: *"Existing middleware uses an unsupported shape
for automatic Clerk composition."*

So the automated path **cannot finish the job here**. It left:

- **Two auth systems' worth of routes** — `/(auth)/login` + `/(auth)/signup`
  (Supabase, working) and `/sign-in` + `/sign-up` (Clerk, unlinked)
- **Clerk not enforcing anything** — route protection is still `proxy.ts`, still
  Supabase
- **No `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`**, so `ClerkProvider` is inert

Verified: the app still **builds and runs** — Clerk v7 tolerates a missing key, so
this is dead code rather than a broken app. No console errors, landing page and
`/login` both render.

---

## Two steps I cannot do

1. **Supabase dashboard** — Authentication → Sign In / Providers → Add provider →
   Clerk → paste the Clerk domain. Requires your login.
2. **Clerk dashboard** — activate the Supabase integration to reveal that domain
   (https://dashboard.clerk.com/setup/supabase).

Nothing works until both are done, because Supabase must be told to trust Clerk's
issuer before it will accept the tokens.

---

## Options

### A. Continue the migration (full)

Order matters, and steps 1–2 gate everything:

1. Activate Clerk↔Supabase in both dashboards *(you)*
2. New migration: `uuid` → `text` on `users.id` and 6 `user_id` columns; drop the
   `auth.users` FK; add a `current_user_id()` helper returning `text`
3. Rewrite all 38 policies to use it
4. Clerk webhook (or lazy upsert) to create `public.users` rows
5. Rewrite the backend JWT verification — `GET /auth/v1/user` expects a Supabase
   token and will not accept a Clerk one
6. Update `proxy.ts` by hand (Clerk skipped it)
7. Rewrite the 118 RLS tests
8. Re-run everything

**This is a rewrite of the security layer, not a configuration change.** It is
doable, and the end state is clean — but it should be planned, not squeezed in.

### B. Revert

Restore from the backup, or remove the 5 pieces of scaffolding by hand. The app
returns to a fully working Supabase Auth with 149 passing e2e assertions.

### C. Keep Supabase Auth, add what you actually wanted from Clerk

If the draw was prebuilt UI, social login, or organisations — Supabase Auth
supports OAuth providers and phone/OTP, and RLS keeps working unchanged. This is
genuinely additive, with no migration.

**Worth noting for this audience specifically:** phone/OTP is probably a better
fit than email for rural farmers, and Supabase supports it today. Clerk's
advantage here is polish, not capability.

---

## Backup

```
C:/Users/ajink/workbuddy-ai/_backup-agri-ai-20260920-145231/agri-ai.tar
```

65 MB, 758 entries, verified readable — includes all 5 migrations,
`backend/app/core/security.py`, `proxy.ts`, the 16 MB model and the FAISS index.

```bash
cd C:/Users/ajink/workbuddy-ai
tar -xf _backup-agri-ai-20260920-145231/agri-ai.tar
```
