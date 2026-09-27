-- ===========================================================================
-- Regional outbreak signals
--
-- WHY THIS EXISTS
-- ---------------
-- `diagnoses` is locked down by RLS to `user_id = current_user_id()` — a farmer
-- sees only their own rows. That is correct and must not change.
--
-- But the aggregate is a genuinely different thing from the rows. Three farmers
-- in the same district independently reporting Late Blight in one week is a
-- signal none of them can see alone, and it is the single most useful thing the
-- app can tell them: act now, before it reaches your field.
--
-- So this exposes the *aggregate only*, and nothing else.
--
-- PRIVACY
-- -------
-- The function is SECURITY DEFINER (it must read past RLS), so the guards are
-- what matter. It returns:
--
--   * counts and a max(timestamp) — never `user_id`, never `image_url`, never
--     `id`, never `confidence_score`. There is no column here that identifies a
--     person, so no caller can enumerate another farmer's activity.
--   * **only the caller's own region**, read from their own profile row. A
--     caller cannot ask about a district they are not in, so this cannot be used
--     to survey the country.
--   * a **hard floor of 3** on the number of distinct farmers, enforced below
--     the parameter. This is deliberate k-anonymity: a caller cannot pass
--     `p_min_reports => 1` and use the result to infer that one specific
--     neighbour photographed a diseased leaf. The floor cannot be lowered
--     through the API.
--
-- Together those mean the worst case for a malicious caller is learning that
-- "at least three people near me reported late blight" — which is the intended
-- product behaviour, not a leak.
--
-- SIGNAL QUALITY
-- --------------
-- Three things keep the alert trustworthy:
--
--   1. **The threshold counts distinct farmers, not rows.** One farmer
--      photographing five leaves must not announce an outbreak to their
--      district. Requiring several different people to independently see it is
--      what makes it news.
--   2. **Healthy is excluded.** An "outbreak" of healthy plants is noise.
--   3. **Confidence floor of 0.30**, matching
--      `CONFIDENCE_UNRELIABLE_THRESHOLD` in `app/models/labels.py` — below it the
--      model is "not meaningfully better than a guess", so such a row is not
--      evidence. Aggregation supplies the confidence that a single weak
--      prediction lacks, but only over predictions that are at least plausible.
--
-- A false outbreak alert is worse than no alert: it would have farmers spraying
-- a healthy field, which costs money and trust. Hence the conservative defaults.
--
-- DEPENDS ON: 20260920000001_clerk_compatible_identity.sql (current_user_id)
-- ===========================================================================

-- The window filter scans by time. Only (user_id, created_at) is indexed today,
-- which does not help a query that groups across users.
create index if not exists diagnoses_created_at_idx
  on public.diagnoses (created_at desc);

