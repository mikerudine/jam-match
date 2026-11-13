-- Telegram identity fields for Jam Match profiles (schema jam only).
-- telegram_handle remains the contact shown on a confirmed jam; Telegram
-- username is written there on sign-in.

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

-- Prefer Telegram display name / username from auth metadata when present.
create or replace function jam.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = jam, auth, public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  tg_username text := nullif(trim(meta->>'telegram_username'), '');
  tg_first text := nullif(trim(meta->>'telegram_first_name'), '');
  tg_last text := nullif(trim(meta->>'telegram_last_name'), '');
  display text;
begin
  display := coalesce(
    nullif(trim(meta->>'display_name'), ''),
    nullif(trim(concat_ws(' ', tg_first, tg_last)), ''),
    tg_username,
    split_part(coalesce(new.email, ''), '@', 1),
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
    new.id,
    display,
    case
      when meta ? 'telegram_id' and (meta->>'telegram_id') ~ '^[0-9]+$'
        then (meta->>'telegram_id')::bigint
      else null
    end,
    tg_username,
    tg_first,
    tg_last,
    nullif(trim(meta->>'telegram_photo_url'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
