-- Telegram join-request notify support (schema jam only).
-- - telegram_write_access flag on profiles (bot can message the user)
-- - jam.respond_to_join_request_as: service_role-only actor variant for webhook
-- - jam.set_telegram_write_access: authenticated helper to store write grant
-- Do not apply to live DBs from CI / agents.

-- ---------------------------------------------------------------------------
-- Optional flag: user allowed the bot to message them (Login Widget write /
-- Mini App requestWriteAccess). Best-effort; Telegram may still refuse send.
-- ---------------------------------------------------------------------------
alter table jam.profiles
  add column if not exists telegram_write_access boolean not null default false;

comment on column jam.profiles.telegram_write_access is
  'True when the user granted Telegram bot write access (widget / Mini App).';

create or replace function jam.set_telegram_write_access(p_granted boolean)
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

  update jam.profiles
  set
    telegram_write_access = coalesce(p_granted, false),
    updated_at = now()
  where id = v_uid;

  if not found then
    raise exception 'profile not found';
  end if;
end;
$$;

revoke all on function jam.set_telegram_write_access(boolean) from public, anon;
grant execute on function jam.set_telegram_write_access(boolean) to authenticated;

comment on function jam.set_telegram_write_access is
  'Store whether the current user granted Telegram bot write access.';

-- ---------------------------------------------------------------------------
-- Service-role actor variant of respond_to_join_request (Telegram callbacks).
-- Same accept/decline rules; actor is passed explicitly (no auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function jam.respond_to_join_request_as(
  p_actor uuid,
  p_request_id uuid,
  p_accept boolean
) returns void
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

  perform jam.maybe_confirm_jam(v_req.jam_id);
end;
$$;

revoke all on function jam.respond_to_join_request_as(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function jam.respond_to_join_request_as(uuid, uuid, boolean)
  to service_role;

comment on function jam.respond_to_join_request_as is
  'Service-role only: accept/decline a join request as a given initiator profile.';

-- Keep the authenticated RPC thin: same logic via actor = auth.uid().
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
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  perform jam.respond_to_join_request_as(v_uid, p_request_id, p_accept);
end;
$$;

revoke all on function jam.respond_to_join_request(uuid, boolean) from public, anon;
grant execute on function jam.respond_to_join_request(uuid, boolean) to authenticated;

comment on function jam.respond_to_join_request is
  'Initiator accepts (adds filled seat; confirmed stays confirmed) or declines.';
