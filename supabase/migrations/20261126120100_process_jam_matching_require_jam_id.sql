-- P0: forbid global process_jam_matching(null) from clients (DoS / DB load).
-- Scoped runs require jam_id + caller is participant (creator included).

create or replace function jam.process_jam_matching(p_jam_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_seat record;
  v_offered integer := 0;
  v_id uuid;
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
      v_offered := v_offered + 1;
    end if;
    perform jam.maybe_confirm_jam(v_seat.jam_id);
  end loop;

  return v_offered;
end;
$$;

revoke all on function jam.process_jam_matching(uuid) from public, anon;
grant execute on function jam.process_jam_matching(uuid) to authenticated;

notify pgrst, 'reload schema';
