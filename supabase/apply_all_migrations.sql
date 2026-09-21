-- ===========================================================================
-- Agri AI — all Phase 2 migrations, concatenated for the Supabase SQL Editor
-- GENERATED FILE — do not edit by hand. Regenerate from supabase/migrations/.
--
-- Paste this entire file into the Supabase dashboard SQL Editor and run it once.
-- It is safe to re-run: every statement is guarded (if not exists / drop policy if
-- exists), so a partial failure can simply be retried.
--
-- This does NOT include seed data. Run supabase/seed.sql separately if you want
-- the dev test rows.
-- ===========================================================================



-- ###########################################################################
-- SECTION: 20260915000001_initial_schema.sql
-- ###########################################################################

-- ===========================================================================
-- Agri AI — Phase 2, migration 1 of 3: initial schema
-- Source of truth: 05-BackendSchema-AgriAI.md
--
-- Creates the ten tables defined in the Backend Schema:
--   users, diagnoses, solutions, assistant_conversations, assistant_messages,
--   communities, community_members, posts, comments, post_likes
--
-- Indexes live in migration 2; RLS policies in migration 3.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- users
-- Mirrors a Supabase Auth user. `id` is the auth.users id, so a profile row is
-- created by the `on_auth_user_created` trigger (see migration 3).
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  phone         text,
  name          text not null default '',
  region        text,
  primary_crops text[],
  role          text not null default 'farmer',
  created_at    timestamptz not null default now(),

  constraint users_role_check check (role in ('farmer', 'moderator', 'admin')),
  -- A user signs up with an email OR a phone number, never neither.
  constraint users_email_or_phone_check check (email is not null or phone is not null),
  -- Keep the auth identifier and the contact identifier the same thing.
  constraint users_email_not_blank check (email is null or length(trim(email)) > 0),
  constraint users_phone_not_blank check (phone is null or length(trim(phone)) > 0)
);

comment on table public.users is
  'Farmer profile. One row per Supabase Auth user; `id` is the auth.users id.';
comment on column public.users.role is
  'farmer (default) | moderator | admin. Drives the RLS role checks.';
comment on column public.users.primary_crops is
  'Optional. Set during onboarding (App Flow: /onboarding).';

-- ---------------------------------------------------------------------------
-- diagnoses
-- One row per image submitted to the PyTorch / EfficientNet-B0 model.
-- Every row carries a confidence score — the app never claims certainty.
-- ---------------------------------------------------------------------------
create table if not exists public.diagnoses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  image_url         text not null,
  crop_type         text not null,
  predicted_disease text not null,
  confidence_score  double precision not null,
  symptoms_summary  text,
  model_version     text not null,
  created_at        timestamptz not null default now(),

  constraint diagnoses_confidence_range_check
    check (confidence_score >= 0 and confidence_score <= 1)
);

comment on table public.diagnoses is
  'Model output for one uploaded crop image. Never written by the LLM.';
comment on column public.diagnoses.confidence_score is
  '0.0–1.0. Always surfaced in the UI; low values trigger the expert-confirmation prompt.';
comment on column public.diagnoses.model_version is
  'Which model version produced this result, for monitoring and reproducibility.';

-- ---------------------------------------------------------------------------
-- solutions
-- The CURATED trusted knowledge base. Read-only to farmers; written only by
-- admins/moderators. The LLM must never invent rows here — the diagnosis screen
-- renders exclusively from this table.
-- ---------------------------------------------------------------------------
create table if not exists public.solutions (
  id              uuid primary key default gen_random_uuid(),
  disease_name    text not null,
  solution_type   text not null,
  title           text not null,
  description     text not null,
  source_name     text not null,
  source_url      text,
  region_specific text,
  verified        boolean not null default false,
  created_at      timestamptz not null default now(),

  constraint solutions_type_check check (solution_type in ('natural', 'traditional')),
  constraint solutions_disease_not_blank check (length(trim(disease_name)) > 0),
  constraint solutions_title_not_blank check (length(trim(title)) > 0),
  constraint solutions_description_not_blank check (length(trim(description)) > 0),
  constraint solutions_source_not_blank check (length(trim(source_name)) > 0)
);

