import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/AuthContext'
import type { TelegramWidgetUser } from '@/auth/types'
import { TelegramLoginButton } from '@/components/TelegramLoginButton'
import { emailLoginEnabled, telegramBotUsername } from '@/lib/config'
import { useLocale } from '@/i18n/LocaleContext'

export function SignInPage() {
  const { auth } = useAuth()
  const { t, locale } = useLocale()
  const [email, setEmail] = useState('musician03@jam-match.local')
  const [password, setPassword] = useState('password123')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'magic' | 'password'>('password')
  const [miniAppTrying, setMiniAppTrying] = useState(false)
  const miniAppAttempted = useRef(false)

  // Telegram Mini App: if initData is present, sign in automatically.
  useEffect(() => {
    if (!auth || miniAppAttempted.current) return
    const initData = window.Telegram?.WebApp?.initData
    if (!initData) return

    miniAppAttempted.current = true
    setMiniAppTrying(true)
    setError(null)
    window.Telegram?.WebApp?.ready()
    window.Telegram?.WebApp?.expand?.()

    auth
      .signInWithTelegramInitData(initData)
      .catch((err) => {
        setError(err instanceof Error ? err.message : t.common.error)
      })
      .finally(() => setMiniAppTrying(false))
  }, [auth, t.common.error])

  async function onTelegramWidget(user: TelegramWidgetUser) {
    if (!auth) return
    setBusy(true)
    setError(null)
    try {
      await auth.signInWithTelegramWidget(user)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  async function onEmailSubmit(e: FormEvent) {
    e.preventDefault()
    if (!auth) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'magic') {
        const redirectTo = `${window.location.origin}${window.location.pathname}`
        await auth.signInWithMagicLink(email.trim(), redirectTo)
        setSent(true)
      } else {
        await auth.signInWithPassword(email.trim(), password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <div className="anim-rise">
        <p className="font-display text-4xl font-extrabold text-cream">{t.brand}</p>
        <p className="mt-2 text-mute">{t.tagline}</p>
      </div>

      <div className="mt-8 space-y-4 rounded-2xl border border-line bg-panel/90 p-5 anim-rise-delay">
        <h1 className="font-display text-2xl">{t.auth.title}</h1>
        <p className="text-sm text-mute">{t.auth.telegramHint}</p>

        {miniAppTrying ? (
          <p className="text-sm text-teal">{t.auth.telegramMiniApp}</p>
        ) : (
          <div className={busy ? 'pointer-events-none opacity-60' : undefined}>
            <TelegramLoginButton onAuth={onTelegramWidget} lang={locale} />
          </div>
        )}

        {!telegramBotUsername && (
          <p className="text-xs text-mute">{t.auth.telegramBotMissing}</p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      {emailLoginEnabled && (
        <form
          onSubmit={onEmailSubmit}
          className="mt-6 space-y-4 rounded-2xl border border-dashed border-line/80 bg-panel/50 p-5 anim-rise-delay"
        >
          <p className="text-xs uppercase tracking-wide text-mute">
            {t.auth.devEmail}
          </p>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode('password')}
              className={`rounded-full px-3 py-1 ${
                mode === 'password' ? 'bg-amber text-ink' : 'border border-line text-mute'
              }`}
            >
              {t.auth.passwordLocal}
            </button>
            <button
              type="button"
              onClick={() => setMode('magic')}
              className={`rounded-full px-3 py-1 ${
                mode === 'magic' ? 'bg-amber text-ink' : 'border border-line text-mute'
              }`}
            >
              {t.auth.magicLink}
            </button>
          </div>
          {mode === 'magic' && (
            <p className="text-sm text-mute">{t.auth.magicHint}</p>
          )}
          <label className="block text-sm text-mute">
            {t.auth.email}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-ink px-3 py-3 text-cream outline-none focus:border-amber"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          {mode === 'password' && (
            <label className="block text-sm text-mute">
              {t.auth.password}
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-ink px-3 py-3 text-cream outline-none focus:border-amber"
                autoComplete="current-password"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-amber px-4 py-3 font-semibold text-ink transition hover:bg-amber-deep disabled:opacity-60"
          >
            {mode === 'magic' ? t.auth.sendLink : t.auth.title}
          </button>
          {sent && <p className="text-sm text-teal">{t.auth.sent}</p>}
        </form>
      )}
    </div>
  )
}
