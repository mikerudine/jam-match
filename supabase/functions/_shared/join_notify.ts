/**
 * Pure helpers for Telegram join-request notifications.
 * Shared by jam-notify + telegram-webhook; tested with Node strip-types.
 */

export const DEFAULT_BOT_USERNAME = 'jammatch_bot'
export const MINI_APP_URL = 'https://mikerudine.github.io/jam-match/'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FORMAT_UK: Record<string, string> = {
  free_jam: 'Вільний джем',
  cover_practice: 'Кавери',
  permanent_band: 'Постійний склад',
}

export type JoinCallbackAction = 'accept' | 'decline'

export interface ParsedJoinCallback {
  action: JoinCallbackAction
  requestId: string
}

/** Build callback_data for Accept / Decline (≤ 64 bytes). */
export function buildJoinCallbackData(
  action: JoinCallbackAction,
  requestId: string,
): string {
  const id = requestId.trim().toLowerCase()
  if (!UUID_RE.test(id)) {
    throw new Error(`invalid join request id: ${requestId}`)
  }
  const code = action === 'accept' ? 'a' : 'd'
  const data = `jr:${code}:${id}`
  if (data.length > 64) {
    throw new Error(`callback_data too long: ${data.length}`)
  }
  return data
}

/** Parse jr:a:<uuid> / jr:d:<uuid>; null if malformed. */
export function parseJoinCallbackData(
  data: string | null | undefined,
): ParsedJoinCallback | null {
  if (!data || typeof data !== 'string') return null
  const m = /^jr:([ad]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    data.trim(),
  )
  if (!m) return null
  return {
    action: m[1]!.toLowerCase() === 'a' ? 'accept' : 'decline',
    requestId: m[2]!.toLowerCase(),
  }
}

/** Strip UUID dashes → 32 hex for startapp payload. */
export function encodeJamIdForStartParam(jamId: string): string {
  const trimmed = jamId.trim().toLowerCase()
  if (UUID_RE.test(trimmed)) return trimmed.replace(/-/g, '')
  if (/^[0-9a-f]{32}$/i.test(trimmed)) return trimmed
  throw new Error(`invalid jam id: ${jamId}`)
}

export function buildJamMiniAppUrl(
  jamId: string,
  botUsername: string = DEFAULT_BOT_USERNAME,
): string {
  const bot = botUsername.trim().replace(/^@/, '') || DEFAULT_BOT_USERNAME
  const startapp = `jam_${encodeJamIdForStartParam(jamId)}`
  return `https://t.me/${bot}?startapp=${startapp}`
}

