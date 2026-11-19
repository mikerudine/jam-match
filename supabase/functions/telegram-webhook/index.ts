/**
 * telegram-webhook — Telegram Bot updates (verify_jwt = false).
 * Validates X-Telegram-Bot-Api-Secret-Token against TELEGRAM_WEBHOOK_SECRET.
 *
 * Handles:
 *   - callback_query jr:a:<id> / jr:d:<id> → respond_to_join_request_as + notify
 *   - /start → greeting + Mini App button
 *
 * Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
 * Optional: TELEGRAM_BOT_USERNAME
 * Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  DEFAULT_BOT_USERNAME,
  buildJamOpenKeyboard,
  buildStartGreeting,
  buildStartKeyboard,
  formatDecisionMessage,
  formatResolvedOrganizerMessage,
  parseJoinCallbackData,
} from '../_shared/join_notify.ts'
import {
  answerCallbackQuery,
  editTelegramMessage,
  sendTelegramMessage,
} from '../_shared/telegram_api.ts'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface CallbackQuery {
  id: string
  from: { id: number; first_name?: string; username?: string }
  data?: string
  message?: {
    message_id: number
    chat: { id: number }
    text?: string
  }
}

interface TelegramUpdate {
  update_id?: number
  message?: {
    message_id: number
    chat: { id: number }
    text?: string
    from?: { id: number }
  }
  callback_query?: CallbackQuery
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 })
  }
  if (req.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405 })
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  const botUsername =
    (Deno.env.get('TELEGRAM_BOT_USERNAME') ?? DEFAULT_BOT_USERNAME).replace(
      /^@/,
      '',
    ) || DEFAULT_BOT_USERNAME
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!botToken || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error('telegram-webhook misconfigured')
    return new Response('misconfigured', { status: 500 })
  }

  const headerSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
  if (!timingSafeEqual(headerSecret, webhookSecret)) {
    return new Response('unauthorized', { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await req.json()) as TelegramUpdate
  } catch {
    return new Response('invalid_json', { status: 400 })
  }

  const jam = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: 'jam' },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // --- /start -------------------------------------------------------------
  const msgText = update.message?.text?.trim() ?? ''
  if (update.message && (msgText === '/start' || msgText.startsWith('/start '))) {
    const chatId = update.message.chat.id
    await sendTelegramMessage(
      botToken,
      chatId,
      buildStartGreeting(),
      buildStartKeyboard({ botUsername }),
    )
    return ok()
  }

  // --- callback_query -----------------------------------------------------
  const cq = update.callback_query
  if (!cq) return ok()

  const parsed = parseJoinCallbackData(cq.data)
  if (!parsed) {
    await answerCallbackQuery(botToken, cq.id, 'Невідома дія', true)
    return ok()
  }

  const telegramUserId = cq.from.id
  const { data: actorProfile, error: actorErr } = await jam
    .from('profiles')
    .select('id, display_name, telegram_id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  if (actorErr || !actorProfile) {
    console.error('actor profile missing', actorErr)
    await answerCallbackQuery(
      botToken,
      cq.id,
      'Спочатку увійди в Jam Match через Telegram',
      true,
    )
    return ok()
  }

  const accept = parsed.action === 'accept'

  const { error: rpcErr } = await jam.rpc('respond_to_join_request_as', {
    p_actor: actorProfile.id,
    p_request_id: parsed.requestId,
    p_accept: accept,
  })

  if (rpcErr) {
    console.error('respond_to_join_request_as failed', rpcErr)
    const hint =
      rpcErr.message?.includes('already resolved')
        ? 'Запит уже оброблено'
        : rpcErr.message?.includes('only the initiator')
          ? 'Лише організатор може відповісти'
          : 'Не вдалося відповісти'
    await answerCallbackQuery(botToken, cq.id, hint, true)
    return ok()
  }

  // Reload request + jam + requester for message edits / notify.
  const { data: joinReq } = await jam
    .from('jam_join_requests')
    .select('id, jam_id, requester_id, role, status')
    .eq('id', parsed.requestId)
    .maybeSingle()

  const jamId = joinReq?.jam_id as string | undefined
  let jamRow: {
    format: string
    genres: string[] | null
    area: string
    window_start: string
    window_end: string
  } | null = null
  let requesterName = 'музикант'
  let requesterTelegramId: number | null = null

  if (jamId) {
    const { data: j } = await jam
      .from('jam_requests')
      .select('format, genres, area, window_start, window_end')
      .eq('id', jamId)
      .maybeSingle()
    jamRow = j as typeof jamRow

    if (joinReq?.requester_id) {
      const { data: reqProfile } = await jam
        .from('profiles')
        .select('display_name, telegram_id')
        .eq('id', joinReq.requester_id)
        .maybeSingle()
      requesterName = (reqProfile?.display_name as string) || requesterName
      requesterTelegramId =
        typeof reqProfile?.telegram_id === 'number'
          ? reqProfile.telegram_id
          : null
    }
  }

  const role = (joinReq?.role as string) || '—'
  const resolvedText = formatResolvedOrganizerMessage({
    accepted: accept,
    requesterName,
    role,
  })

  if (cq.message?.chat?.id != null && cq.message.message_id != null) {
    await editTelegramMessage(
      botToken,
      cq.message.chat.id,
      cq.message.message_id,
      resolvedText,
      jamId
        ? buildJamOpenKeyboard({ jamId, botUsername })
        : { inline_keyboard: [] },
    )
  }

  await answerCallbackQuery(
    botToken,
    cq.id,
    accept ? 'Прийнято' : 'Відхилено',
  )

  // Notify requester (best-effort).
  if (requesterTelegramId && jamRow && jamId) {
    const text = formatDecisionMessage({
      accepted: accept,
      jamFormat: jamRow.format,
      jamArea: jamRow.area,
      jamGenres: jamRow.genres,
      windowStart: jamRow.window_start,
      windowEnd: jamRow.window_end,
      role,
      jamId,
      botUsername,
    })
    const sent = await sendTelegramMessage(
      botToken,
      requesterTelegramId,
      text,
      buildJamOpenKeyboard({ jamId, botUsername }),
    )
    if (!sent.ok) {
      console.error('decision notify failed', sent.description)
    }
  }

  return ok()
})
