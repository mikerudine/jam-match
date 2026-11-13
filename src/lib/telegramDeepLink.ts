/**
 * Telegram Mini App startapp payload helpers.
 *
 * Direct links: https://t.me/<bot>/<app>?startapp=<payload>
 * startapp allows only [A-Za-z0-9_-], max 64 chars.
 * Jam UUIDs are encoded as jam_<32 hex> (dashes stripped).
 */

const JAM_START_PREFIX = 'jam_'
const UUID_DASHED_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_HEX_RE = /^[0-9a-f]{32}$/i

/** Strip UUID dashes → 32 hex chars. Accepts dashed or already-stripped. */
export function encodeJamIdForStartParam(jamId: string): string {
  const trimmed = jamId.trim()
  if (UUID_DASHED_RE.test(trimmed)) {
    return trimmed.replace(/-/g, '').toLowerCase()
  }
  if (UUID_HEX_RE.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  throw new Error(`Invalid jam id for start_param: ${jamId}`)
}

/** Build `jam_<32hex>` startapp payload (≤ 64 chars). */
export function encodeJamStartParam(jamId: string): string {
  const encoded = `${JAM_START_PREFIX}${encodeJamIdForStartParam(jamId)}`
  if (encoded.length > 64) {
    throw new Error(`start_param too long (${encoded.length}): ${encoded}`)
  }
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error(`start_param has illegal chars: ${encoded}`)
  }
  return encoded
}

/** Decode `jam_<id>` → dashed UUID, or null if not a jam deep link. */
export function decodeJamStartParam(param: string | null | undefined): string | null {
  if (!param) return null
  const raw = param.trim()
  if (!raw.toLowerCase().startsWith(JAM_START_PREFIX)) return null

  const body = raw.slice(JAM_START_PREFIX.length)
  if (UUID_DASHED_RE.test(body)) return body.toLowerCase()
  if (!UUID_HEX_RE.test(body)) return null

  const hex = body.toLowerCase()
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export interface BuildJamTelegramLinkOptions {
  botUsername: string
  appName?: string
}

/**
 * Main Mini App (empty appName): https://t.me/<bot>?startapp=jam_<id>
 * Named /newapp: https://t.me/<bot>/<app>?startapp=jam_<id>
 */
export function buildJamTelegramLink(
  jamId: string,
  options: BuildJamTelegramLinkOptions,
): string {
  const bot = options.botUsername.trim().replace(/^@/, '')
  if (!bot) throw new Error('Telegram bot username is required')
  const app = (options.appName ?? '').trim()
  const startapp = encodeJamStartParam(jamId)
  const path = app ? `${bot}/${app}` : bot
  return `https://t.me/${path}?startapp=${startapp}`
}

/**
 * Read Mini App start_param from WebApp.initDataUnsafe or URL tgWebAppStartParam.
 */
export function readTelegramStartParam(
  win: Pick<Window, 'Telegram' | 'location'> = window,
): string | null {
  const unsafe = win.Telegram?.WebApp?.initDataUnsafe
  const fromWebApp =
    unsafe && typeof unsafe === 'object'
      ? (unsafe as { start_param?: unknown }).start_param
      : undefined
  if (typeof fromWebApp === 'string' && fromWebApp.trim()) {
    return fromWebApp.trim()
  }

  try {
    const params = new URLSearchParams(win.location.search)
    const fromQuery = params.get('tgWebAppStartParam')
    if (fromQuery?.trim()) return fromQuery.trim()
  } catch {
    // ignore
  }

  // HashRouter apps sometimes receive Telegram params in the hash query form.
  try {
    const hash = win.location.hash.replace(/^#/, '')
    const qIndex = hash.indexOf('?')
    const hashQuery = qIndex >= 0 ? hash.slice(qIndex + 1) : hash
    if (hashQuery.includes('tgWebAppStartParam=')) {
      const params = new URLSearchParams(
        hashQuery.startsWith('?') ? hashQuery.slice(1) : hashQuery,
      )
      const fromHash = params.get('tgWebAppStartParam')
      if (fromHash?.trim()) return fromHash.trim()
    }
  } catch {
    // ignore
  }

  return null
}

let pendingJamIdFromStartParam: string | null = null

/** Capture jam id from start_param once at startup (before HashRouter). */
export function capturePendingJamFromStartParam(
  win: Pick<Window, 'Telegram' | 'location'> = window,
): string | null {
  const jamId = decodeJamStartParam(readTelegramStartParam(win))
  if (jamId) pendingJamIdFromStartParam = jamId
  return jamId
}

export function peekPendingJamFromStartParam(): string | null {
  return pendingJamIdFromStartParam
}

/** Consume pending jam id so navigation runs once. */
export function takePendingJamFromStartParam(): string | null {
  const id = pendingJamIdFromStartParam
  pendingJamIdFromStartParam = null
  return id
}

/** Test helper. */
export function setPendingJamFromStartParamForTests(jamId: string | null): void {
  pendingJamIdFromStartParam = jamId
}
