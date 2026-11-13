export interface AuthUser {
  id: string
  email: string | null
}

export interface AuthSession {
  user: AuthUser
  accessToken: string
}

/**
 * Auth adapter — swap Supabase magic-link for Telegram initData later
 * without rewriting the rest of the app.
 */
export interface AuthAdapter {
  getSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  signInWithMagicLink(email: string, redirectTo: string): Promise<void>
  /** Local/seed convenience; production MVP uses magic link. */
  signInWithPassword(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}
