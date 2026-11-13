-- Jam song list + votes (covers for a jam).
-- Schema jam only. Participants only (via jam.is_jam_participant).
-- Max 10 songs per user per jam enforced in DB (trigger).
-- Follows 20261113170000 hardening: SECURITY DEFINER + search_path = jam,
-- EXECUTE revoked from public/anon; grant authenticated only where needed.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table jam.jam_songs (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references jam.jam_requests (id) on delete cascade,
  added_by uuid not null references jam.profiles (id) on delete cascade,
  title text not null,
  artist text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jam_songs_title_nonempty check (length(trim(title)) > 0),
  constraint jam_songs_title_len check (char_length(title) <= 200),
  constraint jam_songs_artist_len check (artist is null or char_length(artist) <= 200)
);

create table jam.jam_song_votes (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references jam.jam_songs (id) on delete cascade,
  user_id uuid not null references jam.profiles (id) on delete cascade,
  value smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jam_song_votes_value_check check (value in (-1, 1)),
  unique (song_id, user_id)
);

create index jam_songs_jam_idx on jam.jam_songs (jam_id);
create index jam_songs_added_by_idx on jam.jam_songs (jam_id, added_by);
create index jam_song_votes_song_idx on jam.jam_song_votes (song_id);

-- Grants match existing jam tables (default privileges + explicit for clarity).
grant select, insert, update, delete on jam.jam_songs to authenticated;
grant select, insert, update, delete on jam.jam_song_votes to authenticated;
grant select on jam.jam_songs to anon;
grant select on jam.jam_song_votes to anon;
grant all on jam.jam_songs to service_role;
grant all on jam.jam_song_votes to service_role;

-- ---------------------------------------------------------------------------
-- Enforce max 10 songs per user per jam (BEFORE INSERT).
-- ---------------------------------------------------------------------------
create or replace function jam.enforce_jam_song_limit()
returns trigger
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_count integer;
begin
  if NEW.added_by is null then
    raise exception 'added_by required';
  end if;

  select count(*)::integer into v_count
  from jam.jam_songs
  where jam_id = NEW.jam_id
    and added_by = NEW.added_by;

  if v_count >= 10 then
    raise exception 'song limit reached (max 10 per jam)';
  end if;

  return NEW;
end;
$$;

create trigger jam_songs_limit_bi
  before insert on jam.jam_songs
  for each row
  execute function jam.enforce_jam_song_limit();

-- Keep updated_at fresh on song / vote edits.
create or replace function jam.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = jam
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger jam_songs_touch_bu
  before update on jam.jam_songs
  for each row
  execute function jam.touch_updated_at();

create trigger jam_song_votes_touch_bu
  before update on jam.jam_song_votes
  for each row
  execute function jam.touch_updated_at();

-- Internal triggers/helpers: not client-callable.
revoke execute on function jam.enforce_jam_song_limit() from public, anon, authenticated;
revoke execute on function jam.touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS — participants only; anon / non-participants get nothing.
-- ---------------------------------------------------------------------------
alter table jam.jam_songs enable row level security;
alter table jam.jam_song_votes enable row level security;

create policy jam_songs_select_participants
  on jam.jam_songs for select
  to authenticated
  using (jam.is_jam_participant(jam_id, auth.uid()));

create policy jam_songs_insert_own
  on jam.jam_songs for insert
  to authenticated
  with check (
    added_by = auth.uid()
    and jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_songs_update_own
  on jam.jam_songs for update
  to authenticated
  using (added_by = auth.uid())
  with check (
    added_by = auth.uid()
    and jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_songs_delete_own
  on jam.jam_songs for delete
  to authenticated
  using (
    added_by = auth.uid()
    and jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_song_votes_select_participants
  on jam.jam_song_votes for select
  to authenticated
  using (
    exists (
      select 1
      from jam.jam_songs s
      where s.id = jam_song_votes.song_id
        and jam.is_jam_participant(s.jam_id, auth.uid())
    )
  );

create policy jam_song_votes_insert_own
  on jam.jam_song_votes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from jam.jam_songs s
      where s.id = jam_song_votes.song_id
        and jam.is_jam_participant(s.jam_id, auth.uid())
    )
  );

create policy jam_song_votes_update_own
  on jam.jam_song_votes for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from jam.jam_songs s
      where s.id = jam_song_votes.song_id
        and jam.is_jam_participant(s.jam_id, auth.uid())
    )
  );

create policy jam_song_votes_delete_own
  on jam.jam_song_votes for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from jam.jam_songs s
      where s.id = jam_song_votes.song_id
        and jam.is_jam_participant(s.jam_id, auth.uid())
    )
  );
