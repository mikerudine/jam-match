-- P2 defense in depth: jam tables should not be readable by anon even if RLS slips.
-- Authenticated keeps existing grants; service_role unchanged.

revoke all on all tables in schema jam from anon, public;

-- Re-affirm authenticated DML where needed (profiles already column-scoped).
grant select, insert, update, delete on all tables in schema jam to authenticated;
grant usage, select on all sequences in schema jam to authenticated;

-- Profiles: keep telegram_id / write_access off authenticated SELECT/INSERT/UPDATE.
revoke all on table jam.profiles from authenticated;
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

notify pgrst, 'reload schema';