comment on table public.solutions is
  'Curated Natural + Traditional solutions. Matched at query time against diagnoses.predicted_disease (deliberately NOT a hard FK — the disease taxonomy is managed separately).';
comment on column public.solutions.solution_type is
  'natural | traditional. traditional rows are always rendered with the label "Traditional Practice — Not a Guaranteed Treatment."';
comment on column public.solutions.verified is
  'false until reviewed by an admin/agronomist.';

-- ---------------------------------------------------------------------------
-- assistant_conversations
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_conversations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  diagnosis_id uuid references public.diagnoses (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.assistant_conversations is
  'An AI Farming Assistant thread. diagnosis_id is set when opened from /assistant/[diagnosisId] so the RAG answer can be grounded in that diagnosis context.';

-- ---------------------------------------------------------------------------
-- assistant_messages
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.assistant_conversations (id) on delete cascade,
  role              text not null,
  content           text not null,
  retrieved_sources jsonb,
  created_at        timestamptz not null default now(),

  constraint assistant_messages_role_check check (role in ('user', 'assistant'))
);

comment on table public.assistant_messages is
  'Individual chat turns. `retrieved_sources` holds the knowledge-base chunks an assistant answer was grounded in, so the UI can show citation chips (e.g. "Source: ICAR Guidelines").';

-- ---------------------------------------------------------------------------
-- communities
-- ---------------------------------------------------------------------------
create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_by  uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint communities_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.communities is
  'Farmer topic communities, e.g. "Tomato Farmers", "Pest & Disease Help".';

-- ---------------------------------------------------------------------------
-- community_members  (many-to-many join table)
-- ---------------------------------------------------------------------------
create table if not exists public.community_members (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,
  joined_at    timestamptz not null default now(),

  -- Not spelled out in the Backend Schema, but a duplicate membership row would
  -- corrupt member counts and the "my communities" list. See DECISIONS.md.
  constraint community_members_unique_membership unique (community_id, user_id)
);

comment on table public.community_members is
  'Join table between users and communities.';

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,
  diagnosis_id uuid references public.diagnoses (id) on delete set null,
  image_url    text,
  content      text not null,
  created_at   timestamptz not null default now(),

  constraint posts_content_not_blank check (length(trim(content)) > 0)
);

comment on table public.posts is
  'Community posts. diagnosis_id/image_url are set when a farmer taps "Share with Community" from a diagnosis result.';

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now(),

  constraint comments_content_not_blank check (length(trim(content)) > 0)
);

comment on table public.comments is 'Replies on a community post.';

-- ---------------------------------------------------------------------------
-- post_likes
-- ---------------------------------------------------------------------------
create table if not exists public.post_likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint post_likes_unique_per_user unique (post_id, user_id)
);

comment on table public.post_likes is
  'A "Helpful" marker on a post. Unique per (post_id, user_id) — one like per farmer per post.';


-- ###########################################################################
-- SECTION: 20260915000002_indexes.sql
-- ###########################################################################

-- ===========================================================================
-- Agri AI — Phase 2, migration 2 of 3: indexes
-- Source of truth: 05-BackendSchema-AgriAI.md ("Indexes" section)
--
-- Section A reproduces the six indexes named in the Backend Schema.
-- Section B adds supporting indexes that the schema did not name. Postgres does
-- not index foreign keys automatically, so without these, cascade deletes and
-- the API's list endpoints degrade badly as data grows. They change performance
-- only — never access rules.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. Indexes specified in the Backend Schema
-- ---------------------------------------------------------------------------

-- Dashboard history lookups (GET /api/diagnoses/user/:userId).
create index if not exists diagnoses_user_id_created_at_idx
  on public.diagnoses (user_id, created_at desc);

-- Fast lookup when rendering a diagnosis result: match curated solutions by
-- disease + section (Natural vs Traditional).
create index if not exists solutions_disease_name_solution_type_idx
  on public.solutions (disease_name, solution_type);

-- Community feed pagination.
create index if not exists posts_community_id_created_at_idx
  on public.posts (community_id, created_at desc);

