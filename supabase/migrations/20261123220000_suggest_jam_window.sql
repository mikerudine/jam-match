-- Suggest jam datetime from participant availability when window is unset.
-- Solo → nearest free day; 2+ → nearest day with best overlap (majority OK).

create or replace function jam.user_free_at(
  p_user_id uuid,
  p_date date,
  p_hour integer
) returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  select case o.mode
    when 'off' then false
    when 'full' then true
    else exists (
      select 1
      from jam.availability_slots a
      where a.user_id = p_user_id
        and a.day_of_week = extract(isodow from p_date)::int - 1
        and a.hour = p_hour
    )
  end
  from (select 1) _
  left join jam.availability_date_overrides o
    on o.user_id = p_user_id
   and o.on_date = p_date;
$$;

revoke all on function jam.user_free_at(uuid, date, integer) from public, anon, authenticated;

create or replace function jam.suggest_window_for_users(p_user_ids uuid[])
returns table (
  window_start timestamptz,
  window_end timestamptz,
  match_count integer,
  matched_user_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uids uuid[];
  v_n integer;
  v_min integer;
  v_day date;
  v_last date;
  v_start integer;
  v_h integer;
  v_common uuid[];
  v_slot uuid[];
  v_count integer;
  v_dur integer;
  v_best_count integer := 0;
  v_best_day date;
  v_best_start integer;
  v_best_end integer;
  v_best_users uuid[];
  v_best_dur integer := 0;
begin
  select coalesce(array_agg(distinct x order by x), '{}')
  into v_uids
  from unnest(p_user_ids) as x
  where x is not null;

  v_n := coalesce(cardinality(v_uids), 0);
  if v_n = 0 then
    return;
  end if;

  v_min := case when v_n = 1 then 1 else 2 end;
  v_day := (timezone('Europe/Kyiv', now()))::date;
  v_last := v_day + 27;

  while v_day <= v_last loop
    for v_start in 0..23 loop
      v_common := v_uids;
      for v_h in v_start..23 loop
        select coalesce(array_agg(u order by u), '{}')
        into v_slot
        from unnest(v_uids) as u
        where jam.user_free_at(u, v_day, v_h);

        select coalesce(array_agg(x order by x), '{}')
        into v_common
        from (
          select unnest(v_common) as x
          intersect
          select unnest(v_slot)
        ) q;

        v_count := coalesce(cardinality(v_common), 0);
        if v_count < v_min then
          exit;
        end if;

        v_dur := v_h - v_start + 1;
        if v_count > v_best_count
           or (
             v_count = v_best_count
             and (
               v_best_day is null
               or v_day < v_best_day
               or (
                 v_day = v_best_day
                 and (
                   v_dur > v_best_dur
                   or (v_dur = v_best_dur and v_start < v_best_start)
                 )
               )
             )
           )
        then
          v_best_count := v_count;
          v_best_day := v_day;
          v_best_start := v_start;
          v_best_end := v_h + 1;
          v_best_dur := v_dur;
          v_best_users := v_common;
        end if;
      end loop;
    end loop;
    v_day := v_day + 1;
  end loop;

  if v_best_day is null then
    return;
  end if;

  window_start := timezone(
    'Europe/Kyiv',
    v_best_day + make_time(v_best_start, 0, 0)
  );
  if v_best_end >= 24 then
    window_end := timezone(
      'Europe/Kyiv',
      (v_best_day + 1) + make_time(0, 0, 0)
    );
  else
    window_end := timezone(
      'Europe/Kyiv',
      v_best_day + make_time(v_best_end, 0, 0)
    );
  end if;
  match_count := v_best_count;
  matched_user_ids := v_best_users;
  return next;
end;
$$;

revoke all on function jam.suggest_window_for_users(uuid[]) from public, anon, authenticated;

create or replace function jam.jam_participant_ids(p_jam_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = jam
as $$
  select coalesce(array_agg(distinct uid), '{}')
  from (
    select j.creator_id as uid
    from jam.jam_requests j
    where j.id = p_jam_id
    union
    select s.filled_by
    from jam.jam_seats s
    where s.jam_id = p_jam_id
      and s.filled_by is not null
  ) u
  where uid is not null;
$$;

revoke all on function jam.jam_participant_ids(uuid) from public, anon, authenticated;

create or replace function jam.suggest_jam_window(p_jam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uids uuid[];
  v_row record;
  v_names text[];
begin
  v_uids := jam.jam_participant_ids(p_jam_id);
  if coalesce(cardinality(v_uids), 0) = 0 then
    return null;
  end if;

  select * into v_row
  from jam.suggest_window_for_users(v_uids)
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(array_agg(p.display_name order by p.display_name), '{}')
  into v_names
  from jam.profiles p
  where p.id = any (v_row.matched_user_ids);

  return jsonb_build_object(
    'window_start', v_row.window_start,
    'window_end', v_row.window_end,
    'match_count', v_row.match_count,
    'participant_count', cardinality(v_uids),
    'matched_user_ids', to_jsonb(v_row.matched_user_ids),
    'matched_names', to_jsonb(v_names)
  );
end;
$$;

revoke all on function jam.suggest_jam_window(uuid) from public, anon;
grant execute on function jam.suggest_jam_window(uuid) to authenticated;

drop function if exists jam.list_browse_jams();

create function jam.list_browse_jams()
returns table (
  id uuid,
  creator_id uuid,
  theme text,
  format jam.jam_format,
  genres text[],
  area text,
  base_name text,
  window_start timestamptz,
  window_end timestamptz,
  status jam.jam_status,
  invite_ttl_hours integer,
  audience text,
  created_at timestamptz,
  creator_display_name text,
  filled_count integer,
  open_count integer,
  covers_my_availability boolean,
  is_friend_creator boolean,
  i_am_participant boolean,
  suggested_window_start timestamptz,
  suggested_window_end timestamptz,
  suggested_match_count integer,
  suggested_participant_count integer,
  suggested_matched_names text[]
)
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return query
  select
    j.id,
    j.creator_id,
    j.theme,
    j.format,
    j.genres,
    j.area,
    j.base_name,
    j.window_start,
    j.window_end,
    j.status,
    j.invite_ttl_hours,
    coalesce(j.audience, 'open') as audience,
    j.created_at,
    p.display_name as creator_display_name,
    (
      select count(*)::integer
      from jam.jam_seats s
      where s.jam_id = j.id and s.status = 'filled'
    ) as filled_count,
    (
      select count(*)::integer
      from jam.jam_seats s
      where s.jam_id = j.id and s.status <> 'filled'
    ) as open_count,
    case
      when j.window_start is not null and j.window_end is not null then
        jam.user_covers_window(v_uid, j.window_start, j.window_end)
      when sug.window_start is not null and sug.window_end is not null then
        jam.user_covers_window(v_uid, sug.window_start, sug.window_end)
      else false
    end as covers_my_availability,
    jam.are_friends(v_uid, j.creator_id) as is_friend_creator,
    jam.is_jam_participant(j.id, v_uid) as i_am_participant,
    sug.window_start as suggested_window_start,
    sug.window_end as suggested_window_end,
    sug.match_count as suggested_match_count,
    sug.participant_count as suggested_participant_count,
    sug.matched_names as suggested_matched_names
  from jam.jam_requests j
  join jam.profiles p on p.id = j.creator_id
  left join lateral (
    select
      (s->>'window_start')::timestamptz as window_start,
      (s->>'window_end')::timestamptz as window_end,
      (s->>'match_count')::integer as match_count,
      (s->>'participant_count')::integer as participant_count,
      case
        when s ? 'matched_names' then
          array(select jsonb_array_elements_text(s->'matched_names'))
        else null
      end as matched_names
    from (
      select case
        when j.window_start is null then jam.suggest_jam_window(j.id)
        else null
      end as s
    ) x
  ) sug on true
  where j.status in ('matching', 'confirmed')
    and (j.window_end is null or j.window_end > now())
    and (
      coalesce(j.audience, 'open') = 'open'
      or jam.are_friends(v_uid, j.creator_id)
      or jam.is_jam_participant(j.id, v_uid)
    )
  order by
    coalesce(j.window_start, sug.window_start) nulls last,
    j.created_at desc;
end;
$$;

revoke all on function jam.list_browse_jams() from public, anon;
grant execute on function jam.list_browse_jams() to authenticated;

create or replace function jam.get_public_jam(p_jam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = jam
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_jam jam.jam_requests%rowtype;
  v_initiator text;
  v_seats jsonb;
  v_filled integer;
  v_open integer;
  v_sug jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_jam
  from jam.jam_requests
  where id = p_jam_id;

  if not found then
    return null;
  end if;

  if v_jam.status not in ('matching', 'confirmed') then
    return null;
  end if;
  if v_jam.window_end is not null and v_jam.window_end < now() then
    return null;
  end if;

  if jam.is_jam_participant(p_jam_id, v_uid) then
    null;
  elsif coalesce(v_jam.audience, 'open') = 'friends'
     and not jam.are_friends(v_uid, v_jam.creator_id) then
    return jsonb_build_object('denied', 'friends_only');
  end if;

  select p.display_name into v_initiator
  from jam.profiles p
  where p.id = v_jam.creator_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role', s.role,
        'role_label', s.role_label,
        'is_creator', s.is_creator,
        'filled', (s.status = 'filled' or s.filled_by is not null)
      )
      order by s.sort_order
    ),
    '[]'::jsonb
  )
  into v_seats
  from jam.jam_seats s
  where s.jam_id = p_jam_id;

  select
    count(*) filter (where s.status = 'filled' or s.filled_by is not null),
    count(*) filter (where not (s.status = 'filled' or s.filled_by is not null))
  into v_filled, v_open
  from jam.jam_seats s
  where s.jam_id = p_jam_id;

  if v_jam.window_start is null then
    v_sug := jam.suggest_jam_window(p_jam_id);
  else
    v_sug := null;
  end if;

  return jsonb_build_object(
    'id', v_jam.id,
    'format', v_jam.format,
    'genres', to_jsonb(v_jam.genres),
    'area', v_jam.area,
    'window_start', v_jam.window_start,
    'window_end', v_jam.window_end,
    'status', v_jam.status,
    'audience', coalesce(v_jam.audience, 'open'),
    'initiator_display_name', coalesce(v_initiator, ''),
    'seats', v_seats,
    'filled_count', coalesce(v_filled, 0),
    'open_count', coalesce(v_open, 0),
    'suggested_window_start', v_sug->>'window_start',
    'suggested_window_end', v_sug->>'window_end',
    'suggested_match_count', (v_sug->>'match_count')::integer,
    'suggested_participant_count', (v_sug->>'participant_count')::integer,
    'suggested_matched_names', v_sug->'matched_names'
  );
end;
$$;

revoke all on function jam.get_public_jam(uuid) from public, anon;
grant execute on function jam.get_public_jam(uuid) to authenticated;
