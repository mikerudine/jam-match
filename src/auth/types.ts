export interface AuthUser {
  id: string
  email: string | null
}

export interface AuthSession {
  user: AuthUser
  accessToken: string
}

/** Payload from Telegram Login Widget `data-onauth` callback. */
export interface TelegramWidgetUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

/**
 * Auth adapter — Supabase session behind Telegram (primary) or email (dev).
 */
export interface AuthAdapter {
  getSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  /** Telegram Login Widget user object (already hashed by Telegram). */
  signInWithTelegramWidget(user: TelegramWidgetUser): Promise<void>
  /** Telegram Mini App `Telegram.WebApp.initData` query string. */
  signInWithTelegramInitData(initData: string): Promise<void>
  /** Dev / seed only — gated by VITE_ENABLE_EMAIL_LOGIN. */
  signInWithMagicLink(email: string, redirectTo: string): Promise<void>
  /** Local/seed convenience; gated by VITE_ENABLE_EMAIL_LOGIN. */
  signInWithPassword(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}