-- Post comment thread.
create index if not exists comments_post_id_created_at_idx
  on public.comments (post_id, created_at);

-- "My communities" lookup.
create index if not exists community_members_user_id_idx
  on public.community_members (user_id);

-- NOTE on post_likes(post_id, user_id) "unique index — prevent duplicate likes":
-- this is enforced by the `post_likes_unique_per_user` UNIQUE constraint in
-- migration 1, which already creates the backing unique index. Declaring it a
-- second time here would only duplicate storage and slow down writes.
-- Verified by the unique-violation test in tests/run_db_tests.py.

-- ---------------------------------------------------------------------------
-- B. Supporting indexes (additions — see DECISIONS.md)
-- ---------------------------------------------------------------------------

-- Loading an assistant thread in order.
create index if not exists assistant_messages_conversation_id_created_at_idx
  on public.assistant_messages (conversation_id, created_at);

-- Listing a user's assistant conversations.
create index if not exists assistant_conversations_user_id_created_at_idx
  on public.assistant_conversations (user_id, created_at desc);

-- Profile: "my posts".
create index if not exists posts_user_id_created_at_idx
  on public.posts (user_id, created_at desc);

-- Community discovery list.
create index if not exists communities_created_at_idx
  on public.communities (created_at desc);

-- Cascade-delete / "who did this" lookups on foreign keys that would otherwise
-- require a sequential scan of the whole table.
create index if not exists communities_created_by_idx
  on public.communities (created_by);

create index if not exists community_members_community_id_idx
  on public.community_members (community_id);

create index if not exists comments_user_id_idx
  on public.comments (user_id);

create index if not exists post_likes_user_id_idx
  on public.post_likes (user_id);

create index if not exists posts_diagnosis_id_idx
  on public.posts (diagnosis_id);

create index if not exists assistant_conversations_diagnosis_id_idx
  on public.assistant_conversations (diagnosis_id);


-- ###########################################################################
-- SECTION: 20260915000003_rls_policies.sql
-- ###########################################################################

-- ===========================================================================
-- Agri AI — Phase 2, migration 3 of 3: Row Level Security
-- Source of truth: 05-BackendSchema-AgriAI.md ("Row Level Security (RLS)"
-- and "User Roles" sections)
--
-- Every table gets RLS enabled. Policies are expressed against the Supabase
-- `authenticated` / `anon` roles and use auth.uid() for identity, so the same
-- rules hold for the browser client (anon key), the backend (JWT-forwarded
-- requests), and direct PostgREST calls.
--
-- Roles: farmer (default) | moderator | admin
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Role helpers
--
-- SECURITY DEFINER so that reading `public.users.role` from inside a `users`
-- policy does not re-trigger RLS on `users` (which would recurse infinitely).
-- `set search_path` is pinned to defeat search_path hijacking of a SECURITY
-- DEFINER function.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.role from public.users u where u.id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_app_role() = 'admin';
$$;

-- Used by the community moderation policies (posts / comments).
create or replace function public.is_moderator_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_app_role() in ('moderator', 'admin');
$$;

comment on function public.current_app_role() is
  'Role of the calling user, or NULL when unauthenticated. Used by RLS policies.';

-- Do not let unauthenticated callers execute the role helpers.
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_moderator_or_admin() from public, anon;
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_moderator_or_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Profile row auto-creation
--
-- users.id is the Supabase Auth user id, so a profile row must exist as soon as
-- an auth user is created. Without this the Auth phase could never populate the
-- table from real sign-ups. (Addition — not spelled out in the Backend Schema.)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email, phone, name)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 3. Privilege-escalation guard
--
-- The Backend Schema says a user may update their own row. Taken literally that
-- would let any farmer run `update users set role = 'admin'` on themselves.
-- This trigger keeps self-service profile edits working while reserving role
-- changes for admins. (Addition — see DECISIONS.md.)
-- ---------------------------------------------------------------------------
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an admin can change a user role'
      using errcode = '42501'; -- insufficient_privilege
  end if;
  return new;
end;
$$;

drop trigger if exists users_prevent_role_escalation on public.users;
create trigger users_prevent_role_escalation
  before update on public.users
  for each row execute function public.prevent_role_escalation();

