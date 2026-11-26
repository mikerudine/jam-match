-- P1: accept join fills matching open/invited seat; at most one accepted per (user, jam).

create unique index if not exists jam_join_requests_one_accepted
  on jam.jam_join_requests (jam_id, requester_id)
  where status = 'accepted';

create unique index if not exists jam_seats_one_filled_user
  on jam.jam_seats (jam_id, filled_by)
  where filled_by is not null;

create or replace function jam.respond_to_join_request_as(
  p_actor uuid,
  p_request_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_req jam.jam_join_requests%rowtype;
  v_jam jam.jam_requests%rowtype;
  v_role jam.instrument;
  v_label text;
  v_order integer;
  v_seat_id uuid;
begin
  if p_actor is null then
    raise exception 'actor required';
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
  if v_jam.creator_id <> p_actor then
    raise exception 'only the initiator can respond';
  end if;
  if v_jam.status not in ('matching', 'confirmed') then
    raise exception 'jam is not open for join requests';
  end if;
  if v_jam.window_end is not null and v_jam.window_end < now() then
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

  if exists (
    select 1 from jam.jam_join_requests
    where jam_id = v_req.jam_id
      and requester_id = v_req.requester_id
      and status = 'accepted'
      and id <> p_request_id
  ) then
    raise exception 'requester already accepted for this jam';
  end if;

  v_role := jam.coerce_instrument(v_req.role);
  if v_role = 'other' and lower(trim(v_req.role)) <> 'other' then
    v_label := trim(v_req.role);
  else
    v_label := null;
  end if;

  -- Prefer an existing open (then invited) seat for this instrument.
  select s.id into v_seat_id
  from jam.jam_seats s
  where s.jam_id = v_req.jam_id
    and s.filled_by is null
    and not s.is_creator
    and s.role = v_role
    and s.status in ('open', 'invited')
  order by case s.status when 'open' then 0 else 1 end, s.sort_order, s.id
  for update skip locked
  limit 1;

  if v_seat_id is not null then
    update jam.jam_seats
    set
      status = 'filled',
      filled_by = v_req.requester_id,
      role_label = coalesce(v_label, role_label)
    where id = v_seat_id;

    update jam.jam_invites
    set status = 'expired'
    where seat_id = v_seat_id
      and status = 'pending';
  else
    select coalesce(max(sort_order), 0) + 1 into v_order
    from jam.jam_seats
    where jam_id = v_req.jam_id;

    insert into jam.jam_seats (
      jam_id, role, role_label, filled_by, is_creator, status, sort_order
    ) values (
      v_req.jam_id, v_role, v_label, v_req.requester_id, false, 'filled', v_order
    )
    returning id into v_seat_id;
  end if;

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

create or replace function jam.request_to_join(
  p_jam_id uuid,
  p_role text,
  p_note text default null
)
returns uuid
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
    where jam_id = p_jam_id and requester_id = v_uid and status = 'accepted'
  ) then
    raise exception 'already accepted for this jam';
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

revoke all on function jam.respond_to_join_request_as(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function jam.respond_to_join_request_as(uuid, uuid, boolean) to service_role;

revoke all on function jam.request_to_join(uuid, text, text) from public, anon;
grant execute on function jam.request_to_join(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
