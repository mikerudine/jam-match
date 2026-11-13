import { useEffect, useRef } from 'react'
import {
  isKnownTelegramOauthEvent,
  isTelegramWidgetUser,
  parseTelegramOauthMessage,
} from '@/auth/telegramWidgetAuth'
import type { TelegramWidgetUser } from '@/auth/types'
import { telegramBotUsername } from '@/lib/config'
import { useLocale } from '@/i18n/LocaleContext'

interface Props {
  onAuth: (user: TelegramWidgetUser) => void
  lang?: 'uk' | 'en'
}

/** Hosts allow-listed via BotFather /setdomain for the Login Widget. */
const WIDGET_HOSTS = new Set(['mikerudine.github.io'])

function hostAllowsWidget(): boolean {
  if (typeof window === 'undefined') return false
  return WIDGET_HOSTS.has(window.location.hostname)
}

/**
 * Telegram Login via the official widget script (telegram-widget.js).
 * Uses data-onauth → window.__jamTgAuth so postMessage `auth_user` /
 * auth_data is handled by Telegram's script (incl. return_to + iOS redirect).
 */
export function TelegramLoginButton({ onAuth, lang = 'uk' }: Props) {
  const { t } = useLocale()
  const onAuthRef = useRef(onAuth)
  onAuthRef.current = onAuth
  const containerRef = useRef<HTMLDivElement>(null)
  const canEmbed = hostAllowsWidget()

  useEffect(() => {
    if (!canEmbed || !telegramBotUsername) return

    let lastHash: string | null = null
    function deliver(user: TelegramWidgetUser) {
      if (!isTelegramWidgetUser(user)) return
      // Widget data-onauth and our message listener may both fire.
      if (lastHash === user.hash) return
      lastHash = user.hash
      onAuthRef.current(user)
    }

    window.__jamTgAuth = deliver

    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://oauth.telegram.org') return
      const user = parseTelegramOauthMessage(event.data)
      if (user) {
        deliver(user)
        return
      }
      if (!isKnownTelegramOauthEvent(event.data)) {
        console.warn(
          '[TelegramLogin] Unrecognised oauth.telegram.org message',
          event.data,
        )
      }
    }
    window.addEventListener('message', onMessage)

    const container = containerRef.current
    if (container) {
      container.innerHTML = ''
      const script = document.createElement('script')
      script.async = true
      script.src = 'https://telegram.org/js/telegram-widget.js?22'
      script.setAttribute('data-telegram-login', telegramBotUsername)
      script.setAttribute('data-size', 'large')
      script.setAttribute('data-request-access', 'write')
      script.setAttribute('data-radius', '12')
      script.setAttribute('data-onauth', '__jamTgAuth(user)')
      if (lang === 'uk') script.setAttribute('data-lang', 'uk')
      container.appendChild(script)
    }

    return () => {
      window.removeEventListener('message', onMessage)
      if (window.__jamTgAuth) delete window.__jamTgAuth
      if (container) container.innerHTML = ''
    }
  }, [canEmbed, lang])

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

  return (
    <div className="text-center">
      <div ref={containerRef} className="mx-auto inline-block min-h-10" />
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
