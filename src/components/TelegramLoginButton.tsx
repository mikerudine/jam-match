import { useEffect, useRef } from 'react'
import { telegramBotUsername } from '@/lib/config'
import type { TelegramWidgetUser } from '@/auth/types'
import { useLocale } from '@/i18n/LocaleContext'

interface Props {
  onAuth: (user: TelegramWidgetUser) => void
  lang?: 'uk' | 'en'
}

/** Hosts allow-listed via BotFather /setdomain for the Login Widget. */
const WIDGET_HOSTS = new Set(['mikerudine.github.io'])

function isWidgetUser(value: unknown): value is TelegramWidgetUser {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    typeof v.hash === 'string' &&
    typeof v.auth_date === 'number'
  )
}

function hostAllowsWidget(): boolean {
  if (typeof window === 'undefined') return false
  return WIDGET_HOSTS.has(window.location.hostname)
}

/**
 * Telegram Login via oauth.telegram.org embed (no document.write).
 * Requires BotFather /setdomain for the page host (mikerudine.github.io).
 * Off that host we show a branded placeholder + setup hint (widget cannot work).
 */
export function TelegramLoginButton({ onAuth, lang = 'uk' }: Props) {
  const { t } = useLocale()
  const onAuthRef = useRef(onAuth)
  onAuthRef.current = onAuth
  const canEmbed = hostAllowsWidget()

  useEffect(() => {
    if (!canEmbed) return

    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://oauth.telegram.org') return
      let data: unknown = event.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          return
        }
      }
      const payload =
        data && typeof data === 'object' && 'result' in data
          ? (data as { result: unknown }).result
          : data
      if (isWidgetUser(payload)) onAuthRef.current(payload)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [canEmbed])

  if (!telegramBotUsername) {
    return (
      <p className="rounded-xl border border-line bg-ink/60 px-3 py-3 text-sm text-mute">
        {t.auth.telegramBotMissing}
      </p>
    )
  }

  if (!canEmbed) {
    return (
      <div className="space-y-2 text-center">
        <div
          className="mx-auto inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
          style={{ background: '#54a9eb' }}
        >
          <TelegramGlyph />
          {t.auth.telegramButton}
        </div>
        <p className="text-xs text-mute">{t.auth.telegramDomainHint}</p>
      </div>
    )
  }

  const origin = encodeURIComponent(window.location.origin)
  const src =
    `https://oauth.telegram.org/embed/${encodeURIComponent(telegramBotUsername)}` +
    `?origin=${origin}&size=large&request_access=write&radius=12` +
    (lang === 'uk' ? '&lang=uk' : '')

  return (
    <div className="text-center">
      <iframe
        id="jam-match-telegram-login"
        title={t.auth.telegramButton}
        src={src}
        width={260}
        height={48}
        className="mx-auto border-0"
        scrolling="no"
        style={{ overflow: 'hidden' }}
      />
    </div>
  )
}

function TelegramGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21.5 3.5 2.8 10.7c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.7.4.9 1 .9.6 0 .9-.3 1.2-.6l2.9-2.8 5.1 3.8c.9.5 1.6.2 1.8-.9l3.3-15.5c.3-1.3-.5-1.9-1.5-1.4Z"
        fill="currentColor"
      />
    </svg>
  )
}
