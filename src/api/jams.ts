import { getSupabase } from '@/lib/supabase'
import type {
  ConfirmedMember,
  Instrument,
  JamFormat,
  JamInvite,
  JamJoinRequest,
  JamRequest,
  JamSeat,
  Profile,
} from '@/types'

export interface CreateJamInput {
  format: JamFormat
  genres: string[]
  area: string
  base_name?: string
  window_start: string
  window_end: string
  invite_ttl_hours: number
  creator_role: Instrument
  wanted_roles: Instrument[]
}

export async function createJam(input: CreateJamInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_jam_request', {
    p_format: input.format,
    p_genres: input.genres,
    p_area: input.area,
    p_base_name: input.base_name ?? null,
    p_window_start: input.window_start,
    p_window_end: input.window_end,
    p_invite_ttl_hours: input.invite_ttl_hours,
    p_creator_role: input.creator_role,
    p_wanted_roles: input.wanted_roles,
  })
  if (error) throw error
  return data as string
}

export interface UpdateJamInput {
  jam_id: string
  format: JamFormat
  genres: string[]
  area: string
  base_name?: string
  window_start: string
  window_end: string
  invite_ttl_hours: number
  creator_role: Instrument
  keep_seat_ids: string[]
  add_roles: Instrument[]
}

export async function updateJam(input: UpdateJamInput): Promise<void> {
  const { error } = await getSupabase().rpc('update_jam_request', {
    p_jam_id: input.jam_id,
    p_format: input.format,
    p_genres: input.genres,
    p_area: input.area,
    p_base_name: input.base_name ?? null,
    p_window_start: input.window_start,
    p_window_end: input.window_end,
    p_invite_ttl_hours: input.invite_ttl_hours,
    p_creator_role: input.creator_role,
    p_keep_seat_ids: input.keep_seat_ids,
    p_add_roles: input.add_roles,
  })
  if (error) throw error
}

export async function runMatching(jamId?: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('process_jam_matching', {
    p_jam_id: jamId ?? null,
  })
  if (error) throw error
  return (data as number) ?? 0
}

export async function listMyJams(userId: string): Promise<
  Array<JamRequest & { seats: JamSeat[] }>
> {
  const supabase = getSupabase()

  const { data: seatRows, error: seatErr } = await supabase
    .from('jam_seats')
    .select('jam_id')
    .eq('filled_by', userId)
  if (seatErr) throw seatErr

  const { data: created, error: createdErr } = await supabase
    .from('jam_requests')
    .select('*')
    .eq('creator_id', userId)
  if (createdErr) throw createdErr

  const jamIds = new Set<string>([
    ...(created ?? []).map((j) => j.id as string),
    ...(seatRows ?? []).map((s) => s.jam_id as string),
  ])

  if (jamIds.size === 0) return []

  const { data: jams, error: jamErr } = await supabase
    .from('jam_requests')
    .select('*')
    .in('id', [...jamIds])
    .order('window_start', { ascending: true })
  if (jamErr) throw jamErr

  const { data: seats, error: seatsErr } = await supabase
    .from('jam_seats')
    .select('*')
    .in('jam_id', [...jamIds])
    .order('sort_order')
  if (seatsErr) throw seatsErr

  return (jams ?? []).map((jam) => ({
    ...(jam as JamRequest),
    seats: (seats ?? []).filter((s) => s.jam_id === jam.id) as JamSeat[],
  }))
}

export async function getJamDetail(jamId: string): Promise<{
  jam: JamRequest
  seats: JamSeat[]
  members: ConfirmedMember[]
}> {
  const supabase = getSupabase()
  const { data: jam, error: jamErr } = await supabase
    .from('jam_requests')
    .select('*')
    .eq('id', jamId)
    .single()
  if (jamErr) throw jamErr

  const { data: seats, error: seatsErr } = await supabase
    .from('jam_seats')
    .select('*')
    .eq('jam_id', jamId)
    .order('sort_order')
  if (seatsErr) throw seatsErr

  const filledIds = (seats ?? [])
    .map((s) => s.filled_by as string | null)
    .filter((id): id is string => Boolean(id))

  let profiles: Profile[] = []
  if (filledIds.length > 0) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, telegram_handle, instruments, demo_url')
      .in('id', filledIds)
    if (error) throw error
    profiles = (data ?? []) as Profile[]
  }

  const members: ConfirmedMember[] = (seats ?? [])
    .filter((s) => s.filled_by)
    .map((s) => {
      const profile = profiles.find((p) => p.id === s.filled_by)!
      return {
        seat_id: s.id as string,
        role: s.role as Instrument,
        profile,
      }
    })

  return {
    jam: jam as JamRequest,
    seats: (seats ?? []) as JamSeat[],
    members,
  }
}

