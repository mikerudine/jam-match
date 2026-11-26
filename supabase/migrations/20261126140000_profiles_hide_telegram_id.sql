-- P1: stop leaking telegram_id / telegram_write_access to other authenticated users.
-- Table SELECT is limited to public columns; own full row via get_own_profile().
-- list_friends no longer returns SETOF profiles (was SECURITY DEFINER + p.*).

revoke all on table jam.profiles from anon, authenticated, public;

grant select (
  id,
  display_name,
  telegram_handle,
  instruments,
  genres,
  level,
  preferred_areas,
  demo_url,
  reliability_score,
  reliability_count,
  locale,
  created_at,
  updated_at,
  telegram_first_name,
  telegram_last_name,
  telegram_photo_url
) on table jam.profiles to authenticated;

-- Client upserts editable profile fields (telegram_id only via ensure_profile).
grant insert (
  id,
  display_name,
  telegram_handle,
  instruments,
  genres,
  level,
  preferred_areas,
  demo_url,
  reliability_score,
  reliability_count,
  locale,
  created_at,
  updated_at,
  telegram_first_name,
  telegram_last_name,
  telegram_photo_url
) on table jam.profiles to authenticated;

grant update (
  display_name,
  telegram_handle,
  instruments,
  genres,
  level,
  preferred_areas,
  demo_url,
  locale,
  updated_at,
  telegram_first_name,
  telegram_last_name,
  telegram_photo_url
) on table jam.profiles to authenticated;

grant select, insert, update, delete on table jam.profiles to service_role;

-- Own profile including telegram_id / write_access (for Profile page + auth).
create or replace function jam.get_own_profile()
returns jam.profiles
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_row jam.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row
  from jam.profiles
  where id = v_uid;

  if not found then
    return null;
  end if;

  return v_row;
end;
$$;

revoke all on function jam.get_own_profile() from public, anon;
grant execute on function jam.get_own_profile() to authenticated;

-- Friends list without numeric telegram_id / write flag.
drop function if exists jam.list_friends();

create function jam.list_friends()
returns table (
  id uuid,
  display_name text,
  telegram_handle text,
  instruments jam.instrument[],
  genres text[],
  level jam.skill_level,
  preferred_areas text[],
  demo_url text,
  reliability_score double precision,
  reliability_count integer,
  locale text,
  created_at timestamptz,
  updated_at timestamptz,
  telegram_first_name text,
  telegram_last_name text,
  telegram_photo_url text
)
language sql
stable
security definer
set search_path = jam
as $$
  select
    p.id,
    p.display_name,
    p.telegram_handle,
    p.instruments,
    p.genres,
    p.level,
    p.preferred_areas,
    p.demo_url,
    p.reliability_score,
    p.reliability_count,
    p.locale,
    p.created_at,
    p.updated_at,
    p.telegram_first_name,
    p.telegram_last_name,
    p.telegram_photo_url
  from jam.profiles p
  join jam.friendships f
    on p.id = case
      when f.user_a = auth.uid() then f.user_b
      when f.user_b = auth.uid() then f.user_a
    end
  where auth.uid() is not null
  order by lower(p.display_name), p.created_at;
$$;

revoke all on function jam.list_friends() from public, anon;
grant execute on function jam.list_friends() to authenticated;

notify pgrst, 'reload schema';
