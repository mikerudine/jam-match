/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_TELEGRAM_BOT_USERNAME?: string
  /** Set to "true" to show email/password (local seed) on the sign-in screen. */
  readonly VITE_ENABLE_EMAIL_LOGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface TelegramWebApp {
  initData: string
  initDataUnsafe: Record<string, unknown>
  ready: () => void
  expand: () => void
  colorScheme?: 'light' | 'dark'
}

interface TelegramNamespace {
  WebApp?: TelegramWebApp
}

interface Window {
  Telegram?: TelegramNamespace
  onTelegramAuth?: (user: {
    id: number
    first_name: string
    last_name?: string
    username?: string
    photo_url?: string
    auth_date: number
    hash: string
  }) => void
}
