import type { Session } from '@supabase/supabase-js'
import { supabaseConfig } from '@/lib/config'
import { getSupabase } from '@/lib/supabase'
import type {
  AuthAdapter,
  AuthSession,
  TelegramWidgetUser,
} from './types'

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

interface TelegramAuthResponse {
  token_hash: string
  email: string
  user_id: string
  error?: string
}

async function exchangeTelegramAuth(body: Record<string, unknown>): Promise<void> {
  const supabase = getSupabase()
  const url = `${supabaseConfig.url.replace(/\/$/, '')}/functions/v1/telegram-auth`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseConfig.anonKey}`,
      apikey: supabaseConfig.anonKey,
    },
    body: JSON.stringify(body),
  })

  let payload: TelegramAuthResponse
  try {
    payload = (await res.json()) as TelegramAuthResponse
  } catch {
    throw new Error(`telegram-auth: HTTP ${res.status}`)
  }

  if (!res.ok || !payload.token_hash) {
    throw new Error(payload.error ?? `telegram-auth: HTTP ${res.status}`)
  }

  const { error } = await supabase.auth.verifyOtp({
    token_hash: payload.token_hash,
    type: 'email',
  })
  if (error) throw error
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

    async signInWithTelegramWidget(user: TelegramWidgetUser) {
      await exchangeTelegramAuth({ mode: 'widget', user })
    },

    async signInWithTelegramInitData(initData: string) {
      await exchangeTelegramAuth({ mode: 'webapp', initData })
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
