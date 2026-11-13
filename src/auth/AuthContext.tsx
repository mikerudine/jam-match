import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabaseConfigured } from '@/lib/config'
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
