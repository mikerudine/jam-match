import type { TelegramWidgetUser } from './types'

const TG_AUTH_RESULT_RE = /[#?&]tgAuthResult=([A-Za-z0-9\-_=]*)$/

const KNOWN_OAUTH_EVENTS = new Set([
  'auth_user',
  'ready',
  'resize',
  'visible_off',
  'get_coords',
  'scroll_to',
  'unauthorized',
  'callback',
])

export function isTelegramWidgetUser(value: unknown): value is TelegramWidgetUser {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    typeof v.hash === 'string' &&
    typeof v.auth_date === 'number'
  )
}

/**
 * Parse postMessage payloads from oauth.telegram.org.
 * Official widget sends JSON string `{"event":"auth_user","auth_data":{...}}`.
 * Also accepts object form, legacy `{result: user}`, and bare user objects.
 */
export function parseTelegramOauthMessage(data: unknown): TelegramWidgetUser | null {
  let payload: unknown = data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return null
    }
  }
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>

  if (record.event === 'auth_user') {
    return isTelegramWidgetUser(record.auth_data) ? record.auth_data : null
  }

  if ('result' in record) {
    return isTelegramWidgetUser(record.result) ? record.result : null
  }

  if (isTelegramWidgetUser(record)) return record

  return null
}

/** True when a parsed oauth.telegram.org message is a known widget event. */
export function isKnownTelegramOauthEvent(data: unknown): boolean {
  let payload: unknown = data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return false
    }
  }
  if (!payload || typeof payload !== 'object') return false
  const event = (payload as { event?: unknown }).event
  return typeof event === 'string' && KNOWN_OAUTH_EVENTS.has(event)
}

/** Decode Telegram Login Widget `#tgAuthResult=<base64url JSON>` payload. */
export function decodeTgAuthResult(encoded: string): TelegramWidgetUser | null {
  if (!encoded) return null
  try {
    let data = encoded.replace(/-/g, '+').replace(/_/g, '/')
    // Match telegram-widget.js: new Array(5 - pad).join('=') ⇒ 4-pad equals.
    const pad = data.length % 4
    if (pad > 1) {
      data += '='.repeat(4 - pad)
    }
    const parsed: unknown = JSON.parse(atob(data))
    return isTelegramWidgetUser(parsed) ? parsed : null
  } catch {
    return null
  }
}

export interface TgAuthResultExtraction {
  user: TelegramWidgetUser
  cleanedHash: string
  cleanedSearch: string
}

/**
 * Find `tgAuthResult` at the end of hash or search (Telegram widget regex),
 * decode it, and return cleaned hash/search without the token.
 */
export function extractTgAuthResult(
  hash: string,
  search = '',
): TgAuthResultExtraction | null {
  const hashMatch = hash.match(TG_AUTH_RESULT_RE)
  if (hashMatch) {
    const user = decodeTgAuthResult(hashMatch[1] ?? '')
    if (!user) return null
    let cleanedHash = hash.replace(TG_AUTH_RESULT_RE, '')
    if (cleanedHash === '#') cleanedHash = ''
    return { user, cleanedHash, cleanedSearch: search }
  }

  const searchMatch = search.match(TG_AUTH_RESULT_RE)
  if (searchMatch) {
    const user = decodeTgAuthResult(searchMatch[1] ?? '')
    if (!user) return null
    let cleanedSearch = search.replace(TG_AUTH_RESULT_RE, '')
    if (cleanedSearch === '?' || cleanedSearch === '&') cleanedSearch = ''
    return { user, cleanedHash: hash, cleanedSearch }
  }

  return null
}

/**
 * Read + strip `tgAuthResult` from the current URL before HashRouter mounts.
 * Uses history.replaceState so the auth fragment is not treated as a route.
 */
export function consumeTgAuthResultFromLocation(
  loc: Pick<Location, 'hash' | 'search' | 'pathname' | 'href'> = window.location,
  historyApi: Pick<History, 'replaceState'> = window.history,
): TelegramWidgetUser | null {
  const extracted = extractTgAuthResult(loc.hash, loc.search)
  if (!extracted) return null

  const url = new URL(loc.href)
  // URL.hash / URL.search setters add the `#` / `?` prefix when non-empty.
  const hashBody = extracted.cleanedHash.replace(/^#/, '')
  const searchBody = extracted.cleanedSearch.replace(/^\?/, '')
  url.hash = hashBody
  url.search = searchBody

  historyApi.replaceState(
    null,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  return extracted.user
}

let pendingTelegramWidgetUser: TelegramWidgetUser | null = null

export function setPendingTelegramWidgetUser(user: TelegramWidgetUser | null): void {
  pendingTelegramWidgetUser = user
}

export function takePendingTelegramWidgetUser(): TelegramWidgetUser | null {
  const user = pendingTelegramWidgetUser
  pendingTelegramWidgetUser = null
  return user
}
