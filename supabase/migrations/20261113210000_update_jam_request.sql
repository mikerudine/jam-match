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
