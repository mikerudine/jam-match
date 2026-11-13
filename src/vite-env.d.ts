/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_TELEGRAM_BOT_USERNAME?: string
  /** BotFather Mini App short name; defaults to "jam". */
  readonly VITE_TELEGRAM_APP_NAME?: string
  /** Set to "true" to show email/password (local seed) on the sign-in screen. */
  readonly VITE_ENABLE_EMAIL_LOGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface TelegramWebApp {
  initData: string
  initDataUnsafe: {
    start_param?: string
    [key: string]: unknown
  }
  ready: () => void
  expand: () => void
  openTelegramLink?: (url: string) => void
  colorScheme?: 'light' | 'dark'
}

interface TelegramNamespace {
  WebApp?: TelegramWebApp
}

interface Window {
  Telegram?: TelegramNamespace
  /** Official Login Widget data-onauth callback (bound by TelegramLoginButton). */
  __jamTgAuth?: (user: {
    id: number
    first_name: string
    last_name?: string
    username?: string
    photo_url?: string
    auth_date: number
    hash: string
  }) => void
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
