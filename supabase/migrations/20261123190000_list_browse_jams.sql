-- Home feed: browse discoverable jams (open / friends) without being a participant.
-- Schema jam only. SECURITY DEFINER; revoke from anon/public.

create or replace function jam.list_browse_jams()
returns table (
  id uuid,
  creator_id uuid,
  theme text,
  format jam.jam_format,
  genres text[],
  area text,
  base_name text,
  window_start timestamptz,
  window_end timestamptz,
  status jam.jam_status,
  invite_ttl_hours integer,
  audience text,
  created_at timestamptz,
  creator_display_name text,
  filled_count integer,
  open_count integer,
  covers_my_availability boolean,
  is_friend_creator boolean,
  i_am_participant boolean
)
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return query
  select
    j.id,
    j.creator_id,
    j.theme,
    j.format,
    j.genres,
    j.area,
    j.base_name,
    j.window_start,
    j.window_end,
    j.status,
    j.invite_ttl_hours,
    coalesce(j.audience, 'open') as audience,
    j.created_at,
    p.display_name as creator_display_name,
    (
      select count(*)::integer
      from jam.jam_seats s
      where s.jam_id = j.id and s.status = 'filled'
    ) as filled_count,
    (
      select count(*)::integer
      from jam.jam_seats s
      where s.jam_id = j.id and s.status <> 'filled'
    ) as open_count,
    case
      when j.window_start is null or j.window_end is null then false
      else jam.user_covers_window(v_uid, j.window_start, j.window_end)
    end as covers_my_availability,
    jam.are_friends(v_uid, j.creator_id) as is_friend_creator,
    jam.is_jam_participant(j.id, v_uid) as i_am_participant
  from jam.jam_requests j
  join jam.profiles p on p.id = j.creator_id
  where j.status in ('matching', 'confirmed')
    and (j.window_end is null or j.window_end > now())
    and (
      coalesce(j.audience, 'open') = 'open'
      or jam.are_friends(v_uid, j.creator_id)
      or jam.is_jam_participant(j.id, v_uid)
    )
  order by j.window_start nulls last, j.created_at desc;
end;
$$;

revoke all on function jam.list_browse_jams() from public, anon;
grant execute on function jam.list_browse_jams() to authenticated;

comment on function jam.list_browse_jams() is
  'Discoverable open/friends jams for home tabs (not past). Includes availability overlap flag.';
