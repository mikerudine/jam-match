-- Per-jam availability for a participant (defaults to profile until customized).

create table jam.jam_availability (
  jam_id uuid not null references jam.jam_requests (id) on delete cascade,
  user_id uuid not null references jam.profiles (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (jam_id, user_id)
);

create table jam.jam_availability_slots (
  jam_id uuid not null,
  user_id uuid not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour smallint not null check (hour between 0 and 23),
  primary key (jam_id, user_id, day_of_week, hour),
  foreign key (jam_id, user_id)
    references jam.jam_availability (jam_id, user_id) on delete cascade
);

create table jam.jam_availability_date_overrides (
  jam_id uuid not null,
  user_id uuid not null,
  on_date date not null,
  mode text not null check (mode in ('full', 'off')),
  primary key (jam_id, user_id, on_date),
  foreign key (jam_id, user_id)
    references jam.jam_availability (jam_id, user_id) on delete cascade
);

create index jam_availability_slots_user_idx
  on jam.jam_availability_slots (user_id, jam_id);
create index jam_availability_date_overrides_date_idx
  on jam.jam_availability_date_overrides (on_date);

alter table jam.jam_availability enable row level security;
alter table jam.jam_availability_slots enable row level security;
alter table jam.jam_availability_date_overrides enable row level security;

create policy jam_availability_select_participants
  on jam.jam_availability for select
  to authenticated
  using (jam.is_jam_participant(jam_id, auth.uid()));

create policy jam_availability_insert_own
  on jam.jam_availability for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_availability_update_own
  on jam.jam_availability for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy jam_availability_delete_own
  on jam.jam_availability for delete
  to authenticated
  using (user_id = auth.uid());

create policy jam_availability_slots_select_participants
  on jam.jam_availability_slots for select
  to authenticated
  using (jam.is_jam_participant(jam_id, auth.uid()));

create policy jam_availability_slots_insert_own
  on jam.jam_availability_slots for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_availability_slots_delete_own
  on jam.jam_availability_slots for delete
  to authenticated
  using (user_id = auth.uid());

create policy jam_availability_date_overrides_select_participants
  on jam.jam_availability_date_overrides for select
  to authenticated
  using (jam.is_jam_participant(jam_id, auth.uid()));

create policy jam_availability_date_overrides_insert_own
  on jam.jam_availability_date_overrides for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_availability_date_overrides_delete_own
  on jam.jam_availability_date_overrides for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on jam.jam_availability to authenticated;
grant select, insert, delete on jam.jam_availability_slots to authenticated;
grant select, insert, delete on jam.jam_availability_date_overrides to authenticated;

drop function if exists jam.user_free_at(uuid, date, integer);
drop function if exists jam.suggest_window_for_users(uuid[]);

-- Free at hour: jam-custom schedule if present, else profile.
create or replace function jam.user_free_at(
  p_user_id uuid,
  p_date date,
  p_hour integer,
  p_jam_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  select case
    when p_jam_id is not null
      and exists (
        select 1 from jam.jam_availability ja
        where ja.jam_id = p_jam_id and ja.user_id = p_user_id
      )
    then (
      select case o.mode
        when 'off' then false
        when 'full' then true
        else exists (
          select 1
          from jam.jam_availability_slots a
          where a.jam_id = p_jam_id
            and a.user_id = p_user_id
            and a.day_of_week = extract(isodow from p_date)::int - 1
            and a.hour = p_hour
        )
      end
      from (select 1) _
      left join jam.jam_availability_date_overrides o
        on o.jam_id = p_jam_id
       and o.user_id = p_user_id
       and o.on_date = p_date
    )
    else (
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
       and o.on_date = p_date
    )
  end;
$$;

revoke all on function jam.user_free_at(uuid, date, integer, uuid) from public, anon, authenticated;

drop function if exists jam.user_covers_window(uuid, timestamptz, timestamptz);

create function jam.user_covers_window(
  p_user_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_jam_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  with hours as (
    select
      (gs at time zone 'Europe/Kyiv')::date as on_date,
      extract(isodow from (gs at time zone 'Europe/Kyiv'))::int - 1 as dow,
      extract(hour from (gs at time zone 'Europe/Kyiv'))::int as hr
    from generate_series(
      date_trunc('hour', p_start),
      p_end - interval '1 second',
      interval '1 hour'
    ) as gs
  )
  select coalesce(
    (
      select bool_and(jam.user_free_at(p_user_id, h.on_date, h.hr, p_jam_id))
      from hours h
    ),
    false
  );
$$;

revoke all on function jam.user_covers_window(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;

-- Overlap grid uses jam-custom weekly slots when present.
create or replace function jam.get_jam_schedule_overlap(p_jam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_participants uuid[];
  v_count integer;
  v_people jsonb;
  v_cells jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not jam.is_jam_participant(p_jam_id, v_uid) then
    raise exception 'not a participant';
  end if;

  select coalesce(array_agg(distinct uid), '{}')
  into v_participants
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

  v_count := coalesce(cardinality(v_participants), 0);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', p.id,
      'display_name', p.display_name,
      'slot_count', coalesce(sc.n, 0),
      'customized', coalesce(sc.customized, false)
    )
    order by p.display_name
  ), '[]'::jsonb)
  into v_people
  from jam.profiles p
  left join lateral (
    select
      case
        when exists (
          select 1 from jam.jam_availability ja
          where ja.jam_id = p_jam_id and ja.user_id = p.id
        ) then (
          select count(*)::integer
          from jam.jam_availability_slots a
          where a.jam_id = p_jam_id and a.user_id = p.id
        )
        else (
          select count(*)::integer
          from jam.availability_slots a
          where a.user_id = p.id
        )
      end as n,
      exists (
        select 1 from jam.jam_availability ja
        where ja.jam_id = p_jam_id and ja.user_id = p.id
      ) as customized
  ) sc on true
  where p.id = any (v_participants);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day_of_week', x.day_of_week,
      'hour', x.hour,
      'count', x.n,
      'user_ids', to_jsonb(x.uids)
    )
    order by x.day_of_week, x.hour
  ), '[]'::jsonb)
  into v_cells
  from (
    select
      e.day_of_week,
      e.hour,
      count(distinct e.user_id)::integer as n,
      array_agg(distinct e.user_id order by e.user_id) as uids
    from (
      select a.day_of_week, a.hour, a.user_id
      from jam.jam_availability_slots a
      where a.jam_id = p_jam_id
        and a.user_id = any (v_participants)
        and exists (
          select 1 from jam.jam_availability ja
          where ja.jam_id = a.jam_id and ja.user_id = a.user_id
        )
      union all
      select a.day_of_week, a.hour, a.user_id
      from jam.availability_slots a
      where a.user_id = any (v_participants)
        and not exists (
          select 1 from jam.jam_availability ja
          where ja.jam_id = p_jam_id and ja.user_id = a.user_id
        )
    ) e
    group by e.day_of_week, e.hour
  ) x;

  return jsonb_build_object(
    'participant_count', v_count,
    'participants', v_people,
    'cells', v_cells
  );
