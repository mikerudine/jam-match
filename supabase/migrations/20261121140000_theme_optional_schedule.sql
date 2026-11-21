-- Theme-first jams: theme required for new creates; date window and open seats optional.
-- Idea jams stay open until a past window_end (or completed/cancelled).

alter table jam.jam_requests
  add column if not exists theme text;

alter table jam.jam_requests
  alter column area drop not null;

alter table jam.jam_requests
  alter column window_start drop not null;

alter table jam.jam_requests
  alter column window_end drop not null;

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'jam.jam_requests'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%window_end%window_start%'
  loop
    execute format('alter table jam.jam_requests drop constraint %I', r.conname);
  end loop;
end $$;

alter table jam.jam_requests
  add constraint jam_requests_window_check
  check (
    (window_start is null and window_end is null)
    or (
      window_start is not null
      and window_end is not null
      and window_end > window_start
    )
  );

alter table jam.jam_requests
  drop constraint if exists jam_requests_theme_len;

alter table jam.jam_requests
  add constraint jam_requests_theme_len
  check (theme is null or char_length(trim(theme)) between 2 and 200);

-- Backfill theme from format for existing rows (display fallback still works in UI).
update jam.jam_requests
set theme = coalesce(nullif(trim(theme), ''), format::text)
where theme is null or trim(theme) = '';

-- Recreate create_jam_request with optional schedule / lineup + theme.
drop function if exists jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer, jam.instrument, jam.instrument[]
);

create or replace function jam.create_jam_request(
  p_format jam.jam_format,
  p_genres text[],
  p_area text,
  p_base_name text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_invite_ttl_hours integer,
  p_creator_role jam.instrument,
  p_wanted_roles jam.instrument[],
  p_theme text default null
) returns uuid
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_jam_id uuid;
  v_role jam.instrument;
  v_order integer := 0;
  v_theme text := nullif(trim(coalesce(p_theme, '')), '');
  v_wanted jam.instrument[] := coalesce(p_wanted_roles, '{}');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from jam.profiles
    where id = v_uid and display_name <> '' and cardinality(instruments) > 0
  ) then
    raise exception 'complete your profile first';
  end if;
  if v_theme is null or char_length(v_theme) < 2 then
    raise exception 'theme required';
  end if;
  if char_length(v_theme) > 200 then
    raise exception 'theme too long';
  end if;

  if (p_window_start is null) <> (p_window_end is null) then
    raise exception 'invalid time window';
  end if;
  if p_window_start is not null and p_window_end is not null
     and p_window_end <= p_window_start then
    raise exception 'invalid time window';
  end if;

  insert into jam.jam_requests (
    creator_id, format, genres, area, base_name,
    window_start, window_end, invite_ttl_hours, theme
  ) values (
    v_uid,
    p_format,
    coalesce(p_genres, '{}'),
    nullif(trim(coalesce(p_area, '')), ''),
    p_base_name,
    p_window_start,
    p_window_end,
    coalesce(p_invite_ttl_hours, 3),
    v_theme
  )
  returning id into v_jam_id;

  insert into jam.jam_seats (jam_id, role, filled_by, is_creator, status, sort_order)
  values (v_jam_id, p_creator_role, v_uid, true, 'filled', v_order);

  foreach v_role in array v_wanted loop
    v_order := v_order + 1;
    insert into jam.jam_seats (jam_id, role, status, sort_order)
    values (v_jam_id, v_role, 'open', v_order);
  end loop;

  return v_jam_id;
end;
$$;

revoke execute on function jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer, jam.instrument, jam.instrument[], text
) from public, anon;
grant execute on function jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer, jam.instrument, jam.instrument[], text
) to authenticated;

-- Matching only for jams that already have a schedule.
create or replace function jam.offer_next_for_seat(p_seat_id uuid)
returns uuid
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_jam jam.jam_requests%rowtype;
  v_seat jam.jam_seats%rowtype;
  v_candidate uuid;
  v_invite_id uuid;
begin
  select * into v_seat from jam.jam_seats where id = p_seat_id for update;
  if not found then
    return null;
  end if;
  if v_seat.status = 'filled' or v_seat.is_creator then
    return null;
  end if;

  select * into v_jam from jam.jam_requests where id = v_seat.jam_id;
  if v_jam.status <> 'matching' then
    return null;
  end if;
  if v_jam.window_start is null or v_jam.window_end is null then
    return null;
  end if;

  if exists (
    select 1 from jam.jam_invites i
    where i.seat_id = p_seat_id and i.status = 'pending' and i.expires_at >= now()
  ) then
    return null;
  end if;

  select c.id into v_candidate
  from jam.profiles c
  where v_seat.role = any (c.instruments)
    and c.id <> v_jam.creator_id
    and c.id not in (
      select filled_by from jam.jam_seats
      where jam_id = v_jam.id and filled_by is not null
    )
    and not exists (
      select 1 from jam.jam_invites i
      where i.seat_id = p_seat_id
        and i.invitee_id = c.id
        and i.status in ('pending', 'accepted', 'skipped', 'expired')
    )
    and jam.user_covers_window(c.id, v_jam.window_start, v_jam.window_end)
    and (
      cardinality(v_jam.genres) = 0
      or c.genres && v_jam.genres
    )
    and (
      v_jam.area is null
      or v_jam.area = ''
      or cardinality(c.preferred_areas) = 0
      or v_jam.area = any (c.preferred_areas)
    )
  order by
    jam.role_scarcity(v_seat.role) desc,
    (
      select count(*) from unnest(c.genres) g where g = any (v_jam.genres)
    ) desc,
    c.reliability_score desc,
    c.created_at asc
  limit 1;

  if v_candidate is null then
    update jam.jam_seats set status = 'open' where id = p_seat_id;
    return null;
  end if;

  insert into jam.jam_invites (jam_id, seat_id, invitee_id, expires_at)
  values (
    v_jam.id,
    p_seat_id,
    v_candidate,
    now() + make_interval(hours => v_jam.invite_ttl_hours)
  )
  returning id into v_invite_id;

  update jam.jam_seats set status = 'invited' where id = p_seat_id;
  return v_invite_id;
end;
$$;

create or replace function jam.process_jam_matching(p_jam_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_seat record;
  v_offered integer := 0;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  perform jam.expire_pending_invites(p_jam_id);

  for v_seat in
    select s.*
    from jam.jam_seats s
    join jam.jam_requests j on j.id = s.jam_id
    where j.status = 'matching'
      and j.window_start is not null
      and j.window_end is not null
      and s.status in ('open', 'invited')
      and s.filled_by is null
      and not s.is_creator
      and (p_jam_id is null or s.jam_id = p_jam_id)
      and not exists (
        select 1 from jam.jam_invites i
        where i.seat_id = s.id and i.status = 'pending' and i.expires_at >= now()
      )
    order by jam.role_scarcity(s.role) desc, s.sort_order
  loop
    v_id := jam.offer_next_for_seat(v_seat.id);
    if v_id is not null then
      v_offered := v_offered + 1;
    end if;
    perform jam.maybe_confirm_jam(v_seat.jam_id);
  end loop;

  return v_offered;
end;
$$;
