-- ===========================================================================
-- Agri AI — Phase 7: public display profiles for the community feed
--
-- WHY THIS EXISTS
-- ---------------
-- `public.users` is readable only by the row's owner or an admin
-- (`users_select_own_or_admin`). That is the right default — the table holds
-- email, phone, region and crops.
--
-- But a community feed has to show *who* said something. Without a deliberate
-- exception, the frontend cannot resolve an author name for anyone else's post.
--
-- So this adds one narrow, auditable SECURITY DEFINER function that exposes
-- ONLY the three fields a feed legitimately needs:
--
--     id, name, role
--
-- It does NOT expose email, phone, region or primary_crops. Keeping the
-- disclosure to a named function — rather than widening the table policy —
-- means the exception is explicit, greppable, and impossible to widen by
-- accident.
--
-- A farmer's display name and role are treated as public within the app; their
-- contact details are not. See DECISIONS.md §7.1.
-- ===========================================================================

create or replace function public.public_profiles(user_ids uuid[])
returns table (
  id   uuid,
  name text,
  role text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select u.id, u.name, u.role
  from public.users u
  where u.id = any(user_ids);
$$;

comment on function public.public_profiles(uuid[]) is
  'Public display fields (id, name, role) for community authors. Deliberately '
  'narrow: never expose email, phone, region or crops. See DECISIONS.md §7.1.';

-- Only signed-in farmers may call it, and only for the ids they already know
-- from a post or comment.
revoke all on function public.public_profiles(uuid[]) from public;
revoke all on function public.public_profiles(uuid[]) from anon;
grant execute on function public.public_profiles(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Feed indexes. The community feed is "posts in this community, newest first",
-- which is the single hottest read in the app.
-- ---------------------------------------------------------------------------
create index if not exists posts_community_created_idx
  on public.posts (community_id, created_at desc);

create index if not exists comments_post_created_idx
  on public.comments (post_id, created_at);

create index if not exists post_likes_post_idx
  on public.post_likes (post_id);

-- NOTE: no index on community_members(user_id) — Phase 2 already created
-- `community_members_user_id_idx`, and a second one would just be write overhead.
