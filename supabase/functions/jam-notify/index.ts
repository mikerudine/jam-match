/**
 * jam-notify — Telegram DMs for join requests and matching invites.
 *
 * Body:
 *   { request_id } — join flow (organizer Accept/Decline or decision to requester)
 *   { invite_id }  — matching invite to invitee
 *
 * Secrets: TELEGRAM_BOT_TOKEN
 * Optional: TELEGRAM_BOT_USERNAME (default jammatch_bot)
 * Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *
 * verify_jwt = true (gateway). Failures soft-skip so RPC flows stay OK.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  DEFAULT_BOT_USERNAME,
  buildJamOpenKeyboard,
  buildJoinRequestKeyboard,
  formatDecisionMessage,
  formatJoinRequestMessage,
  formatMatchingInviteMessage,
} from '../_shared/join_notify.ts'
import { sendTelegramMessage } from '../_shared/telegram_api.ts'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface JoinRow {
  id: string
  jam_id: string
  requester_id: string
  role: string
  note: string | null
  status: 'pending' | 'accepted' | 'declined'
}

interface InviteRow {
  id: string
  jam_id: string
  seat_id: string
  invitee_id: string
  status: string
  expires_at: string
}

interface JamRow {
  id: string
  creator_id: string
  format: string
  genres: string[] | null
  area: string
  window_start: string
  window_end: string
}

interface SeatRow {
  id: string
  role: string
  filled_by: string | null
}

interface ProfileRow {
  id: string
  display_name: string
  telegram_id: number | null
  telegram_write_access?: boolean | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' })
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const botUsername =
    (Deno.env.get('TELEGRAM_BOT_USERNAME') ?? DEFAULT_BOT_USERNAME).replace(
      /^@/,
      '',
    ) || DEFAULT_BOT_USERNAME
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!botToken || !supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error('jam-notify misconfigured')
    return json(200, { ok: false, skipped: 'server_misconfigured' })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json(401, { error: 'missing_authorization' })
  }

  let body: { request_id?: string; invite_id?: string }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const requestId =
    typeof body.request_id === 'string' ? body.request_id.trim() : ''
  const inviteId =
    typeof body.invite_id === 'string' ? body.invite_id.trim() : ''

  if (!requestId && !inviteId) {
    return json(400, { error: 'missing_request_id_or_invite_id' })
  }
  if (requestId && inviteId) {
    return json(400, { error: 'ambiguous_ids' })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) {
    return json(401, { error: 'invalid_session' })
  }

  const jam = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: 'jam' },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    if (inviteId) {
      return await notifyMatchingInvite({
        jam,
        userId: user.id,
        inviteId,
        botToken,
        botUsername,
      })
    }

    return await notifyJoinRequest({
      jam,
      userId: user.id,
      requestId,
      botToken,
      botUsername,
    })
  } catch (err) {
    console.error('jam-notify unexpected', err)
    return json(200, { ok: false, skipped: 'unexpected_error' })
  }
})

async function notifyMatchingInvite(input: {
  jam: ReturnType<typeof createClient>
  userId: string
  inviteId: string
  botToken: string
  botUsername: string
}): Promise<Response> {
  const { jam, userId, inviteId, botToken, botUsername } = input

  const { data: invite, error: inviteErr } = await jam
    .from('jam_invites')
    .select('id, jam_id, seat_id, invitee_id, status, expires_at')
    .eq('id', inviteId)
    .maybeSingle()

  if (inviteErr || !invite) {
    console.error('invite load failed', inviteErr)
    return json(200, { ok: false, skipped: 'invite_not_found' })
  }

  const inv = invite as InviteRow
  if (inv.status !== 'pending') {
    return json(200, { ok: false, skipped: 'invite_not_pending' })
  }

  const { data: jamRow, error: jamErr } = await jam
    .from('jam_requests')
    .select('id, creator_id, format, genres, area, window_start, window_end')
    .eq('id', inv.jam_id)
    .maybeSingle()

  if (jamErr || !jamRow) {
    console.error('jam load failed', jamErr)
    return json(200, { ok: false, skipped: 'jam_not_found' })
  }

  const jamData = jamRow as JamRow

  const { data: seats, error: seatsErr } = await jam
    .from('jam_seats')
    .select('id, role, filled_by')
    .eq('jam_id', inv.jam_id)

  if (seatsErr) {
    console.error('seats load failed', seatsErr)
    return json(200, { ok: false, skipped: 'seats_failed' })
  }

  const seatList = (seats ?? []) as SeatRow[]
  const isParticipant =
    jamData.creator_id === userId ||
    seatList.some((s) => s.filled_by === userId)

  const { data: callerInvites, error: callerInvErr } = await jam
    .from('jam_invites')
    .select('id')
    .eq('jam_id', inv.jam_id)
    .eq('invitee_id', userId)
    .limit(1)

  if (callerInvErr) {
    console.error('caller invites load failed', callerInvErr)
    return json(200, { ok: false, skipped: 'authz_failed' })
  }

  const wasInvitee = (callerInvites ?? []).length > 0
  if (!isParticipant && !wasInvitee) {
    return json(403, { error: 'forbidden' })
  }

  const seat = seatList.find((s) => s.id === inv.seat_id)
  if (!seat) {
    return json(200, { ok: false, skipped: 'seat_not_found' })
  }

  const { data: profile, error: profileErr } = await jam
    .from('profiles')
    .select('id, display_name, telegram_id, telegram_write_access')
    .eq('id', inv.invitee_id)
    .maybeSingle()

  if (profileErr) {
    console.error('invitee profile load failed', profileErr)
    return json(200, { ok: false, skipped: 'profiles_failed' })
  }

  const invitee = profile as ProfileRow | null
  const chatId = invitee?.telegram_id
  if (!chatId) {
    return json(200, { ok: false, skipped: 'invitee_no_telegram' })
  }

  if (!jamData.window_start || !jamData.window_end) {
    return json(200, { ok: false, skipped: 'jam_undated' })
  }

  const text = formatMatchingInviteMessage({
    role: seat.role,
    jamFormat: jamData.format,
    jamArea: jamData.area,
    jamGenres: jamData.genres,
    windowStart: jamData.window_start,
    windowEnd: jamData.window_end,
    expiresAt: inv.expires_at,
    jamId: jamData.id,
    botUsername,
  })
  const markup = buildJamOpenKeyboard({
    jamId: jamData.id,
    botUsername,
  })
  const sent = await sendTelegramMessage(botToken, chatId, text, markup)
  if (!sent.ok) {
    console.error('sendMessage to invitee failed', sent.description)
    return json(200, {
      ok: false,
      skipped: 'telegram_send_failed',
      detail: sent.description ?? null,
    })
  }
  return json(200, { ok: true, notified: 'invitee' })
}

async function notifyJoinRequest(input: {
  jam: ReturnType<typeof createClient>
  userId: string
  requestId: string
  botToken: string
  botUsername: string
}): Promise<Response> {
  const { jam, userId, requestId, botToken, botUsername } = input

  const { data: joinReq, error: joinErr } = await jam
    .from('jam_join_requests')
    .select('id, jam_id, requester_id, role, note, status')
    .eq('id', requestId)
    .maybeSingle()

  if (joinErr || !joinReq) {
    console.error('join request load failed', joinErr)
    return json(200, { ok: false, skipped: 'request_not_found' })
  }

  const reqRow = joinReq as JoinRow

  const { data: jamRow, error: jamErr } = await jam
    .from('jam_requests')
    .select('id, creator_id, format, genres, area, window_start, window_end')
    .eq('id', reqRow.jam_id)
    .maybeSingle()

  if (jamErr || !jamRow) {
    console.error('jam load failed', jamErr)
    return json(200, { ok: false, skipped: 'jam_not_found' })
  }

  const jamData = jamRow as JamRow

  const { data: profiles, error: profileErr } = await jam
    .from('profiles')
    .select('id, display_name, telegram_id, telegram_write_access')
    .in('id', [reqRow.requester_id, jamData.creator_id])

  if (profileErr) {
    console.error('profiles load failed', profileErr)
    return json(200, { ok: false, skipped: 'profiles_failed' })
  }

  const byId = new Map(
    ((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p]),
  )
  const requester = byId.get(reqRow.requester_id)
  const initiator = byId.get(jamData.creator_id)

  if (reqRow.status === 'pending') {
    if (userId !== reqRow.requester_id) {
      return json(403, { error: 'forbidden' })
    }
    const chatId = initiator?.telegram_id
    if (!chatId) {
      return json(200, { ok: false, skipped: 'initiator_no_telegram' })
    }

    const text = formatJoinRequestMessage({
      requesterName: requester?.display_name ?? 'музикант',
      role: reqRow.role,
      note: reqRow.note,
      jamFormat: jamData.format,
      jamArea: jamData.area,
      jamGenres: jamData.genres,
      windowStart: jamData.window_start,
      windowEnd: jamData.window_end,
      jamId: jamData.id,
      requestId: reqRow.id,
      botUsername,
    })
    const markup = buildJoinRequestKeyboard({
      requestId: reqRow.id,
      jamId: jamData.id,
      botUsername,
    })
    const sent = await sendTelegramMessage(botToken, chatId, text, markup)
    if (!sent.ok) {
      console.error('sendMessage to initiator failed', sent.description)
      return json(200, {
        ok: false,
        skipped: 'telegram_send_failed',
        detail: sent.description ?? null,
      })
    }
    return json(200, { ok: true, notified: 'initiator' })
  }

  if (reqRow.status === 'accepted' || reqRow.status === 'declined') {
    if (userId !== jamData.creator_id) {
      return json(403, { error: 'forbidden' })
    }
    const chatId = requester?.telegram_id
    if (!chatId) {
      return json(200, { ok: false, skipped: 'requester_no_telegram' })
    }

    const text = formatDecisionMessage({
      accepted: reqRow.status === 'accepted',
      jamFormat: jamData.format,
      jamArea: jamData.area,
      jamGenres: jamData.genres,
      windowStart: jamData.window_start,
      windowEnd: jamData.window_end,
      role: reqRow.role,
      jamId: jamData.id,
      botUsername,
    })
    const markup = buildJamOpenKeyboard({
      jamId: jamData.id,
      botUsername,
    })
    const sent = await sendTelegramMessage(botToken, chatId, text, markup)
    if (!sent.ok) {
      console.error('sendMessage to requester failed', sent.description)
      return json(200, {
        ok: false,
        skipped: 'telegram_send_failed',
        detail: sent.description ?? null,
      })
    }
    return json(200, { ok: true, notified: 'requester' })
  }

  return json(200, { ok: false, skipped: 'unexpected_status' })
}
