-- Jam Match lives in schema `jam` inside the shared Supabase project
-- (kyiv-air-raid-alerts / maqdxmetyzpyupivyecz), same multi-app pattern as `rebuild`.
-- Do NOT create objects in public. Expose `jam` in Dashboard → Settings → API → Exposed schemas.

create schema if not exists jam;

grant usage on schema jam to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums (schema-qualified)
-- ---------------------------------------------------------------------------
create type jam.instrument as enum (
  'drums', 'bass', 'guitar', 'keys', 'vocals', 'other'
);

create type jam.skill_level as enum (
  'beginner', 'intermediate', 'advanced'
);

create type jam.jam_format as enum (
  'free_jam', 'cover_practice', 'permanent_band'
);

create type jam.jam_status as enum (
  'matching', 'confirmed', 'cancelled', 'completed'
);

create type jam.seat_status as enum (
  'open', 'invited', 'filled'
);

create type jam.invite_status as enum (
  'pending', 'accepted', 'skipped', 'expired'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table jam.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  telegram_handle text,
  instruments jam.instrument[] not null default '{}',
  genres text[] not null default '{}',
  level jam.skill_level not null default 'intermediate',
  preferred_areas text[] not null default '{}',
  demo_url text,
  reliability_score double precision not null default 1.0
    check (reliability_score >= 0 and reliability_score <= 1),
  reliability_count integer not null default 0 check (reliability_count >= 0),
  locale text not null default 'uk' check (locale in ('uk', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table jam.availability_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references jam.profiles (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour smallint not null check (hour between 0 and 23),
  unique (user_id, day_of_week, hour)
);

create table jam.jam_requests (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references jam.profiles (id) on delete cascade,
  format jam.jam_format not null,
  genres text[] not null default '{}',
  area text not null,
  base_name text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status jam.jam_status not null default 'matching',
  invite_ttl_hours integer not null default 3 check (invite_ttl_hours between 1 and 48),
  created_at timestamptz not null default now(),
  check (window_end > window_start)
);

create table jam.jam_seats (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references jam.jam_requests (id) on delete cascade,
  role jam.instrument not null,
  filled_by uuid references jam.profiles (id) on delete set null,
  is_creator boolean not null default false,
  status jam.seat_status not null default 'open',
  sort_order integer not null default 0
);

create table jam.jam_invites (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references jam.jam_requests (id) on delete cascade,
  seat_id uuid not null references jam.jam_seats (id) on delete cascade,
  invitee_id uuid not null references jam.profiles (id) on delete cascade,
  status jam.invite_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (seat_id, invitee_id)
);

create table jam.jam_feedback (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references jam.jam_requests (id) on delete cascade,
  from_user_id uuid not null references jam.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  everyone_showed_up boolean not null,
  created_at timestamptz not null default now(),
  unique (jam_id, from_user_id)
);

create index jam_requests_creator_idx on jam.jam_requests (creator_id);
create index jam_requests_status_idx on jam.jam_requests (status);
create index jam_seats_jam_idx on jam.jam_seats (jam_id);
create index jam_invites_invitee_idx on jam.jam_invites (invitee_id, status);
create index availability_user_idx on jam.availability_slots (user_id);

grant select, insert, update, delete on all tables in schema jam to authenticated;
grant select on all tables in schema jam to anon;
grant all on all tables in schema jam to service_role;
grant usage, select on all sequences in schema jam to authenticated, service_role;

alter default privileges in schema jam
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema jam
  grant select on tables to anon;
alter default privileges in schema jam
  grant all on tables to service_role;

-- ---------------------------------------------------------------------------
-- Ensure jam.profiles row for the current user (called from the app after
-- sign-in). No triggers on auth.users — auth is shared across apps in this
-- project; a failing jam trigger would break signups project-wide.
-- ---------------------------------------------------------------------------
create or replace function jam.ensure_profile(
  p_display_name text default null
)
returns jam.profiles
language plpgsql
security definer
set search_path = jam
as $$
declare
  uid uuid := auth.uid();
  meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  display text;
  result jam.profiles;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  display := coalesce(
    nullif(trim(p_display_name), ''),
    nullif(trim(meta->>'display_name'), ''),
    'musician'
  );

  insert into jam.profiles (id, display_name)
  values (uid, display)
  on conflict (id) do update
    set
      display_name = case
        when nullif(trim(excluded.display_name), '') is not null
          and excluded.display_name is distinct from 'musician'
          then excluded.display_name
        else jam.profiles.display_name
      end,
      updated_at = now()
  returning * into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers (SECURITY DEFINER; limited EXECUTE grants)
-- ---------------------------------------------------------------------------
create or replace function jam.user_covers_window(
  p_user_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  with hours as (
    select
      extract(isodow from (gs at time zone 'Europe/Kyiv'))::int - 1 as dow,
      extract(hour from (gs at time zone 'Europe/Kyiv'))::int as hr
    from generate_series(
      date_trunc('hour', p_start),
      p_end - interval '1 second',
      interval '1 hour'
    ) as gs
  )
  select coalesce(
    (
      select bool_and(exists (
        select 1
        from jam.availability_slots a
        where a.user_id = p_user_id
          and a.day_of_week = h.dow
          and a.hour = h.hr
      ))
      from hours h
    ),
    false
  );
$$;

create or replace function jam.role_scarcity(p_role jam.instrument)
returns double precision
language sql
stable
security definer
set search_path = jam
as $$
  select 1.0 / greatest(
    (select count(*)::double precision
     from jam.profiles p
     where p_role = any (p.instruments)),
    1.0
  );
$$;

create or replace function jam.is_jam_participant(p_jam_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = jam
as $$
  select
    exists (
      select 1 from jam.jam_requests j
      where j.id = p_jam_id and j.creator_id = p_uid
    )
    or exists (
      select 1 from jam.jam_seats s
      where s.jam_id = p_jam_id and s.filled_by = p_uid
    )
    or exists (
      select 1 from jam.jam_invites i
      where i.jam_id = p_jam_id and i.invitee_id = p_uid
    );
$$;

create or replace function jam.expire_pending_invites(p_jam_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = jam
as $$
declare
  n integer;
begin
  update jam.jam_invites i
  set status = 'expired'
  where i.status = 'pending'
    and i.expires_at < now()
    and (p_jam_id is null or i.jam_id = p_jam_id);

  get diagnostics n = row_count;

  update jam.jam_seats s
  set status = 'open'
  where s.status = 'invited'
    and (p_jam_id is null or s.jam_id = p_jam_id)
    and not exists (
      select 1 from jam.jam_invites i
      where i.seat_id = s.id and i.status = 'pending'
    );

  return n;
end;
$$;

create or replace function jam.offer_next_for_seat(p_seat_id uuid)
returns uuid
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_jam jam.jam_requests%rowtype;
  v_seat jam.jam_seats%rowtype;
  v_candidate uuid;
  v_invite_id uuid;
begin
  select * into v_seat from jam.jam_seats where id = p_seat_id for update;
  if not found then
    return null;
  end if;
  if v_seat.status = 'filled' or v_seat.is_creator then
    return null;
  end if;

  select * into v_jam from jam.jam_requests where id = v_seat.jam_id;
  if v_jam.status <> 'matching' then
    return null;
  end if;

  if exists (
    select 1 from jam.jam_invites i
    where i.seat_id = p_seat_id and i.status = 'pending' and i.expires_at >= now()
  ) then
    return null;
  end if;

  select c.id into v_candidate
  from jam.profiles c
  where v_seat.role = any (c.instruments)
    and c.id <> v_jam.creator_id
    and c.id not in (
      select filled_by from jam.jam_seats
      where jam_id = v_jam.id and filled_by is not null
    )
    and not exists (
      select 1 from jam.jam_invites i
      where i.seat_id = p_seat_id
        and i.invitee_id = c.id
        and i.status in ('pending', 'accepted', 'skipped', 'expired')
    )
    and jam.user_covers_window(c.id, v_jam.window_start, v_jam.window_end)
    and (
      cardinality(v_jam.genres) = 0
      or c.genres && v_jam.genres
    )
    and (
      v_jam.area = any (c.preferred_areas)
      or cardinality(c.preferred_areas) = 0
    )
  order by
    jam.role_scarcity(v_seat.role) desc,
    (
      select count(*) from unnest(c.genres) g where g = any (v_jam.genres)
    ) desc,
    c.reliability_score desc,
    c.created_at asc
  limit 1;

  if v_candidate is null then
    update jam.jam_seats set status = 'open' where id = p_seat_id;
    return null;
  end if;

  insert into jam.jam_invites (jam_id, seat_id, invitee_id, expires_at)
  values (
    v_jam.id,
    p_seat_id,
    v_candidate,
    now() + make_interval(hours => v_jam.invite_ttl_hours)
  )
  returning id into v_invite_id;

  update jam.jam_seats set status = 'invited' where id = p_seat_id;
  return v_invite_id;
end;
$$;

create or replace function jam.maybe_confirm_jam(p_jam_id uuid)
returns void
language plpgsql
security definer
set search_path = jam
as $$
begin
  if not exists (
    select 1 from jam.jam_seats
    where jam_id = p_jam_id and status <> 'filled'
  ) then
    update jam.jam_requests
    set status = 'confirmed'
    where id = p_jam_id and status = 'matching';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs (callable via PostgREST on schema jam)
-- ---------------------------------------------------------------------------
create or replace function jam.create_jam_request(
  p_format jam.jam_format,
  p_genres text[],
  p_area text,
  p_base_name text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_invite_ttl_hours integer,
  p_creator_role jam.instrument,
  p_wanted_roles jam.instrument[]
) returns uuid
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_uid uuid := auth.uid();
  v_jam_id uuid;
  v_role jam.instrument;
  v_order integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from jam.profiles
    where id = v_uid and display_name <> '' and cardinality(instruments) > 0
  ) then
    raise exception 'complete your profile first';
  end if;
  if p_window_end <= p_window_start then
    raise exception 'invalid time window';
  end if;
  if cardinality(p_wanted_roles) < 1 then
    raise exception 'need at least one open seat';
  end if;

  insert into jam.jam_requests (
    creator_id, format, genres, area, base_name,
    window_start, window_end, invite_ttl_hours
  ) values (
    v_uid, p_format, coalesce(p_genres, '{}'), p_area, p_base_name,
    p_window_start, p_window_end, coalesce(p_invite_ttl_hours, 3)
  )
  returning id into v_jam_id;

  insert into jam.jam_seats (jam_id, role, filled_by, is_creator, status, sort_order)
  values (v_jam_id, p_creator_role, v_uid, true, 'filled', v_order);

  foreach v_role in array p_wanted_roles loop
    v_order := v_order + 1;
    insert into jam.jam_seats (jam_id, role, status, sort_order)
    values (v_jam_id, v_role, 'open', v_order);
  end loop;

  return v_jam_id;
end;
$$;

create or replace function jam.process_jam_matching(p_jam_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_seat record;
  v_offered integer := 0;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  perform jam.expire_pending_invites(p_jam_id);

  for v_seat in
    select s.*
    from jam.jam_seats s
    join jam.jam_requests j on j.id = s.jam_id
    where j.status = 'matching'
      and s.status in ('open', 'invited')
      and s.filled_by is null
      and not s.is_creator
      and (p_jam_id is null or s.jam_id = p_jam_id)
      and not exists (
        select 1 from jam.jam_invites i
        where i.seat_id = s.id and i.status = 'pending' and i.expires_at >= now()
      )
    order by jam.role_scarcity(s.role) desc, s.sort_order
  loop
    v_id := jam.offer_next_for_seat(v_seat.id);
    if v_id is not null then
      v_offered := v_offered + 1;
    end if;
    perform jam.maybe_confirm_jam(v_seat.jam_id);
  end loop;

  return v_offered;
end;
$$;

create or replace function jam.respond_to_invite(
  p_invite_id uuid,
  p_accept boolean
) returns void
language plpgsql
security definer
set search_path = jam
as $$
declare
  v_invite jam.jam_invites%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform jam.expire_pending_invites();

  select * into v_invite
  from jam.jam_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'invite not found';
  end if;
  if v_invite.invitee_id <> v_uid then
    raise exception 'not your invite';
  end if;
  if v_invite.status <> 'pending' or v_invite.expires_at < now() then
    update jam.jam_invites set status = 'expired' where id = p_invite_id;
    update jam.jam_seats set status = 'open'
      where id = v_invite.seat_id and status = 'invited';
    perform jam.offer_next_for_seat(v_invite.seat_id);
    raise exception 'invite expired';
  end if;

  if p_accept then
    update jam.jam_invites set status = 'accepted' where id = p_invite_id;
    update jam.jam_seats
    set status = 'filled', filled_by = v_uid
    where id = v_invite.seat_id and status <> 'filled';
    update jam.jam_invites
    set status = 'expired'
    where seat_id = v_invite.seat_id
      and id <> p_invite_id
      and status = 'pending';
    perform jam.maybe_confirm_jam(v_invite.jam_id);
  else
    update jam.jam_invites set status = 'skipped' where id = p_invite_id;
    update jam.jam_seats set status = 'open'
      where id = v_invite.seat_id and status = 'invited';
    perform jam.offer_next_for_seat(v_invite.seat_id);
  end if;
end;
$$;

create or replace function jam.submit_jam_feedback(
  p_jam_id uuid,
  p_rating integer,
  p_everyone_showed_up boolean
) returns void
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

  for v_member in
    select filled_by from jam.jam_seats
    where jam_id = p_jam_id and filled_by is not null and filled_by <> v_uid
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
    and window_end < now();
end;
$$;

-- Revoke broad execute, then grant only what clients need
revoke all on function jam.user_covers_window(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function jam.role_scarcity(jam.instrument) from public, anon, authenticated;
revoke all on function jam.expire_pending_invites(uuid) from public, anon, authenticated;
revoke all on function jam.offer_next_for_seat(uuid) from public, anon, authenticated;
revoke all on function jam.maybe_confirm_jam(uuid) from public, anon, authenticated;
-- Needed by RLS policy expressions
grant execute on function jam.is_jam_participant(uuid, uuid) to authenticated;

revoke all on function jam.ensure_profile(text) from public, anon;
grant execute on function jam.ensure_profile(text) to authenticated;

grant execute on function jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer,
  jam.instrument, jam.instrument[]
) to authenticated;

grant execute on function jam.process_jam_matching(uuid) to authenticated;
grant execute on function jam.respond_to_invite(uuid, boolean) to authenticated;
grant execute on function jam.submit_jam_feedback(uuid, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table jam.profiles enable row level security;
alter table jam.availability_slots enable row level security;
alter table jam.jam_requests enable row level security;
alter table jam.jam_seats enable row level security;
alter table jam.jam_invites enable row level security;
alter table jam.jam_feedback enable row level security;

create policy profiles_select_authenticated
  on jam.profiles for select
  to authenticated
  using (true);

create policy profiles_insert_own
  on jam.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy profiles_update_own
  on jam.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy availability_select_own
  on jam.availability_slots for select
  to authenticated
  using (user_id = auth.uid());

create policy availability_insert_own
  on jam.availability_slots for insert
  to authenticated
  with check (user_id = auth.uid());

create policy availability_update_own
  on jam.availability_slots for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy availability_delete_own
  on jam.availability_slots for delete
  to authenticated
  using (user_id = auth.uid());

create policy jam_requests_select
  on jam.jam_requests for select
  to authenticated
  using (jam.is_jam_participant(id, auth.uid()));

create policy jam_requests_insert_own
  on jam.jam_requests for insert
  to authenticated
  with check (creator_id = auth.uid());

create policy jam_requests_update_creator
  on jam.jam_requests for update
  to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy jam_seats_select
  on jam.jam_seats for select
  to authenticated
  using (jam.is_jam_participant(jam_id, auth.uid()));

create policy jam_invites_select_own
  on jam.jam_invites for select
  to authenticated
  using (
    invitee_id = auth.uid()
    or jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_feedback_select_members
  on jam.jam_feedback for select
  to authenticated
  using (jam.is_jam_participant(jam_id, auth.uid()));

create policy jam_feedback_insert_own
  on jam.jam_feedback for insert
  to authenticated
  with check (
    from_user_id = auth.uid()
    and exists (
      select 1 from jam.jam_seats s
      where s.jam_id = jam_feedback.jam_id and s.filled_by = auth.uid()
    )
  );
