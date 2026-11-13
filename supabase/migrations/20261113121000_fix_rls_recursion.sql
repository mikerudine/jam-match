-- Break RLS recursion between jam_requests / jam_seats / jam_invites
-- by checking membership via SECURITY DEFINER helpers.

create or replace function private.is_jam_participant(p_jam_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.jam_requests j
      where j.id = p_jam_id and j.creator_id = p_uid
    )
    or exists (
      select 1 from public.jam_seats s
      where s.jam_id = p_jam_id and s.filled_by = p_uid
    )
    or exists (
      select 1 from public.jam_invites i
      where i.jam_id = p_jam_id and i.invitee_id = p_uid
    );
$$;

revoke all on function private.is_jam_participant(uuid, uuid) from public;

drop policy if exists jam_requests_select on public.jam_requests;
create policy jam_requests_select
  on public.jam_requests for select
  to authenticated
  using (private.is_jam_participant(id, auth.uid()));

drop policy if exists jam_seats_select on public.jam_seats;
create policy jam_seats_select
  on public.jam_seats for select
  to authenticated
  using (private.is_jam_participant(jam_id, auth.uid()));

drop policy if exists jam_invites_select_own on public.jam_invites;
create policy jam_invites_select_own
  on public.jam_invites for select
  to authenticated
  using (
    invitee_id = auth.uid()
    or private.is_jam_participant(jam_id, auth.uid())
  );

drop policy if exists jam_feedback_select_members on public.jam_feedback;
create policy jam_feedback_select_members
  on public.jam_feedback for select
  to authenticated
  using (private.is_jam_participant(jam_id, auth.uid()));
