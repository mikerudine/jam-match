/**
 * Telegram Login Widget + Mini App initData hash verification.
 * Pure Web Crypto — runnable in Deno (Edge Functions) and Node (tests).
 *
 * Widget:  secret = SHA256(bot_token); HMAC-SHA256(data_check_string, secret)
 * Mini App: secret = HMAC-SHA256(bot_token, key="WebAppData"); HMAC-SHA256(data_check_string, secret)
 */

export type TelegramAuthMode = 'widget' | 'webapp'

export interface TelegramUserPayload {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
  /** Extra widget fields (optional) */
  [key: string]: string | number | undefined
}

const encoder = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

async function sha256(data: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', data)
}

async function hmacSha256(
  keyBytes: BufferSource,
  message: BufferSource,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', key, message)
}

/** Build the Telegram data-check-string from auth fields (excludes hash). */
export function buildDataCheckString(
  fields: Record<string, string>,
): string {
  return Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')
}

/** Flatten widget / parsed user object into string map for hashing. */
export function fieldsFromWidgetUser(
  user: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(user)) {
    if (value === undefined || value === null) continue
    out[key] = String(value)
  }
  return out
}

/** Parse Telegram Mini App initData query string into a string map. */
export function parseInitData(initData: string): Record<string, string> {
  const params = new URLSearchParams(initData)
  const out: Record<string, string> = {}
  for (const [key, value] of params.entries()) {
    out[key] = value
  }
  return out
}

export async function computeTelegramHash(
  fields: Record<string, string>,
  botToken: string,
  mode: TelegramAuthMode,
): Promise<string> {
  const dataCheckString = buildDataCheckString(fields)
  let secretKey: ArrayBuffer

  if (mode === 'widget') {
    secretKey = await sha256(encoder.encode(botToken))
  } else {
    // Mini App: HMAC_SHA256(bot_token, key = "WebAppData")
    secretKey = await hmacSha256(
      encoder.encode('WebAppData'),
      encoder.encode(botToken),
    )
  }

  const mac = await hmacSha256(secretKey, encoder.encode(dataCheckString))
  return toHex(mac)
}

export async function verifyTelegramHash(
  fields: Record<string, string>,
  botToken: string,
  mode: TelegramAuthMode,
): Promise<boolean> {
  const provided = (fields.hash ?? '').toLowerCase()
  if (!provided || !/^[0-9a-f]+$/.test(provided)) return false
  const expected = await computeTelegramHash(fields, botToken, mode)
  return timingSafeEqualHex(provided, expected.toLowerCase())
}

export function checkAuthDateFreshness(
  authDate: number,
  maxAgeSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isFinite(authDate) || authDate <= 0) return false
  if (authDate > nowSeconds + 60) return false // clock skew / future
  return nowSeconds - authDate <= maxAgeSeconds
}

export function extractUserFromFields(
  fields: Record<string, string>,
  mode: TelegramAuthMode,
): TelegramUserPayload | null {
  if (mode === 'widget') {
    const id = Number(fields.id)
    const auth_date = Number(fields.auth_date)
    if (!Number.isFinite(id) || !Number.isFinite(auth_date) || !fields.hash) {
      return null
    }
    return {
      id,
      auth_date,
      hash: fields.hash,
      first_name: fields.first_name,
      last_name: fields.last_name,
      username: fields.username,
      photo_url: fields.photo_url,
    }
  }

  // Mini App: user is a JSON object in the `user` field
  if (!fields.user || !fields.auth_date || !fields.hash) return null
  let userObj: Record<string, unknown>
  try {
    userObj = JSON.parse(fields.user) as Record<string, unknown>
  } catch {
    return null
  }
  const id = Number(userObj.id)
  const auth_date = Number(fields.auth_date)
  if (!Number.isFinite(id) || !Number.isFinite(auth_date)) return null
  return {
    id,
    auth_date,
    hash: fields.hash,
    first_name:
      typeof userObj.first_name === 'string' ? userObj.first_name : undefined,
    last_name:
      typeof userObj.last_name === 'string' ? userObj.last_name : undefined,
    username:
      typeof userObj.username === 'string' ? userObj.username : undefined,
    photo_url:
      typeof userObj.photo_url === 'string' ? userObj.photo_url : undefined,
  }
}

/** Default: auth payload must be ≤ 24h old. */
export const DEFAULT_MAX_AUTH_AGE_SECONDS = 86_400
