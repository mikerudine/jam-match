-- Allow jam initiator to edit a matching jam request (schema jam only).
-- SECURITY DEFINER RPC; EXECUTE revoked from public/anon, granted to authenticated.
-- Does not apply triggers on auth.users. Do not run against live DBs from CI.

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
  p_add_roles jam.instrument[]
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
  v_open_count integer;
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
  if v_jam.window_end < now() then
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

  v_keep := coalesce(p_keep_seat_ids, '{}');
  v_add := coalesce(p_add_roles, '{}');

  -- Creator seat must be kept; filled seats cannot be removed.
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

  -- Every kept id must belong to this jam.
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

  update jam.jam_requests
  set
    format = p_format,
    genres = coalesce(p_genres, '{}'),
    area = p_area,
    base_name = nullif(trim(p_base_name), ''),
    window_start = p_window_start,
    window_end = p_window_end,
    invite_ttl_hours = coalesce(p_invite_ttl_hours, invite_ttl_hours)
  where id = p_jam_id;

  update jam.jam_seats
  set role = p_creator_role
  where jam_id = p_jam_id and is_creator;

  -- Cancel pending invites on seats being removed, then delete those seats.
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

  -- If time / area / genres changed, expire pending invites that no longer fit.
  if v_schedule_changed or v_area_changed or v_genres_changed then
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
          cardinality(c.preferred_areas) > 0
          and not (j.area = any (c.preferred_areas))
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
  uuid,
  jam.jam_format,
  text[],
  text,
  text,
  timestamptz,
  timestamptz,
  integer,
  jam.instrument,
  uuid[],
  jam.instrument[]
) from public, anon;

grant execute on function jam.update_jam_request(
  uuid,
  jam.jam_format,
  text[],
  text,
  text,
  timestamptz,
  timestamptz,
  integer,
  jam.instrument,
  uuid[],
  jam.instrument[]
) to authenticated;

comment on function jam.update_jam_request is
  'Initiator-only edit of a matching jam: fields, seats; rematch open seats.';

-- ---------------------------------------------------------------------------
-- Open join requests: any authenticated musician can ask to join an open jam
-- with a freeform role (e.g. maracas). Seat enum stays; custom roles use
-- role_label + instrument 'other'.
-- ---------------------------------------------------------------------------

create type jam.join_request_status as enum (
  'pending', 'accepted', 'declined'
);

alter table jam.jam_seats
  add column if not exists role_label text;

comment on column jam.jam_seats.role_label is
  'Optional freeform instrument label when role = other (e.g. maracas)';

