-- Per-slot participant ids for multi-color hour grid.

create or replace function jam.get_jam_schedule_overlap(p_jam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_participants uuid[];
  v_count integer;
  v_people jsonb;
  v_cells jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not jam.is_jam_participant(p_jam_id, v_uid) then
    raise exception 'not a participant';
  end if;

  select coalesce(array_agg(distinct uid), '{}')
  into v_participants
  from (
    select j.creator_id as uid
    from jam.jam_requests j
    where j.id = p_jam_id
    union
    select s.filled_by
    from jam.jam_seats s
    where s.jam_id = p_jam_id
      and s.filled_by is not null
  ) u
  where uid is not null;

  v_count := coalesce(cardinality(v_participants), 0);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', p.id,
      'display_name', p.display_name,
      'slot_count', coalesce(sc.n, 0)
    )
    order by p.display_name
  ), '[]'::jsonb)
  into v_people
  from jam.profiles p
  left join lateral (
    select count(*)::integer as n
    from jam.availability_slots a
    where a.user_id = p.id
  ) sc on true
  where p.id = any (v_participants);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day_of_week', x.day_of_week,
      'hour', x.hour,
      'count', x.n,
      'user_ids', to_jsonb(x.uids)
    )
    order by x.day_of_week, x.hour
  ), '[]'::jsonb)
  into v_cells
  from (
    select
      a.day_of_week,
      a.hour,
      count(distinct a.user_id)::integer as n,
      array_agg(distinct a.user_id order by a.user_id) as uids
    from jam.availability_slots a
    where a.user_id = any (v_participants)
    group by a.day_of_week, a.hour
  ) x;

  return jsonb_build_object(
    'participant_count', v_count,
    'participants', v_people,
    'cells', v_cells
  );
end;
$$;
