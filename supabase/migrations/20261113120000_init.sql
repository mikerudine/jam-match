-- Jam Match schema: profiles, availability, jams, invites, feedback + matching RPCs.
-- All public tables have RLS enabled.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.instrument as enum (
  'drums', 'bass', 'guitar', 'keys', 'vocals', 'other'
);

create type public.skill_level as enum (
  'beginner', 'intermediate', 'advanced'
);

create type public.jam_format as enum (
  'free_jam', 'cover_practice', 'permanent_band'
);

create type public.jam_status as enum (
  'matching', 'confirmed', 'cancelled', 'completed'
);

create type public.seat_status as enum (
  'open', 'invited', 'filled'
);

create type public.invite_status as enum (
  'pending', 'accepted', 'skipped', 'expired'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  telegram_handle text,
  instruments public.instrument[] not null default '{}',
  genres text[] not null default '{}',
  level public.skill_level not null default 'intermediate',
  preferred_areas text[] not null default '{}',
  demo_url text,
  reliability_score double precision not null default 1.0
    check (reliability_score >= 0 and reliability_score <= 1),
  reliability_count integer not null default 0 check (reliability_count >= 0),
  locale text not null default 'uk' check (locale in ('uk', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour smallint not null check (hour between 0 and 23),
  unique (user_id, day_of_week, hour)
);

create table public.jam_requests (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  format public.jam_format not null,
  genres text[] not null default '{}',
  area text not null,
  base_name text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status public.jam_status not null default 'matching',
  invite_ttl_hours integer not null default 3 check (invite_ttl_hours between 1 and 48),
  created_at timestamptz not null default now(),
  check (window_end > window_start)
);

create table public.jam_seats (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references public.jam_requests (id) on delete cascade,
  role public.instrument not null,
  filled_by uuid references public.profiles (id) on delete set null,
  is_creator boolean not null default false,
  status public.seat_status not null default 'open',
  sort_order integer not null default 0
);

create table public.jam_invites (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references public.jam_requests (id) on delete cascade,
  seat_id uuid not null references public.jam_seats (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (seat_id, invitee_id)
);

create table public.jam_feedback (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references public.jam_requests (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  everyone_showed_up boolean not null,
  created_at timestamptz not null default now(),
  unique (jam_id, from_user_id)
);

create index jam_requests_creator_idx on public.jam_requests (creator_id);
create index jam_requests_status_idx on public.jam_requests (status);
create index jam_seats_jam_idx on public.jam_seats (jam_id);
create index jam_invites_invitee_idx on public.jam_invites (invitee_id, status);
create index availability_user_idx on public.availability_slots (user_id);

-- ---------------------------------------------------------------------------
-- Auto-create profile on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'musician')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers (private schema for SECURITY DEFINER matching)
-- ---------------------------------------------------------------------------
create schema if not exists private;

create or replace function private.user_covers_window(
  p_user_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns boolean
language sql
stable
set search_path = public
as $$
  with hours as (
    select
      -- Convert to Europe/Kyiv wall time for weekly grid matching.
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
        from public.availability_slots a
        where a.user_id = p_user_id
          and a.day_of_week = h.dow
          and a.hour = h.hr
      ))
      from hours h
    ),
    false
  );
$$;

create or replace function private.role_scarcity(p_role public.instrument)
returns double precision
language sql
stable
set search_path = public
as $$
  select 1.0 / greatest(
    (select count(*)::double precision
     from public.profiles p
     where p_role = any (p.instruments)),
    1.0
  );
$$;

create or replace function private.expire_pending_invites(p_jam_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.jam_invites i
  set status = 'expired'
  where i.status = 'pending'
    and i.expires_at < now()
    and (p_jam_id is null or i.jam_id = p_jam_id);

  get diagnostics n = row_count;

  update public.jam_seats s
  set status = 'open'
  where s.status = 'invited'
    and (p_jam_id is null or s.jam_id = p_jam_id)
    and not exists (
      select 1 from public.jam_invites i
      where i.seat_id = s.id and i.status = 'pending'
    );

  return n;
end;
$$;

create or replace function private.offer_next_for_seat(p_seat_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jam public.jam_requests%rowtype;
  v_seat public.jam_seats%rowtype;
  v_candidate uuid;
  v_invite_id uuid;
begin
  select * into v_seat from public.jam_seats where id = p_seat_id for update;
  if not found then
    return null;
  end if;
  if v_seat.status = 'filled' or v_seat.is_creator then
    return null;
  end if;

  select * into v_jam from public.jam_requests where id = v_seat.jam_id;
  if v_jam.status <> 'matching' then
    return null;
  end if;

  -- Already has a live pending invite?
  if exists (
    select 1 from public.jam_invites i
    where i.seat_id = p_seat_id and i.status = 'pending' and i.expires_at >= now()
  ) then
    return null;
  end if;

  select c.id into v_candidate
  from public.profiles c
  where v_seat.role = any (c.instruments)
    and c.id <> v_jam.creator_id
    and c.id not in (
      select filled_by from public.jam_seats
      where jam_id = v_jam.id and filled_by is not null
    )
    and not exists (
      select 1 from public.jam_invites i
      where i.seat_id = p_seat_id
        and i.invitee_id = c.id
        and i.status in ('pending', 'accepted', 'skipped', 'expired')
    )
    and private.user_covers_window(c.id, v_jam.window_start, v_jam.window_end)
    and (
      cardinality(v_jam.genres) = 0
      or c.genres && v_jam.genres
    )
    and (
      v_jam.area = any (c.preferred_areas)
      or cardinality(c.preferred_areas) = 0
    )
  order by
    private.role_scarcity(v_seat.role) desc,
    (
      select count(*) from unnest(c.genres) g where g = any (v_jam.genres)
    ) desc,
    c.reliability_score desc,
    c.created_at asc
  limit 1;

  if v_candidate is null then
    update public.jam_seats set status = 'open' where id = p_seat_id;
    return null;
  end if;

  insert into public.jam_invites (jam_id, seat_id, invitee_id, expires_at)
  values (
    v_jam.id,
    p_seat_id,
    v_candidate,
    now() + make_interval(hours => v_jam.invite_ttl_hours)
  )
  returning id into v_invite_id;

  update public.jam_seats set status = 'invited' where id = p_seat_id;
  return v_invite_id;
end;
$$;

create or replace function private.maybe_confirm_jam(p_jam_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.jam_seats
    where jam_id = p_jam_id and status <> 'filled'
  ) then
    update public.jam_requests
    set status = 'confirmed'
    where id = p_jam_id and status = 'matching';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_jam_request(
  p_format public.jam_format,
  p_genres text[],
  p_area text,
  p_base_name text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_invite_ttl_hours integer,
  p_creator_role public.instrument,
  p_wanted_roles public.instrument[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jam_id uuid;
  v_role public.instrument;
  v_order integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.profiles
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

  insert into public.jam_requests (
    creator_id, format, genres, area, base_name,
    window_start, window_end, invite_ttl_hours
  ) values (
    v_uid, p_format, coalesce(p_genres, '{}'), p_area, p_base_name,
    p_window_start, p_window_end, coalesce(p_invite_ttl_hours, 3)
  )
  returning id into v_jam_id;

  insert into public.jam_seats (jam_id, role, filled_by, is_creator, status, sort_order)
  values (v_jam_id, p_creator_role, v_uid, true, 'filled', v_order);

  foreach v_role in array p_wanted_roles loop
    v_order := v_order + 1;
    insert into public.jam_seats (jam_id, role, status, sort_order)
    values (v_jam_id, v_role, 'open', v_order);
  end loop;

  return v_jam_id;
end;
$$;

create or replace function public.process_jam_matching(p_jam_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat record;
  v_offered integer := 0;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  perform private.expire_pending_invites(p_jam_id);

  -- Prefer scarce roles first when offering seats.
  for v_seat in
    select s.*
    from public.jam_seats s
    join public.jam_requests j on j.id = s.jam_id
    where j.status = 'matching'
      and s.status in ('open', 'invited')
      and s.filled_by is null
      and not s.is_creator
      and (p_jam_id is null or s.jam_id = p_jam_id)
      and not exists (
        select 1 from public.jam_invites i
        where i.seat_id = s.id and i.status = 'pending' and i.expires_at >= now()
      )
    order by private.role_scarcity(s.role) desc, s.sort_order
  loop
    v_id := private.offer_next_for_seat(v_seat.id);
    if v_id is not null then
      v_offered := v_offered + 1;
    end if;
    perform private.maybe_confirm_jam(v_seat.jam_id);
  end loop;

  return v_offered;
end;
$$;

create or replace function public.respond_to_invite(
  p_invite_id uuid,
  p_accept boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.jam_invites%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform private.expire_pending_invites();

  select * into v_invite
  from public.jam_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'invite not found';
  end if;
  if v_invite.invitee_id <> v_uid then
    raise exception 'not your invite';
  end if;
  if v_invite.status <> 'pending' or v_invite.expires_at < now() then
    update public.jam_invites set status = 'expired' where id = p_invite_id;
    update public.jam_seats set status = 'open'
      where id = v_invite.seat_id and status = 'invited';
    perform private.offer_next_for_seat(v_invite.seat_id);
    raise exception 'invite expired';
  end if;

  if p_accept then
    update public.jam_invites set status = 'accepted' where id = p_invite_id;
    update public.jam_seats
    set status = 'filled', filled_by = v_uid
    where id = v_invite.seat_id and status <> 'filled';
    -- Expire other pending invites for same seat
    update public.jam_invites
    set status = 'expired'
    where seat_id = v_invite.seat_id
      and id <> p_invite_id
      and status = 'pending';
    perform private.maybe_confirm_jam(v_invite.jam_id);
  else
    update public.jam_invites set status = 'skipped' where id = p_invite_id;
    update public.jam_seats set status = 'open'
      where id = v_invite.seat_id and status = 'invited';
    perform private.offer_next_for_seat(v_invite.seat_id);
  end if;
end;
$$;

create or replace function public.submit_jam_feedback(
  p_jam_id uuid,
  p_rating integer,
  p_everyone_showed_up boolean
) returns void
language plpgsql
security definer
set search_path = public
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
    select 1 from public.jam_seats
    where jam_id = p_jam_id and filled_by = v_uid
  ) then
    raise exception 'not a jam member';
  end if;

  insert into public.jam_feedback (jam_id, from_user_id, rating, everyone_showed_up)
  values (p_jam_id, v_uid, p_rating, p_everyone_showed_up);

  -- Reliability tiebreaker: show-up weighs more than vibe rating.
  v_delta := case when p_everyone_showed_up then 0.05 else -0.15 end
           + ((p_rating - 3)::double precision * 0.02);

  for v_member in
    select filled_by from public.jam_seats
    where jam_id = p_jam_id and filled_by is not null and filled_by <> v_uid
  loop
    update public.profiles
    set
      reliability_score = greatest(0, least(1,
        (reliability_score * reliability_count + (0.7 + v_delta))
        / (reliability_count + 1)
      )),
      reliability_count = reliability_count + 1,
      updated_at = now()
    where id = v_member;
  end loop;

  update public.jam_requests
  set status = 'completed'
  where id = p_jam_id
    and status = 'confirmed'
    and window_end < now();
end;
$$;

revoke all on function private.user_covers_window(uuid, timestamptz, timestamptz) from public;
revoke all on function private.role_scarcity(public.instrument) from public;
revoke all on function private.expire_pending_invites(uuid) from public;
revoke all on function private.offer_next_for_seat(uuid) from public;
revoke all on function private.maybe_confirm_jam(uuid) from public;

grant execute on function public.create_jam_request(
  public.jam_format, text[], text, text, timestamptz, timestamptz, integer,
  public.instrument, public.instrument[]
) to authenticated;

grant execute on function public.process_jam_matching(uuid) to authenticated;
grant execute on function public.respond_to_invite(uuid, boolean) to authenticated;
grant execute on function public.submit_jam_feedback(uuid, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.availability_slots enable row level security;
alter table public.jam_requests enable row level security;
alter table public.jam_seats enable row level security;
alter table public.jam_invites enable row level security;
alter table public.jam_feedback enable row level security;

-- Profiles: authenticated users can read community profiles (needed for matching UI contacts once confirmed).
create policy profiles_select_authenticated
  on public.profiles for select
  to authenticated
  using (true);

create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Availability: own rows only (matching runs in security definer).
create policy availability_select_own
  on public.availability_slots for select
  to authenticated
  using (user_id = auth.uid());

create policy availability_insert_own
  on public.availability_slots for insert
  to authenticated
  with check (user_id = auth.uid());

create policy availability_update_own
  on public.availability_slots for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy availability_delete_own
  on public.availability_slots for delete
  to authenticated
  using (user_id = auth.uid());

-- Jams: visible to creator, seated members, or invitees.
create policy jam_requests_select
  on public.jam_requests for select
  to authenticated
  using (
    creator_id = auth.uid()
    or exists (
      select 1 from public.jam_seats s
      where s.jam_id = jam_requests.id and s.filled_by = auth.uid()
    )
    or exists (
      select 1 from public.jam_invites i
      where i.jam_id = jam_requests.id and i.invitee_id = auth.uid()
    )
  );

create policy jam_requests_insert_own
  on public.jam_requests for insert
  to authenticated
  with check (creator_id = auth.uid());

create policy jam_requests_update_creator
  on public.jam_requests for update
  to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy jam_seats_select
  on public.jam_seats for select
  to authenticated
  using (
    exists (
      select 1 from public.jam_requests j
      where j.id = jam_seats.jam_id
        and (
          j.creator_id = auth.uid()
          or exists (
            select 1 from public.jam_seats s2
            where s2.jam_id = j.id and s2.filled_by = auth.uid()
          )
          or exists (
            select 1 from public.jam_invites i
            where i.jam_id = j.id and i.invitee_id = auth.uid()
          )
        )
    )
  );

create policy jam_invites_select_own
  on public.jam_invites for select
  to authenticated
  using (
    invitee_id = auth.uid()
    or exists (
      select 1 from public.jam_requests j
      where j.id = jam_invites.jam_id and j.creator_id = auth.uid()
    )
  );

create policy jam_feedback_select_members
  on public.jam_feedback for select
  to authenticated
  using (
    exists (
      select 1 from public.jam_seats s
      where s.jam_id = jam_feedback.jam_id and s.filled_by = auth.uid()
    )
  );

create policy jam_feedback_insert_own
  on public.jam_feedback for insert
  to authenticated
  with check (
    from_user_id = auth.uid()
    and exists (
      select 1 from public.jam_seats s
      where s.jam_id = jam_feedback.jam_id and s.filled_by = auth.uid()
    )
  );