-- ===========================================================================
-- 4. Policies
-- ===========================================================================

-- ---- users -----------------------------------------------------------------
-- "user can read/update only their own row; admins can read all"
-- plus the Roles section: "admin: ... manages users/roles".
alter table public.users enable row level security;

drop policy if exists users_select_own_or_admin on public.users;
create policy users_select_own_or_admin on public.users
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists users_update_own_or_admin on public.users;
create policy users_update_own_or_admin on public.users
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists users_delete_own_or_admin on public.users;
create policy users_delete_own_or_admin on public.users
  for delete to authenticated
  using (id = auth.uid() or public.is_admin());

-- ---- diagnoses -------------------------------------------------------------
-- "user can read/write only rows where user_id = auth.uid()"
alter table public.diagnoses enable row level security;

drop policy if exists diagnoses_select_own on public.diagnoses;
create policy diagnoses_select_own on public.diagnoses
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists diagnoses_insert_own on public.diagnoses;
create policy diagnoses_insert_own on public.diagnoses
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists diagnoses_update_own on public.diagnoses;
create policy diagnoses_update_own on public.diagnoses
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists diagnoses_delete_own on public.diagnoses;
create policy diagnoses_delete_own on public.diagnoses
  for delete to authenticated
  using (user_id = auth.uid());

-- ---- solutions (curated knowledge base) ------------------------------------
-- "publicly readable by all authenticated users; writable only by
--  admin/moderator roles"
--
-- DOC CONFLICT RESOLVED (see DECISIONS.md): the Roles section states that a
-- moderator "cannot edit the knowledge base" while this line permits
-- admin/moderator writes. Least privilege was chosen, matching the explicit
-- Roles statement: writes are ADMIN ONLY. To follow the RLS line literally
-- instead, swap is_admin() for is_moderator_or_admin() in the three write
-- policies below.
alter table public.solutions enable row level security;

drop policy if exists solutions_select_authenticated on public.solutions;
create policy solutions_select_authenticated on public.solutions
  for select to authenticated
  using (true);

drop policy if exists solutions_insert_admin on public.solutions;
create policy solutions_insert_admin on public.solutions
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists solutions_update_admin on public.solutions;
create policy solutions_update_admin on public.solutions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists solutions_delete_admin on public.solutions;
create policy solutions_delete_admin on public.solutions
  for delete to authenticated
  using (public.is_admin());

-- ---- assistant_conversations ----------------------------------------------
-- "user can read/write only their own conversations"
alter table public.assistant_conversations enable row level security;

drop policy if exists assistant_conversations_select_own on public.assistant_conversations;
create policy assistant_conversations_select_own on public.assistant_conversations
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists assistant_conversations_insert_own on public.assistant_conversations;
create policy assistant_conversations_insert_own on public.assistant_conversations
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists assistant_conversations_update_own on public.assistant_conversations;
create policy assistant_conversations_update_own on public.assistant_conversations
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists assistant_conversations_delete_own on public.assistant_conversations;
create policy assistant_conversations_delete_own on public.assistant_conversations
  for delete to authenticated
  using (user_id = auth.uid());

-- ---- assistant_messages ----------------------------------------------------
-- "own conversations" means the PARENT conversation belongs to the caller.
alter table public.assistant_messages enable row level security;

