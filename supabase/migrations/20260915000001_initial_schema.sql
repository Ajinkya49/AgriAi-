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