export async function listInbox(userId: string): Promise<
  Array<
    JamInvite & {
      jam: JamRequest
      seat: JamSeat
      creator: Pick<Profile, 'id' | 'display_name' | 'telegram_handle'> | null
    }
  >
> {
  const supabase = getSupabase()
  await runMatching()

  const { data: invites, error } = await supabase
    .from('jam_invites')
    .select('*')
    .eq('invitee_id', userId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  if (!invites?.length) return []

  const jamIds = [...new Set(invites.map((i) => i.jam_id as string))]
  const seatIds = [...new Set(invites.map((i) => i.seat_id as string))]

  const [{ data: jams }, { data: seats }] = await Promise.all([
    supabase.from('jam_requests').select('*').in('id', jamIds),
    supabase.from('jam_seats').select('*').in('id', seatIds),
  ])

  const creatorIds = [...new Set((jams ?? []).map((j) => j.creator_id as string))]
  const { data: creators } = await supabase
    .from('profiles')
    .select('id, display_name, telegram_handle')
    .in('id', creatorIds)

  return invites.map((invite) => {
    const jam = (jams ?? []).find((j) => j.id === invite.jam_id) as JamRequest
    const seat = (seats ?? []).find((s) => s.id === invite.seat_id) as JamSeat
    const creator =
      (creators ?? []).find((c) => c.id === jam.creator_id) ?? null
    return {
      ...(invite as JamInvite),
      jam,
      seat,
      creator,
    }
  })
}

export async function respondToInvite(
  inviteId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc('respond_to_invite', {
    p_invite_id: inviteId,
    p_accept: accept,
  })
  if (error) throw error
}

export async function submitFeedback(input: {
  jam_id: string
  rating: number
  everyone_showed_up: boolean
}): Promise<void> {
  const { error } = await getSupabase().rpc('submit_jam_feedback', {
    p_jam_id: input.jam_id,
    p_rating: input.rating,
    p_everyone_showed_up: input.everyone_showed_up,
  })
  if (error) throw error
}

export async function hasSubmittedFeedback(
  jamId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('jam_feedback')
    .select('id')
    .eq('jam_id', jamId)
    .eq('from_user_id', userId)
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export async function requestToJoin(input: {
  jam_id: string
  role: string
  note?: string
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('request_to_join', {
    p_jam_id: input.jam_id,
    p_role: input.role,
    p_note: input.note ?? null,
  })
  if (error) throw error
  return data as string
}

export async function respondToJoinRequest(
  requestId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc('respond_to_join_request', {
    p_request_id: requestId,
    p_accept: accept,
  })
  if (error) throw error
}

export async function listJoinRequestsForJam(
  jamId: string,
): Promise<
  Array<
    JamJoinRequest & {
      requester: Pick<
        Profile,
        'id' | 'display_name' | 'telegram_handle' | 'instruments'
      > | null
    }
  >
> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('jam_join_requests')
    .select('*')
    .eq('jam_id', jamId)
    .order('created_at', { ascending: false })
  if (error) throw error
  if (!data?.length) return []

  const ids = [...new Set(data.map((r) => r.requester_id as string))]
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, display_name, telegram_handle, instruments')
    .in('id', ids)
  if (pErr) throw pErr

  return data.map((row) => ({
    ...(row as JamJoinRequest),
    requester:
      (profiles ?? []).find((p) => p.id === row.requester_id) ?? null,
  }))
}

export async function getMyJoinRequest(
  jamId: string,
  userId: string,
): Promise<JamJoinRequest | null> {
  const { data, error } = await getSupabase()
    .from('jam_join_requests')
    .select('*')
    .eq('jam_id', jamId)
    .eq('requester_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as JamJoinRequest | null) ?? null
}