export function formatJamWindowUk(
  windowStart: string,
  windowEnd: string,
  timeZone = 'Europe/Kyiv',
): string {
  const start = new Date(windowStart)
  const end = new Date(windowEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${windowStart} – ${windowEnd}`
  }
  const dateFmt = new Intl.DateTimeFormat('uk-UA', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const timeFmt = new Intl.DateTimeFormat('uk-UA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${dateFmt.format(start)}, ${timeFmt.format(start)}–${timeFmt.format(end)}`
}

export function formatJamLabelUk(input: {
  format: string
  area: string
  genres?: string[] | null
}): string {
  const format = FORMAT_UK[input.format] ?? input.format
  const genres =
    input.genres && input.genres.length > 0
      ? input.genres.slice(0, 3).join(', ')
      : null
  return genres ? `${format} · ${input.area} · ${genres}` : `${format} · ${input.area}`
}

export interface JoinRequestNotifyInput {
  requesterName: string
  role: string
  note?: string | null
  jamFormat: string
  jamArea: string
  jamGenres?: string[] | null
  windowStart: string
  windowEnd: string
  jamId: string
  requestId: string
  botUsername?: string
}

/** Ukrainian text for a new join request (organizer). */
export function formatJoinRequestMessage(input: JoinRequestNotifyInput): string {
  const lines = [
    '🎸 Новий запит на джем',
    '',
    `Від: ${input.requesterName.trim() || 'музикант'}`,
    `Інструмент: ${input.role.trim()}`,
  ]
  const note = input.note?.trim()
  if (note) lines.push(`Нотатка: ${note}`)
  lines.push(
    '',
    `Джем: ${formatJamLabelUk({
      format: input.jamFormat,
      area: input.jamArea,
      genres: input.jamGenres,
    })}`,
    `Час: ${formatJamWindowUk(input.windowStart, input.windowEnd)}`,
  )
  return lines.join('\n')
}

export interface DecisionNotifyInput {
  accepted: boolean
  jamFormat: string
  jamArea: string
  jamGenres?: string[] | null
  windowStart: string
  windowEnd: string
  role: string
  jamId: string
  botUsername?: string
}

/** Ukrainian text notifying the requester of accept/decline. */
export function formatDecisionMessage(input: DecisionNotifyInput): string {
  const jam = formatJamLabelUk({
    format: input.jamFormat,
    area: input.jamArea,
    genres: input.jamGenres,
  })
  const when = formatJamWindowUk(input.windowStart, input.windowEnd)
  if (input.accepted) {
    return [
      '✅ Тебе прийняли на джем!',
      '',
      `Роль: ${input.role.trim()}`,
      `Джем: ${jam}`,
      `Час: ${when}`,
    ].join('\n')
  }
  return [
    '❌ Запит на джем відхилено',
    '',
    `Роль: ${input.role.trim()}`,
    `Джем: ${jam}`,
    `Час: ${when}`,
  ].join('\n')
}

/** Edited organizer message after Accept / Decline from inline buttons. */
export function formatResolvedOrganizerMessage(input: {
  accepted: boolean
  requesterName: string
  role: string
}): string {
  const name = input.requesterName.trim() || 'музикант'
  const role = input.role.trim()
  if (input.accepted) {
    return `✅ Прийнято · ${name} (${role})`
  }
  return `❌ Відхилено · ${name} (${role})`
}

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }

export function buildJoinRequestKeyboard(input: {
  requestId: string
  jamId: string
  botUsername?: string
}): { inline_keyboard: InlineButton[][] } {
  const bot = input.botUsername ?? DEFAULT_BOT_USERNAME
  return {
    inline_keyboard: [
      [
        {
          text: 'Прийняти',
          callback_data: buildJoinCallbackData('accept', input.requestId),
        },
        {
          text: 'Відхилити',
          callback_data: buildJoinCallbackData('decline', input.requestId),
        },
      ],
      [
        {
          text: 'Відкрити джем',
          url: buildJamMiniAppUrl(input.jamId, bot),
        },
      ],
    ],
  }
}

export function buildJamOpenKeyboard(input: {
  jamId: string
  botUsername?: string
}): { inline_keyboard: InlineButton[][] } {
  const bot = input.botUsername ?? DEFAULT_BOT_USERNAME
  return {
    inline_keyboard: [
      [
        {
          text: 'Відкрити джем',
          url: buildJamMiniAppUrl(input.jamId, bot),
        },
      ],
    ],
  }
}

export function buildStartGreeting(): string {
  return [
    'Привіт! Це Jam Match — збираємо склади для джемів.',
    '',
    'Натисни кнопку нижче, щоб відкрити застосунок.',
  ].join('\n')
}

export function buildStartKeyboard(input?: {
  botUsername?: string
  miniAppUrl?: string
}): { inline_keyboard: InlineButton[][] } {
  const bot = (input?.botUsername ?? DEFAULT_BOT_USERNAME).replace(/^@/, '')
  const mini = input?.miniAppUrl ?? MINI_APP_URL
  return {
    inline_keyboard: [
      [{ text: 'Відкрити Jam Match', url: `https://t.me/${bot}?startapp` }],
      [{ text: 'Сайт', url: mini }],
    ],
  }
}
