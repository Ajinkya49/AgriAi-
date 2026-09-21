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
