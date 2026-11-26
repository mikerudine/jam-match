-- P0: gate suggest_jam_window — was callable by any authenticated user for any jam_id
-- and returned matched_user_ids / names. Align visibility with list_browse_jams;
-- UUID list only for participants.

create or replace function jam.can_view_jam_suggest(p_jam_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  select
    jam.is_jam_participant(p_jam_id, p_uid)
    or exists (
      select 1
      from jam.jam_requests j
      where j.id = p_jam_id
        and j.status in ('matching', 'confirmed')
        and (j.window_end is null or j.window_end > now())
        and (
          coalesce(j.audience, 'open') = 'open'
          or jam.are_friends(p_uid, j.creator_id)
          or jam.jam_has_friend_participant(j.id, p_uid)
        )
    );
$$;

revoke all on function jam.can_view_jam_suggest(uuid, uuid)
  from public, anon, authenticated;

create or replace function jam.suggest_jam_window(p_jam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_participant boolean;
  v_uids uuid[];
  v_row record;
  v_names text[];
  v_payload jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not jam.can_view_jam_suggest(p_jam_id, v_uid) then
    raise exception 'not allowed';
  end if;

  v_participant := jam.is_jam_participant(p_jam_id, v_uid);

  v_uids := jam.jam_participant_ids(p_jam_id);
  if coalesce(cardinality(v_uids), 0) = 0 then
    return null;
  end if;

  select * into v_row
  from jam.suggest_window_for_users(v_uids, p_jam_id)
  limit 1;

  if not found then
    return null;
  end if;

  v_payload := jsonb_build_object(
    'window_start', v_row.window_start,
    'window_end', v_row.window_end,
    'match_count', v_row.match_count,
    'participant_count', cardinality(v_uids)
  );

  -- IDs / names only for participants (browse callers get window + counts).
  if v_participant then
    select coalesce(array_agg(p.display_name order by p.display_name), '{}')
    into v_names
    from jam.profiles p
    where p.id = any (v_row.matched_user_ids);

    v_payload := v_payload
      || jsonb_build_object(
        'matched_user_ids', to_jsonb(v_row.matched_user_ids),
        'matched_names', to_jsonb(v_names)
      );
  end if;

  return v_payload;
end;
$$;

revoke all on function jam.suggest_jam_window(uuid) from public, anon;
grant execute on function jam.suggest_jam_window(uuid) to authenticated;

notify pgrst, 'reload schema';
