-- ===========================================================================
-- Ensure a profile row exists for the caller
--
-- WHY THIS EXISTS
-- ---------------
-- `public.users` rows are created by the `on_auth_user_created` trigger, which
-- fires on inserts into `auth.users`.
--
-- With Clerk there is **no** `auth.users` row — Clerk is the identity system and
-- Supabase's auth schema stays empty. So that trigger never fires, nothing
-- creates the profile, and a Clerk user would have no row. Without a row:
--
--   * `public.current_app_role()` returns NULL, so every `is_admin()` /
--     `is_moderator_or_admin()` policy denies;
--   * `users_select_own_or_admin` matches nothing, so `/auth/me` returns no
--     profile and the app has nothing to show.
--
-- `ensure_profile()` closes that gap for BOTH issuers. For a Supabase user the
-- row already exists and this is a cheap no-op; for a Clerk user it creates it.
--
-- Chosen over a Clerk webhook deliberately: a webhook needs a public endpoint, a
-- signing secret and retry handling, and it can miss events. This self-heals on
-- the next request instead, with no new infrastructure — which fits the
-- "simple stack" constraint.
--
-- SAFETY
-- ------
-- SECURITY DEFINER, so it can insert despite RLS. It is not abusable: it only
-- ever inserts a row whose id is the CALLER's own subject, read from the caller's
-- own verified JWT. There is no parameter to pass someone else's id.
--
-- DEPENDS ON: 20260920000001_clerk_compatible_identity.sql
-- ===========================================================================

create or replace function public.ensure_profile()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  subject     text;
  claims      jsonb;
  claim_email text;
  claim_phone text;
  claim_name  text;
begin
  subject := public.current_user_id();

  -- Unauthenticated, or a token with no `sub`. Nothing to ensure.
  if subject is null then
    return null;
  end if;

  -- Fast path: the overwhelmingly common case.
  if exists (select 1 from public.users u where u.id = subject) then
    return subject;
  end if;

  claims := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );

  claim_email := nullif(trim(claims ->> 'email'), '');
  claim_phone := nullif(trim(claims ->> 'phone'), '');

  -- `users_email_or_phone_check` requires one or the other. Clerk's DEFAULT
  -- session token carries neither — only sub/iss/exp/sid/azp — so this can be
  -- reached in practice.
  --
  -- Returning the subject anyway is deliberate: identity still resolves, the
  -- caller is simply unknown to the app until a row exists. That is a better
  -- failure than raising, which would make the whole API unusable. To get a row,
  -- add an `email` claim to the Clerk session token (Clerk Dashboard ->
  -- Sessions -> Customize session token).
  if claim_email is null and claim_phone is null then
    return subject;
  end if;

  claim_name := coalesce(
    nullif(trim(claims ->> 'name'), ''),
    nullif(trim(claims ->> 'full_name'), ''),
    ''
  );

  insert into public.users (id, email, phone, name)
  values (subject, claim_email, claim_phone, claim_name)
  -- Two concurrent first requests would both see "no row" and both insert.
  on conflict (id) do nothing;

  return subject;
end;
$$;

comment on function public.ensure_profile() is
  'Returns the caller''s identity subject, creating their public.users row if it '
  'is missing. Covers signups that never touch auth.users — i.e. Clerk. '
  'Self-healing: safe to call on every request.';

-- Same exposure as the other identity helpers: signed-in callers only.
revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated, service_role;
