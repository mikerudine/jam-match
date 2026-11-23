-- Location catalog + per-jam proposals with ±1 votes (mirrors jam_songs).
-- Schema jam only. Max 2 proposals per participant per jam.
-- Catalog readable/creatable by any authenticated user; proposals: participants only.

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table jam.locations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references jam.profiles (id) on delete cascade,
  name text not null,
  address text not null,
  url text not null,
  price_per_hour numeric(10, 2),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_name_nonempty check (length(trim(name)) > 0),
  constraint locations_name_len check (char_length(name) <= 200),
  constraint locations_address_nonempty check (length(trim(address)) > 0),
  constraint locations_address_len check (char_length(address) <= 500),
  constraint locations_url_nonempty check (length(trim(url)) > 0),
  constraint locations_url_len check (char_length(url) <= 1000),
  constraint locations_comment_len check (comment is null or char_length(comment) <= 1000),
  constraint locations_price_nonneg check (price_per_hour is null or price_per_hour >= 0)
);

create index locations_created_by_idx on jam.locations (created_by);
create index locations_name_idx on jam.locations (lower(name));

-- ---------------------------------------------------------------------------
-- Jam proposals (link catalog row into a jam for voting)
-- ---------------------------------------------------------------------------
create table jam.jam_location_proposals (
  id uuid primary key default gen_random_uuid(),
  jam_id uuid not null references jam.jam_requests (id) on delete cascade,
  location_id uuid not null references jam.locations (id) on delete cascade,
  added_by uuid not null references jam.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (jam_id, location_id)
);

create table jam.jam_location_votes (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references jam.jam_location_proposals (id) on delete cascade,
  user_id uuid not null references jam.profiles (id) on delete cascade,
  value smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jam_location_votes_value_check check (value in (-1, 1)),
  unique (proposal_id, user_id)
);

create index jam_location_proposals_jam_idx on jam.jam_location_proposals (jam_id);
create index jam_location_proposals_added_by_idx
  on jam.jam_location_proposals (jam_id, added_by);
create index jam_location_votes_proposal_idx on jam.jam_location_votes (proposal_id);

grant select, insert, update, delete on jam.locations to authenticated;
grant select, insert, update, delete on jam.jam_location_proposals to authenticated;
grant select, insert, update, delete on jam.jam_location_votes to authenticated;
grant select on jam.locations to anon;
grant all on jam.locations to service_role;
grant all on jam.jam_location_proposals to service_role;
grant all on jam.jam_location_votes to service_role;

-- ---------------------------------------------------------------------------
-- Enforce max 2 proposals per user per jam
-- ---------------------------------------------------------------------------
create or replace function jam.enforce_jam_location_proposal_limit()
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
  from jam.jam_location_proposals
  where jam_id = NEW.jam_id
    and added_by = NEW.added_by;

  if v_count >= 2 then
    raise exception 'location limit reached (max 2 per jam)';
  end if;

  return NEW;
end;
$$;

create trigger jam_location_proposals_limit_bi
  before insert on jam.jam_location_proposals
  for each row
  execute function jam.enforce_jam_location_proposal_limit();

create trigger jam_locations_touch_bu
  before update on jam.locations
  for each row
  execute function jam.touch_updated_at();

create trigger jam_location_proposals_touch_bu
  before update on jam.jam_location_proposals
  for each row
  execute function jam.touch_updated_at();

create trigger jam_location_votes_touch_bu
  before update on jam.jam_location_votes
  for each row
  execute function jam.touch_updated_at();

revoke execute on function jam.enforce_jam_location_proposal_limit()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table jam.locations enable row level security;
alter table jam.jam_location_proposals enable row level security;
alter table jam.jam_location_votes enable row level security;

-- Catalog: any signed-in musician can browse / create; edit own only.
create policy locations_select_authenticated
  on jam.locations for select
  to authenticated
  using (true);

create policy locations_insert_own
  on jam.locations for insert
  to authenticated
  with check (created_by = auth.uid());

create policy locations_update_own
  on jam.locations for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy locations_delete_own
  on jam.locations for delete
  to authenticated
  using (created_by = auth.uid());

create policy jam_location_proposals_select_participants
  on jam.jam_location_proposals for select
  to authenticated
  using (jam.is_jam_participant(jam_id, auth.uid()));

create policy jam_location_proposals_insert_own
  on jam.jam_location_proposals for insert
  to authenticated
  with check (
    added_by = auth.uid()
    and jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_location_proposals_delete_own
  on jam.jam_location_proposals for delete
  to authenticated
  using (
    added_by = auth.uid()
    and jam.is_jam_participant(jam_id, auth.uid())
  );

create policy jam_location_votes_select_participants
  on jam.jam_location_votes for select
  to authenticated
  using (
    exists (
      select 1
      from jam.jam_location_proposals p
      where p.id = jam_location_votes.proposal_id
        and jam.is_jam_participant(p.jam_id, auth.uid())
    )
  );

create policy jam_location_votes_insert_own
  on jam.jam_location_votes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from jam.jam_location_proposals p
      where p.id = jam_location_votes.proposal_id
        and jam.is_jam_participant(p.jam_id, auth.uid())
    )
  );

create policy jam_location_votes_update_own
  on jam.jam_location_votes for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from jam.jam_location_proposals p
      where p.id = jam_location_votes.proposal_id
        and jam.is_jam_participant(p.jam_id, auth.uid())
    )
  );

create policy jam_location_votes_delete_own
  on jam.jam_location_votes for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from jam.jam_location_proposals p
      where p.id = jam_location_votes.proposal_id
        and jam.is_jam_participant(p.jam_id, auth.uid())
    )
  );