drop policy if exists assistant_messages_select_own on public.assistant_messages;
create policy assistant_messages_select_own on public.assistant_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = assistant_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists assistant_messages_insert_own on public.assistant_messages;
create policy assistant_messages_insert_own on public.assistant_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = assistant_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists assistant_messages_delete_own on public.assistant_messages;
create policy assistant_messages_delete_own on public.assistant_messages
  for delete to authenticated
  using (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = assistant_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- ---- communities -----------------------------------------------------------
-- "publicly readable; creation allowed by any authenticated user; edits
--  restricted to created_by or admin"
alter table public.communities enable row level security;

drop policy if exists communities_select_all on public.communities;
create policy communities_select_all on public.communities
  for select to anon, authenticated
  using (true);

drop policy if exists communities_insert_authenticated on public.communities;
create policy communities_insert_authenticated on public.communities
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists communities_update_owner_or_admin on public.communities;
create policy communities_update_owner_or_admin on public.communities
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists communities_delete_owner_or_admin on public.communities;
create policy communities_delete_owner_or_admin on public.communities
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- ---- community_members -----------------------------------------------------
-- "user can insert/delete only their own membership row; readable by all"
alter table public.community_members enable row level security;

drop policy if exists community_members_select_all on public.community_members;
create policy community_members_select_all on public.community_members
  for select to anon, authenticated
  using (true);

drop policy if exists community_members_insert_self on public.community_members;
create policy community_members_insert_self on public.community_members
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists community_members_delete_self on public.community_members;
create policy community_members_delete_self on public.community_members
  for delete to authenticated
  using (user_id = auth.uid());

-- ---- posts -----------------------------------------------------------------
-- "publicly readable within joined communities; insert restricted to
--  authenticated users; update/delete restricted to user_id = auth.uid() or
--  admin/moderator"
--
-- INTERPRETATION (see DECISIONS.md): SELECT is granted to any authenticated
-- user rather than being gated on membership. App Flow journey 3 has a farmer
-- open the feed of a *suggested* (not-yet-joined) community, so a membership
-- gate would break the documented journey. Posts are public community content.
alter table public.posts enable row level security;

drop policy if exists posts_select_authenticated on public.posts;
create policy posts_select_authenticated on public.posts
  for select to authenticated
  using (true);

drop policy if exists posts_insert_authenticated on public.posts;
create policy posts_insert_authenticated on public.posts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists posts_update_own_or_staff on public.posts;
create policy posts_update_own_or_staff on public.posts
  for update to authenticated
  using (user_id = auth.uid() or public.is_moderator_or_admin())
  with check (user_id = auth.uid() or public.is_moderator_or_admin());

drop policy if exists posts_delete_own_or_staff on public.posts;
create policy posts_delete_own_or_staff on public.posts
  for delete to authenticated
  using (user_id = auth.uid() or public.is_moderator_or_admin());

-- ---- comments --------------------------------------------------------------
-- "same pattern as posts"
alter table public.comments enable row level security;

drop policy if exists comments_select_authenticated on public.comments;
create policy comments_select_authenticated on public.comments
  for select to authenticated
  using (true);

drop policy if exists comments_insert_authenticated on public.comments;
create policy comments_insert_authenticated on public.comments
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists comments_update_own_or_staff on public.comments;
create policy comments_update_own_or_staff on public.comments
  for update to authenticated
  using (user_id = auth.uid() or public.is_moderator_or_admin())
  with check (user_id = auth.uid() or public.is_moderator_or_admin());

drop policy if exists comments_delete_own_or_staff on public.comments;
create policy comments_delete_own_or_staff on public.comments
  for delete to authenticated
  using (user_id = auth.uid() or public.is_moderator_or_admin());

-- ---- post_likes ------------------------------------------------------------
-- "user can insert/delete only their own like row"
-- SELECT is not specified; it is needed to render like counts and to show
-- whether the current farmer already liked a post.
alter table public.post_likes enable row level security;

drop policy if exists post_likes_select_authenticated on public.post_likes;
create policy post_likes_select_authenticated on public.post_likes
  for select to authenticated
  using (true);

drop policy if exists post_likes_insert_self on public.post_likes;
create policy post_likes_insert_self on public.post_likes
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists post_likes_delete_self on public.post_likes;
create policy post_likes_delete_self on public.post_likes
  for delete to authenticated
  using (user_id = auth.uid());

-- ===========================================================================
-- 5. Grants
--
-- RLS decides *which rows* a role may touch; grants decide whether it may issue
-- the statement at all. Both are required. `anon` is limited to the two
-- publicly readable community tables — every other table has no anon policy, so
-- anon reads return zero rows even though the grant exists.
-- ===========================================================================
grant usage on schema public to anon, authenticated, service_role;

grant select on public.communities, public.community_members to anon;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- The backend's service-role client bypasses RLS (used for the diagnosis insert
-- after model inference, and for seeding the solutions knowledge base).
grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;
