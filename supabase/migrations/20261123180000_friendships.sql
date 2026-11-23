-- Friendships via Telegram deep-link + jam audience open|friends.
-- Schema jam only. Friends-only jams: preview/match/join gated to creator's friends.

-- ---------------------------------------------------------------------------
-- Friendships
-- ---------------------------------------------------------------------------
create table jam.friendships (
  user_a uuid not null references jam.profiles (id) on delete cascade,
  user_b uuid not null references jam.profiles (id) on delete cascade,
  initiated_by uuid not null references jam.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_ordered check (user_a < user_b),
  constraint friendships_initiator_in_pair check (
    initiated_by = user_a or initiated_by = user_b
  )
);

create index friendships_user_a_idx on jam.friendships (user_a);
create index friendships_user_b_idx on jam.friendships (user_b);

grant select on jam.friendships to authenticated;
grant all on jam.friendships to service_role;

alter table jam.friendships enable row level security;

create policy friendships_select_own
  on jam.friendships for select
  to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- Mutations only via SECURITY DEFINER RPCs.
revoke insert, update, delete on jam.friendships from authenticated, anon, public;

create or replace function jam.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  select p_a is not null
    and p_b is not null
    and p_a <> p_b
    and exists (
      select 1
      from jam.friendships f
      where f.user_a = least(p_a, p_b)
        and f.user_b = greatest(p_a, p_b)
    );
$$;

revoke all on function jam.are_friends(uuid, uuid) from public, anon;
grant execute on function jam.are_friends(uuid, uuid) to authenticated;

create or replace function jam.accept_friend_invite(p_inviter_id uuid)
returns jam.friendships
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_row jam.friendships;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_inviter_id is null then
    raise exception 'inviter required';
  end if;
  if p_inviter_id = v_uid then
    raise exception 'cannot friend yourself';
  end if;
  if not exists (select 1 from jam.profiles where id = p_inviter_id) then
    raise exception 'inviter not found';
  end if;
  if not exists (select 1 from jam.profiles where id = v_uid) then
    raise exception 'complete your profile first';
  end if;

  v_a := least(v_uid, p_inviter_id);
  v_b := greatest(v_uid, p_inviter_id);

  insert into jam.friendships (user_a, user_b, initiated_by)
  values (v_a, v_b, p_inviter_id)
  on conflict (user_a, user_b) do update
    set initiated_by = jam.friendships.initiated_by
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function jam.accept_friend_invite(uuid) from public, anon;
grant execute on function jam.accept_friend_invite(uuid) to authenticated;

create or replace function jam.remove_friend(p_other_id uuid)
returns void
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_other_id is null or p_other_id = v_uid then
    raise exception 'invalid friend';
  end if;

  delete from jam.friendships
  where user_a = least(v_uid, p_other_id)
    and user_b = greatest(v_uid, p_other_id);
end;
$$;

revoke all on function jam.remove_friend(uuid) from public, anon;
grant execute on function jam.remove_friend(uuid) to authenticated;

create or replace function jam.list_friends()
returns setof jam.profiles
language sql
stable
security definer
set search_path = jam
as $$
  select p.*
  from jam.profiles p
  join jam.friendships f
    on p.id = case
      when f.user_a = auth.uid() then f.user_b
      when f.user_b = auth.uid() then f.user_a
    end
  where auth.uid() is not null
  order by lower(p.display_name), p.created_at;
$$;

revoke all on function jam.list_friends() from public, anon;
grant execute on function jam.list_friends() to authenticated;

-- ---------------------------------------------------------------------------
-- Jam audience
-- ---------------------------------------------------------------------------
alter table jam.jam_requests
  add column if not exists audience text not null default 'open';

alter table jam.jam_requests
  drop constraint if exists jam_requests_audience_check;

alter table jam.jam_requests
  add constraint jam_requests_audience_check
  check (audience in ('open', 'friends'));

comment on column jam.jam_requests.audience is
  'open = anyone; friends = creator friends only (preview/match/join)';

