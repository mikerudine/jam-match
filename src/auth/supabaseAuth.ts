import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import type { AuthAdapter, AuthSession } from './types'

function mapSession(session: Session | null): AuthSession | null {
  if (!session?.user) return null
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
    },
    accessToken: session.access_token,
  }
}

export function createSupabaseAuthAdapter(): AuthAdapter {
  const supabase = getSupabase()

  return {
    async getSession() {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      return mapSession(data.session)
    },

    onAuthStateChange(callback) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(mapSession(session))
      })
      return () => data.subscription.unsubscribe()
    },

    async signInWithMagicLink(email, redirectTo) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      })
      if (error) throw error
    },

    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },

    async signOut() {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  }
}
