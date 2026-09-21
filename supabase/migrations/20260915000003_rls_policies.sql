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