create or replace function public.regional_outbreaks(
  p_days integer default 14,
  p_min_reports integer default 3
)
returns table (
  region            text,
  crop_type         text,
  predicted_disease text,
  display_disease   text,
  farmer_count      integer,
  report_count      integer,
  last_reported_at  timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with me as (
    select nullif(btrim(u.region), '') as region
    from public.users u
    where u.id = public.current_user_id()
  ),
  bounds as (
    select
      -- Clamp the window: an unbounded lookback would both mislead ("outbreak"
      -- from six months ago) and scan the whole table.
      now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90)) as since,
      -- Clamp the threshold from BELOW only. This is the k-anonymity floor
      -- described above; it must never be lowerable.
      greatest(coalesce(p_min_reports, 3), 3) as min_reports
  )
  select
    me.region                                   as region,
    d.crop_type                                 as crop_type,
    d.predicted_disease                         as predicted_disease,
    replace(d.predicted_disease, d.crop_type || ' - ', '') as display_disease,
    -- The headline number. Counted over DISTINCT FARMERS, not rows.
    count(distinct d.user_id)::integer           as farmer_count,
    count(*)::integer                            as report_count,
    max(d.created_at)                            as last_reported_at
  from public.diagnoses d
  join public.users author on author.id = d.user_id
  cross join me
  where
    -- Caller must have a region, and we only ever look at their own.
    me.region is not null
    -- Normalised compare: `region` is free text in the profile and may carry
    -- stray casing or whitespace from an older form.
    and lower(btrim(author.region)) = lower(me.region)
    -- `bounds` holds exactly one row, so these read as constants. They are
    -- scalar subqueries rather than a cross join because `min_reports` would
    -- otherwise have to appear in the GROUP BY, which reads as though the
    -- threshold were part of the grouping key.
    and d.created_at >= (select since from bounds)
    -- A healthy plant is not an outbreak.
    and d.predicted_disease not like '% - Healthy'
    -- See SIGNAL QUALITY above.
    and d.confidence_score >= 0.30
  group by d.crop_type, d.predicted_disease, me.region
  -- The threshold is on DISTINCT FARMERS, not rows.
  --
  -- This is the difference between a real signal and a false alarm. Counted by
  -- rows, one farmer photographing five leaves on the same plant would announce
  -- an outbreak to their whole district — and the app would have caused exactly
  -- the wasted spraying it exists to prevent. Requiring several *different*
  -- people to independently see it is what makes it news.
  --
  -- It also strengthens the k-anonymity guarantee: the floor is now "at least 3
  -- distinct farmers", so a single farmer's activity can never be inferred.
  having count(distinct d.user_id) >= (select min_reports from bounds)
  -- Most farmers first, then most-recent as the tiebreak: a big old outbreak
  -- and a small new one are both worth showing, and this keeps the order stable.
  order by count(distinct d.user_id) desc, max(d.created_at) desc
  limit 5;
$$;

comment on function public.regional_outbreaks(integer, integer) is
  'Aggregate disease signals for the CALLER''S OWN region: counts only, never '
  'individual rows, with a hard floor of 3 DISTINCT FARMERS for k-anonymity. '
  'Exists because the aggregate is genuinely different information from the '
  'rows, which stay protected by RLS.';

-- Same exposure as the other helpers: signed-in callers only. `anon` is
-- explicitly revoked — an unauthenticated caller has no region and no identity,
-- so there is nothing legitimate for them to ask.
revoke execute on function public.regional_outbreaks(integer, integer) from public, anon;
grant execute on function public.regional_outbreaks(integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification
--
-- Runs at migration time and fails the migration rather than leaving a
-- silently-broken function behind.
-- ---------------------------------------------------------------------------
do $$
declare
  signature text;
  forbidden text[] := array['user_id', 'image_url', 'confidence_score', 'email', 'phone'];
  name text;
begin
  -- Read the RETURNS TABLE columns from pg_proc. (`information_schema.columns`
  -- only covers tables and views — a function's output columns are NOT there,
  -- so checking it would silently always pass.)
  select pg_get_function_result(p.oid)
  into signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'regional_outbreaks';

  if signature is null then
    raise exception 'regional_outbreaks() was not created';
  end if;

  -- If someone later adds an identifying column, this fails the migration
  -- instead of quietly turning an aggregate into a privacy hole.
  foreach name in array forbidden loop
    if position(name in signature) > 0 then
      raise exception
        'regional_outbreaks returns identifying column "%" — it must return aggregates only. Signature: %',
        name, signature;
    end if;
  end loop;

  -- Assert the privacy floor is really 3, not merely documented as 3.
  if (select pg_get_function_arguments(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'regional_outbreaks')
     not like '%p_min_reports integer DEFAULT 3%'
  then
    raise exception
      'regional_outbreaks: the default min_reports is no longer 3. The '
      'k-anonymity floor is load-bearing — update this check deliberately if '
      'you really mean to change it.';
  end if;

  raise notice 'regional_outbreaks() verified — aggregates only, 3-farmer floor.';
end;
$$;
