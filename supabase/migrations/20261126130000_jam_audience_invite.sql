-- Third jam audience: invite (link-only).
-- Friends stay as Telegram fr_ deep-link circle.
--
-- open    — public feed + join + auto-matching
-- friends — feed/join/match only for creator's friends
-- invite  — not in feed; preview/join via jam link; no auto-matching

alter table jam.jam_requests
  drop constraint if exists jam_requests_audience_check;

alter table jam.jam_requests
  add constraint jam_requests_audience_check
  check (audience in ('open', 'friends', 'invite'));

comment on column jam.jam_requests.audience is
  'open = public; friends = creator friends (fr_ link); invite = link-only, no feed, no auto-match';

-- ---------------------------------------------------------------------------
-- create / update: accept invite
-- ---------------------------------------------------------------------------
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
  p_theme text default null,
  p_audience text default 'open'
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
  v_audience text := coalesce(nullif(trim(p_audience), ''), 'open');
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
  if v_audience not in ('open', 'friends', 'invite') then
    raise exception 'invalid audience';
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
    window_start, window_end, invite_ttl_hours, theme, audience
  ) values (
    v_uid,
    p_format,
    coalesce(p_genres, '{}'),
    nullif(trim(coalesce(p_area, '')), ''),
    p_base_name,
    p_window_start,
    p_window_end,
    coalesce(p_invite_ttl_hours, 3),
    v_theme,
    v_audience
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

create or replace function jam.update_jam_request(
  p_jam_id uuid,
  p_format jam.jam_format,
  p_genres text[],
  p_area text,
  p_base_name text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_invite_ttl_hours integer,
  p_creator_role jam.instrument,
  p_keep_seat_ids uuid[],
  p_add_roles jam.instrument[],
  p_audience text default null
) returns void
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_jam jam.jam_requests%rowtype;
  v_seat jam.jam_seats%rowtype;
  v_keep uuid[];
  v_add jam.instrument[];
  v_role jam.instrument;
  v_order integer;
  v_schedule_changed boolean;
  v_area_changed boolean;
  v_genres_changed boolean;
  v_audience_changed boolean;
  v_open_count integer;
  v_audience text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_jam
  from jam.jam_requests
  where id = p_jam_id
  for update;

  if not found then
    raise exception 'jam not found';
  end if;
  if v_jam.creator_id <> v_uid then
    raise exception 'only the initiator can edit this jam';
  end if;
  if v_jam.status <> 'matching' then
    raise exception 'jam can only be edited while matching';
  end if;
  if v_jam.window_end is not null and v_jam.window_end < now() then
    raise exception 'jam is in the past';
  end if;
  if (p_window_start is null) <> (p_window_end is null) then
    raise exception 'invalid time window';
  end if;
  if p_window_start is not null and p_window_end is not null then
    if p_window_end <= p_window_start then
      raise exception 'invalid time window';
    end if;
    if p_window_end < now() then
      raise exception 'jam is in the past';
    end if;
  end if;
  if coalesce(p_invite_ttl_hours, v_jam.invite_ttl_hours) < 1
     or coalesce(p_invite_ttl_hours, v_jam.invite_ttl_hours) > 48 then
    raise exception 'invite ttl out of range';
  end if;

  v_audience := coalesce(nullif(trim(p_audience), ''), v_jam.audience, 'open');
  if v_audience not in ('open', 'friends', 'invite') then
    raise exception 'invalid audience';
  end if;

  v_keep := coalesce(p_keep_seat_ids, '{}');
  v_add := coalesce(p_add_roles, '{}');

  if not exists (
    select 1 from jam.jam_seats s
    where s.jam_id = p_jam_id and s.is_creator and s.id = any (v_keep)
  ) then
    raise exception 'creator seat cannot be removed';
  end if;

  if exists (
    select 1 from jam.jam_seats s
    where s.jam_id = p_jam_id
      and s.status = 'filled'
      and not s.is_creator
      and not (s.id = any (v_keep))
  ) then
    raise exception 'cannot remove a seat with an accepted participant';
  end if;

  if exists (
    select 1
    from unnest(v_keep) as kid(id)
    where not exists (
      select 1 from jam.jam_seats s
      where s.id = kid.id and s.jam_id = p_jam_id
    )
  ) then
    raise exception 'invalid seat id';
  end if;

  v_schedule_changed :=
    v_jam.window_start is distinct from p_window_start
    or v_jam.window_end is distinct from p_window_end;
  v_area_changed := v_jam.area is distinct from p_area;
  v_genres_changed := v_jam.genres is distinct from coalesce(p_genres, '{}');
  v_audience_changed := v_jam.audience is distinct from v_audience;

  update jam.jam_requests
  set
    format = p_format,
    genres = coalesce(p_genres, '{}'),
    area = p_area,
    base_name = nullif(trim(p_base_name), ''),
    window_start = p_window_start,
    window_end = p_window_end,
    invite_ttl_hours = coalesce(p_invite_ttl_hours, invite_ttl_hours),
    audience = v_audience
  where id = p_jam_id;

  update jam.jam_seats
  set role = p_creator_role
  where jam_id = p_jam_id and is_creator;

  for v_seat in
    select * from jam.jam_seats
    where jam_id = p_jam_id
      and not is_creator
      and not (id = any (v_keep))
  loop
    if v_seat.status = 'filled' or v_seat.filled_by is not null then
      raise exception 'cannot remove a seat with an accepted participant';
    end if;

    update jam.jam_invites
    set status = 'expired'
    where seat_id = v_seat.id and status = 'pending';

    delete from jam.jam_seats where id = v_seat.id;
  end loop;

  select coalesce(max(sort_order), 0) into v_order
  from jam.jam_seats
  where jam_id = p_jam_id;

  foreach v_role in array v_add loop
    v_order := v_order + 1;
    insert into jam.jam_seats (jam_id, role, status, sort_order)
    values (p_jam_id, v_role, 'open', v_order);
  end loop;

  select count(*) into v_open_count
  from jam.jam_seats
  where jam_id = p_jam_id and not is_creator;

  if v_open_count < 1 then
    raise exception 'need at least one open seat';
  end if;

  if v_schedule_changed or v_area_changed or v_genres_changed or v_audience_changed then
    update jam.jam_invites i
    set status = 'expired'
    from jam.profiles c, jam.jam_requests j
    where i.jam_id = p_jam_id
      and i.status = 'pending'
      and j.id = i.jam_id
      and c.id = i.invitee_id
      and (
        j.audience = 'invite'
        or (
          j.window_start is not null
          and j.window_end is not null
          and not jam.user_covers_window(c.id, j.window_start, j.window_end, j.id)
        )
        or (
          cardinality(j.genres) > 0
          and not (c.genres && j.genres)
        )
        or (
          j.area is not null
          and j.area <> ''
          and cardinality(c.preferred_areas) > 0
          and not (j.area = any (c.preferred_areas))
        )
        or (
          j.audience = 'friends'
          and not jam.are_friends(c.id, j.creator_id)
        )
      );

    update jam.jam_seats s
    set status = 'open'
    where s.jam_id = p_jam_id
      and s.status = 'invited'
      and s.filled_by is null
      and not exists (
        select 1 from jam.jam_invites i
        where i.seat_id = s.id and i.status = 'pending' and i.expires_at >= now()
      );
  end if;

  perform jam.process_jam_matching(p_jam_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- No auto-matching for invite jams
-- ---------------------------------------------------------------------------
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
  -- Link-only jams: seats fill via join requests, not inbox auto-invites.
  if coalesce(v_jam.audience, 'open') = 'invite' then
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
    and jam.user_covers_window(c.id, v_jam.window_start, v_jam.window_end, v_jam.id)
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
    and (
      coalesce(v_jam.audience, 'open') <> 'friends'
      or jam.are_friends(c.id, v_jam.creator_id)
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

-- ---------------------------------------------------------------------------
-- Browse: invite jams only for participants
-- ---------------------------------------------------------------------------
create or replace function jam.list_browse_jams()
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
      else false
    end as covers_my_availability,
    jam.are_friends(v_uid, j.creator_id) as is_friend_creator,
    jam.jam_has_friend_participant(j.id, v_uid) as has_friend_participant,
    jam.is_jam_participant(j.id, v_uid) as i_am_participant,
    null::timestamptz as suggested_window_start,
    null::timestamptz as suggested_window_end,
    null::integer as suggested_match_count,
    null::integer as suggested_participant_count,
    null::text[] as suggested_matched_names
  from jam.jam_requests j
  join jam.profiles p on p.id = j.creator_id
  where j.status in ('matching', 'confirmed')
    and (j.window_end is null or j.window_end > now())
    and (
      jam.is_jam_participant(j.id, v_uid)
      or coalesce(j.audience, 'open') = 'open'
      or (
        coalesce(j.audience, 'open') = 'friends'
        and (
          jam.are_friends(v_uid, j.creator_id)
          or jam.jam_has_friend_participant(j.id, v_uid)
        )
      )
    )
  order by
    j.window_start nulls last,
    j.created_at desc;
end;
$$;

revoke all on function jam.list_browse_jams() from public, anon;
grant execute on function jam.list_browse_jams() to authenticated;

-- ---------------------------------------------------------------------------
-- Suggest visibility: open + invite (link) + friends circle + participants
-- ---------------------------------------------------------------------------
create or replace function jam.can_view_jam_suggest(p_jam_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  select
    jam.is_jam_participant(p_jam_id, p_uid)
    or exists (
      select 1
      from jam.jam_requests j
      where j.id = p_jam_id
        and j.status in ('matching', 'confirmed')
        and (j.window_end is null or j.window_end > now())
        and (
          coalesce(j.audience, 'open') in ('open', 'invite')
          or (
            coalesce(j.audience, 'open') = 'friends'
            and (
              jam.are_friends(p_uid, j.creator_id)
              or jam.jam_has_friend_participant(j.id, p_uid)
            )
          )
        )
    );
$$;

notify pgrst, 'reload schema';
