-- Date-level availability overrides on top of the weekly day×hour grid.
-- mode 'full' = all 24 hours that calendar day; 'off' = unavailable that day.

create table jam.availability_date_overrides (
  user_id uuid not null references jam.profiles (id) on delete cascade,
  on_date date not null,
  mode text not null check (mode in ('full', 'off')),
  primary key (user_id, on_date)
);

create index availability_date_overrides_date_idx
  on jam.availability_date_overrides (on_date);

alter table jam.availability_date_overrides enable row level security;

create policy availability_date_overrides_select_own
  on jam.availability_date_overrides for select
  to authenticated
  using (user_id = auth.uid());

create policy availability_date_overrides_insert_own
  on jam.availability_date_overrides for insert
  to authenticated
  with check (user_id = auth.uid());

create policy availability_date_overrides_update_own
  on jam.availability_date_overrides for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy availability_date_overrides_delete_own
  on jam.availability_date_overrides for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on jam.availability_date_overrides to authenticated;

-- Matching / browse: respect date overrides (Europe/Kyiv calendar day).
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
      (gs at time zone 'Europe/Kyiv')::date as on_date,
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
      select bool_and(
        case o.mode
          when 'off' then false
          when 'full' then true
          else exists (
            select 1
            from jam.availability_slots a
            where a.user_id = p_user_id
              and a.day_of_week = h.dow
              and a.hour = h.hr
          )
        end
      )
      from hours h
      left join jam.availability_date_overrides o
        on o.user_id = p_user_id
       and o.on_date = h.on_date
    ),
    false
  );
$$;

revoke all on function jam.user_covers_window(uuid, timestamptz, timestamptz) from public, anon, authenticated;
