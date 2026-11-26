import {
  notifyJamCancelled,
  notifyJoinRequest,
  notifyMatchingInvite,
  type NotifyResult,
} from '@/api/notify'
import { getSupabase } from '@/lib/supabase'
import type {
  ConfirmedMember,
  Instrument,
  JamAudience,
  JamFormat,
  JamInvite,
  JamJoinRequest,
  JamRequest,
  JamSeat,
  Profile,
  PublicJam,
  PublicJamDenied,
} from '@/types'
import { isPublicJamDenied } from '@/types'

export interface CreateJamInput {
  theme: string
  format: JamFormat
  genres: string[]
  area?: string | null
  base_name?: string
  window_start?: string | null
  window_end?: string | null
  invite_ttl_hours: number
  creator_role: Instrument
  wanted_roles: Instrument[]
  audience?: JamAudience
}

export async function createJam(input: CreateJamInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_jam_request', {
    p_format: input.format,
    p_genres: input.genres,
    p_area: input.area ?? null,
    p_base_name: input.base_name ?? null,
    p_window_start: input.window_start ?? null,
    p_window_end: input.window_end ?? null,
    p_invite_ttl_hours: input.invite_ttl_hours,
    p_creator_role: input.creator_role,
    p_wanted_roles: input.wanted_roles,
    p_theme: input.theme,
    p_audience: input.audience ?? 'open',
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
  audience?: JamAudience
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
    p_audience: input.audience ?? null,
  })
  if (error) throw error
}

async function notifyNewInvites(inviteIds: string[]): Promise<void> {
  await Promise.all(
    inviteIds.map((id) => notifyMatchingInvite(id).catch(() => undefined)),
  )
}

/** Run matching for one jam (caller must be a participant). Global null is rejected server-side. */
export async function runMatching(jamId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('process_jam_matching', {
    p_jam_id: jamId,
  })
  if (error) throw error
  const inviteIds = (Array.isArray(data) ? data : []) as string[]
  await notifyNewInvites(inviteIds)
  return inviteIds.length
}

/**
 * Set jam window (idea → scheduled) and run matching.
 * Creator only; used for suggested slots on undated jams.
 */
export async function applyJamWindowAndMatch(input: {
  jam_id: string
  window_start: string
  window_end: string
}): Promise<number> {
  const { data, error } = await getSupabase().rpc('apply_jam_window', {
    p_jam_id: input.jam_id,
    p_window_start: input.window_start,
    p_window_end: input.window_end,
  })
  if (error) throw error
  const inviteIds = (Array.isArray(data) ? data : []) as string[]
  await notifyNewInvites(inviteIds)
  return inviteIds.length
}

export async function listMyJams(userId: string): Promise<
  Array<JamRequest & { seats: JamSeat[] }>
> {
  const supabase = getSupabase()

  // Scheduled / mine = seats I fill + jams I created (organizer view).
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

/** Discoverable feed row for home tabs (RPC jam.list_browse_jams). */
export interface BrowseJamRow extends JamRequest {
  creator_display_name: string
  filled_count: number
  open_count: number
  covers_my_availability: boolean
  is_friend_creator: boolean
  /** True if any other participant is a friend (not only the organizer). */
  has_friend_participant: boolean
  i_am_participant: boolean
  suggested_window_start?: string | null
  suggested_window_end?: string | null
  suggested_match_count?: number | null
  suggested_participant_count?: number | null
  suggested_matched_names?: string[] | null
}

export async function listBrowseJams(): Promise<BrowseJamRow[]> {
  const { data, error } = await getSupabase().rpc('list_browse_jams')
  if (error) throw error
  return (data ?? []) as BrowseJamRow[]
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

  const { data: invites, error } = await supabase
    .from('jam_invites')
    .select('*')
    .eq('invitee_id', userId)
    .order('created_at', { ascending: false })
    .limit(80)
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
  const { data, error } = await getSupabase().rpc('respond_to_invite', {
    p_invite_id: inviteId,
    p_accept: accept,
  })
  if (error) throw error
  const nextInviteId = typeof data === 'string' ? data : null
  if (nextInviteId) {
    await notifyMatchingInvite(nextInviteId).catch(() => undefined)
  }
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

/** Creator cancels a matching/confirmed jam; soft-notifies filled members. */
export async function cancelJam(
  jamId: string,
): Promise<{ notify: NotifyResult }> {
  const { error } = await getSupabase().rpc('cancel_jam', {
    p_jam_id: jamId,
  })
  if (error) throw error
  const notify = await notifyJamCancelled(jamId)
  return { notify }
}

/** Creator marks a confirmed jam completed (undated anytime; dated after window_end). */
export async function completeJam(jamId: string): Promise<void> {
  const { error } = await getSupabase().rpc('complete_jam', {
    p_jam_id: jamId,
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
}): Promise<{ requestId: string; notify: NotifyResult }> {
  const { data, error } = await getSupabase().rpc('request_to_join', {
    p_jam_id: input.jam_id,
    p_role: input.role,
    p_note: input.note ?? null,
  })
  if (error) throw error
  const requestId = data as string
  const notify = await notifyJoinRequest(requestId)
  return { requestId, notify }
}

export async function respondToJoinRequest(
  requestId: string,
  accept: boolean,
): Promise<{ notify: NotifyResult }> {
  const { error } = await getSupabase().rpc('respond_to_join_request', {
    p_request_id: requestId,
    p_accept: accept,
  })
  if (error) throw error
  const notify = await notifyJoinRequest(requestId)
  return { notify }
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

export type PublicJamResult =
  | { kind: 'jam'; jam: PublicJam }
  | { kind: 'denied'; reason: PublicJamDenied['denied'] }
  | { kind: 'none' }

export async function getPublicJam(jamId: string): Promise<PublicJam | null> {
  const result = await getPublicJamResult(jamId)
  return result.kind === 'jam' ? result.jam : null
}

export async function getPublicJamResult(
  jamId: string,
): Promise<PublicJamResult> {
  const { data, error } = await getSupabase().rpc('get_public_jam', {
    p_jam_id: jamId,
  })
  if (error) throw error
  if (!data) return { kind: 'none' }
  if (isPublicJamDenied(data)) {
    return { kind: 'denied', reason: data.denied }
  }
  const jam = data as PublicJam
  if (!jam.audience) jam.audience = 'open'
  return { kind: 'jam', jam }
}
