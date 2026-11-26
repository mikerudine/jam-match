-- P1 idea-jam: creator can set a concrete window (e.g. from suggest) then matching runs.

create or replace function jam.apply_jam_window(
  p_jam_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns uuid[]
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
  if p_window_start is null or p_window_end is null then
    raise exception 'window required';
  end if;
  if p_window_end <= p_window_start then
    raise exception 'invalid window';
  end if;

  select * into v_jam
  from jam.jam_requests
  where id = p_jam_id
  for update;

  if not found then
    raise exception 'jam not found';
  end if;
  if v_jam.creator_id <> v_uid then
    raise exception 'only the initiator can set the window';
  end if;
  if v_jam.status <> 'matching' then
    raise exception 'jam is not matching';
  end if;
  if coalesce(v_jam.audience, 'open') = 'invite' then
    raise exception 'invite-only jams do not auto-match';
  end if;

  update jam.jam_requests
  set
    window_start = p_window_start,
    window_end = p_window_end,
    updated_at = now()
  where id = p_jam_id;

  return jam.process_jam_matching(p_jam_id);
end;
$$;

revoke all on function jam.apply_jam_window(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function jam.apply_jam_window(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
