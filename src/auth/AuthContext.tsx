import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ensureProfile } from '@/api/profile'
import { supabaseConfigured } from '@/lib/config'
import { requestTelegramWriteAccessOnce } from '@/lib/telegramWriteAccess'
import { createSupabaseAuthAdapter } from './supabaseAuth'
import type { AuthAdapter, AuthSession } from './types'

interface AuthContextValue {
  session: AuthSession | null
  loading: boolean
  configured: boolean
  auth: AuthAdapter | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useMemo(
    () => (supabaseConfigured ? createSupabaseAuthAdapter() : null),
    [],
  )
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(Boolean(auth))
  const ensuredForUser = useRef<string | null>(null)

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }

    let cancelled = false
    auth.getSession().then((s) => {
      if (!cancelled) {
        setSession(s)
        setLoading(false)
      }
    })

    const unsubscribe = auth.onAuthStateChange((s) => {
      setSession(s)
      setLoading(false)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [auth])

  // After every successful sign-in (incl. magic-link redirect / page reload),
  // ensure jam.profiles exists. Idempotent; Telegram path also calls with
  // explicit fields right after verifyOtp.
  useEffect(() => {
    if (!session?.user.id) {
      ensuredForUser.current = null
      return
    }
    if (ensuredForUser.current === session.user.id) return
    ensuredForUser.current = session.user.id
    ensureProfile()
      .then(() => {
        // After a session exists, ask Telegram once for bot DM permission
        // so join Accept/Decline notifications can reach the user.
        if (window.Telegram?.WebApp?.initData) {
          requestTelegramWriteAccessOnce()
        }
      })
      .catch((err) => {
        console.error('ensure_profile failed', err)
        ensuredForUser.current = null
      })
  }, [session?.user.id])

  const value = useMemo(
    () => ({
      session,
      loading,
      configured: supabaseConfigured,
      auth,
    }),
    [session, loading, auth],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