-- create_jam_request: add p_audience (keep prior args + theme).
drop function if exists jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer,
  jam.instrument, jam.instrument[], text
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
  if v_audience not in ('open', 'friends') then
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

revoke execute on function jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer,
  jam.instrument, jam.instrument[], text, text
) from public, anon;
grant execute on function jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer,
  jam.instrument, jam.instrument[], text, text
) to authenticated;

-- update_jam_request: add p_audience
drop function if exists jam.update_jam_request(
  uuid, jam.jam_format, text[], text, text, timestamptz, timestamptz,
  integer, jam.instrument, uuid[], jam.instrument[]
);

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
  if p_window_end <= p_window_start then
    raise exception 'invalid time window';
  end if;
  if p_window_end < now() then
    raise exception 'jam is in the past';
  end if;
  if coalesce(p_invite_ttl_hours, v_jam.invite_ttl_hours) < 1
     or coalesce(p_invite_ttl_hours, v_jam.invite_ttl_hours) > 48 then
    raise exception 'invite ttl out of range';
  end if;

  v_audience := coalesce(nullif(trim(p_audience), ''), v_jam.audience, 'open');
  if v_audience not in ('open', 'friends') then
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
        not jam.user_covers_window(c.id, j.window_start, j.window_end)
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

revoke all on function jam.update_jam_request(
  uuid, jam.jam_format, text[], text, text, timestamptz, timestamptz,
  integer, jam.instrument, uuid[], jam.instrument[], text
) from public, anon;
grant execute on function jam.update_jam_request(
  uuid, jam.jam_format, text[], text, text, timestamptz, timestamptz,
  integer, jam.instrument, uuid[], jam.instrument[], text
) to authenticated;

-- Matching: friends-only → only creator's friends
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

-- Public preview: friends-only denied with explicit reason for UI
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
    -- participants use getJamDetail; still allow preview shape if called
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
    'open_count', coalesce(v_open, 0)
  );
end;
$$;

revoke all on function jam.get_public_jam(uuid) from public, anon;
grant execute on function jam.get_public_jam(uuid) to authenticated;

create or replace function jam.request_to_join(
  p_jam_id uuid,
  p_role text,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_jam jam.jam_requests%rowtype;
  v_role text := trim(coalesce(p_role, ''));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if char_length(v_role) < 1 or char_length(v_role) > 64 then
    raise exception 'invalid role';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note too long';
  end if;

  select * into v_jam
  from jam.jam_requests
  where id = p_jam_id
  for update;

  if not found then
    raise exception 'jam not found';
  end if;
  if v_jam.status not in ('matching', 'confirmed') then
    raise exception 'jam is not open for join requests';
  end if;
  if v_jam.window_end is not null and v_jam.window_end < now() then
    raise exception 'jam is not open for join requests';
  end if;
  if v_jam.creator_id = v_uid then
    raise exception 'initiator cannot request to join own jam';
  end if;
  if coalesce(v_jam.audience, 'open') = 'friends'
     and not jam.are_friends(v_uid, v_jam.creator_id) then
    raise exception 'friends only';
  end if;
  if exists (
    select 1 from jam.jam_seats
    where jam_id = p_jam_id and filled_by = v_uid
  ) then
    raise exception 'already in this jam';
  end if;
  if exists (
    select 1 from jam.jam_join_requests
    where jam_id = p_jam_id and requester_id = v_uid and status = 'pending'
  ) then
    raise exception 'join request already pending';
  end if;
  if not exists (
    select 1 from jam.profiles
    where id = v_uid and display_name <> ''
  ) then
    raise exception 'complete your profile first';
  end if;

  insert into jam.jam_join_requests (jam_id, requester_id, role, note)
  values (p_jam_id, v_uid, v_role, v_note)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function jam.request_to_join(uuid, text, text) from public, anon;
grant execute on function jam.request_to_join(uuid, text, text) to authenticated;
