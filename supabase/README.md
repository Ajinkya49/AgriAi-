# Supabase

This folder holds everything version-controlled about the Supabase project
(Postgres schema, RLS policies, seed data, storage buckets).

## Phase 1 — project setup checklist

Create the project in the Supabase dashboard, then record the values below in
`backend/.env` and `frontend/.env.local`.

| Dashboard location | Value | Goes to |
|---|---|---|
| Project Settings → API → Project URL | `https://<ref>.supabase.co` | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` |
| Project Settings → API → anon public | `anon` key | `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Project Settings → API → service_role | `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` (**backend only**) |
| Project Settings → Database → Connection string | URI | `DATABASE_URL` |

### Storage

Create one private bucket (name must match `SUPABASE_STORAGE_BUCKET`, default
`agri-ai`) with this object layout from the Backend Schema:

```
uploads/{user_id}/{diagnosis_id}.jpg     # diagnosis images
posts/{post_id}/{image_id}.jpg           # community post images
```

Keep the bucket **private** — the app serves images through signed URLs.

### Auth

Enable the **Email** provider. Phone OTP is a fast-follow (per the TRD), so it can
stay disabled for now.

## Phase 2 — migrations ✅

```
migrations/
├── 20260915000001_initial_schema.sql   # the 10 tables + constraints
├── 20260915000002_indexes.sql          # the 6 schema indexes + supporting FK indexes
└── 20260915000003_rls_policies.sql     # role helpers, triggers, RLS, grants
apply_all_migrations.sql                # generated: all three, for the SQL Editor
seed.sql                                # LOCAL dev seed (direct auth.users insert)
scripts/
└── seed_test_users.py                  # HOSTED projects: creates test users via Admin API
tests/
├── 00_local_auth_shim.sql              # test-only stand-in for Supabase's auth schema
├── run_db_tests.py                     # 66 assertions, local Postgres
└── verify_live_project.py              # 15 assertions, real Supabase over REST
DECISIONS.md                            # every interpretation + one doc conflict
```

### ⚠️ `seed.sql` vs `scripts/seed_test_users.py`

`seed.sql` inserts users straight into `auth.users`. That works against **local**
PostgreSQL, but on a **hosted** Supabase project those users cannot sign in —
GoTrue resolves email/password logins through `auth.identities`, and a
hand-written `auth.users` row has no identity row. The symptom is an opaque:

```
{"code":500,"error_code":"unexpected_failure","msg":"Database error querying schema"}
```

On a hosted project use the Admin API instead:

```bash
~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
    supabase/scripts/seed_test_users.py
```

### Test accounts (password `AgriAI#2026`)

| Email | Role |
|---|---|
| `ramesh.patil@example.com` | farmer (Maharashtra, Tomato + Wheat) |
| `sunita.devi@example.com` | farmer (Bihar, Tomato) |
| `moderator@agriai.example` | moderator |
| `admin@agriai.example` | admin |

**Delete these from Authentication → Users before any real deployment.**


### Applying to a real Supabase project

```bash
supabase link --project-ref <your-ref>
supabase db push          # runs everything in migrations/, in order
```

Run `seed.sql` **only** against a local/dev project:

```bash
supabase db reset         # local: applies migrations + seed.sql
```

> ⚠️ The 12 rows in `seed.sql` are illustrative placeholders, not ICAR/KVK
> sourced content. Phase 5 replaces them. See `DECISIONS.md` §7.

### Verifying locally (no Docker, no Supabase CLI required)

`tests/run_db_tests.py` boots a throwaway PostgreSQL instance, applies the shim
→ migrations → seed, then executes the policies as the real `anon`,
`authenticated` and `service_role` roles with a simulated JWT subject. Every
test runs in a transaction that is rolled back, so runs are repeatable.

```bash
~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
    supabase/tests/run_db_tests.py
```

Last run: **66 passed, 0 failed.** Covers table/RLS/index presence, cross-user
read and write blocking on all 10 tables, role escalation, impersonation
attempts, duplicate likes and duplicate joins, and `service_role` RLS bypass.

### RLS at a glance

| Table | farmer (own data) | moderator | admin | anon |
|---|---|---|---|---|
| `users` | read/update own row | own row | read all, change roles | — |
| `diagnoses` | read/write own only | own only | own only | — |
| `solutions` | read | read | **read + write** | — |
| `assistant_conversations` / `_messages` | own conversations | own | own | — |
| `communities` | read, create, edit own | read | read, edit any | read |
| `community_members` | read, join/leave self | read | read | read |
| `posts` / `comments` | read, write own | read, **moderate any** | read, delete any | — |
| `post_likes` | read, like/unlike self | read | read | — |

`service_role` (backend only) bypasses RLS entirely.

