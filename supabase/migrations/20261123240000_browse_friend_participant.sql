-- Friends tab: any jam where a friend participates (not only friend-as-creator).
-- Time-match uses covers_my_availability including own jams (client filter).

create or replace function jam.jam_has_friend_participant(
  p_jam_id uuid,
  p_uid uuid
) returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  select exists (
    select 1
    from unnest(jam.jam_participant_ids(p_jam_id)) as uid
    where uid is distinct from p_uid
      and jam.are_friends(p_uid, uid)
  );
$$;

revoke all on function jam.jam_has_friend_participant(uuid, uuid) from public, anon, authenticated;

drop function if exists jam.list_browse_jams();

create function jam.list_browse_jams()
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
  has_friend_participant boolean,
  i_am_participant boolean,
  suggested_window_start timestamptz,
  suggested_window_end timestamptz,
  suggested_match_count integer,
  suggested_participant_count integer,
  suggested_matched_names text[]
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
      when j.window_start is not null and j.window_end is not null then
        jam.user_covers_window(v_uid, j.window_start, j.window_end)
      when sug.window_start is not null and sug.window_end is not null then
        jam.user_covers_window(v_uid, sug.window_start, sug.window_end)
      else false
    end as covers_my_availability,
    jam.are_friends(v_uid, j.creator_id) as is_friend_creator,
    jam.jam_has_friend_participant(j.id, v_uid) as has_friend_participant,
    jam.is_jam_participant(j.id, v_uid) as i_am_participant,
    sug.window_start as suggested_window_start,
    sug.window_end as suggested_window_end,
    sug.match_count as suggested_match_count,
    sug.participant_count as suggested_participant_count,
    sug.matched_names as suggested_matched_names
  from jam.jam_requests j
  join jam.profiles p on p.id = j.creator_id
  left join lateral (
    select
      (s->>'window_start')::timestamptz as window_start,
      (s->>'window_end')::timestamptz as window_end,
      (s->>'match_count')::integer as match_count,
      (s->>'participant_count')::integer as participant_count,
      case
        when s ? 'matched_names' then
          array(select jsonb_array_elements_text(s->'matched_names'))
        else null
      end as matched_names
    from (
      select case
        when j.window_start is null then jam.suggest_jam_window(j.id)
        else null
      end as s
    ) x
  ) sug on true
  where j.status in ('matching', 'confirmed')
    and (j.window_end is null or j.window_end > now())
    and (
      coalesce(j.audience, 'open') = 'open'
      or jam.are_friends(v_uid, j.creator_id)
      or jam.is_jam_participant(j.id, v_uid)
      or jam.jam_has_friend_participant(j.id, v_uid)
    )
  order by
    coalesce(j.window_start, sug.window_start) nulls last,
    j.created_at desc;
end;
$$;

revoke all on function jam.list_browse_jams() from public, anon;
grant execute on function jam.list_browse_jams() to authenticated;
