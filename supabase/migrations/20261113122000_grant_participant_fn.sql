-- Policies evaluate as the invoking role, so authenticated needs EXECUTE.
grant execute on function private.is_jam_participant(uuid, uuid) to authenticated;