end;
$$;

-- Suggest window uses jam-aware free_at.
create or replace function jam.suggest_window_for_users(
  p_user_ids uuid[],
  p_jam_id uuid default null
)
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
  v_today date;
  v_first_hour integer;
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
  v_kyiv_now timestamp;
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
  v_kyiv_now := timezone('Europe/Kyiv', now());
  v_today := v_kyiv_now::date;
  v_day := v_today;
  v_last := v_day + 27;

  while v_day <= v_last loop
    if v_day = v_today then
      v_first_hour := extract(hour from v_kyiv_now)::integer + 1;
    else
      v_first_hour := 0;
    end if;

    if v_first_hour <= 23 then
      for v_start in v_first_hour..23 loop
        v_common := v_uids;
        for v_h in v_start..23 loop
          select coalesce(array_agg(u order by u), '{}')
          into v_slot
          from unnest(v_uids) as u
          where jam.user_free_at(u, v_day, v_h, p_jam_id);

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
    end if;
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

revoke all on function jam.suggest_window_for_users(uuid[], uuid)
  from public, anon, authenticated;

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
  from jam.suggest_window_for_users(v_uids, p_jam_id)
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

-- Browse: covers_my_availability respects jam-custom schedule.
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
  has_friend_participant boolean,
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
        jam.user_covers_window(v_uid, j.window_start, j.window_end, j.id)
      when sug.window_start is not null and sug.window_end is not null then
        jam.user_covers_window(v_uid, sug.window_start, sug.window_end, j.id)
      else false
    end as covers_my_availability,
    jam.are_friends(v_uid, j.creator_id) as is_friend_creator,
    jam.jam_has_friend_participant(j.id, v_uid) as has_friend_participant,
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
      or jam.jam_has_friend_participant(j.id, v_uid)
    )
  order by
    coalesce(j.window_start, sug.window_start) nulls last,
    j.created_at desc;
end;
$$;

revoke all on function jam.list_browse_jams() from public, anon;
grant execute on function jam.list_browse_jams() to authenticated;
