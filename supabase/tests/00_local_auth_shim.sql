-- ===========================================================================
-- LOCAL TEST HARNESS ONLY — never apply this to a real Supabase project.
--
-- A real Supabase database already provides everything in this file: the `auth`
-- schema, the auth.users table, the auth.uid() function, and the
-- anon / authenticated / service_role roles. This shim recreates the minimum
-- of that surface so the migrations and RLS policies in ../migrations/ can be
-- executed and verified against a plain PostgreSQL instance.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Roles that Supabase creates out of the box.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Supabase's service_role bypasses RLS entirely.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------------
create schema if not exists auth;

-- Mirrors the columns of Supabase's auth.users that the Agri AI migrations and
-- seed data depend on.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255),
  encrypted_password varchar(255),
  phone              text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Same resolution order as Supabase: the scalar `request.jwt.claim.sub` first,
-- then the `sub` field of the `request.jwt.claims` JSON blob.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

comment on function auth.uid() is
  'Test shim. On real Supabase this is provided by the platform.';