create table jam.jam_join_requests (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references jam.jam_requests (id) on delete cascade,
  requester_id uuid not null references jam.profiles (id) on delete cascade,
  role text not null
    check (char_length(trim(role)) between 1 and 64),
  note text
    check (note is null or char_length(note) <= 500),
  status jam.join_request_status not null default 'pending',
  seat_id uuid references jam.jam_seats (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index jam_join_requests_one_pending
  on jam.jam_join_requests (jam_id, requester_id)
  where status = 'pending';

create index jam_join_requests_jam_idx
  on jam.jam_join_requests (jam_id, status);

create index jam_join_requests_requester_idx
  on jam.jam_join_requests (requester_id, status);

alter table jam.jam_join_requests enable row level security;

-- Open matching jams are visible to any logged-in musician (for join requests /
-- shared links). Participant policy still applies for confirmed etc.
create policy jam_requests_select_open_matching
  on jam.jam_requests for select
  to authenticated
  using (status = 'matching' and window_end > now());

create policy jam_seats_select_open_matching
  on jam.jam_seats for select
  to authenticated
  using (
    exists (
      select 1 from jam.jam_requests j
      where j.id = jam_id
        and j.status = 'matching'
        and j.window_end > now()
    )
  );

create policy jam_join_requests_select_own
  on jam.jam_join_requests for select
  to authenticated
  using (requester_id = auth.uid());

create policy jam_join_requests_select_initiator
  on jam.jam_join_requests for select
  to authenticated
  using (
    exists (
      select 1 from jam.jam_requests j
      where j.id = jam_id and j.creator_id = auth.uid()
    )
  );

create or replace function jam.coerce_instrument(p_role text)
returns jam.instrument
language sql
immutable
as $$
  select case lower(trim(coalesce(p_role, '')))
    when 'drums' then 'drums'::jam.instrument
    when 'bass' then 'bass'::jam.instrument
    when 'guitar' then 'guitar'::jam.instrument
    when 'keys' then 'keys'::jam.instrument
    when 'vocals' then 'vocals'::jam.instrument
    when 'other' then 'other'::jam.instrument
    else 'other'::jam.instrument
  end;
$$;

revoke all on function jam.coerce_instrument(text) from public, anon, authenticated;

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
  if v_jam.status <> 'matching' or v_jam.window_end < now() then
    raise exception 'jam is not open for join requests';
  end if;
  if v_jam.creator_id = v_uid then
    raise exception 'initiator cannot request to join own jam';
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

create or replace function jam.respond_to_join_request(
  p_request_id uuid,
  p_accept boolean
) returns void
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_req jam.jam_join_requests%rowtype;
  v_jam jam.jam_requests%rowtype;
  v_role jam.instrument;
  v_label text;
  v_order integer;
  v_seat_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_req
  from jam.jam_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'join request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'join request already resolved';
  end if;

  select * into v_jam
  from jam.jam_requests
  where id = v_req.jam_id
  for update;

  if not found then
    raise exception 'jam not found';
  end if;
  if v_jam.creator_id <> v_uid then
    raise exception 'only the initiator can respond';
  end if;
  if v_jam.status <> 'matching' or v_jam.window_end < now() then
    raise exception 'jam is not open for join requests';
  end if;

  if not p_accept then
    update jam.jam_join_requests
    set status = 'declined', responded_at = now()
    where id = p_request_id;
    return;
  end if;

  if exists (
    select 1 from jam.jam_seats
    where jam_id = v_req.jam_id and filled_by = v_req.requester_id
  ) then
    raise exception 'requester already in this jam';
  end if;

  v_role := jam.coerce_instrument(v_req.role);
  if v_role = 'other' and lower(trim(v_req.role)) <> 'other' then
    v_label := trim(v_req.role);
  else
    v_label := null;
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_order
  from jam.jam_seats
  where jam_id = v_req.jam_id;

  insert into jam.jam_seats (
    jam_id, role, role_label, filled_by, is_creator, status, sort_order
  ) values (
    v_req.jam_id, v_role, v_label, v_req.requester_id, false, 'filled', v_order
  )
  returning id into v_seat_id;

  -- Drop any pending invites to this person on this jam.
  update jam.jam_invites
  set status = 'expired'
  where jam_id = v_req.jam_id
    and invitee_id = v_req.requester_id
    and status = 'pending';

  update jam.jam_seats s
  set status = 'open'
  where s.jam_id = v_req.jam_id
    and s.status = 'invited'
    and s.filled_by is null
    and not exists (
      select 1 from jam.jam_invites i
      where i.seat_id = s.id and i.status = 'pending' and i.expires_at >= now()
    );

  update jam.jam_join_requests
  set status = 'accepted', seat_id = v_seat_id, responded_at = now()
  where id = p_request_id;

  perform jam.maybe_confirm_jam(v_req.jam_id);
end;
$$;

revoke all on function jam.request_to_join(uuid, text, text) from public, anon;
revoke all on function jam.respond_to_join_request(uuid, boolean) from public, anon;

grant execute on function jam.request_to_join(uuid, text, text) to authenticated;
grant execute on function jam.respond_to_join_request(uuid, boolean) to authenticated;

comment on function jam.request_to_join is
  'Authenticated musician asks to join an open matching jam with any role.';
comment on function jam.respond_to_join_request is
  'Initiator accepts (adds filled seat) or declines a join request.';
