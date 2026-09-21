-- ===========================================================================
-- Agri AI — local development seed data
-- Source of truth: 06-ImplementationPlan-AgriAI.md, Phase 2
--   "Seed a small set of test data: a few users, a handful of solutions
--    entries for 2–3 diseases, one test community"
--
-- LOCAL / DEVELOPMENT ONLY. Never run this against production.
--
-- Test accounts — all four use the password  AgriAI#2026
--   ramesh.patil@example.com   farmer      (Maharashtra, Tomato + Wheat)
--   sunita.devi@example.com    farmer      (Bihar, Tomato)
--   moderator@agriai.example   moderator
--   admin@agriai.example       admin
-- `encrypted_password` holds a real bcrypt hash so these accounts can actually
-- sign in through Supabase Auth during Phase 3 testing. Delete them from
-- Authentication -> Users before any real deployment.
--
-- !! IMPORTANT — READ BEFORE REUSING THESE SOLUTIONS IN THE PRODUCT !!
-- The rows seeded into `solutions` below are ILLUSTRATIVE PLACEHOLDERS. They
-- were written to exercise the schema and the diagnosis screen layout, NOT
-- copied from ICAR / KVK / agricultural-university publications.
--
-- The PRD states: "Never hallucinate agricultural recommendations — all
-- natural/traditional guidance must be grounded in a trusted knowledge base."
-- Phase 5 must therefore REPLACE every row below with text taken verbatim from
-- the approved sources listed in backend/app/knowledge_base/sources.md, and
-- set `verified = true` only after an agronomist has reviewed it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Auth users
-- Inserting into auth.users fires `on_auth_user_created`, which creates the
-- matching public.users profile row (name comes from raw_user_meta_data).
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, phone,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'ramesh.patil@example.com',
    '$2b$10$orwT22pQCRMdG/rfsW2rpOBPngXhDt1YB./Jh/3bYIxAmLzr4uEIm', null,
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Ramesh Patil"}',
    now(), now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'sunita.devi@example.com',
    '$2b$10$orwT22pQCRMdG/rfsW2rpOBPngXhDt1YB./Jh/3bYIxAmLzr4uEIm', null,
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Sunita Devi"}',
    now(), now()
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'moderator@agriai.example',
    '$2b$10$orwT22pQCRMdG/rfsW2rpOBPngXhDt1YB./Jh/3bYIxAmLzr4uEIm', null,
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"KVK Moderator"}',
    now(), now()
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin@agriai.example',
    '$2b$10$orwT22pQCRMdG/rfsW2rpOBPngXhDt1YB./Jh/3bYIxAmLzr4uEIm', null,
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Agri AI Admin"}',
    now(), now()
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Onboarding details + roles
-- region / primary_crops are what the /onboarding screen collects.
-- ---------------------------------------------------------------------------
update public.users
   set region = 'Maharashtra',
       primary_crops = array['Tomato', 'Wheat'],
       role = 'farmer'
 where id = '11111111-1111-4111-8111-111111111111';

update public.users
   set region = 'Bihar',
       primary_crops = array['Tomato'],
       role = 'farmer'
 where id = '22222222-2222-4222-8222-222222222222';

update public.users
   set region = 'Maharashtra',
       role = 'moderator'
 where id = '33333333-3333-4333-8333-333333333333';

update public.users
   set region = 'Maharashtra',
       role = 'admin'
 where id = '44444444-4444-4444-8444-444444444444';

-- ---------------------------------------------------------------------------
-- 3. Curated solutions
--
-- MOVED. The `solutions` knowledge base is now a migration, not seed data:
--     migrations/20260915000004_solutions_knowledge_base.sql
--
-- It belongs in migrations because it is curated product content sourced from
-- ICAR / TNAU / published trials — not disposable test fixtures. The Phase 2
-- placeholder rows that used to live here were explicitly unsourced and have
-- been replaced.
--
-- Nothing to insert here. See that migration for the taxonomy mapping.

-- ---------------------------------------------------------------------------
-- 4. One test community + membership + a post
-- ---------------------------------------------------------------------------
insert into public.communities (id, name, description, created_by)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Tomato Farmers',
  'For farmers growing tomato — share what is working on your field, ask about problems, and compare notes on pests and disease.',
  '11111111-1111-4111-8111-111111111111'
)
on conflict (id) do nothing;

insert into public.community_members (community_id, user_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222')
on conflict (community_id, user_id) do nothing;

insert into public.posts (id, community_id, user_id, content)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Lower leaves of my tomato plants are getting brown spots with rings inside them. Has anyone else seen this in the last two weeks?'
)
on conflict (id) do nothing;
