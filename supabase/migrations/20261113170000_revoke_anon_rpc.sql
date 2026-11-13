-- Harden EXECUTE privileges on jam-schema functions.
-- PostgreSQL grants EXECUTE to PUBLIC by default; init granted authenticated
-- but never revoked PUBLIC/anon on several SECURITY DEFINER RPCs.
-- Schema jam only; do not touch auth, public, or other schemas.

-- Client-facing RPCs: revoke default PUBLIC/anon leak, keep authenticated.
revoke execute on function jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer,
  jam.instrument, jam.instrument[]
) from public, anon;

revoke execute on function jam.process_jam_matching(uuid) from public, anon;
revoke execute on function jam.respond_to_invite(uuid, boolean) from public, anon;
revoke execute on function jam.submit_jam_feedback(uuid, integer, boolean) from public, anon;
revoke execute on function jam.is_jam_participant(uuid, uuid) from public, anon;

grant execute on function jam.create_jam_request(
  jam.jam_format, text[], text, text, timestamptz, timestamptz, integer,
  jam.instrument, jam.instrument[]
) to authenticated;

grant execute on function jam.process_jam_matching(uuid) to authenticated;
grant execute on function jam.respond_to_invite(uuid, boolean) to authenticated;
grant execute on function jam.submit_jam_feedback(uuid, integer, boolean) to authenticated;
grant execute on function jam.is_jam_participant(uuid, uuid) to authenticated;

-- Internal helpers: must not be callable by anon/public (or clients).
revoke execute on function jam.user_covers_window(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function jam.role_scarcity(jam.instrument)
  from public, anon, authenticated;
revoke execute on function jam.expire_pending_invites(uuid)
  from public, anon, authenticated;
revoke execute on function jam.offer_next_for_seat(uuid)
  from public, anon, authenticated;
revoke execute on function jam.maybe_confirm_jam(uuid)
  from public, anon, authenticated;

-- ensure_profile: authenticated only (current Telegram-aware signature).
revoke execute on function jam.ensure_profile(
  text, bigint, text, text, text, text
) from public, anon;

grant execute on function jam.ensure_profile(
  text, bigint, text, text, text, text
) to authenticated;

-- Future functions in jam should not inherit PUBLIC EXECUTE.
alter default privileges in schema jam
  revoke execute on functions from public;
