-- Telegram identity fields for Jam Match profiles (schema jam only).
-- telegram_handle remains the contact shown on a confirmed jam; Telegram
-- username is written there on sign-in via jam.ensure_profile().
-- No objects outside schema jam.

alter table jam.profiles
  add column if not exists telegram_id bigint,
  add column if not exists telegram_first_name text,
  add column if not exists telegram_last_name text,
  add column if not exists telegram_photo_url text;

create unique index if not exists profiles_telegram_id_uidx
  on jam.profiles (telegram_id)
  where telegram_id is not null;

comment on column jam.profiles.telegram_id is 'Telegram user id from Login Widget / Mini App';
comment on column jam.profiles.telegram_handle is 'Telegram @username; default contact for confirmed jams';

-- Replace ensure_profile with Telegram-aware signature (idempotent; auth.uid()).
-- Display name / telegram fields come from explicit args or JWT user_metadata
-- set at Telegram sign-in — never derived from the synthetic email local-part.
drop function if exists jam.ensure_profile(text);

create or replace function jam.ensure_profile(
  p_display_name text default null,
  p_telegram_id bigint default null,
  p_telegram_username text default null,
  p_telegram_first_name text default null,
  p_telegram_last_name text default null,
  p_telegram_photo_url text default null
)
returns jam.profiles
language plpgsql
security definer
set search_path = jam
as $$
declare
  uid uuid := auth.uid();
  meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  tg_id bigint;
  tg_username text;
  tg_first text;
  tg_last text;
  tg_photo text;
  display text;
  result jam.profiles;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  tg_id := coalesce(
    p_telegram_id,
    case
      when (meta->>'telegram_id') ~ '^[0-9]+$'
        then (meta->>'telegram_id')::bigint
      else null
    end
  );
  tg_username := nullif(
    trim(coalesce(p_telegram_username, meta->>'telegram_username', '')),
    ''
  );
  tg_first := nullif(
    trim(coalesce(p_telegram_first_name, meta->>'telegram_first_name', '')),
    ''
  );
  tg_last := nullif(
    trim(coalesce(p_telegram_last_name, meta->>'telegram_last_name', '')),
    ''
  );
  tg_photo := nullif(
    trim(coalesce(p_telegram_photo_url, meta->>'telegram_photo_url', '')),
    ''
  );

  display := coalesce(
    nullif(trim(p_display_name), ''),
    nullif(trim(meta->>'display_name'), ''),
    nullif(trim(concat_ws(' ', tg_first, tg_last)), ''),
    tg_username,
    'musician'
  );

  insert into jam.profiles (
    id,
    display_name,
    telegram_id,
    telegram_handle,
    telegram_first_name,
    telegram_last_name,
    telegram_photo_url
  )
  values (
    uid,
    display,
    tg_id,
    tg_username,
    tg_first,
    tg_last,
    tg_photo
  )
  on conflict (id) do update
    set
      display_name = case
        when nullif(trim(excluded.display_name), '') is not null
          and excluded.display_name is distinct from 'musician'
          then excluded.display_name
        else jam.profiles.display_name
      end,
      telegram_id = coalesce(excluded.telegram_id, jam.profiles.telegram_id),
      telegram_handle = coalesce(excluded.telegram_handle, jam.profiles.telegram_handle),
      telegram_first_name = coalesce(
        excluded.telegram_first_name,
        jam.profiles.telegram_first_name
      ),
      telegram_last_name = coalesce(
        excluded.telegram_last_name,
        jam.profiles.telegram_last_name
      ),
      telegram_photo_url = coalesce(
        excluded.telegram_photo_url,
        jam.profiles.telegram_photo_url
      ),
      updated_at = now()
  returning * into result;

  return result;
end;
$$;

revoke all on function jam.ensure_profile(
  text, bigint, text, text, text, text
) from public, anon;

grant execute on function jam.ensure_profile(
  text, bigint, text, text, text, text
) to authenticated;
