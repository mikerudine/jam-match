-- P1: return new invite ids from matching / respond so the client can soft-call jam-notify.
-- Default invite TTL raised now that Telegram push exists (was short "because no push").

drop function if exists jam.process_jam_matching(uuid);

create function jam.process_jam_matching(p_jam_id uuid default null)
returns uuid[]
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_seat record;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_jam_id is null then
    raise exception 'jam_id required';
  end if;

  if not jam.is_jam_participant(p_jam_id, v_uid) then
    raise exception 'not a participant';
  end if;

  perform jam.expire_pending_invites(p_jam_id);

  for v_seat in
    select s.*
    from jam.jam_seats s
    join jam.jam_requests j on j.id = s.jam_id
    where j.id = p_jam_id
      and j.status = 'matching'
      and j.window_start is not null
      and j.window_end is not null
      and s.status in ('open', 'invited')
      and s.filled_by is null
      and not s.is_creator
      and not exists (
        select 1 from jam.jam_invites i
        where i.seat_id = s.id and i.status = 'pending' and i.expires_at >= now()
      )
    order by jam.role_scarcity(s.role) desc, s.sort_order
  loop
    v_id := jam.offer_next_for_seat(v_seat.id);
    if v_id is not null then
      v_ids := array_append(v_ids, v_id);
    end if;
    perform jam.maybe_confirm_jam(v_seat.jam_id);
  end loop;

  return v_ids;
end;
$$;

revoke all on function jam.process_jam_matching(uuid) from public, anon;
grant execute on function jam.process_jam_matching(uuid) to authenticated;

drop function if exists jam.respond_to_invite(uuid, boolean);

create function jam.respond_to_invite(p_invite_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_invite jam.jam_invites%rowtype;
  v_uid uuid := auth.uid();
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform jam.expire_pending_invites();

  select * into v_invite
  from jam.jam_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'invite not found';
  end if;
  if v_invite.invitee_id <> v_uid then
    raise exception 'not your invite';
  end if;

  -- Stale/expired: free the seat, cascade next candidate, return that invite id for notify.
  if v_invite.status <> 'pending' or v_invite.expires_at < now() then
    update jam.jam_invites set status = 'expired' where id = p_invite_id and status = 'pending';
    update jam.jam_seats set status = 'open'
      where id = v_invite.seat_id and status = 'invited';
    return jam.offer_next_for_seat(v_invite.seat_id);
  end if;

  if p_accept then
    update jam.jam_invites set status = 'accepted' where id = p_invite_id;
    update jam.jam_seats
    set status = 'filled', filled_by = v_uid
    where id = v_invite.seat_id and status <> 'filled';
    update jam.jam_invites
    set status = 'expired'
    where seat_id = v_invite.seat_id
      and id <> p_invite_id
      and status = 'pending';
    perform jam.maybe_confirm_jam(v_invite.jam_id);
    return null;
  end if;

  update jam.jam_invites set status = 'skipped' where id = p_invite_id;
  update jam.jam_seats set status = 'open'
    where id = v_invite.seat_id and status = 'invited';
  v_next := jam.offer_next_for_seat(v_invite.seat_id);
  return v_next;
end;
$$;

revoke all on function jam.respond_to_invite(uuid, boolean) from public, anon;
grant execute on function jam.respond_to_invite(uuid, boolean) to authenticated;

-- New jams default to 12h reply window (UI still overrides per jam).
alter table jam.jam_requests
  alter column invite_ttl_hours set default 12;

notify pgrst, 'reload schema';
