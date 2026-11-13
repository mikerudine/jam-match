-- Public jam preview + join requests for confirmed (non-past) jams.
-- Schema jam only. Do not apply to live DBs from CI.
-- Replaces broad open_matching table SELECT with get_public_jam RPC so
-- non-participants never see base_name / contacts / member profiles.

-- ---------------------------------------------------------------------------
-- Drop open-matching table policies (leaked base_name / full seat rows)
-- ---------------------------------------------------------------------------
drop policy if exists jam_requests_select_open_matching on jam.jam_requests;
drop policy if exists jam_seats_select_open_matching on jam.jam_seats;

-- ---------------------------------------------------------------------------
-- Safe public preview for matching | confirmed, not past
-- ---------------------------------------------------------------------------
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

  if v_jam.status not in ('matching', 'confirmed') or v_jam.window_end < now() then
    return null;
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
    'initiator_display_name', coalesce(v_initiator, ''),
    'seats', v_seats,
    'filled_count', coalesce(v_filled, 0),
    'open_count', coalesce(v_open, 0)
  );
end;
$$;

revoke all on function jam.get_public_jam(uuid) from public, anon;
grant execute on function jam.get_public_jam(uuid) to authenticated;

comment on function jam.get_public_jam is
  'Safe preview of matching/confirmed non-past jam: no base_name, contacts, or member ids.';

-- ---------------------------------------------------------------------------
-- request_to_join / respond_to_join_request: allow confirmed (not past)
-- ---------------------------------------------------------------------------
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
  if v_jam.status not in ('matching', 'confirmed') or v_jam.window_end < now() then
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
  if v_jam.status not in ('matching', 'confirmed') or v_jam.window_end < now() then
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

  -- Only promotes matching → confirmed; confirmed jams stay confirmed.
  perform jam.maybe_confirm_jam(v_req.jam_id);
end;
$$;

revoke all on function jam.request_to_join(uuid, text, text) from public, anon;
revoke all on function jam.respond_to_join_request(uuid, boolean) from public, anon;

grant execute on function jam.request_to_join(uuid, text, text) to authenticated;
grant execute on function jam.respond_to_join_request(uuid, boolean) to authenticated;

comment on function jam.request_to_join is
  'Ask to join a matching or confirmed non-past jam with any role.';
comment on function jam.respond_to_join_request is
  'Initiator accepts (adds filled seat; confirmed stays confirmed) or declines.';
