import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ensureProfile } from '@/api/profile'
import { useLocale } from '@/i18n/LocaleContext'
import { supabaseConfigured } from '@/lib/config'
import { requestTelegramWriteAccessOnce } from '@/lib/telegramWriteAccess'
import { createSupabaseAuthAdapter } from './supabaseAuth'
import type { AuthAdapter, AuthSession } from './types'

interface AuthContextValue {
  session: AuthSession | null
  loading: boolean
  configured: boolean
  auth: AuthAdapter | null
  profileReady: boolean
  profileError: string | null
  retryEnsureProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  const auth = useMemo(
    () => (supabaseConfigured ? createSupabaseAuthAdapter() : null),
    [],
  )
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(Boolean(auth))
  const [profileReady, setProfileReady] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileRetrying, setProfileRetrying] = useState(false)
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

  const runEnsureProfile = useCallback(async (userId: string) => {
    setProfileError(null)
    await ensureProfile()
    ensuredForUser.current = userId
    setProfileReady(true)
    if (window.Telegram?.WebApp?.initData) {
      requestTelegramWriteAccessOnce()
    }
  }, [])

  // After every successful sign-in (incl. magic-link redirect / page reload),
  // ensure jam.profiles exists. Idempotent; Telegram path also calls with
  // explicit fields right after verifyOtp.
  useEffect(() => {
    if (!session?.user.id) {
      ensuredForUser.current = null
      setProfileReady(false)
      setProfileError(null)
      return
    }
    if (ensuredForUser.current === session.user.id) {
      setProfileReady(true)
      return
    }
    const userId = session.user.id
    runEnsureProfile(userId).catch((err) => {
      console.error('ensure_profile failed', err)
      ensuredForUser.current = null
      setProfileReady(false)
      setProfileError(
        err instanceof Error ? err.message : t.auth.profileSyncFailed,
      )
    })
  }, [session?.user.id, runEnsureProfile, t.auth.profileSyncFailed])

  const retryEnsureProfile = useCallback(async () => {
    if (!session?.user.id) return
    setProfileRetrying(true)
    try {
      await runEnsureProfile(session.user.id)
    } catch (err) {
      console.error('ensure_profile retry failed', err)
      ensuredForUser.current = null
      setProfileReady(false)
      setProfileError(
        err instanceof Error ? err.message : t.auth.profileSyncFailed,
      )
    } finally {
      setProfileRetrying(false)
    }
  }, [session?.user.id, runEnsureProfile, t.auth.profileSyncFailed])

  const value = useMemo(
    () => ({
      session,
      loading,
      configured: supabaseConfigured,
      auth,
      profileReady,
      profileError,
      retryEnsureProfile,
    }),
    [
      session,
      loading,
      auth,
      profileReady,
      profileError,
      retryEnsureProfile,
    ],
  )

  return (
    <AuthContext.Provider value={value}>
      {profileError ? (
        <div className="border-b border-amber/40 bg-amber/15 px-4 py-3 text-sm text-cream">
          <p>{t.auth.profileSyncFailed}</p>
          {profileError !== t.auth.profileSyncFailed ? (
            <p className="mt-1 text-xs text-mute">{profileError}</p>
          ) : null}
          <button
            type="button"
            disabled={profileRetrying}
            onClick={() => {
              void retryEnsureProfile()
            }}
            className="mt-2 rounded-lg bg-teal px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-60"
          >
            {profileRetrying ? t.common.loading : t.auth.profileSyncRetry}
          </button>
        </div>
      ) : null}
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
