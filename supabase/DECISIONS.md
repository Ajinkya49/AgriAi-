# Phase 2 — decisions, additions, and one document conflict

Everything here is a point where `05-BackendSchema-AgriAI.md` was silent,
ambiguous, or self-contradictory. Each one is called out so it can be corrected
if the intent was different.

---

## ⚠️ 1. Document conflict — who may write to `solutions`?

The Backend Schema says two different things:

| Location | Statement |
|---|---|
| "Row Level Security (RLS)" section | `solutions`: "publicly readable by all authenticated users; **writable only by `admin`/`moderator` roles**" |
| "User Roles" section | `moderator`: "can moderate community posts/comments, **cannot edit the knowledge base**" · `admin`: "full access, **manages `solutions` knowledge base entries**" |

**Resolution taken: writes are ADMIN ONLY** (`public.is_admin()`), i.e. the
stricter, least-privilege reading, which matches the explicit Roles statement.

To follow the RLS line literally instead, change `public.is_admin()` →
`public.is_moderator_or_admin()` in the three `solutions_*_admin` write policies
in `migrations/20260915000003_rls_policies.sql`. That is the only edit needed.

**Please confirm which one you want.** This is the one item where I picked
between two contradictory instructions rather than guessing at a gap.

---

## 2. `posts` SELECT — membership gate or not?

The Backend Schema says: *"posts: publicly readable within joined communities"*.

**Interpretation taken: any authenticated user may read posts.**

Reasoning: App Flow journey 3 has a farmer tap a community from the *suggested*
(not-yet-joined) list and immediately see its post feed. A membership gate would
break that documented journey. The phrase "publicly readable" also points this
way, and community posts are public content by nature.

To gate it on membership instead, replace `using (true)` in the
`posts_select_authenticated` policy with an `exists` check against
`community_members`.

---

## 3. Security fix — privilege escalation via self-update

The Backend Schema says *"users: user can read/update only their own row"*.
Implemented literally, every farmer could run:

```sql
update public.users set role = 'admin' where id = auth.uid();
```

and grant themselves the admin role.

**Added `public.prevent_role_escalation()` trigger** — a BEFORE UPDATE trigger
that raises `insufficient_privilege` when `role` changes and the caller is not an
admin. Self-service profile edits (name, region, primary_crops) still work
normally. Covered by the test *"users: farmer CANNOT escalate own role to admin"*.

---

## 4. Additions not named in the Backend Schema

| Addition | Why |
|---|---|
| `on_auth_user_created` trigger → `public.handle_new_auth_user()` | `users.id` is the Supabase Auth id, so a profile row must be created at sign-up. Without this the Auth phase could never populate `users` from real registrations. |
| `public.current_app_role()` / `is_admin()` / `is_moderator_or_admin()` | RLS policies need the caller's role. `SECURITY DEFINER` + pinned `search_path` so reading `users.role` inside a `users` policy does not recurse, and so the function cannot be hijacked via `search_path`. |
| `community_members` UNIQUE `(community_id, user_id)` | Not in the schema, but without it a farmer can join the same community repeatedly, corrupting member counts and the "my communities" list. Covered by *"duplicate join is rejected"*. |
| `post_likes` UNIQUE `(post_id, user_id)` | The schema asks for a *"unique index — prevent duplicate likes"*. A UNIQUE **constraint** is the stronger form and already creates the backing index, so no second index was declared in migration 2. |
| Admin may UPDATE/DELETE any `users` row | Implied by "admin: full access … manages users/roles", though the RLS line only says admins may *read* all. |
| `anon` may SELECT `communities` + `community_members` only | "publicly readable" for those two tables. Every other table has no `anon` policy, so anon gets zero rows even where a grant exists. |
| Supporting FK indexes | Postgres does not index foreign keys. Without them, cascade deletes and list endpoints degrade to sequential scans. Performance only — no effect on access rules. |

---

## 5. Type choices

- **`timestamptz` instead of `timestamp`.** The schema says "timestamp".
  `timestamptz` is Supabase's own default and avoids silent timezone bugs for a
  user base spread across Indian states (all IST today, but this is free
  insurance).
- **`double precision`** for `confidence_score`, with a `CHECK (0 <= x <= 1)`
  enforcing the documented 0.0–1.0 range.
- **`gen_random_uuid()`** for primary keys — built into PostgreSQL 13+, so no
  `pgcrypto`/`uuid-ossp` extension is required.

---

## 6. Disease taxonomy convention

`solutions.disease_name` matches `diagnoses.predicted_disease` **by exact
string**. Phase 4's model class labels must map onto these strings — there is no
fuzzy matching at query time.

Convention chosen: **`"<Crop> - <Disease>"`**, e.g. `Tomato - Early Blight`,
`Wheat - Leaf Rust`. Seeded values for v1:

| Crop | Disease |
|---|---|
| Tomato | Early Blight (*Alternaria solani*) |
| Tomato | Late Blight (*Phytophthora infestans*) |
| Wheat | Leaf Rust (*Puccinia triticina*) |

Confirm this matches the crop/disease set you want for v1 before Phase 4 trains
the model.

---

## 7. ⚠️ The seeded `solutions` rows are placeholders

The 12 rows in `supabase/seed.sql` were written to exercise the schema and the
diagnosis-screen layout. **They were not copied from ICAR / KVK / agricultural
university publications.**

The PRD states: *"Never hallucinate agricultural recommendations — all
natural/traditional guidance must be grounded in a trusted knowledge base."*

**Phase 5 must replace every row with text taken verbatim from the approved
sources in `backend/app/knowledge_base/sources.md`, and set `verified = true`
only after an agronomist has reviewed it.** Rows seeded as `verified = false`
are deliberately left unverified to exercise that flag in the UI.
