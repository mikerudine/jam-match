-- P2: cancel jam, complete undated confirmed, fairer reliability on feedback.

create or replace function jam.cancel_jam(p_jam_id uuid)
returns void
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_jam jam.jam_requests%rowtype;
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
    raise exception 'only the initiator can cancel';
  end if;
  if v_jam.status not in ('matching', 'confirmed') then
    raise exception 'jam cannot be cancelled';
  end if;

  update jam.jam_requests
  set status = 'cancelled', updated_at = now()
  where id = p_jam_id;

  update jam.jam_invites
  set status = 'expired'
  where jam_id = p_jam_id and status = 'pending';

  update jam.jam_join_requests
  set status = 'declined', responded_at = now()
  where jam_id = p_jam_id and status = 'pending';

  update jam.jam_seats
  set status = 'open'
  where jam_id = p_jam_id
    and status = 'invited'
    and filled_by is null;
end;
$$;

create or replace function jam.complete_jam(p_jam_id uuid)
returns void
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_jam jam.jam_requests%rowtype;
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
    raise exception 'only the initiator can complete';
  end if;
  if v_jam.status <> 'confirmed' then
    raise exception 'only confirmed jams can be completed';
  end if;
  -- Dated jams: allow complete after window ended; undated: anytime once confirmed.
  if v_jam.window_end is not null and v_jam.window_end >= now() then
    raise exception 'jam window has not ended yet';
  end if;

  update jam.jam_requests
  set status = 'completed', updated_at = now()
  where id = p_jam_id;
end;
$$;

create or replace function jam.submit_jam_feedback(
  p_jam_id uuid,
  p_rating integer,
  p_everyone_showed_up boolean
)
returns void
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_delta double precision;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating out of range';
  end if;
  if not exists (
    select 1 from jam.jam_seats
    where jam_id = p_jam_id and filled_by = v_uid
  ) then
    raise exception 'not a jam member';
  end if;

  insert into jam.jam_feedback (jam_id, from_user_id, rating, everyone_showed_up)
  values (p_jam_id, v_uid, p_rating, p_everyone_showed_up);

  v_delta := case when p_everyone_showed_up then 0.05 else -0.15 end
           + ((p_rating - 3)::double precision * 0.02);

  -- Include the author: peers-only updates let organizers game reliability.
  for v_member in
    select filled_by from jam.jam_seats
    where jam_id = p_jam_id and filled_by is not null
  loop
    update jam.profiles
    set
      reliability_score = greatest(0, least(1,
        (reliability_score * reliability_count + (0.7 + v_delta))
        / (reliability_count + 1)
      )),
      reliability_count = reliability_count + 1,
      updated_at = now()
    where id = v_member;
  end loop;

  update jam.jam_requests
  set status = 'completed'
  where id = p_jam_id
    and status = 'confirmed'
    and (window_end is null or window_end < now());
end;
$$;

revoke all on function jam.cancel_jam(uuid) from public, anon;
grant execute on function jam.cancel_jam(uuid) to authenticated;

revoke all on function jam.complete_jam(uuid) from public, anon;
grant execute on function jam.complete_jam(uuid) to authenticated;

revoke all on function jam.submit_jam_feedback(uuid, integer, boolean) from public, anon;
grant execute on function jam.submit_jam_feedback(uuid, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
