const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const supabaseConfigured = Boolean(url && anonKey)

export const supabaseConfig = {
  url,
  anonKey,
} as const

/** Bot username without @ — required for the Login Widget on the website. */
export const telegramBotUsername = (
  import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? ''
).trim().replace(/^@/, '')

/**
 * BotFather Mini App short name used in t.me/<bot>/<app>?startapp=…
 * Defaults to `jam` (no secret required).
 */
export const telegramAppName = (
  import.meta.env.VITE_TELEGRAM_APP_NAME ?? 'jam'
).trim() || 'jam'

/**
 * Email / password magic-link UI for local seed accounts.
 * Production community sign-in is Telegram only.
 */
export const emailLoginEnabled =
  (import.meta.env.VITE_ENABLE_EMAIL_LOGIN ?? '').trim() === 'true'
